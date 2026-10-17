import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { AUDIO_MAX_FRAMES } from '../../src/platform/audio/protocol'
import {
  delayAudioTransport,
  delayOutputClock,
  readAudioTransport,
} from '../helpers/audio-transport'
import {
  analyzePresentationGaps,
  expectProductionClean,
  observeProduction,
  readProductionProbe,
} from '../production/probe'

const GAMES = [
  { name: 'jardim', button: 'Explorar jardim' },
  { name: 'Tobu Tobu Girl', button: /^Jogar 01 Tobu Tobu Girl\./ },
  { name: '2048', button: /^Jogar 02 / },
] as const

const PROFILES = [
  { name: 'transporte de 10 ms por sentido', transportDelayMs: 10, outputDelayMs: 0 },
  {
    name: 'transporte de 60 ms por sentido e saída atrasada',
    transportDelayMs: 60,
    outputDelayMs: 312,
  },
] as const

for (const profile of PROFILES) {
  test.describe(profile.name, () => {
    test.beforeEach(async ({ page }) => {
      await observeProduction(page)
      await delayAudioTransport(page, profile.transportDelayMs)
      if (profile.outputDelayMs > 0) await delayOutputClock(page, profile.outputDelayMs)
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
        const sampleRate = after.contexts.at(-1)!.sampleRate
        const presentation = analyzePresentationGaps(
          after.canvasDrawObservations,
          after.videoFrameObservations,
          {
            epoch: lastAudio.epoch,
            sampleRate,
            measuredFrom: before.observedAt,
            measuredUntil: after.observedAt,
            // Cobre imagens já capturadas, ainda no PCM e na saída; exclui a abertura antiga.
            capturePaddingMs:
              profile.outputDelayMs + (AUDIO_MAX_FRAMES / sampleRate) * 1000 + (2 * 1000) / 60,
          },
        )
        const maximumDrawGapMs = Math.max(0, ...presentation.gaps.map((gap) => gap.durationMs))
        const maximumDrawGapExcessMs = Math.max(
          Number.NEGATIVE_INFINITY,
          ...presentation.gaps.map((gap) => gap.durationMs - gap.allowanceMs),
        )
        const result = {
          game: game.name,
          project: testInfo.project.name,
          profile: profile.name,
          syntheticOutputDelayMs: profile.outputDelayMs,
          limitation:
            'Chromium no computador com atraso controlado; não homologa o Motorola Edge 40 Neo.',
          seconds,
          speedPercent: speed * 100,
          canvasFramesPerSecond: (after.canvasDraws - before.canvasDraws) / seconds,
          maximumDrawGapMs,
          maximumDrawGapExcessMs,
          presentation,
          capturedVideoFrames: after.videoFrames - before.videoFrames,
          sampleRate,
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
        await testInfo.attach('audio-flow.json', {
          path: reportPath,
          contentType: 'application/json',
        })
        expect(result.speedPercent).toBeGreaterThanOrEqual(98)
        expect(result.speedPercent).toBeLessThanOrEqual(102)
        expect(result.underrunFrames).toBe(0)
        expect(result.droppedFrames).toBe(0)
        expect(result.renderedFrames).toBeGreaterThan(result.sampleRate * 11)
        expect(result.canvasFramesPerSecond).toBeGreaterThanOrEqual(55)
        expect(result.canvasFramesPerSecond).toBeLessThanOrEqual(61)
        expect(firstAudio.epoch).toBe(lastAudio.epoch)
        expect(result.presentation.gaps.length).toBeGreaterThan(600)
        expect(result.maximumDrawGapExcessMs).toBeLessThan(0)
        expect(result.capturedVideoFrames).toBeGreaterThan(650)
        expect(lastAudio.queuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
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
        expect((await readProductionProbe(page)).latestAudio!.epoch).toBeGreaterThan(
          lastAudio.epoch,
        )
      })
    }
  })
}
