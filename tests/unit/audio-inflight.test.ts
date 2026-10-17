import { describe, expect, it } from 'vitest'
import { PcmStream } from '../../src/platform/audio/pcm-stream'
import { AUDIO_MAX_FRAMES, audioBufferProfile } from '../../src/platform/audio/protocol'

interface Flight {
  frames: number
  due: number
}

/** Relógio virtual em quanta de render. Não depende de timers ou navegador. */
function jitterScenario(sampleRate = 48_000, alternating = false, overshoot = 0) {
  const quantum = 128
  const stream = new PcmStream(sampleRate)
  stream.reset(1, true)
  const left = new Float32Array(quantum)
  const right = new Float32Array(quantum)
  const aligned = (seconds: number) => Math.ceil((sampleRate * seconds) / quantum) * quantum
  const warmLatency = aligned(0.0533333333333)
  const mediumLatency = aligned(0.032)
  const slowLatency = aligned(0.0746666666666)
  let flight: Flight | null = null
  let requests = 0
  let maximumQueued = 0
  let maximumOutstanding = 0
  let underrunFramesAtWarmup = 0
  let targetBeforeJitter = 0
  let measuredWarmup = false
  const profile = audioBufferProfile(sampleRate)

  function request(frame: number): void {
    const frames = stream.demand()
    if (frames === 0) return
    if (flight !== null) throw new Error('Mais de uma demanda ficou pendente no relógio virtual.')
    requests += 1
    let latency: number
    if (frame < sampleRate * 2) latency = warmLatency
    else if (frame < sampleRate * 3) latency = mediumLatency
    else if (frame < sampleRate * 4)
      latency = alternating
        ? [mediumLatency, slowLatency, quantum * 4, slowLatency][requests % 4]!
        : slowLatency
    else if (frame < sampleRate * 4.5) latency = quantum
    else if (frame < sampleRate * 7)
      latency = [mediumLatency, slowLatency, quantum * 4, slowLatency, slowLatency, mediumLatency][
        requests % 6
      ]!
    else latency = quantum
    flight = { frames, due: frame + latency }
    const state = stream.diagnostics()
    maximumOutstanding = Math.max(maximumOutstanding, state.queuedFrames + state.pendingFrames)
    expect(state.queuedFrames + state.pendingFrames + 128).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
    expect(frames).toBeLessThanOrEqual(profile.requestLimit)
  }

  request(0)
  for (let frame = 0; frame < sampleRate * 8; frame += quantum) {
    if (flight !== null && (flight as Flight).due <= frame) {
      const pending: Flight = flight
      flight = null
      expect(stream.receive(new Float32Array((pending.frames + overshoot) * 2), 1)).toBe(true)
      const state = stream.diagnostics()
      maximumQueued = Math.max(maximumQueued, state.queuedFrames)
      expect(state.queuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(state.targetFrames).toBeLessThanOrEqual(profile.maxFrames)
      request(frame)
    }
    if (!measuredWarmup && frame >= sampleRate * 3) {
      const state = stream.diagnostics()
      underrunFramesAtWarmup = state.underrunFrames
      targetBeforeJitter = state.targetFrames
      measuredWarmup = true
    }
    stream.render(left, right)
    request(frame + quantum)
  }
  return {
    stream,
    targetBeforeJitter,
    maximumQueued,
    maximumOutstanding,
    underrunFramesAfterWarmup: stream.diagnostics().underrunFrames - underrunFramesAtWarmup,
  }
}

describe('reserva de PCM enquanto uma demanda está em voo', () => {
  it.each([false, true])(
    'cobre jitter depois do warmup sem esquecer atrasos anteriores, alternância=%s',
    (alternating) => {
      const result = jitterScenario(48_000, alternating)
      expect(result.targetBeforeJitter).toBe(5376)
      expect(result.underrunFramesAfterWarmup).toBe(0)
      expect(result.stream.diagnostics().droppedFrames).toBe(0)
      expect(result.stream.diagnostics().primed).toBe(true)
      expect(result.stream.diagnostics().peakRoundTripFrames).toBe(3584)
    },
  )

  it('aceita resposta repentinamente rápida e overshoot de CPU sem transbordar a arena', () => {
    const result = jitterScenario(48_000, true, 128)
    expect(result.underrunFramesAfterWarmup).toBe(0)
    expect(result.stream.diagnostics().droppedFrames).toBe(0)
    expect(result.maximumOutstanding + 128).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
  })

  it.each([8000, 44_100, 96_000, 192_000])(
    'mantém limites físicos e recupera a reserva em %i Hz',
    (sampleRate) => {
      const result = jitterScenario(sampleRate, true, 128)
      expect(result.maximumOutstanding + 128).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.maximumQueued).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.stream.diagnostics().droppedFrames).toBe(0)
      expect(result.stream.diagnostics().primed).toBe(true)
      expect(result.stream.diagnostics().active).toBe(true)
      // Em 192 kHz a arena comporta menos de 171 ms. Não se presume que cubra
      // jitter arbitrário combinado com a resposta anterior.
    },
  )

  it('descarta a estimativa de latência ao mudar de época', () => {
    const { stream } = jitterScenario()
    expect(stream.diagnostics().peakRoundTripFrames).toBeGreaterThan(0)
    stream.reset(2, true)
    expect(stream.diagnostics()).toMatchObject({
      peakRoundTripFrames: 0,
      roundTripFrames: 0,
      queuedFrames: 0,
      pendingFrames: 0,
    })
    const profile = audioBufferProfile(48_000)
    expect(stream.demand()).toBe(profile.initialFrames)
    expect(stream.receive(new Float32Array(profile.initialFrames * 2), 2)).toBe(true)
    stream.render(new Float32Array(profile.refillFrames), new Float32Array(profile.refillFrames))
    expect(stream.demand()).toBe(profile.refillFrames)
  })
})
