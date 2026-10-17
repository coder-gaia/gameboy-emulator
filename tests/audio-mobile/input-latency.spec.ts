import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  delayAudioTransport,
  delayOutputClock,
  readAudioTransport,
} from '../helpers/audio-transport'
import {
  armInputLatency,
  latencyPercentile,
  observeInputLatency,
  readInputLatency,
} from '../helpers/input-latency'
import { expectProductionClean, observeProduction, readProductionProbe } from '../production/probe'

test.use({ hasTouch: true })

const PROFILES = [
  { name: 'sem áudio', audio: false, transportDelayMs: 0, outputDelayMs: 0 },
  { name: 'áudio nativo', audio: true, transportDelayMs: 0, outputDelayMs: 0 },
  {
    name: 'áudio com transporte de 60 ms por sentido',
    audio: true,
    transportDelayMs: 60,
    outputDelayMs: 0,
  },
  {
    name: 'áudio com transporte de 60 ms e saída de 312 ms',
    audio: true,
    transportDelayMs: 60,
    outputDelayMs: 312,
  },
] as const

const PRESS_DELAYS_MS = [11, 43, 79, 131, 17, 61, 103, 157, 29, 89, 137, 53] as const
const PRESENTATION_P95_LIMIT_MS = (2 * 1000) / 60 + 5
const TOTAL_LIMIT_MS = 200

