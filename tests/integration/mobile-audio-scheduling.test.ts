import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AUDIO_MAX_FRAMES } from '../../src/platform/audio/protocol'
import {
  loadSchedulingProcessor,
  simulateMobileAudioScheduling,
} from '../helpers/mobile-audio-scheduling'
import type { SchedulingSample } from '../helpers/mobile-audio-scheduling'

beforeAll(loadSchedulingProcessor)
afterAll(() => vi.unstubAllGlobals())

function maximumPresentationGap(samples: readonly SchedulingSample[]): number {
  let previousAt: number | null = null
  let maximumGap = 0
  for (const sample of samples) {
    if (sample.presentedFrame === null) continue
    if (previousAt !== null) maximumGap = Math.max(maximumGap, sample.atMs - previousAt)
    previousAt = sample.atMs
  }
  return maximumGap
}

describe('integração de áudio e vídeo com mensagens agrupadas e saída atrasada', () => {
  it('aguarda a saída no diagnóstico e apresenta vídeo desde o início do clock', async () => {
    const result = await simulateMobileAudioScheduling({
      seconds: 2,
      batchMs: 10,
      timestampAvailableAtMs: 312,
    })
    const maximumLead = Math.max(
      ...result.samples.map((sample) => (sample.cursor ?? 0) - sample.audibleFrame),
    )
    expect(maximumLead).toBeLessThanOrEqual(128)
    expect(
      result.samples.some(
        (sample) => sample.atMs < 312 && sample.presentedFrame !== null && sample.cursor === null,
      ),
    ).toBe(true)
    expect(maximumPresentationGap(result.samples)).toBeLessThanOrEqual(1000 / 30 + 0.001)
    const recovered = result.samples.filter((sample) => sample.atMs >= 1000)
    expect(maximumPresentationGap(recovered)).toBeLessThanOrEqual(1000 / 30 + 0.001)
  })

  it('sustenta PCM real e apresentação com lotes de 128 ms e saída de 312 ms', async () => {
    const result = await simulateMobileAudioScheduling()
    const samples = result.samples.filter((sample) => sample.atMs >= 3000)
    const draws = samples.filter((sample) => sample.presentedFrame !== null).length
    const first = samples[0]!
    const last = samples.at(-1)!
    const seconds = (last.atMs - first.atMs) / 1000
    const audio = result.audioHistory.filter((sample) => sample.atMs >= 3000)
    expect(audio.at(-1)!.diagnostics.underrunFrames - audio[0]!.diagnostics.underrunFrames).toBe(0)
    expect(audio.at(-1)!.diagnostics.droppedFrames).toBe(0)
    expect((last.renderedPcmFrames - first.renderedPcmFrames) / 48_000 / seconds).toBeCloseTo(1, 2)
    expect(result.droppedVideoFrames).toBe(0)
    expect(result.producedFrames - result.renderedFrames).toBeGreaterThanOrEqual(0)
    expect(result.producedFrames - result.renderedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES * 2)
    expect(result.producerDroppedFrames).toBe(0)
    expect(result.partialResponses).toBeGreaterThan(0)
    expect(draws / seconds).toBeGreaterThanOrEqual(55)
    expect(draws / seconds).toBeLessThanOrEqual(61)
    expect(maximumPresentationGap(samples)).toBeLessThanOrEqual(1000 / 30 + 0.001)
    expect(result.requests).toBeGreaterThan(20)
    expect(result.largestRequest).toBeGreaterThan(512)
    expect(result.largestRequest).toBeLessThanOrEqual(16_256)
    for (const sample of samples) {
      expect(sample.cursor).not.toBeNull()
      expect(sample.cursor! - sample.audibleFrame).toBeLessThanOrEqual(128)
      expect(sample.audibleFrame - sample.cursor!).toBeLessThanOrEqual(512)
      expect(sample.producedPcmFrames).toBeLessThanOrEqual(sample.wallclockPcmFrames)
      expect(sample.producedPcmFrames - sample.displayedPcmFrame!).toBeLessThanOrEqual(1200)
    }
  })

  it('não salta nem regride na falta real de PCM e recupera após a saída reproduzir o silêncio', async () => {
    const result = await simulateMobileAudioScheduling({
      seconds: 10,
      stallAtMs: 4000,
      stallForMs: 384,
    })
    const samples = result.samples.filter((sample) => sample.atMs >= 3000)
    expect(
      result.missingFrames,
      'O cenário precisa esvaziar PCM efetivamente renderizado.',
    ).toBeGreaterThan(0)
    expect(result.audioHistory.at(-1)!.diagnostics.underrunFrames).toBeGreaterThan(0)
    expect(result.audioHistory.at(-1)!.diagnostics.droppedFrames).toBe(0)
    expect(result.producerDroppedFrames).toBe(0)
    let previousCursor = -1
    for (const sample of samples) {
      expect(sample.cursor).not.toBeNull()
      expect(sample.cursor!).toBeGreaterThanOrEqual(previousCursor)
      expect(sample.cursor! - sample.audibleFrame).toBeLessThanOrEqual(128)
      expect(sample.audibleFrame - sample.cursor!).toBeLessThanOrEqual(512)
      previousCursor = sample.cursor!
    }
    expect(result.droppedVideoFrames).toBe(0)
    expect(result.producedFrames - result.renderedFrames).toBeGreaterThanOrEqual(0)
    expect(result.producedFrames - result.renderedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES * 2)
    expect(maximumPresentationGap(samples)).toBeLessThanOrEqual(1000 / 30 + 0.001)
    const duringStall = samples.filter((sample) => sample.atMs >= 4000 && sample.atMs <= 5000)
    expect(duringStall.filter((sample) => sample.presentedFrame !== null).length).toBeGreaterThan(
      50,
    )
    const recovered = samples.filter((sample) => sample.atMs >= 7000)
    const seconds = (recovered.at(-1)!.atMs - recovered[0]!.atMs) / 1000
    expect(
      recovered.filter((sample) => sample.presentedFrame !== null).length / seconds,
    ).toBeGreaterThanOrEqual(55)
    expect(maximumPresentationGap(recovered)).toBeLessThanOrEqual(1000 / 30 + 0.001)
  })

  it('pedido sem passado disponível espera o próximo tick e recebe somente PCM produzido', async () => {
    const result = await simulateMobileAudioScheduling({ seconds: 2, batchMs: 1 })
    expect(result.requestsWaitingForProducer).toBeGreaterThan(0)
    expect(result.partialResponses).toBeGreaterThan(0)
    expect(result.producerDroppedFrames).toBe(0)
    expect(result.droppedVideoFrames).toBe(0)
    for (const sample of result.samples) {
      expect(sample.producedPcmFrames).toBeLessThanOrEqual(sample.wallclockPcmFrames)
      expect(sample.renderedPcmFrames).toBeLessThanOrEqual(sample.producedPcmFrames)
      expect(sample.workerQueuedFrames).toBeGreaterThanOrEqual(0)
      expect(sample.workletQueuedFrames).toBeGreaterThanOrEqual(0)
    }
  })

  it('sustenta três minutos após dez segundos de aquecimento sem acumular latência', async () => {
    const warmupMs = 10_000
    const measuredSeconds = 180
    const result = await simulateMobileAudioScheduling({
      seconds: warmupMs / 1000 + measuredSeconds,
    })
    const measured = result.samples.filter((sample) => sample.atMs >= warmupMs)
    const first = measured[0]!
    const last = measured.at(-1)!
    const elapsed = (last.atMs - first.atMs) / 1000
    const audio = result.audioHistory.filter((sample) => sample.atMs >= warmupMs)
    expect(elapsed).toBeCloseTo(measuredSeconds, 6)
    expect((last.producedPcmFrames - first.producedPcmFrames) / 48_000 / elapsed).toBeCloseTo(1, 6)
    expect((last.renderedPcmFrames - first.renderedPcmFrames) / 48_000 / elapsed).toBeCloseTo(1, 4)
    expect(audio.at(-1)!.diagnostics.underrunFrames - audio[0]!.diagnostics.underrunFrames).toBe(0)
    expect(audio.at(-1)!.diagnostics.droppedFrames).toBe(0)
    expect(result.producerDroppedFrames).toBe(0)
    expect(result.droppedVideoFrames).toBe(0)
    expect(maximumPresentationGap(measured)).toBeLessThanOrEqual(1000 / 30 + 0.001)

    for (const sample of measured) {
      expect(sample.workerQueuedFrames).toBeGreaterThanOrEqual(0)
      expect(sample.workerQueuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(sample.workletQueuedFrames).toBeGreaterThanOrEqual(0)
      expect(sample.workletQueuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(sample.audioInventoryFrames).toBe(
        sample.producedPcmFrames -
          sample.renderedPcmFrames -
          sample.producerDroppedFrames -
          sample.consumerDroppedFrames,
      )
      expect(sample.producedPcmFrames).toBeLessThanOrEqual(sample.wallclockPcmFrames)
      expect(sample.producedPcmFrames - sample.displayedPcmFrame!).toBeLessThanOrEqual(1200)
      expect(sample.cursor).not.toBeNull()
      expect(sample.cursor! - sample.audibleFrame).toBeLessThanOrEqual(128)
      expect(sample.audibleFrame - sample.cursor!).toBeLessThanOrEqual(512)
    }
    const firstThird = measured.filter((sample) => sample.atMs < warmupMs + 60_000)
    const lastThird = measured.filter((sample) => sample.atMs >= warmupMs + 120_000)
    const maximumInventory = (samples: readonly SchedulingSample[]) =>
      Math.max(...samples.map((sample) => sample.audioInventoryFrames))
    const meanInventory = (samples: readonly SchedulingSample[]) =>
      samples.reduce((sum, sample) => sum + sample.audioInventoryFrames, 0) / samples.length
    expect(maximumInventory(lastThird)).toBeLessThanOrEqual(maximumInventory(firstThird) + 128)
    expect(meanInventory(lastThird)).toBeLessThanOrEqual(meanInventory(firstThird) + 128)
  })
})
