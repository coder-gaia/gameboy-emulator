import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { delayAudioTransport, readAudioTransport } from '../helpers/audio-transport'
import { expectProductionClean, observeProduction, readProductionProbe } from '../production/probe'

const GAMES = [
  { name: 'jardim', button: 'Explorar jardim' },
  { name: 'Tobu Tobu Girl', button: /^Jogar 01 Tobu Tobu Girl\./ },
  { name: '2048', button: /^Jogar 02 / },
] as const

test.beforeEach(async ({ page }) => {
  await observeProduction(page)
  await delayAudioTransport(page, 10)
})

test.afterEach(async ({ page }) => expectProductionClean(page))

for (const game of GAMES) {
  test(`${game.name} mantém velocidade com atraso controlado no transporte de áudio`, async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await page.getByRole('button', { name: game.button, exact: true }).click()
    const canvas = page.getByLabel('Tela do emulador', { exact: true })
    await expect(canvas).toBeVisible()
    await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
    await expect
      .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
      .toBeGreaterThan(8192)

    // A abertura de Tobu desliga o LCD durante as trocas de logos e de cena.
    // Aguarda o avanço da abertura antes do aquecimento; mudanças de LCD ainda são contadas.
    if (game.name === 'Tobu Tobu Girl') {
      await expect
        .poll(async () => (await readProductionProbe(page)).workers.at(-1)?.frameId ?? 0, {
          timeout: 25_000,
        })
        .toBeGreaterThan(900)
    }

    // O priming e a adaptação inicial ficam fora da janela sustentada.
    await page.waitForTimeout(3000)
    const before = await readProductionProbe(page)
    await page.waitForTimeout(12_000)
    const after = await readProductionProbe(page)
    const firstWorker = before.workers.at(-1)!
    const lastWorker = after.workers.at(-1)!
    const firstAudio = before.latestAudio!
    const lastAudio = after.latestAudio!
    const seconds = (after.observedAt - before.observedAt) / 1000
    const speed = (lastWorker.totalTCycles - firstWorker.totalTCycles) / 4_194_304 / seconds
    const transport = await readAudioTransport(page)
    const result = {
      game: game.name,
      project: testInfo.project.name,
      limitation:
        'Chromium no computador com atraso controlado; não homologa o Motorola Edge 40 Neo.',
      seconds,
      speedPercent: speed * 100,
      canvasFramesPerSecond: (after.canvasDraws - before.canvasDraws) / seconds,
      capturedVideoFrames: after.videoFrames - before.videoFrames,
      sampleRate: after.contexts.at(-1)!.sampleRate,
      renderedFrames: lastAudio.renderedFrames - firstAudio.renderedFrames,
      underrunFrames: lastAudio.underrunFrames - firstAudio.underrunFrames,
      droppedFrames: lastAudio.droppedFrames - firstAudio.droppedFrames,
      targetFrames: lastAudio.targetFrames,
      roundTripFrames: lastAudio.roundTripFrames,
      peakRoundTripFrames: lastAudio.peakRoundTripFrames,
      queuedFrames: lastAudio.queuedFrames,
      measuredFrom: before.observedAt,
      measuredUntil: after.observedAt,
      audioHistory: after.audioHistory,
      transport,
    }
    const reportPath = testInfo.outputPath('audio-flow.json')
    await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n')
    await testInfo.attach('audio-flow.json', { path: reportPath, contentType: 'application/json' })
    expect(result.speedPercent).toBeGreaterThanOrEqual(98)
    expect(result.speedPercent).toBeLessThanOrEqual(102)
    expect(result.underrunFrames).toBe(0)
    expect(result.droppedFrames).toBe(0)
    expect(result.renderedFrames).toBeGreaterThan(result.sampleRate * 11)
    expect(result.canvasFramesPerSecond).toBeGreaterThanOrEqual(55)
    expect(result.canvasFramesPerSecond).toBeLessThanOrEqual(61)
    expect(result.capturedVideoFrames).toBeGreaterThan(650)
    expect(lastAudio.queuedFrames).toBeLessThanOrEqual(16_384)
    expect(lastAudio.pendingFrames).toBeLessThanOrEqual(16_256)
    expect(lastWorker.playing).toBe(true)
    expect(lastWorker.frameId).toBeGreaterThan(firstWorker.frameId + 600)
    expect(transport.bridgesCreated - transport.bridgesClosed).toBe(1)
    expect(transport.requestsForwarded).toBeGreaterThan(50)
    expect(transport.maximumRequestFrames).toBeGreaterThan(512)
    expect(transport.maximumRequestFrames).toBeLessThanOrEqual(16_256)

    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    await expect
      .poll(async () => (await readProductionProbe(page)).contexts.at(-1)?.state)
      .toBe('suspended')
    const paused = await readProductionProbe(page)
    await page.waitForTimeout(200)
    const stillPaused = await readProductionProbe(page)
    expect(stillPaused.workers.at(-1)!.totalTCycles).toBe(paused.workers.at(-1)!.totalTCycles)
    expect(stillPaused.latestAudio).toMatchObject({ active: false, queuedFrames: 0 })
    await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
    await expect
      .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
      .toBeGreaterThan(8192)
    expect((await readProductionProbe(page)).latestAudio!.epoch).toBeGreaterThan(lastAudio.epoch)
  })
}
