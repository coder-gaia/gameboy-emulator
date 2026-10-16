import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createStateRecord, decodeState, encodeState } from '../../src/platform/states'
import {
  SAVE_DATABASE_NAME,
  SAVE_DATABASE_VERSION,
  STATE_STORE_NAME,
} from '../../src/platform/storage/schema'

interface CpuPoint {
  pc: number
  totalTCycles: number
}
interface SavedView {
  image: string
  cpu: CpuPoint
}

async function openGarden(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  return canvas
}

function notice(page: Page): Locator {
  return page.getByRole('status', { name: 'Estado dos slots', exact: true })
}

async function pixels(canvas: Locator): Promise<string> {
  return canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
}

async function expectCpu(page: Page, cpu: CpuPoint): Promise<void> {
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText(
    cpu.pc.toString(16).padStart(4, '0').toUpperCase(),
  )
  await expect(page.getByLabel('T-cycles executados', { exact: true })).toHaveText(
    String(cpu.totalTCycles),
  )
}

async function storedCpu(page: Page, slot: number): Promise<CpuPoint> {
  return page.evaluate(
    ({ databaseName, version, storeName, slot }) =>
      new Promise<CpuPoint>((resolve, reject) => {
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
            const row = records.result.find((record) => record.slot === slot)
            if (!row) {
              reject(new Error('O slot esperado não foi persistido.'))
              return
            }
            const record = JSON.parse(new TextDecoder().decode(row.bytes))
            resolve(record.payload.core.cpu)
          }
        }
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      version: SAVE_DATABASE_VERSION,
      storeName: STATE_STORE_NAME,
      slot,
    },
  )
}

async function saveView(page: Page, canvas: Locator, slot: number): Promise<SavedView> {
  await page.getByRole('radio', { name: `Slot ${slot}`, exact: true }).check()
  await page.getByRole('button', { name: 'Salvar estado', exact: true }).click()
  await expect(notice(page)).toContainText(`Estado salvo no slot ${slot}`)
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  const cpu = await storedCpu(page, slot)
  await expectCpu(page, cpu)
  return { image: await pixels(canvas), cpu }
}

async function move(page: Page, canvas: Locator, key: string): Promise<void> {
  const before = await pixels(canvas)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await page.keyboard.down(key)
  await expect.poll(() => pixels(canvas)).not.toBe(before)
  await page.keyboard.up(key)
}

async function loadView(page: Page, canvas: Locator, slot: number, view: SavedView): Promise<void> {
  await page.getByRole('radio', { name: `Slot ${slot}`, exact: true }).check()
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(notice(page)).toContainText(`Slot ${slot} carregado`)
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  await expect.poll(() => pixels(canvas)).toBe(view.image)
  await expectCpu(page, view.cpu)
}

async function exportCurrent(page: Page): Promise<Uint8Array> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar estado', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^pocketlab-.+\.pocketstate$/)
  await expect(notice(page)).toContainText('O ponto atual foi exportado')
  const path = await download.path()
  if (!path) throw new Error('O navegador não disponibilizou o arquivo exportado.')
  return new Uint8Array(await readFile(path))
}

async function importFile(page: Page, bytes: Uint8Array, name = 'ponto.pocketstate') {
  await page.getByLabel('Arquivo de estado', { exact: true }).setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  })
}

test('três slots restauram tela e CPU em pausa, sobrevivem ao reload e ficam separados por ROM', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  const first = await saveView(page, canvas, 1)
  await move(page, canvas, 'ArrowRight')
  const second = await saveView(page, canvas, 2)
  await move(page, canvas, 'ArrowDown')
  const third = await saveView(page, canvas, 3)
  expect(new Set([first.image, second.image, third.image]).size).toBe(3)
  await loadView(page, canvas, 1, first)
  await loadView(page, canvas, 2, second)
  await loadView(page, canvas, 3, third)

  await page.reload()
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Carregar estado', exact: true })).toBeEnabled()
  await loadView(page, canvas, 1, first)
  await loadView(page, canvas, 2, second)
  await loadView(page, canvas, 3, third)

  await page.getByRole('button', { name: 'Experimentar cartucho de diagnóstico' }).click()
  await expect(page.getByRole('heading', { name: 'POCKET TEST', exact: true })).toBeVisible()
  for (const slot of [1, 2, 3]) {
    await page.getByRole('radio', { name: `Slot ${slot}`, exact: true }).check()
    await expect(page.getByRole('button', { name: 'Carregar estado', exact: true })).toBeDisabled()
  }
})

