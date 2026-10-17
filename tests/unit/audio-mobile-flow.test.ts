import { describe, expect, it, vi } from 'vitest'
import { PcmStream } from '../../src/platform/audio/pcm-stream'
import { AUDIO_MAX_FRAMES, audioBufferProfile } from '../../src/platform/audio/protocol'
import type { AudioStreamDiagnostics } from '../../src/platform/audio/protocol'

const SAMPLE_RATES = [8_000, 44_100, 48_000, 96_000, 192_000] as const
const QUANTUM = 128

interface Delivery {
  readonly at: number
  readonly frames: number
}

interface SimulationResult {
  readonly before: AudioStreamDiagnostics
  readonly after: AudioStreamDiagnostics
  readonly measuredFrames: number
  readonly producedFrames: number
  readonly largestRequest: number
  readonly maximumQueued: number
  readonly maximumPending: number
}

/** Cada rajada consome quanta nativos antes de permitir a entrega das mensagens seguintes. */
function simulateTransport(
  sampleRate: number,
  roundTripMs: number,
  callbackBurstMs: number,
): SimulationResult {
  const stream = new PcmStream(sampleRate)
  const profile = audioBufferProfile(sampleRate)
  const left = new Float32Array(QUANTUM)
  const right = new Float32Array(QUANTUM)
  const burstQuanta = Math.max(1, Math.ceil((callbackBurstMs * sampleRate) / 1000 / QUANTUM))
  const burstFrames = burstQuanta * QUANTUM
  const roundTripFrames = Math.ceil((roundTripMs * sampleRate) / 1000)
  const warmupFrames = sampleRate * 2
  const finishFrames = sampleRate * 10
  const transport: { delivery: Delivery | null } = { delivery: null }
  let now = 0
  let producedFrames = 0
  let initialProducedFrames = 0
  let measurementStartedAt = 0
  let before: AudioStreamDiagnostics | null = null
  let largestRequest = 0
  let maximumQueued = 0
  let maximumPending = 0

  function request(): void {
    const frames = stream.demand()
    if (frames === 0) return
    expect(transport.delivery, 'O transporte permite somente uma demanda pendente.').toBeNull()
    expect(Number.isInteger(frames)).toBe(true)
    expect(frames).toBeGreaterThan(0)
    expect(frames).toBeLessThanOrEqual(profile.requestLimit)
    largestRequest = Math.max(largestRequest, frames)
    transport.delivery = { at: now + roundTripFrames, frames }
    maximumPending = Math.max(maximumPending, stream.diagnostics().pendingFrames)
  }

  stream.reset(7, true)
  request()
  while (now < finishFrames) {
    if (transport.delivery && transport.delivery.at <= now) {
      const received = transport.delivery
      transport.delivery = null
      expect(stream.receive(new Float32Array(received.frames * 2).fill(0.125), 7)).toBe(true)
      producedFrames += received.frames
      maximumQueued = Math.max(maximumQueued, stream.diagnostics().queuedFrames)
    }
    if (!before && now >= warmupFrames) {
      before = stream.diagnostics()
      measurementStartedAt = now
      initialProducedFrames = producedFrames
    }
    for (let index = 0; index < burstQuanta; index += 1) {
      stream.render(left, right)
      request()
    }
    now += burstFrames
  }
  if (!before) throw new Error('A janela de medição não começou.')
  return {
    before,
    after: stream.diagnostics(),
    measuredFrames: now - measurementStartedAt,
    producedFrames: producedFrames - initialProducedFrames,
    largestRequest,
    maximumQueued,
    maximumPending,
  }
}

