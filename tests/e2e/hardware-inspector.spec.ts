import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { EmulatorMessage, EmulatorRequest } from '../../src/runtime/worker-protocol'
import { expectProductionClean, observeProduction, readProductionProbe } from '../production/probe'

interface HardwareProbe {
  delayMs: number
  requests: { worker: number; id: number; memoryStart: number }[]
  maximumPending: number
}

type HardwareWindow = Window & typeof globalThis & { __hardwareProbe: HardwareProbe }

test.beforeEach(async ({ page }) => {
  await observeProduction(page)
  await page.addInitScript(() => {
    const probe: HardwareProbe = { delayMs: 0, requests: [], maximumPending: 0 }
    ;(window as HardwareWindow).__hardwareProbe = probe
    const NativeWorker = window.Worker
    let workerIndex = 0
    window.Worker = class extends NativeWorker {
      private readonly pendingInspections = new Set<number>()
      private readonly index = ++workerIndex

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }: MessageEvent<EmulatorMessage>) => {
          if (data.type === 'reply') this.pendingInspections.delete(data.id)
          if (data.type === 'error') this.pendingInspections.clear()
        })
      }

      override postMessage(
        message: EmulatorRequest,
        options?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const deliver = (): void => {
          if (Array.isArray(options)) super.postMessage(message, options)
          else super.postMessage(message, options)
        }
        if (message.command.type !== 'inspect-hardware') {
          deliver()
          return
        }
        probe.requests.push({
          worker: this.index,
          id: message.id,
          memoryStart: message.command.memoryStart,
        })
        this.pendingInspections.add(message.id)
        probe.maximumPending = Math.max(probe.maximumPending, this.pendingInspections.size)
        if (probe.delayMs > 0) setTimeout(deliver, probe.delayMs)
        else deliver()
      }

      override terminate(): void {
        this.pendingInspections.clear()
        super.terminate()
      }
    }
  })
})

test.afterEach(async ({ page }) => expectProductionClean(page))

async function probe(page: Page): Promise<HardwareProbe> {
  return page.evaluate(() => structuredClone((window as HardwareWindow).__hardwareProbe))
}

async function openGarden(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
}

async function openHardware(page: Page): Promise<Locator> {
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByText('Painel técnico', { exact: true }).click()
  const panel = page.getByText('Painel técnico', { exact: true }).locator('..')
  await expect(
    panel.getByRole('region', { name: 'Conteúdo da memória', exact: true }),
  ).toBeVisible()
  return panel
}

