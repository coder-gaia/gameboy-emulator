import { readFile } from 'node:fs/promises'
import { performance as hostPerformance } from 'node:perf_hooks'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { PerformanceInterval, PerformancePoint } from '../../src/runtime/performance-sampler'
import { delayAudioTransport } from '../helpers/audio-transport'
import { observeProduction, readProductionProbe } from '../production/probe'

interface DiagnosticReport {
  version: number
  romId: string
  outcome: string
  limitation: string
  summary: PerformanceInterval
  measurement: {
    started: PerformancePoint
    samples: { point: PerformancePoint; interval: PerformanceInterval }[]
  }
}

test.beforeEach(async ({ page }) => observeProduction(page))

async function garden(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).workers.at(-1)?.frameId ?? 0)
    .toBeGreaterThan(3)
}

async function panel(page: Page): Promise<Locator> {
  const summary = page.getByText('Desempenho e áudio', { exact: true })
  await summary.click()
  const metrics = summary.locator('..')
  await expect(
    metrics.getByRole('button', { name: 'Medir por 60 segundos', exact: true }),
  ).toBeEnabled()
  return metrics
}

function status(metrics: Locator): Locator {
  return metrics.getByRole('status').filter({ hasText: /^Medição/ })
}

async function start(metrics: Locator): Promise<void> {
  await metrics.getByRole('button', { name: 'Medir por 60 segundos', exact: true }).click()
  await expect(metrics.getByRole('progressbar', { name: 'Progresso da medição' })).toBeVisible()
}

async function exported(page: Page, metrics: Locator): Promise<DiagnosticReport> {
  await expect(
    metrics.getByRole('button', { name: 'Exportar diagnóstico', exact: true }),
  ).toBeEnabled()
  const pendingDownload = page.waitForEvent('download')
  await metrics.getByRole('button', { name: 'Exportar diagnóstico', exact: true }).click()
  const download = await pendingDownload
  expect(download.suggestedFilename()).toBe('pocket-lab-diagnostico.json')
  const path = await download.path()
  if (!path) throw new Error('O navegador não disponibilizou o diagnóstico local.')
  return JSON.parse(await readFile(path, 'utf8')) as DiagnosticReport
}

function expectPrivate(report: DiagnosticReport): void {
  const forbidden = new Set([
    'rom',
    'romBytes',
    'bytes',
    'memory',
    'ram',
    'vram',
    'wram',
    'framebuffer',
    'serial',
    'registers',
    'cartridge',
    'checkpoint',
    'batteryRam',
  ])
  function visit(value: unknown): void {
    if (value === null || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      expect(forbidden.has(key), `O diagnóstico não deve conter ${key}.`).toBe(false)
      visit(entry)
    }
  }
  visit(report)
  expect(report.version).toBe(1)
  expect(report.romId).toMatch(/^[0-9a-f]{64}$/)
  expect(report.limitation).toContain('Canvas')
}

test('mede Canvas separadamente dos quadros emulados e exporta áudio sem dados do cartucho', async ({
  page,
}) => {
  await delayAudioTransport(page, 10)
  await garden(page)
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  const metrics = await panel(page)
  await expect(metrics.getByLabel('Taxa de áudio', { exact: true })).toHaveText(/Hz$/)
  await expect(metrics.getByLabel('Fila PCM', { exact: true })).toHaveText(/frames.*ms/)
  await start(metrics)
  await page.waitForTimeout(2300)
  await metrics.getByRole('button', { name: 'Encerrar medição', exact: true }).click()
  await expect(status(metrics)).toHaveText('Medição encerrada pelo usuário.')
  const report = await exported(page, metrics)
  expectPrivate(report)
  expect(report.measurement.samples.length).toBeGreaterThanOrEqual(2)
  const first = report.measurement.started
  const last = report.measurement.samples.at(-1)!.point
  expect(last.drawnFrames - first.drawnFrames).toBeGreaterThan(0)
  expect(last.frameId - first.frameId).toBeGreaterThan(0)
  expect(report.summary.drawnFramesPerSecond).toBeGreaterThan(40)
  expect(report.summary.drawnFramesPerSecond).toBeLessThanOrEqual(65)
  expect(report.summary.speedPercent).toBeGreaterThan(0)
  expect(last.audio).toMatchObject({ connected: true, sampleRate: expect.any(Number) })
  expect(last.audio).toHaveProperty('baseLatencySeconds')
  expect(last.audio).toHaveProperty('outputLatencySeconds')
})

