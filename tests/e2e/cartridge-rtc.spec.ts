import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CartridgeRtcState } from '../../src/core/cartridge'
import type {
  EmulatorCommand,
  EmulatorMessage,
  EmulatorSnapshot,
  MachineCheckpoint,
} from '../../src/runtime/worker-protocol'
import { createStateRecord, decodeState, encodeState } from '../../src/platform/states'
import {
  BATTERY_STORE_NAME,
  SAVE_DATABASE_NAME,
  SAVE_DATABASE_VERSION,
  STATE_STORE_NAME,
} from '../../src/platform/storage/schema'
import { buildTestRom } from '../fixtures/rom'

interface RtcWorkerProbe {
  worker: Worker
  snapshot: EmulatorSnapshot | null
}
type RtcWindow = Window &
  typeof globalThis & { __rtcWorkers: RtcWorkerProbe[]; __rtcSequence: number }
interface StoredBattery {
  version: number
  byteLength: number
  bytes: number[]
  rtc: CartridgeRtcState | null
  updatedAt: number
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as RtcWindow
    target.__rtcWorkers = []
    target.__rtcSequence = 1_000_000
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const observation: RtcWorkerProbe = { worker: this, snapshot: null }
        target.__rtcWorkers.push(observation)
        this.addEventListener('message', ({ data }: MessageEvent<EmulatorMessage>) => {
          if (data.type !== 'error' && data.snapshot)
            observation.snapshot = {
              ...data.snapshot,
              batteryRam:
                data.snapshot.batteryRam === undefined
                  ? observation.snapshot?.batteryRam
                  : data.snapshot.batteryRam,
            }
        })
      }
    }
  })
})

function rtcRom(withRam = false): Uint8Array {
  return buildTestRom({
    title: withRam ? 'RTC RAM TEST' : 'RTC ONLY TEST',
    cartridgeType: withRam ? 0x10 : 0x0f,
    ramSizeCode: withRam ? 2 : 0,
    program: withRam
      ? [
          0xf3,
          0x3e,
          0x0a,
          0xea,
          0,
          0, // DI e habilitação de RAM.
          0xfa,
          0,
          0xa0,
          0x3c,
          0xea,
          0,
          0xa0, // Incremento persistido uma vez por boot.
          0x76,
        ]
      : [0xf3, 0x76],
  })
}

function romId(rom: Uint8Array): string {
  return createHash('sha256').update(rom).digest('hex')
}

async function loadRom(page: Page, rom: Uint8Array, title: string): Promise<void> {
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'rtc-local.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(rom),
  })
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Trocar cartucho/ })).toBeEnabled()
}

async function snapshot(page: Page): Promise<EmulatorSnapshot> {
  return page.evaluate(() => {
    const state = (window as RtcWindow).__rtcWorkers.at(-1)?.snapshot
    if (!state) throw new Error('O Worker ainda não publicou um snapshot.')
    return state
  })
}

async function storedSlotBytes(page: Page, id: string): Promise<number[]> {
  return page.evaluate(
    ({ databaseName, version, storeName, id }) =>
      new Promise<number[]>((resolve, reject) => {
        const opening = indexedDB.open(databaseName, version)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const database = opening.result
          const transaction = database.transaction(storeName)
          const get = transaction.objectStore(storeName).get([id, 1])
          transaction.oncomplete = () => {
            database.close()
            resolve(Array.from(new Uint8Array(get.result.bytes)))
          }
          transaction.onabort = () => {
            database.close()
            reject(transaction.error)
          }
        }
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      version: SAVE_DATABASE_VERSION,
      storeName: STATE_STORE_NAME,
      id,
    },
  )
}

async function storedBattery(page: Page, id: string): Promise<StoredBattery | null> {
  return page.evaluate(
    ({ databaseName, version, storeName, id }) =>
      new Promise<StoredBattery | null>((resolve, reject) => {
        const request = indexedDB.open(databaseName, version)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName)
          const get = transaction.objectStore(storeName).get(id)
          transaction.onabort = () => {
            database.close()
            reject(transaction.error)
          }
          transaction.oncomplete = () => {
            database.close()
            const row = get.result as
              | {
                  version: number
                  byteLength: number
                  bytes: ArrayBuffer
                  rtc?: CartridgeRtcState
                  updatedAt: number
                }
              | undefined
            resolve(
              row
                ? { ...row, bytes: Array.from(new Uint8Array(row.bytes)), rtc: row.rtc ?? null }
                : null,
            )
          }
        }
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      version: SAVE_DATABASE_VERSION,
      storeName: BATTERY_STORE_NAME,
      id,
    },
  )
}