test('inspeciona a máquina pausada sem avançar ciclos e mostra instruções, tiles e OAM', async ({
  page,
}) => {
  await openGarden(page)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  const before = (await readProductionProbe(page)).workers.at(-1)!
  const panel = await openHardware(page)
  const disassembly = panel.getByRole('region', { name: 'Desassemblador', exact: true })
  await expect(disassembly.getByRole('row')).toHaveCount(13)
  await expect(disassembly.locator('tr[aria-current="location"]')).toHaveCount(1)
  const pc = await page.getByLabel('Registrador PC', { exact: true }).textContent()
  await expect(disassembly.locator('tr[aria-current="location"] th')).toHaveText(`$${pc}`)
  const tiles = panel.getByRole('img', { name: '384 tiles da VRAM em 16 colunas e 24 linhas' })
  await expect(tiles).toHaveAttribute('width', '128')
  await expect(tiles).toHaveAttribute('height', '192')
  const palette = await tiles.evaluate((element) => {
    const data = (element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 128, 192).data
    const colors = new Set<string>()
    for (let index = 0; index < data.length; index += 4)
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`)
    return [...colors]
  })
  expect(palette.length).toBeGreaterThan(1)
  expect(palette.every((color) => color.endsWith(',255'))).toBe(true)
  await expect(
    panel.getByRole('region', { name: 'Tabela OAM', exact: true }).getByRole('row'),
  ).toHaveCount(41)
  for (const heading of ['Vídeo e PPU', 'Timer', 'DMA e interrupções', 'Cartucho e RTC'])
    await expect(panel.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  await expect.poll(async () => (await probe(page)).requests.length).toBeGreaterThanOrEqual(3)
  expect((await readProductionProbe(page)).workers.at(-1)!.totalTCycles).toBe(before.totalTCycles)
  expect((await probe(page)).maximumPending).toBe(1)
})

test('valida endereço hexadecimal, limita páginas e mantém a memória somente leitura', async ({
  page,
}) => {
  await openGarden(page)
  const panel = await openHardware(page)
  const address = panel.getByRole('textbox', { name: 'Endereço hexadecimal', exact: true })
  await address.fill('C001')
  await panel.getByRole('button', { name: 'Consultar', exact: true }).click()
  await expect(address).toHaveAttribute('aria-invalid', 'true')
  await expect(panel.getByRole('alert')).toContainText('terminado em 00')
  expect((await probe(page)).requests.every((request) => request.memoryStart === 0xc000)).toBe(true)
  await address.fill('$0000')
  await panel.getByRole('button', { name: 'Consultar', exact: true }).click()
  await expect(
    panel.getByText('Página $0000 a $00FF, somente leitura.', { exact: true }),
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Página anterior', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: 'Próxima página', exact: true }).click()
  await expect(address).toHaveValue('0100')
  await expect(
    panel.getByText('Página $0100 a $01FF, somente leitura.', { exact: true }),
  ).toBeVisible()
  await address.fill('0xFF00')
  await panel.getByRole('button', { name: 'Consultar', exact: true }).click()
  await expect(
    panel.getByText('Página $FF00 a $FFFF, somente leitura.', { exact: true }),
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Próxima página', exact: true })).toBeDisabled()
  await expect(panel.getByRole('textbox')).toHaveCount(1)
  await expect(
    panel.getByRole('region', { name: 'Conteúdo da memória', exact: true }).getByRole('cell'),
  ).toHaveCount(272)
})

test('consulta somente enquanto o painel e seu ancestral estão abertos e a aba está visível', async ({
  page,
}) => {
  await openGarden(page)
  await page.waitForTimeout(1100)
  expect((await probe(page)).requests).toHaveLength(0)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.waitForTimeout(600)
  expect((await probe(page)).requests).toHaveLength(0)
  await page.getByText('Painel técnico', { exact: true }).click()
  await expect.poll(async () => (await probe(page)).requests.length).toBeGreaterThanOrEqual(2)
  await page.getByText('Painel técnico', { exact: true }).click()
  const closed = (await probe(page)).requests.length
  await page.waitForTimeout(700)
  expect((await probe(page)).requests).toHaveLength(closed)
  await page.getByText('Painel técnico', { exact: true }).click()
  await expect.poll(async () => (await probe(page)).requests.length).toBeGreaterThan(closed)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  const ancestorClosed = (await probe(page)).requests.length
  await page.waitForTimeout(700)
  expect((await probe(page)).requests).toHaveLength(ancestorClosed)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect.poll(async () => (await probe(page)).requests.length).toBeGreaterThan(ancestorClosed)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = (await probe(page)).requests.length
  await page.waitForTimeout(700)
  expect((await probe(page)).requests).toHaveLength(hidden)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(async () => (await probe(page)).requests.length).toBeGreaterThan(hidden)
  expect((await probe(page)).maximumPending).toBe(1)
})

test('ignora respostas de páginas anteriores sem sobrepor RPCs ao fechar e reabrir', async ({
  page,
}) => {
  await openGarden(page)
  await page.evaluate(() => {
    ;(window as HardwareWindow).__hardwareProbe.delayMs = 1000
  })
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByText('Painel técnico', { exact: true }).click()
  await expect.poll(async () => (await probe(page)).requests.length).toBe(1)
  const address = page.getByRole('textbox', { name: 'Endereço hexadecimal', exact: true })
  await address.fill('D000')
  await page.getByRole('button', { name: 'Consultar', exact: true }).click()
  await address.fill('FF00')
  await page.getByRole('button', { name: 'Consultar', exact: true }).click()
  await page.getByText('Painel técnico', { exact: true }).click()
  await page.waitForTimeout(1200)
  expect((await probe(page)).requests).toHaveLength(1)
  await page.evaluate(() => {
    ;(window as HardwareWindow).__hardwareProbe.delayMs = 0
  })
  await page.getByText('Painel técnico', { exact: true }).click()
  await expect(
    page.getByText('Página $FF00 a $FFFF, somente leitura.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Página $C000 a $C0FF, somente leitura.', { exact: true }),
  ).toHaveCount(0)
  const observations = await probe(page)
  expect(observations.requests.at(-1)!.memoryStart).toBe(0xff00)
  expect(observations.maximumPending).toBe(1)
})

for (const width of [320, 1440]) {
  test(`mantém o painel técnico acessível e a rolagem interna em ${width} px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await openGarden(page)
    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    const panel = await openHardware(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    const memory = panel.getByRole('region', { name: 'Conteúdo da memória', exact: true })
    await memory.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(memory).toBeFocused()
    expect(await memory.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
    const result = await new AxeBuilder({ page }).analyze()
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.failureSummary),
      })),
    ).toEqual([])
    await panel.screenshot({ path: testInfo.outputPath(`hardware-${width}.png`) })
  })
}
