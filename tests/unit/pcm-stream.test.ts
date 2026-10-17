import { describe, expect, it } from 'vitest'
import { PcmStream } from '../../src/platform/audio/pcm-stream'
import {
  AUDIO_MAX_FRAMES,
  AUDIO_MAX_REQUEST_FRAMES,
  audioBufferProfile,
} from '../../src/platform/audio/protocol'

const QUANTUM = 128

interface SimulationOptions {
  readonly sampleRate?: number
  readonly seconds?: number
  readonly burstQuanta?: number | readonly number[]
  readonly responseDelaysMs: readonly number[]
  readonly overshoot?: number
}

/** O backend consome vários quanta no mesmo turno e recebe PCM no intervalo entre rajadas. */
function simulateBackend({
  sampleRate = 48_000,
  seconds = 65,
  burstQuanta = [48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 49],
  responseDelaysMs,
  overshoot = 3,
}: SimulationOptions) {
  const stream = new PcmStream(sampleRate)
  const profile = audioBufferProfile(sampleRate)
  const left = new Float32Array(QUANTUM)
  const right = new Float32Array(QUANTUM)
  const burstPattern = typeof burstQuanta === 'number' ? [burstQuanta] : burstQuanta
  let now = 0
  let nextBurst = 0
  let flight: { frames: number; due: number } | null = null
  let requests = 0
  let maximumQueued = 0
  let maximumOutstanding = 0
  let largestRequest = 0
  let renderedQuanta = 0
  let bursts = 0
  let before: ReturnType<PcmStream['diagnostics']> | null = null
  let quantaAtMeasurement = 0
  const starvation: unknown[] = []

  const request = () => {
    const frames = stream.demand()
    if (frames === 0) return
    if (flight !== null) throw new Error('Uma segunda demanda foi emitida antes da resposta.')
    const stats = stream.diagnostics()
    maximumOutstanding = Math.max(maximumOutstanding, stats.queuedFrames + frames)
    largestRequest = Math.max(largestRequest, frames)
    expect(frames).toBeLessThanOrEqual(profile.requestLimit)
    expect(stats.queuedFrames + frames + QUANTUM).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
    const delay = responseDelaysMs[requests % responseDelaysMs.length]!
    requests += 1
    flight = { frames, due: now + delay }
  }

  stream.reset(1, true)
  request()
  while (now < seconds * 1000) {
    const response = flight as { frames: number; due: number } | null
    if (response !== null && response.due <= nextBurst) {
      now = response.due
      flight = null
      if (!stream.receive(new Float32Array((response.frames + overshoot) * 2), 1))
        throw new Error('O fluxo recusou uma resposta válida do backend simulado.')
      maximumQueued = Math.max(maximumQueued, stream.diagnostics().queuedFrames)
      request()
    } else {
      now = nextBurst
      if (now >= 3000 && before === null) {
        before = stream.diagnostics()
        quantaAtMeasurement = renderedQuanta
      }
      const quanta = burstPattern[bursts % burstPattern.length]!
      bursts += 1
      for (let index = 0; index < quanta; index += 1) {
        const check = before !== null && starvation.length < 3
        const previous = check ? stream.diagnostics() : null
        stream.render(left, right)
        if (previous !== null) {
          const current = stream.diagnostics()
          if (current.underrunFrames > previous.underrunFrames)
            starvation.push({ at: now, quantum: index, previous, current, flight })
        }
        renderedQuanta += 1
        request()
      }
      nextBurst += (quanta * QUANTUM * 1000) / sampleRate
    }
  }
  if (before === null) throw new Error('A simulação não alcançou o aquecimento.')
  const after = stream.diagnostics()
  return {
    stream,
    before,
    after,
    measuredFrames: (renderedQuanta - quantaAtMeasurement) * QUANTUM,
    underrunFrames: after.underrunFrames - before.underrunFrames,
    droppedFrames: after.droppedFrames - before.droppedFrames,
    maximumQueued,
    maximumOutstanding,
    largestRequest,
    requests,
    starvation,
  }
}