async function seedBattery(
  page: Page,
  id: string,
  options: { legacy?: boolean; secondsOffline?: number },
): Promise<void> {
  await page.evaluate(
    ({ databaseName, version, storeName, id, options }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName, version)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(storeName))
            database.createObjectStore(storeName, { keyPath: 'romId' })
          if (!database.objectStoreNames.contains('states')) {
            const states = database.createObjectStore('states', { keyPath: ['romId', 'slot'] })
            states.createIndex('romId', 'romId')
          }
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName, 'readwrite')
          const store = transaction.objectStore(storeName)
          if (options.legacy) {
            const bytes = new Uint8Array(8192)
            bytes[0] = 7
            store.put({
              version: 1,
              romId: id,
              byteLength: bytes.length,
              bytes: bytes.buffer,
              updatedAt: Date.now() - 120_000,
            })
          } else {
            const get = store.get(id)
            get.onsuccess = () => {
              if (!get.result) {
                transaction.abort()
                return
              }
              store.put({ ...get.result, updatedAt: Date.now() - options.secondsOffline! * 1000 })
            }
          }
          transaction.onabort = () => {
            database.close()
            reject(transaction.error ?? new Error('A bateria esperada não existe.'))
          }
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
        }
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      version: SAVE_DATABASE_VERSION,
      storeName: BATTERY_STORE_NAME,
      id,
      options,
    },
  )
}

async function runSeconds(page: Page, seconds = 1): Promise<void> {
  const before = (await snapshot(page)).cpu.totalTCycles
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).cpu.totalTCycles, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(before + seconds * 4_194_304)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).playing).toBe(false)
}

async function exportedCheckpoint(page: Page): Promise<MachineCheckpoint> {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar estado', exact: true }).click()
  const path = await (await downloading).path()
  if (!path) throw new Error('O navegador não entregou o arquivo de estado.')
  const decoded = await decodeState(new Uint8Array(await readFile(path)))
  return decoded.payload as MachineCheckpoint
}

async function workerCommand(
  page: Page,
  command: EmulatorCommand,
): Promise<Exclude<EmulatorMessage, { type: 'frame' } | { type: 'error' }>> {
  return page.evaluate(
    (command) =>
      new Promise((resolve, reject) => {
        const target = window as RtcWindow
        const worker = target.__rtcWorkers.at(-1)?.worker
        if (!worker) {
          reject(new Error('O Worker não foi iniciado.'))
          return
        }
        const id = ++target.__rtcSequence
        const timeout = setTimeout(() => {
          worker.removeEventListener('message', listener)
          reject(new Error('O comando de teste não recebeu resposta.'))
        }, 5000)
        const listener = ({ data }: MessageEvent<EmulatorMessage>) => {
          if (data.type !== 'reply' || data.id !== id) return
          clearTimeout(timeout)
          worker.removeEventListener('message', listener)
          resolve(data)
        }
        worker.addEventListener('message', listener)
        worker.postMessage({ id, command })
      }),
    command,
  )
}

test('RTC sem RAM persiste envelope v2 e recupera tempo offline após reload', async ({ page }) => {
  const rom = rtcRom()
  const id = romId(rom)
  await page.goto('/')
  await loadRom(page, rom, 'RTC ONLY TEST')
  await runSeconds(page)
  const paused = (await snapshot(page)).batteryRtc!
  expect(paused.seconds).toBeGreaterThanOrEqual(1)
  await expect.poll(async () => (await storedBattery(page, id))?.rtc).toEqual(paused)
  const first = (await storedBattery(page, id))!
  expect(first).toMatchObject({ version: 2, byteLength: 0, bytes: [] })
  await page.waitForTimeout(2100)
  expect((await snapshot(page)).batteryRtc).toEqual(paused)
  await expect
    .poll(async () => (await storedBattery(page, id))!.updatedAt)
    .toBeGreaterThan(first.updatedAt)
  await page.reload()
  await expect(page.getByLabel('Arquivo do cartucho', { exact: true })).toBeAttached()
  const before = (await storedBattery(page, id))!.rtc!
  await seedBattery(page, id, { secondsOffline: 65 })
  await loadRom(page, rom, 'RTC ONLY TEST')
  await expect(
    page.getByRole('status', { name: 'Estado do progresso', exact: true }),
  ).toContainText('Progresso recuperado')
  const recovered = (await snapshot(page)).batteryRtc!
  const beforeTotal =
    before.days * 86400 + before.hours * 3600 + before.minutes * 60 + before.seconds
  const afterTotal =
    recovered.days * 86400 + recovered.hours * 3600 + recovered.minutes * 60 + recovered.seconds
  expect(afterTotal - beforeTotal).toBeGreaterThanOrEqual(65)
  expect(afterTotal - beforeTotal).toBeLessThanOrEqual(67)
  expect(recovered.subsecondTCycles).toBe(before.subsecondTCycles)
  expect((await snapshot(page)).playing).toBe(false)
  expect((await snapshot(page)).cpu.totalTCycles).toBe(0)
})