describe('abastecimento PCM com atraso e callbacks em rajadas', () => {
  it.each(SAMPLE_RATES)('define reservas de tempo limitadas em %i Hz', (sampleRate) => {
    const profile = audioBufferProfile(sampleRate)
    expect(profile.initialFrames / sampleRate).toBeGreaterThanOrEqual(0.064)
    expect(profile.initialFrames).toBeLessThanOrEqual(profile.maxFrames)
    expect(profile.maxFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES - QUANTUM)
    expect(profile.requestLimit).toBeLessThanOrEqual(profile.maxFrames)
    expect(profile.refillFrames / sampleRate).toBeGreaterThanOrEqual(0.01)
    expect(profile.refillFrames % QUANTUM).toBe(0)
    expect(profile.maxFrames / sampleRate).toBeLessThanOrEqual(0.128 + QUANTUM / sampleRate)
  })

  it.each(SAMPLE_RATES)(
    'sustenta consumo e produção em %i Hz com ida e volta de 20 ms e rajadas de 16 ms',
    (sampleRate) => {
      const result = simulateTransport(sampleRate, 20, 16)
      const rendered = result.after.renderedFrames - result.before.renderedFrames
      const underrun = result.after.underrunFrames - result.before.underrunFrames
      const dropped = result.after.droppedFrames - result.before.droppedFrames
      expect(result.before.primed).toBe(true)
      expect(result.after.primed).toBe(true)
      expect(underrun, 'A janela estável não deve faltar PCM.').toBe(0)
      expect(dropped, 'O transporte não deve produzir PCM além da arena.').toBe(0)
      expect(rendered).toBe(result.measuredFrames)
      expect(result.producedFrames / result.measuredFrames).toBeGreaterThanOrEqual(0.98)
      expect(result.producedFrames / result.measuredFrames).toBeLessThanOrEqual(1.02)
      expect(result.maximumQueued).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
      expect(result.maximumPending).toBeLessThanOrEqual(audioBufferProfile(sampleRate).requestLimit)
      expect(result.largestRequest).toBeGreaterThan(audioBufferProfile(sampleRate).refillFrames)
    },
  )

  it('o teto temporal efetivo em 192 kHz permanece explícito e não cresce sem limite', () => {
    const sampleRate = 192_000
    const profile = audioBufferProfile(sampleRate)
    const stream = new PcmStream(sampleRate)
    stream.reset(1, true)
    const first = stream.demand()
    const left = new Float32Array(sampleRate)
    const right = new Float32Array(sampleRate)
    stream.render(left, right)
    expect(stream.receive(new Float32Array(first * 2), 1)).toBe(true)
    const stats = stream.diagnostics()
    expect(stats.targetFrames).toBeLessThanOrEqual(profile.maxFrames)
    expect(stats.queuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
    expect(profile.maxFrames / sampleRate).toBeLessThan(0.086)
    expect(stream.demand()).toBeLessThanOrEqual(profile.requestLimit)
  })

  it('a pausa descarta medições e PCM atrasado da sessão anterior', () => {
    const stream = new PcmStream(48_000)
    stream.reset(4, true)
    const request = stream.demand()
    stream.render(new Float32Array(1024), new Float32Array(1024))
    stream.reset(5, false)
    expect(stream.receive(new Float32Array(request * 2), 4)).toBe(false)
    expect(stream.demand()).toBe(0)
    expect(stream.diagnostics()).toMatchObject({
      epoch: 5,
      active: false,
      primed: false,
      pendingFrames: 0,
      queuedFrames: 0,
      renderedFrames: 0,
      underrunFrames: 0,
      droppedFrames: 0,
      roundTripFrames: 0,
    })
    stream.reset(6, true)
    expect(stream.demand()).toBe(audioBufferProfile(48_000).initialFrames)
  })

  it('completa priming quando a adaptação deixa déficit menor que o refill mínimo', () => {
    const stream = new PcmStream(48_000)
    stream.reset(1, true)
    const firstRequest = stream.demand()
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    for (let index = 0; index < 12; index += 1) stream.render(left, right)
    stream.receive(new Float32Array(firstRequest * 2), 1)
    expect(stream.diagnostics().primed).toBe(false)
    const remainder = stream.demand()
    expect(remainder).toBeGreaterThan(0)
    expect(remainder).toBeLessThan(audioBufferProfile(48_000).refillFrames)
    expect(stream.receive(new Float32Array(remainder * 2), 1)).toBe(true)
    expect(stream.diagnostics()).toMatchObject({ primed: true, underrunFrames: 0 })
  })

  it('conta silêncio de rebuffer depois de tocar sem contar o priming inicial', () => {
    const stream = new PcmStream(48_000)
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    stream.reset(1, true)
    const initial = stream.demand()
    stream.render(left, right)
    expect(stream.diagnostics().underrunFrames).toBe(0)
    stream.receive(new Float32Array(initial * 2), 1)
    for (let index = 0; index < initial / QUANTUM + 1; index += 1) stream.render(left, right)
    expect(stream.diagnostics()).toMatchObject({ primed: false, underrunFrames: QUANTUM })
    stream.demand()
    stream.render(left, right)
    stream.render(left, right)
    expect(stream.diagnostics()).toMatchObject({
      primed: false,
      underrunFrames: QUANTUM * 3,
      underruns: 3,
    })
    stream.reset(2, false)
    expect(stream.diagnostics()).toMatchObject({ underrunFrames: 0, underruns: 0 })
  })

  it('recusa PCM além do orçamento sem perder a demanda válida nem aceitar duplicatas', () => {
    const stream = new PcmStream(192_000)
    stream.reset(1, true)
    const request = stream.demand()
    expect(stream.receive(new Float32Array((request + QUANTUM + 1) * 2), 1)).toBe(false)
    expect(stream.diagnostics()).toMatchObject({ pendingFrames: request, queuedFrames: 0 })
    expect(stream.receive(new Float32Array((request + 1) * 2), 0)).toBe(false)
    expect(stream.receive(new Float32Array((request + 1) * 2), 1)).toBe(true)
    expect(stream.receive(new Float32Array((request + 1) * 2), 1)).toBe(false)
    expect(stream.diagnostics()).toMatchObject({
      pendingFrames: 0,
      queuedFrames: request + 1,
      droppedFrames: 0,
    })
  })

  it('o Worklet aguarda outro quantum após PCM vazio sem criar ping-pong em STOP', async () => {
    class PortStub {
      readonly sent: unknown[] = []
      onmessage: ((event: { data: unknown }) => void) | null = null
      postMessage(message: unknown): void {
        this.sent.push(message)
      }
      start(): void {}
      close(): void {}
    }
    interface ProcessorStub {
      readonly port: PortStub
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
    }
    let Processor: (new () => ProcessorStub) | null = null
    vi.stubGlobal(
      'AudioWorkletProcessor',
      class {
        readonly port = new PortStub()
      },
    )
    vi.stubGlobal('sampleRate', 48_000)
    vi.stubGlobal('registerProcessor', (_name: string, registered: new () => ProcessorStub) => {
      Processor = registered
    })
    try {
      await import('../../src/platform/audio/pcm-worklet')
      const Registered = Processor as (new () => ProcessorStub) | null
      if (!Registered) throw new Error('O processador de áudio não foi registrado.')
      const processor = new Registered()
      const workerPort = new PortStub()
      processor.port.onmessage?.({ data: { type: 'connect', port: workerPort, epoch: 1 } })
      processor.port.onmessage?.({ data: { type: 'reset', epoch: 1, active: true } })
      expect(workerPort.sent).toHaveLength(1)
      workerPort.onmessage?.({ data: { type: 'samples', samples: new Float32Array(), epoch: 1 } })
      expect(workerPort.sent).toHaveLength(1)
      processor.process([], [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]])
      expect(workerPort.sent).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([7_999, 192_001, Number.NaN, Number.POSITIVE_INFINITY, 44_100.5])(
    'recusa taxa de áudio inválida %s antes de alocar o fluxo',
    (sampleRate) => {
      expect(() => new PcmStream(sampleRate)).toThrow()
      expect(() => audioBufferProfile(sampleRate)).toThrow()
    },
  )
})