describe('reserva PCM para o backend móvel observado', () => {
  it.each([0, 3, 128])(
    'sustenta três minutos com rajadas de 48/49 quanta, RTT variável e overshoot de %i frames',
    (overshoot) => {
      const result = simulateBackend({
        seconds: 180,
        responseDelaysMs: [115, 117.3333333333, 128, 115, 128, 117.3333333333],
        overshoot,
      })
      expect(result.before.primed).toBe(true)
      expect(result.underrunFrames, JSON.stringify(result.starvation)).toBe(0)
      expect(result.droppedFrames).toBe(0)
      expect(result.after.renderedFrames - result.before.renderedFrames).toBe(result.measuredFrames)
      expect(result.after.peakRoundTripFrames).toBeGreaterThanOrEqual(6144)
      expect(result.maximumQueued).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.maximumOutstanding + QUANTUM).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.requests).toBeGreaterThan(500)
    },
  )

  it('cobre RTT de 115 a 128 ms mesmo com quanta distribuídos uniformemente', () => {
    const result = simulateBackend({
      burstQuanta: 1,
      responseDelaysMs: [115, 117.3333333333, 128, 115],
    })
    expect(result.underrunFrames).toBe(0)
    expect(result.droppedFrames).toBe(0)
    expect(result.after.renderedFrames - result.before.renderedFrames).toBe(result.measuredFrames)
    expect(result.after.targetFrames).toBeGreaterThan(6144)
  })

  it.each([0, 3, 128])(
    'sustenta três minutos de RTT de 150 a 192 ms com rajadas e overshoot de %i frames',
    (overshoot) => {
      const result = simulateBackend({
        seconds: 180,
        responseDelaysMs: [150, 170.6666666667, 192, 150, 192, 1, 1],
        overshoot,
      })
      expect(result.before.primed).toBe(true)
      expect(result.underrunFrames, JSON.stringify(result.starvation)).toBe(0)
      expect(result.droppedFrames).toBe(0)
      expect(result.after.renderedFrames - result.before.renderedFrames).toBe(result.measuredFrames)
      expect(result.maximumQueued).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.maximumOutstanding + QUANTUM).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.largestRequest).toBeLessThanOrEqual(AUDIO_MAX_REQUEST_FRAMES)
      expect(result.maximumOutstanding).toBeGreaterThan(AUDIO_MAX_REQUEST_FRAMES + QUANTUM)
    },
  )

  it('recebe pacote adiantado com overshoot quando a fila já supera a arena da APU', () => {
    const stream = new PcmStream()
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    stream.reset(1, true)
    const first = stream.demand()
    for (let index = 0; index < 72; index += 1) stream.render(left, right)
    expect(stream.receive(new Float32Array((first + QUANTUM) * 2).fill(0.25), 1)).toBe(true)
    const second = stream.demand()
    expect(second).toBeLessThanOrEqual(AUDIO_MAX_REQUEST_FRAMES)
    expect(stream.receive(new Float32Array((second + QUANTUM) * 2).fill(0.25), 1)).toBe(true)
    for (let index = 0; index < 5; index += 1) stream.render(left, right)
    const before = stream.diagnostics()
    expect(before.queuedFrames).toBeGreaterThan(AUDIO_MAX_REQUEST_FRAMES + QUANTUM)
    const request = stream.demand()
    expect(request).toBeGreaterThan(0)
    expect(request).toBeLessThanOrEqual(AUDIO_MAX_REQUEST_FRAMES)
    expect(stream.demand()).toBe(0)
    expect(before.queuedFrames + request + QUANTUM).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
    expect(stream.receive(new Float32Array((request + QUANTUM) * 2).fill(0.25), 1)).toBe(true)
    const queued = stream.diagnostics().queuedFrames
    expect(queued).toBe(before.queuedFrames + request + QUANTUM)
    expect(queued).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
    for (let frames = 0; frames < queued; frames += QUANTUM) {
      stream.render(left, right)
      expect(left.every((sample) => sample === 0.25)).toBe(true)
      expect(right.every((sample) => sample === 0.25)).toBe(true)
    }
    expect(stream.diagnostics()).toMatchObject({
      queuedFrames: 0,
      renderedFrames: before.renderedFrames + queued,
      underrunFrames: 0,
      droppedFrames: 0,
    })
  })

  it.each([8000, 44_100, 48_000, 96_000, 192_000])(
    'preserva priming de 64 ms e não aumenta a reserva de um backend rápido em %i Hz',
    (sampleRate) => {
      const stream = new PcmStream(sampleRate)
      const profile = audioBufferProfile(sampleRate)
      stream.reset(1, true)
      const initial = stream.demand()
      expect(initial).toBe(Math.ceil((sampleRate * 0.064) / QUANTUM) * QUANTUM)
      stream.render(new Float32Array(QUANTUM), new Float32Array(QUANTUM))
      expect(stream.receive(new Float32Array(initial * 2), 1)).toBe(true)
      expect(stream.diagnostics().targetFrames).toBe(profile.initialFrames)
    },
  )

  it('conserva o pico de RTT depois de respostas rápidas e descarta a estimativa na nova epoch', () => {
    const { stream } = simulateBackend({ seconds: 10, responseDelaysMs: [115, 128, 1, 1] })
    const peak = stream.diagnostics().peakRoundTripFrames
    expect(peak).toBeGreaterThanOrEqual(6144)
    stream.reset(2, true)
    expect(stream.diagnostics()).toMatchObject({
      epoch: 2,
      peakRoundTripFrames: 0,
      roundTripFrames: 0,
      queuedFrames: 0,
      pendingFrames: 0,
    })
    expect(stream.demand()).toBe(audioBufferProfile(48_000).initialFrames)
  })

  it('mantém a margem do maior RTT quando o quantum cresce depois de uma resposta rápida', () => {
    const stream = new PcmStream()
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    stream.reset(1, true)
    const first = stream.demand()
    for (let index = 0; index < 20; index += 1) stream.render(left, right)
    expect(stream.receive(new Float32Array(first * 2), 1)).toBe(true)
    expect(stream.diagnostics()).toMatchObject({
      peakRoundTripFrames: 2560,
      targetFrames: 5376,
    })
    const second = stream.demand()
    stream.render(new Float32Array(256), new Float32Array(256))
    expect(stream.receive(new Float32Array(second * 2), 1)).toBe(true)
    expect(stream.diagnostics()).toMatchObject({
      roundTripFrames: 256,
      peakRoundTripFrames: 2560,
      renderQuantumFrames: 256,
      targetFrames: 5632,
      underrunFrames: 0,
    })
  })

  it('PCM vazio de STOP permanece sem consumo e aceita a retomada na mesma epoch', () => {
    const stream = new PcmStream()
    stream.reset(1, true)
    stream.demand()
    expect(stream.receive(new Float32Array(), 1)).toBe(true)
    expect(stream.diagnostics()).toMatchObject({
      primed: false,
      pendingFrames: 0,
      renderedFrames: 0,
      underrunFrames: 0,
    })
    for (let index = 0; index < 48; index += 1)
      stream.render(new Float32Array(QUANTUM), new Float32Array(QUANTUM))
    const requested = stream.demand()
    expect(requested).toBe(audioBufferProfile(48_000).initialFrames)
    expect(stream.receive(new Float32Array(requested * 2), 1)).toBe(true)
    expect(stream.diagnostics()).toMatchObject({ primed: true, underrunFrames: 0 })
  })
})