test('exporta o ponto atual, importa em outro slot e rejeita ROM errada, corrupção e versão futura', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  const bytes = await exportCurrent(page)
  const record = await decodeState(bytes)
  const payload = record.payload as { core: { cpu: CpuPoint }; serial: string }
  const initial: SavedView = { image: await pixels(canvas), cpu: payload.core.cpu }
  await expectCpu(page, initial.cpu)
  await move(page, canvas, 'ArrowRight')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  expect(await pixels(canvas)).not.toBe(initial.image)
  await page.getByRole('radio', { name: 'Slot 3', exact: true }).check()
  await importFile(page, bytes)
  await expect(notice(page)).toContainText('Arquivo importado no slot 3')
  await expect.poll(() => pixels(canvas)).toBe(initial.image)
  await expectCpu(page, initial.cpu)
  await expect(page.getByRole('button', { name: 'Carregar estado', exact: true })).toBeEnabled()

  const wrongRom = await encodeState(
    await createStateRecord('f'.repeat(64), 1, record.payload, record.createdAt),
  )
  const corrupt = JSON.parse(new TextDecoder().decode(bytes))
  corrupt.payload.serial += 'modificado'
  const future = JSON.parse(new TextDecoder().decode(bytes))
  future.version = 2
  const invalidCore = await encodeState(
    await createStateRecord(
      record.romId,
      1,
      { ...payload, core: { ...payload.core, cpu: { ...payload.core.cpu, pc: -1 } } },
      record.createdAt,
    ),
  )
  for (const [file, message] of [
    [wrongRom, 'outro cartucho'],
    [new TextEncoder().encode(JSON.stringify(corrupt)), 'corrompido'],
    [new TextEncoder().encode(JSON.stringify(future)), 'não é compatível'],
    [invalidCore, 'inválido'],
  ] as const) {
    await importFile(page, file)
    await expect(notice(page)).toContainText(message)
    await expect.poll(() => pixels(canvas)).toBe(initial.image)
    await expectCpu(page, initial.cpu)
    await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  }
  await loadView(page, canvas, 3, initial)
})

test('exportação e importação funcionam sem IndexedDB e avisam que o slot não foi gravado', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
  })
  const canvas = await openGarden(page)
  await expect(notice(page)).toContainText('IndexedDB está indisponível')
  const bytes = await exportCurrent(page)
  const record = await decodeState(bytes)
  const initial = await pixels(canvas)
  await move(page, canvas, 'ArrowDown')
  await importFile(page, bytes)
  await expect(notice(page)).toContainText('partida foi retomada em pausa')
  await expect(notice(page)).toContainText('slot não pôde ser gravado')
  await expect.poll(() => pixels(canvas)).toBe(initial)
  await expectCpu(page, (record.payload as { core: { cpu: CpuPoint } }).core.cpu)
  await expect(page.getByRole('button', { name: 'Carregar estado', exact: true })).toBeDisabled()
})

test('importação pendente bloqueia reprodução e troca, depois libera o próximo jogo', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeArrayBuffer = File.prototype.arrayBuffer
    const probe = window as Window & {
      holdStateFile?: boolean
      releaseStateFile?: () => Promise<void>
    }
    File.prototype.arrayBuffer = function () {
      if (!probe.holdStateFile) return nativeArrayBuffer.call(this)
      return new Promise<ArrayBuffer>((resolve, reject) => {
        probe.releaseStateFile = async () => {
          try {
            resolve(await nativeArrayBuffer.call(this))
          } catch (cause) {
            reject(cause)
          }
        }
      })
    }
  })
  const canvas = await openGarden(page)
  const bytes = await exportCurrent(page)
  await page.evaluate(() => {
    ;(window as Window & { holdStateFile?: boolean }).holdStateFile = true
  })
  await importFile(page, bytes)
  await expect(page.getByText('Preparando seu ponto de retorno...', { exact: true })).toBeVisible()
  for (const name of ['Iniciar', 'Reiniciar', 'Explorar jardim']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  await expect(
    page.getByRole('button', { name: 'Experimentar cartucho de diagnóstico' }),
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: /Trocar cartucho/ })).toBeDisabled()
  await page.evaluate(async () => {
    await (window as Window & { releaseStateFile?: () => Promise<void> }).releaseStateFile?.()
  })
  await expect(notice(page)).toContainText('Arquivo importado no slot 1')
  await page.getByRole('button', { name: 'Experimentar cartucho de diagnóstico' }).click()
  await expect(page.getByRole('heading', { name: 'POCKET TEST', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  const frame = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(frame + 30)
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'POCKET TEST', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Carregar estado', exact: true })).toBeDisabled()
})
