import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import { BATTERY_STORE_NAME } from '../../src/platform/storage/schema'
import { observeProduction, readProductionProbe } from '../production/probe'
import { buildTestRom } from '../fixtures/rom'

test.beforeEach(async ({ page }) => observeProduction(page))

async function worker(page: Page) {
  return (await readProductionProbe(page)).workers.at(-1)!
}

async function pixels(canvas: Locator): Promise<string> {
  return canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
}

async function frames(canvas: Locator, count: number): Promise<void> {
  const initial = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThanOrEqual(initial + count)
}

async function enable(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ativar rewind', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Desativar rewind', exact: true })).toBeVisible()
  await expect.poll(async () => (await worker(page)).rewind?.enabled).toBe(true)
}

async function openGarden(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  return canvas
}

async function available(page: Page, seconds = 0.5): Promise<void> {
  await expect
    .poll(async () => (await worker(page)).rewind?.availableSeconds ?? 0)
    .toBeGreaterThanOrEqual(seconds)
  await expect(page.getByRole('button', { name: 'Segure para voltar', exact: true })).toBeEnabled()
}

async function holdPointer(page: Page): Promise<Locator> {
  const button = page.getByRole('button', { name: 'Segure para voltar', exact: true })
  await button.scrollIntoViewIfNeeded()
  const box = (await button.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(true)
  return button
}

test('rewind é opt-in, volta imagem e CPU de três segundos e retoma ao soltar R', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  await expect(page.getByRole('button', { name: 'Ativar rewind', exact: true })).toBeVisible()
  expect((await worker(page)).rewind?.enabled).toBe(false)
  await enable(page)
  await available(page)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await canvas.focus()
  const initialImage = await pixels(canvas)
  await page.keyboard.down('ArrowRight')
  await frames(canvas, 180)
  await page.keyboard.up('ArrowRight')
  const before = await worker(page)
  expect(await pixels(canvas)).not.toBe(initialImage)
  expect(before.rewind!.maxSeconds).toBe(20)
  expect(before.rewind!.maxBytes).toBe(8 * 1024 * 1024)
  expect(before.rewind!.allocatedBytes).toBeLessThanOrEqual(before.rewind!.maxBytes)
  expect(before.rewind!.usedBytes).toBeLessThanOrEqual(before.rewind!.allocatedBytes)
  await page.keyboard.down('KeyR')
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(true)
  await expect(page.getByRole('button', { name: 'Salvar estado', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Trocar cartucho/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Segure para voltar', exact: true })).toBeEnabled()
  await expect.poll(() => pixels(canvas), { timeout: 8000 }).toBe(initialImage)
  await expect.poll(async () => (await worker(page)).rewind!.entries).toBeLessThanOrEqual(1)
  const restored = await worker(page)
  expect(restored.totalTCycles).toBeLessThan(before.totalTCycles - DMG_CLOCK_HZ * 2)
  await expect(page.getByLabel('T-cycles executados', { exact: true })).toHaveText(
    String(restored.totalTCycles),
  )
  await page.keyboard.up('KeyR')
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
  await expect.poll(async () => (await worker(page)).playing).toBe(true)
  await expect(page.getByRole('button', { name: 'Salvar estado', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await worker(page)).totalTCycles)
    .toBeGreaterThan(restored.totalTCycles)
})

test('voltar quando pausado preserva a pausa e desligar libera todo o histórico', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  await enable(page)
  await available(page, 1)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await canvas.focus()
  const before = (await worker(page)).totalTCycles
  await page.keyboard.down('KeyR')
  await expect.poll(async () => (await worker(page)).totalTCycles).toBeLessThan(before)
  await page.keyboard.up('KeyR')
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
  await expect.poll(async () => (await worker(page)).playing).toBe(false)
  const paused = (await worker(page)).totalTCycles
  await page.waitForTimeout(180)
  expect((await worker(page)).totalTCycles).toBe(paused)
  await page.getByRole('button', { name: 'Desativar rewind', exact: true }).click()
  await expect.poll(async () => (await worker(page)).rewind?.entries).toBe(0)
  expect((await worker(page)).rewind!.allocatedBytes).toBe(0)
  expect((await worker(page)).rewind!.usedBytes).toBe(0)
})

test('R remapeado para A continua chegando ao jogo e não inicia rewind', async ({ page }) => {
  const canvas = await openGarden(page)
  await enable(page)
  await available(page)
  await page.getByText('Controles e preferências', { exact: true }).click()
  await page.getByLabel('Tecla para Botão A', { exact: true }).press('KeyR')
  await expect(page.getByLabel('Tecla para Botão A', { exact: true })).toHaveValue('R')
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  const initial = await pixels(canvas)
  const before = (await worker(page)).totalTCycles
  await page.keyboard.down('KeyR')
  await expect(page.getByRole('button', { name: 'Botão A', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await frames(canvas, 12)
  expect((await worker(page)).rewind!.active).toBe(false)
  expect((await worker(page)).totalTCycles).toBeGreaterThan(before)
  expect(await pixels(canvas)).not.toBe(initial)
  await page.keyboard.up('KeyR')
  await expect(page.getByRole('button', { name: 'Botão A', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('botão de rewind aceita Espaço segurado e ativação de tecnologia assistiva', async ({
  page,
}) => {
  await openGarden(page)
  await enable(page)
  await available(page, 1)
  const button = page.getByRole('button', { name: 'Segure para voltar', exact: true })
  await button.focus()
  const before = (await worker(page)).rewindRestores
  await page.keyboard.down('Space')
  await expect.poll(async () => (await worker(page)).rewind!.active).toBe(true)
  await expect.poll(async () => (await worker(page)).rewindRestores).toBeGreaterThan(before)
  await page.keyboard.up('Space')
  await expect.poll(async () => (await worker(page)).rewind!.active).toBe(false)
  await expect.poll(async () => (await worker(page)).playing).toBe(true)
  await available(page)
  const current = (await worker(page)).rewindRestores
  await button.dispatchEvent('click', { detail: 0 })
  await expect.poll(async () => (await worker(page)).rewindRestores).toBe(current + 1)
  await expect.poll(async () => (await worker(page)).rewind!.active).toBe(false)
})

test('clique curto volta um ponto e pointercancel, blur e aba oculta terminam em pausa', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  await enable(page)
  await available(page, 1)
  const count = (await worker(page)).rewindRestores
  await page.getByRole('button', { name: 'Segure para voltar', exact: true }).click()
  await expect.poll(async () => (await worker(page)).rewindRestores).toBeGreaterThan(count)
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
  await expect.poll(async () => (await worker(page)).playing).toBe(true)

  for (const cancellation of ['pointercancel', 'blur', 'hidden'] as const) {
    await available(page)
    const button = await holdPointer(page)
    if (cancellation === 'pointercancel')
      await button.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' })
    else if (cancellation === 'blur')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    else
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
    await expect.poll(async () => (await worker(page)).playing).toBe(false)
    await page.mouse.up()
    await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
    if (cancellation !== 'hidden') {
      await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
      await frames(canvas, 36)
    }
  }
})

test('carregar um estado ou trocar ROM limpa o histórico anterior', async ({ page }) => {
  const canvas = await openGarden(page)
  await enable(page)
  await available(page, 1)
  await page.getByRole('button', { name: 'Salvar estado', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado dos slots' })).toContainText('Estado salvo')
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await frames(canvas, 60)
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado dos slots' })).toContainText(
    'Slot 1 carregado',
  )
  await expect.poll(async () => (await worker(page)).rewind!.entries).toBeLessThanOrEqual(1)
  expect((await worker(page)).rewind!.availableSeconds).toBe(0)
  await expect(page.getByRole('button', { name: 'Segure para voltar', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Experimentar cartucho de diagnóstico' }).click()
  await expect(page.getByRole('heading', { name: 'POCKET TEST', exact: true })).toBeVisible()
  expect((await worker(page)).rewind!.active).toBe(false)
  expect((await worker(page)).rewind!.entries).toBeLessThanOrEqual(1)
  expect((await worker(page)).rewind!.availableSeconds).toBe(0)
})

test('rewind de Tobu limpa fila e epoch do áudio e retoma PCM no mesmo Worklet', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Jogar 01 Tobu Tobu Girl\./ }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await enable(page)
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  await available(page, 1)
  const initial = await readProductionProbe(page)
  await canvas.focus()
  await page.keyboard.down('KeyR')
  await expect.poll(async () => (await worker(page)).rewind!.active).toBe(true)
  await expect
    .poll(async () => (await readProductionProbe(page)).contexts[0]?.state)
    .toBe('suspended')
  await expect.poll(async () => (await readProductionProbe(page)).latestAudio?.queuedFrames).toBe(0)
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.epoch ?? 0)
    .toBeGreaterThan(initial.latestAudio!.epoch)
  await expect
    .poll(async () => (await worker(page)).totalTCycles)
    .toBeLessThan(initial.workers.at(-1)!.totalTCycles)
  await page.keyboard.up('KeyR')
  await expect
    .poll(async () => (await readProductionProbe(page)).contexts[0]?.state)
    .toBe('running')
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0)
    .toBeGreaterThan(0)
  const resumed = await readProductionProbe(page)
  expect(resumed.contexts).toHaveLength(1)
  expect(resumed.nodeCount).toBe(1)
  await expect(page.getByRole('status', { name: 'Estado do áudio' })).toHaveCount(0)
})

interface BatteryWrites {
  calls: { byte: number; at: number }[]
  quota: boolean
}
type BatteryWindow = Window & typeof globalThis & { __rewindBattery: BatteryWrites }

function batteryRom(): Uint8Array {
  return buildTestRom({
    title: 'REWIND BATTERY',
    cartridgeType: 3,
    ramSizeCode: 2,
    program: [
      0xf3, 0x3e, 0x0a, 0xea, 0x00, 0x00, 0x21, 0x00, 0xa0, 0x36, 0x00, 0x34, 0x11, 0xff, 0xff,
      0x1b, 0x7a, 0xb3, 0x20, 0xfb, 0x18, 0xf5,
    ],
  })
}

async function openBattery(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storeName }) => {
      const probe: BatteryWrites = { calls: [], quota: false }
      ;(window as BatteryWindow).__rewindBattery = probe
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (this.name === storeName) {
          if (probe.quota) throw new DOMException('Quota de bateria de teste', 'QuotaExceededError')
          const record = value as { bytes: ArrayBuffer }
          probe.calls.push({ byte: new Uint8Array(record.bytes)[0]!, at: performance.now() })
        }
        return Reflect.apply(put, this, [value, key]) as IDBRequest<IDBValidKey>
      }
    },
    { storeName: BATTERY_STORE_NAME },
  )
  await page.goto('/')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'rewind-battery.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(batteryRom()),
  })
  await expect(page.getByRole('heading', { name: 'REWIND BATTERY', exact: true })).toBeVisible()
  await enable(page)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await available(page, 3)
  await expect
    .poll(() => page.evaluate(() => (window as BatteryWindow).__rewindBattery.calls.length))
    .toBeGreaterThan(0)
}

test('bateria não grava estados intermediários e persiste o ponto final após cancelar rewind', async ({
  page,
}) => {
  await openBattery(page)
  await holdPointer(page)
  const before = await page.evaluate(() => (window as BatteryWindow).__rewindBattery.calls.length)
  // O autosave usa intervalo de 2 s; este período cobre uma execução completa dele durante o gesto.
  await page.waitForTimeout(2200)
  expect(await page.evaluate(() => (window as BatteryWindow).__rewindBattery.calls.length)).toBe(
    before,
  )
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(async () => (await worker(page)).rewind!.active).toBe(false)
  await page.mouse.up()
  const selected = (await worker(page)).batteryFirstByte
  await expect
    .poll(() => page.evaluate(() => (window as BatteryWindow).__rewindBattery.calls.length))
    .toBeGreaterThan(before)
  expect(
    await page.evaluate(() => (window as BatteryWindow).__rewindBattery.calls.at(-1)!.byte),
  ).toBe(selected)
  expect((await worker(page)).playing).toBe(false)
})

test('quota após rewind preserva cartucho e exige a escolha explícita antes de trocar', async ({
  page,
}) => {
  await openBattery(page)
  await holdPointer(page)
  await page.evaluate(() => {
    ;(window as BatteryWindow).__rewindBattery.quota = true
  })
  await expect.poll(async () => (await worker(page)).rewindRestores).toBeGreaterThan(0)
  await expect
    .poll(async () => (await worker(page)).rewind!.entries, { timeout: 8000 })
    .toBeLessThanOrEqual(1)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(async () => (await worker(page)).rewind!.active).toBe(false)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('cartucho foi mantido')
  await expect(page.getByRole('heading', { name: 'REWIND BATTERY', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'POCKET GARDEN', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuar sem salvar', exact: true }).click()
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'POCKET GARDEN', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