for (const profile of PROFILES) {
  test(`entrada até pixel: ${profile.name}`, async ({ page }, testInfo) => {
    await observeProduction(page)
    if (profile.transportDelayMs > 0) await delayAudioTransport(page, profile.transportDelayMs)
    if (profile.outputDelayMs > 0) await delayOutputClock(page, profile.outputDelayMs)
    await observeInputLatency(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
    const canvas = page.getByLabel('Tela do emulador', { exact: true })
    await expect(canvas).toBeVisible()
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
      .toBeGreaterThan(3)
    await expect.poll(async () => (await readInputLatency(page)).latestCanvasHash).not.toBeNull()
    await expect.poll(async () => (await readInputLatency(page)).latestCoreHash).not.toBeNull()

    const button = page.getByRole('button', { name: 'Botão A', exact: true })
    const session = await page.context().newCDPSession(page)
    const attempts: {
      sequence: number
      phase: 'baseline' | 'measured'
      delayMs: number
      x: number
      y: number
    }[] = []
    async function measurePresses(delays: readonly number[], phase: 'baseline' | 'measured') {
      for (const delay of delays) {
        await page.waitForTimeout(delay)
        // Som e rolagem podem mudar a posição dos controles entre as pressões.
        await button.scrollIntoViewIfNeeded()
        const bounds = await button.boundingBox()
        expect(bounds).not.toBeNull()
        const finger = {
          x: bounds!.x + bounds!.width / 2,
          y: bounds!.y + bounds!.height / 2,
          id: 1,
        }
        const expectedSequence = (await readInputLatency(page)).trials.length + 1
        await armInputLatency(page, phase)
        attempts.push({
          sequence: expectedSequence,
          phase,
          delayMs: delay,
          x: finger.x,
          y: finger.y,
        })
        const readExpectedTrial = async () =>
          (await readInputLatency(page)).trials.find(
            (trial) => trial.sequence === expectedSequence && trial.phase === phase,
          )
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [finger],
        })
        try {
          await expect
            .poll(async () => (await readExpectedTrial())?.sequence ?? null, {
              timeout: 2000,
              intervals: [10, 20, 30],
            })
            .toBe(expectedSequence)
          // O polling aguarda o evento; os relógios da medição foram gravados no navegador.
          await expect
            .poll(async () => (await readExpectedTrial())?.capturedAt ?? null, {
              timeout: 2000,
              intervals: [10, 20, 30],
            })
            .not.toBeNull()
        } finally {
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        }
        await expect
          .poll(async () => (await readExpectedTrial())?.settledDraws ?? 0, {
            timeout: 2500,
            intervals: [10, 20, 30],
          })
          .toBeGreaterThanOrEqual(3)
      }
    }
    let before = await readInputLatency(page)
    let beforeProduction = await readProductionProbe(page)
    let measurementError: unknown = null
    try {
      // A referência sem áudio é medida no mesmo navegador, antes de ativar o caminho PCM.
      await measurePresses([7, 31, 67, 113], 'baseline')
      if (profile.audio) {
        await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
        await expect
          .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
          .toBeGreaterThan(8192)
        // A reserva inicial e a adaptação ficam fora da medição de resposta.
        await page.waitForTimeout(4000)
        await expect
          .poll(async () => (await readProductionProbe(page)).latestAudio?.primed ?? false)
          .toBe(true)
      }
      before = await readInputLatency(page)
      beforeProduction = await readProductionProbe(page)
      await measurePresses(PRESS_DELAYS_MS, 'measured')
    } catch (cause) {
      measurementError = cause
    } finally {
      await session.detach()
    }
    const after = await readInputLatency(page)
    const afterProduction = await readProductionProbe(page)
    const baseline = after.trials.filter(
      (trial) => trial.phase === 'baseline' && trial.totalMs !== null,
    )
    const baselineP95Ms = baseline.length
      ? latencyPercentile(
          baseline.map((trial) => trial.totalMs!),
          0.95,
        )
      : null
    const relativeP95LimitMs = Math.min(
      TOTAL_LIMIT_MS,
      Math.max(100, (baselineP95Ms ?? TOTAL_LIMIT_MS) + (2 * 1000) / 60 + 20),
    )
    const completed = after.trials.filter(
      (trial) =>
        trial.phase === 'measured' && trial.totalMs !== null && trial.presentationMs !== null,
    )
    const totalMs = completed.map((trial) => trial.totalMs!)
    const presentationMs = completed.map((trial) => trial.presentationMs!)
    const coreMs = completed.map((trial) => trial.coreResponseMs!)
    const audio = after.audioHistory.filter((sample) => sample.at >= before.observedAt)
    const producer = after.producerHistory.filter((sample) => sample.at >= before.observedAt)
    const firstAudio = before.audioHistory.at(-1)
    const lastAudio = after.audioHistory.at(-1)
    const firstProducer = before.producerHistory.at(-1)
    const lastProducer = after.producerHistory.at(-1)
    const result = {
      profile: profile.name,
      project: testInfo.project.name,
      limitation:
        'Mede entrada nativa até ImageData no Canvas do Chromium no computador; não mede fótons nem homologa o Motorola.',
      syntheticTransportDelayPerDirectionMs: profile.transportDelayMs,
      syntheticOutputDelayMs: profile.outputDelayMs,
      measuredFrom: before.observedAt,
      measuredUntil: after.observedAt,
      baselineP95Ms,
      relativeP95LimitMs,
      totalP95Ms: totalMs.length ? latencyPercentile(totalMs, 0.95) : null,
      totalMaximumMs: totalMs.length ? Math.max(...totalMs) : null,
      presentationP95Ms: presentationMs.length ? latencyPercentile(presentationMs, 0.95) : null,
      presentationMaximumMs: presentationMs.length ? Math.max(...presentationMs) : null,
      coreResponseP95Ms: coreMs.length ? latencyPercentile(coreMs, 0.95) : null,
      coreResponseMaximumMs: coreMs.length ? Math.max(...coreMs) : null,
      attempts,
      trials: after.trials,
      audio,
      producer,
      firstAudio,
      lastAudio,
      firstProducer,
      lastProducer,
      productionBefore: beforeProduction,
      productionAfter: afterProduction,
      transport: profile.transportDelayMs > 0 ? await readAudioTransport(page) : null,
      measurementError:
        measurementError instanceof Error ? measurementError.message : measurementError,
    }
    const reportPath = testInfo.outputPath('input-latency.json')
    await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n')
    await testInfo.attach('input-latency.json', {
      path: reportPath,
      contentType: 'application/json',
    })
    await expectProductionClean(page)
    if (measurementError) throw measurementError
    expect(baseline).toHaveLength(4)
    expect(baselineP95Ms).toBeLessThanOrEqual(TOTAL_LIMIT_MS)
    expect(completed).toHaveLength(12)
    for (const trial of completed) {
      expect(trial.trusted).toBe(true)
      expect(trial.pointerType).toBe('touch')
      expect(trial.forwardingMs).toBeGreaterThanOrEqual(0)
      expect(trial.coreResponseMs).toBeGreaterThanOrEqual(trial.forwardingMs!)
      expect(trial.presentationMs).toBeGreaterThanOrEqual(0)
      expect(trial.releasedAt).not.toBeNull()
      expect(trial.coreHash).not.toBe(trial.baselineCoreHash)
      expect(trial.canvasHash).not.toBe(trial.baselineCanvasHash)
    }
    expect(result.totalMaximumMs).toBeLessThanOrEqual(TOTAL_LIMIT_MS)
    expect(result.totalP95Ms).toBeLessThanOrEqual(relativeP95LimitMs)
    expect(result.presentationMaximumMs).toBeLessThanOrEqual(100)
    expect(result.presentationP95Ms).toBeLessThanOrEqual(PRESENTATION_P95_LIMIT_MS)
    if (profile.audio) {
      expect(firstAudio).toBeDefined()
      expect(lastAudio).toBeDefined()
      expect(lastAudio!.diagnostics.epoch).toBe(firstAudio!.diagnostics.epoch)
      expect(lastAudio!.diagnostics.active).toBe(true)
      expect(lastAudio!.diagnostics.primed).toBe(true)
      expect(lastAudio!.diagnostics.renderedFrames).toBeGreaterThan(
        firstAudio!.diagnostics.renderedFrames,
      )
      expect(lastAudio!.diagnostics.underrunFrames - firstAudio!.diagnostics.underrunFrames).toBe(0)
      expect(lastAudio!.diagnostics.droppedFrames - firstAudio!.diagnostics.droppedFrames).toBe(0)
      expect(lastAudio!.diagnostics.energy).toBe(0)
      for (const point of audio) {
        expect(point.diagnostics.epoch).toBe(firstAudio!.diagnostics.epoch)
        expect(point.diagnostics.underrunFrames).toBe(firstAudio!.diagnostics.underrunFrames)
        expect(point.diagnostics.droppedFrames).toBe(firstAudio!.diagnostics.droppedFrames)
      }
      expect(firstProducer).toBeDefined()
      expect(lastProducer).toBeDefined()
      expect(lastProducer!.diagnostics.droppedFrames).toBe(firstProducer!.diagnostics.droppedFrames)
      for (const point of producer)
        expect(point.diagnostics.droppedFrames).toBe(firstProducer!.diagnostics.droppedFrames)
    } else {
      expect(beforeProduction.contexts).toHaveLength(0)
      expect(afterProduction.contexts).toHaveLength(0)
    }
  })
}