test('o relógio manual encerra o fluxo de 60 segundos sem acelerar o Worker nem homologar velocidade', async ({
  page,
}) => {
  const anchor = new Date('2026-10-17T15:00:00.000Z')
  await page.clock.install({ time: anchor })
  await garden(page)
  const metrics = await panel(page)
  await page.clock.pauseAt(new Date(anchor.getTime() + 60_000))
  const before = (await readProductionProbe(page)).workers.at(-1)!
  const hostStartedAt = hostPerformance.now()
  await start(metrics)
  // Cada salto mantém a amostragem de 1 s sem executar todas as animações intermediárias.
  for (let second = 0; second < 60; second += 1) await page.clock.fastForward(1000)
  await expect(status(metrics)).toHaveText('Medição de 60 segundos concluída.')
  await expect(metrics.getByRole('progressbar', { name: 'Progresso da medição' })).toHaveCount(0)
  const report = await exported(page, metrics)
  expectPrivate(report)
  expect(report.measurement.samples.length).toBeGreaterThanOrEqual(60)
  expect(report.summary.elapsedSeconds).toBeGreaterThanOrEqual(60)
  expect(report.summary.elapsedSeconds).toBeLessThan(62)
  const last = (await readProductionProbe(page)).workers.at(-1)!
  const hostElapsedSeconds = (hostPerformance.now() - hostStartedAt) / 1000
  const workerElapsedSeconds = (last.totalTCycles - before.totalTCycles) / 4_194_304
  expect(workerElapsedSeconds).toBeLessThanOrEqual(hostElapsedSeconds * 1.15 + 1)
  expect(report.summary.underrunFrames).toBeNull()
  expect(report.summary.droppedFrames).toBeNull()
  // Esta janela usa tempo artificial só na página. Ela não é um benchmark de velocidade.
})

test('pausa, nova época de áudio e fechamento do painel encerram janelas sem misturar sessões', async ({
  page,
}) => {
  await garden(page)
  const metrics = await panel(page)
  const cpuSummary = page.getByText('Inspecionar CPU', { exact: true })
  await cpuSummary.click()
  await start(metrics)
  await cpuSummary.click()
  await expect(metrics.getByRole('progressbar', { name: 'Progresso da medição' })).toBeVisible()
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(status(metrics)).toHaveText(/Medição interrompida/)
  await expect(
    metrics.getByRole('button', { name: 'Medir por 60 segundos', exact: true }),
  ).toBeDisabled()
  const paused = await exported(page, metrics)
  expect(paused.summary.interrupted).toBe(true)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect(
    metrics.getByRole('button', { name: 'Medir por 60 segundos', exact: true }),
  ).toBeEnabled()
  await start(metrics)
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect(status(metrics)).toHaveText(/Medição interrompida/)
  const changed = await exported(page, metrics)
  expect(changed.summary.interrupted).toBe(true)
  await start(metrics)
  await page.getByText('Desempenho e áudio', { exact: true }).click()
  await page.getByText('Desempenho e áudio', { exact: true }).click()
  await expect(status(metrics)).toHaveText(/Medição interrompida/)
  expect((await exported(page, metrics)).outcome).toContain('painel')
})

test('rewind e página oculta encerram medições e liberam novo ensaio depois da retomada', async ({
  page,
}) => {
  await garden(page)
  await page.getByRole('button', { name: 'Ativar rewind', exact: true }).click()
  await expect
    .poll(
      async () => (await readProductionProbe(page)).workers.at(-1)?.rewind?.availableSeconds ?? 0,
    )
    .toBeGreaterThan(0.5)
  const metrics = await panel(page)
  await start(metrics)
  await page.getByLabel('Tela do emulador', { exact: true }).focus()
  await page.keyboard.down('KeyR')
  await expect(status(metrics)).toHaveText(/Medição interrompida/)
  await page.keyboard.up('KeyR')
  await expect(
    metrics.getByRole('button', { name: 'Medir por 60 segundos', exact: true }),
  ).toBeEnabled()
  await start(metrics)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(status(metrics)).toHaveText(/Medição interrompida/)
  const report = await exported(page, metrics)
  expectPrivate(report)
  expect(report.outcome).toContain('ocultar')
})