test('RTC com RAM migra bateria v1, restaura checkpoint exato e rejeita RTC corrompido sem sobrescrever slot', async ({
  page,
}) => {
  const rom = rtcRom(true)
  const id = romId(rom)
  await page.goto('/')
  await seedBattery(page, id, { legacy: true })
  await loadRom(page, rom, 'RTC RAM TEST')
  expect((await snapshot(page)).batteryRam?.[0]).toBe(7)
  expect((await snapshot(page)).batteryRtc?.seconds).toBe(0)
  await runSeconds(page)
  await expect.poll(async () => (await storedBattery(page, id))?.bytes[0]).toBe(8)
  expect((await storedBattery(page, id))?.version).toBe(2)
  await page.getByRole('button', { name: 'Salvar estado', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado dos slots', exact: true })).toContainText(
    'Estado salvo no slot 1',
  )
  const checkpoint = await exportedCheckpoint(page)
  if (checkpoint.core.cartridge.mapper !== 'MBC3') throw new Error('A fixture precisa usar MBC3.')
  const savedRtc = checkpoint.core.cartridge.rtc
  await runSeconds(page)
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado dos slots', exact: true })).toContainText(
    'Slot 1 carregado',
  )
  expect((await snapshot(page)).batteryRtc).toEqual(savedRtc)
  expect((await snapshot(page)).cpu.totalTCycles).toBe(checkpoint.core.cpu.totalTCycles)

  const slotBytes = await storedSlotBytes(page, id)
  const invalid = {
    ...checkpoint,
    core: {
      ...checkpoint.core,
      cartridge: { ...checkpoint.core.cartridge, rtc: { ...savedRtc, seconds: 64 } },
    },
  }
  const bytes = await encodeState(await createStateRecord(id, 1, invalid))
  await page.getByLabel('Arquivo de estado', { exact: true }).setInputFiles({
    name: 'rtc-invalido.pocketstate',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  })
  await expect(page.getByRole('status', { name: 'Estado dos slots', exact: true })).toContainText(
    'RTC.seconds',
  )
  const after = await exportedCheckpoint(page)
  expect(after).toEqual(checkpoint)
  expect(await storedSlotBytes(page, id)).toEqual(slotBytes)
  // O slot válido permanece disponível após a rejeição do arquivo.
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado dos slots', exact: true })).toContainText(
    'Slot 1 carregado',
  )
  expect((await snapshot(page)).batteryRtc).toEqual(savedRtc)
})

test('Worker importa RTC-only com halt e rejeita RTC, RAM e tempo offline inválidos de forma atômica', async ({
  page,
}) => {
  await page.goto('/')
  await loadRom(page, rtcRom(), 'RTC ONLY TEST')
  const rtc: CartridgeRtcState = {
    version: 1,
    seconds: 59,
    minutes: 59,
    hours: 23,
    days: 511,
    halted: true,
    carry: false,
    subsecondTCycles: 12345,
  }
  const imported = await workerCommand(page, {
    type: 'import-battery-state',
    bytes: new Uint8Array(0),
    rtc,
    elapsedSeconds: 86400 * 512,
  })
  expect(imported.error).toBeUndefined()
  expect(imported.snapshot?.batteryRtc).toEqual(rtc)
  expect(imported.snapshot?.batteryRam?.length).toBe(0)
  const before = (await workerCommand(page, { type: 'capture-state' })).checkpoint!
  for (const command of [
    {
      type: 'import-battery-state',
      bytes: new Uint8Array(0),
      rtc: { ...rtc, seconds: 64 },
      elapsedSeconds: 0,
    },
    { type: 'import-battery-state', bytes: new Uint8Array(1), rtc, elapsedSeconds: 0 },
    { type: 'import-battery-state', bytes: new Uint8Array(0), rtc, elapsedSeconds: -1 },
  ] as EmulatorCommand[]) {
    const result = await workerCommand(page, command)
    expect(result.error).toBeTruthy()
    expect((await workerCommand(page, { type: 'capture-state' })).checkpoint).toEqual(before)
  }
})
