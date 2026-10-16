import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { buildTestRom } from '../fixtures/rom'
import {
  BATTERY_RECORD_VERSION,
  BATTERY_STORE_NAME,
  SAVE_DATABASE_NAME,
  SAVE_DATABASE_VERSION,
} from '../../src/platform/storage/schema'

function batteryRom(title = 'BATTERY TEST'): Uint8Array {
  return buildTestRom({
    title,
    cartridgeType: 3,
    ramSizeCode: 2,
    program: [
      0xf3, // DI: HALT continua aguardando, sem executar um handler de ROM.
      0x3e,
      0x0a,
      0xea,
      0x00,
      0x00, // Habilita RAM externa no MBC1.
      0xfa,
      0x00,
      0xa0,
      0x3c,
      0xea,
      0x00,
      0xa0, // Lê, incrementa e salva A000.
      0xc6,
      0x30,
      0xe0,
      0x01, // Transmite o contador como dígito ASCII.
      0x3e,
      0x81,
      0xe0,
      0x02,
      0x76,
    ],
  })
}

function romId(rom: Uint8Array): string {
  return createHash('sha256').update(rom).digest('hex')
}

async function loadRom(
  page: Page,
  rom: Uint8Array,
  name: string,
  title = 'BATTERY TEST',
): Promise<void> {
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(rom),
  })
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Trocar cartucho/ })).toBeEnabled()
}

async function runAndPause(page: Page, serial: string): Promise<void> {
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(2)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByLabel('Saída serial', { exact: true })).toHaveText(serial)
  await expect(page.getByLabel('Estado da CPU', { exact: true })).toHaveText('HALT')
}

async function storedBatteries(page: Page) {
  return page.evaluate(
    ({ databaseName, storeName, version }) =>
      new Promise<
        {
          romId: string
          version: number
          byteLength: number
          bytes: number[]
          updatedAt: number
        }[]
      >((resolve, reject) => {
        const request = indexedDB.open(databaseName, version)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName)
          const records = transaction.objectStore(storeName).getAll()
          transaction.onabort = () => {
            database.close()
            reject(transaction.error)
          }
          transaction.oncomplete = () => {
            database.close()
            resolve(
              (
                records.result as {
                  romId: string
                  version: number
                  byteLength: number
                  bytes: ArrayBuffer
                  updatedAt: number
                }[]
              ).map((record) => ({ ...record, bytes: Array.from(new Uint8Array(record.bytes)) })),
            )
          }
        }
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      storeName: BATTERY_STORE_NAME,
      version: SAVE_DATABASE_VERSION,
    },
  )
}

test('bateria sobrevive ao reload, ignora nome do arquivo e mantém cartuchos separados', async ({
  page,
}) => {
  const rom = batteryRom()
  const id = romId(rom)
  await page.goto('/')
  await loadRom(page, rom, 'primeiro-nome.gb')
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'será salvo automaticamente',
  )
  await runAndPause(page, '1')
  await expect
    .poll(async () => (await storedBatteries(page)).find((record) => record.romId === id)?.bytes[0])
    .toBe(1)

  await page.reload()
  await loadRom(page, rom, 'outro-nome.gb')
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'Progresso recuperado',
  )
  await runAndPause(page, '2')
  await expect
    .poll(async () => (await storedBatteries(page)).find((record) => record.romId === id)?.bytes[0])
    .toBe(2)
  expect(await storedBatteries(page)).toHaveLength(1)

  const other = batteryRom('OTHER BATTERY')
  await loadRom(page, other, 'outro-jogo.gb', 'OTHER BATTERY')
  await runAndPause(page, '1')
  await expect.poll(async () => (await storedBatteries(page)).length).toBe(2)
  const records = await storedBatteries(page)
  expect(records.find((record) => record.romId === id)?.bytes[0]).toBe(2)
  expect(records.find((record) => record.romId === romId(other))?.bytes[0]).toBe(1)
  expect(records.every((record) => record.byteLength === 8192)).toBe(true)
})

test('IndexedDB indisponível avisa sobre a sessão e continua executando o jogo', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await loadRom(page, batteryRom(), 'sem-armazenamento.gb')
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'IndexedDB está indisponível',
  )
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'não será salvo automaticamente',
  )
  await runAndPause(page, '1')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('save incompatível recebe aviso e permanece intacto após jogar e pausar', async ({ page }) => {
  const rom = batteryRom()
  const id = romId(rom)
  await page.goto('/')
  await page.evaluate(
    ({ databaseName, storeName, version, recordVersion, id }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName, version)
        request.onupgradeneeded = () =>
          request.result.createObjectStore(storeName, { keyPath: 'romId' })
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName, 'readwrite')
          transaction.objectStore(storeName).put({
            version: recordVersion,
            romId: id,
            byteLength: 3,
            bytes: new Uint8Array([99, 98, 97]).buffer,
            updatedAt: 1234,
          })
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onabort = () => {
            database.close()
            reject(transaction.error)
          }
        }
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      storeName: BATTERY_STORE_NAME,
      version: SAVE_DATABASE_VERSION,
      recordVersion: BATTERY_RECORD_VERSION,
      id,
    },
  )
  await loadRom(page, rom, 'save-incompativel.gb')
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'O save foi preservado',
  )
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'não será salvo automaticamente',
  )
  await runAndPause(page, '1')
  expect(await storedBatteries(page)).toEqual([
    {
      version: BATTERY_RECORD_VERSION,
      romId: id,
      byteLength: 3,
      bytes: [99, 98, 97],
      updatedAt: 1234,
    },
  ])
})

test('quota preserva o cartucho até escolher continuar e permite abrir outro jogo', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (sessionStorage.getItem('test-battery-quota') === 'full') {
        throw new DOMException('Quota esgotada no teste', 'QuotaExceededError')
      }
      return Reflect.apply(put, this, args)
    }
  })
  await page.goto('/')
  const first = batteryRom()
  await loadRom(page, first, 'quota.gb')
  await page.evaluate(() => sessionStorage.setItem('test-battery-quota', 'full'))
  await runAndPause(page, '1')
  await expect(page.getByRole('status', { name: '', exact: true })).toContainText(
    'armazenamento local está cheio',
  )

  const other = batteryRom('AFTER QUOTA')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'outro.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(other),
  })
  await expect(page.getByRole('alert')).toContainText('Seu cartucho foi mantido')
  await expect(page.getByRole('heading', { name: 'BATTERY TEST', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AFTER QUOTA', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuar sem salvar', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => sessionStorage.removeItem('test-battery-quota'))
  await loadRom(page, other, 'outro.gb', 'AFTER QUOTA')
  await runAndPause(page, '1')
  await expect
    .poll(
      async () =>
        (await storedBatteries(page)).find((record) => record.romId === romId(other))?.bytes[0],
    )
    .toBe(1)
  const records = await storedBatteries(page)
  expect(records.find((record) => record.romId === romId(first))).toBeUndefined()
  expect(records).toHaveLength(1)
})
