import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { StereoPcmQueue } from '../../src/platform/audio/pcm-queue'
import { PcmStream } from '../../src/platform/audio/pcm-stream'
import type {
  AudioNeedMessage,
  AudioPlaybackMessage,
  AudioStatsMessage,
} from '../../src/platform/audio/protocol'

class PortStub {
  readonly sent: unknown[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  closed = false

  postMessage(message: unknown): void {
    this.sent.push(message)
  }

  start(): void {}

  close(): void {
    this.closed = true
  }
}

interface ProcessorStub {
  readonly port: PortStub
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

let Registered!: new () => ProcessorStub

function messages<T extends { readonly type: string }>(port: PortStub, type: T['type']): T[] {
  return port.sent.filter((message) => (message as { type?: string }).type === type) as T[]
}

function createProcessor() {
  const processor = new Registered()
  const worker = new PortStub()
  let renderedFrames = 0
  processor.port.onmessage?.({ data: { type: 'connect', port: worker, epoch: 1 } })
  processor.port.onmessage?.({ data: { type: 'reset', epoch: 1, active: true } })
  return {
    processor,
    worker,
    receive(frames: number, epoch = 1) {
      worker.onmessage?.({
        data: { type: 'samples', samples: new Float32Array(frames * 2), epoch },
      })
    },
    render(frames = 128) {
      vi.stubGlobal('currentTime', renderedFrames / 48_000)
      const left = new Float32Array(frames)
      const right = new Float32Array(frames)
      const running = processor.process([], [[left, right]])
      renderedFrames += frames
      return { left, right, running }
    },
    latestPlayback() {
      return messages<AudioPlaybackMessage>(processor.port, 'playback').at(-1)!
    },
  }
}

beforeAll(async () => {
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      readonly port = new PortStub()
    },
  )
  vi.stubGlobal('sampleRate', 48_000)
  vi.stubGlobal('currentTime', 0)
  vi.stubGlobal('registerProcessor', (_name: string, processor: new () => ProcessorStub) => {
    Registered = processor
  })
  await import('../../src/platform/audio/pcm-worklet')
})

beforeEach(() => vi.stubGlobal('currentTime', 0))
afterAll(() => vi.unstubAllGlobals())

describe('cursor PCM sem alocação de diagnósticos no caminho de renderização', () => {
  it('conta PCM descartado e renderizado, mas não conta silêncio por falta de amostras', () => {
    const queue = new StereoPcmQueue(4)
    queue.push(new Float32Array(12))
    expect(queue.consumedFrames).toBe(2)
    queue.render(new Float32Array(8), new Float32Array(8))
    expect(queue.consumedFrames).toBe(6)
    expect(queue.diagnostics()).toMatchObject({ renderedFrames: 4, droppedFrames: 2 })
    queue.render(new Float32Array(8), new Float32Array(8))
    expect(queue.consumedFrames).toBe(6)
    queue.clear()
    expect(queue.consumedFrames).toBe(0)
  })

  it('expõe cursor parado em priming e rebuffer e reinicia na troca de epoch', () => {
    const stream = new PcmStream()
    stream.reset(1, true)
    stream.demand()
    expect(stream.receive(new Float32Array(512 * 2), 1)).toBe(true)
    stream.render(new Float32Array(128), new Float32Array(128))
    expect(stream.playbackFrame).toBe(0)
    expect(stream.availablePlaybackFrame).toBe(512)
    expect(stream.playbackAdvancing).toBe(false)
    const needed = stream.demand()
    expect(stream.receive(new Float32Array(needed * 2), 1)).toBe(true)
    expect(stream.playbackAdvancing).toBe(true)
    const available = stream.availablePlaybackFrame
    stream.render(new Float32Array(available + 128), new Float32Array(available + 128))
    expect(stream.playbackFrame).toBe(available)
    expect(stream.availablePlaybackFrame).toBe(available)
    expect(stream.playbackAdvancing).toBe(false)
    stream.render(new Float32Array(128), new Float32Array(128))
    expect(stream.playbackFrame).toBe(available)
    stream.reset(2, false)
    expect(stream.playbackFrame).toBe(0)
    expect(stream.availablePlaybackFrame).toBe(0)
    expect(stream.playbackAdvancing).toBe(false)
  })
})

describe('mensagens leves de reprodução do AudioWorklet', () => {
  it('informa conexão, reset e PCM recebido antes do próximo relatório completo', () => {
    const fake = createProcessor()
    expect(fake.latestPlayback()).toEqual({
      type: 'playback',
      epoch: 1,
      frame: 0,
      availableFrame: 0,
      contextTime: 0,
      advancing: false,
    })
    const before = fake.processor.port.sent.length
    fake.receive(3072)
    expect(fake.processor.port.sent).toHaveLength(before + 1)
    expect(fake.latestPlayback()).toMatchObject({ frame: 0, availableFrame: 3072, advancing: true })
    expect(messages<AudioStatsMessage>(fake.processor.port, 'stats')).toHaveLength(2)
  })

  it('atualiza a cada 512 frames com horário de fim do quantum e sem depender da amplitude', () => {
    const fake = createProcessor()
    fake.receive(3072)
    const before = messages<AudioPlaybackMessage>(fake.processor.port, 'playback').length
    for (let index = 0; index < 3; index += 1) fake.render()
    expect(messages<AudioPlaybackMessage>(fake.processor.port, 'playback')).toHaveLength(before)
    const output = fake.render()
    expect(output.left).toEqual(new Float32Array(128))
    expect(output.right).toEqual(new Float32Array(128))
    expect(fake.latestPlayback()).toMatchObject({
      frame: 512,
      availableFrame: 3072,
      advancing: true,
    })
    expect(fake.latestPlayback().contextTime).toBeCloseTo(512 / 48_000)
    expect(messages<AudioStatsMessage>(fake.processor.port, 'stats')).toHaveLength(2)
  })

  it('congela assim que acaba o PCM e retoma somente quando a reserva permite', () => {
    const fake = createProcessor()
    fake.receive(3072)
    for (let index = 0; index < 25; index += 1) fake.render()
    expect(fake.latestPlayback()).toMatchObject({
      frame: 3072,
      availableFrame: 3072,
      advancing: false,
    })
    const pending = messages<AudioNeedMessage>(fake.worker, 'need').at(-1)!.frames
    fake.receive(pending)
    expect(fake.latestPlayback()).toMatchObject({ frame: 3072, advancing: false })
    const remaining = messages<AudioNeedMessage>(fake.worker, 'need').at(-1)!.frames
    fake.receive(remaining)
    expect(fake.latestPlayback()).toMatchObject({ frame: 3072, advancing: true })
    for (let index = 0; index < 4; index += 1) fake.render()
    expect(fake.latestPlayback().frame).toBe(3584)
  })

  it('descarta mensagens de PCM antigas e cursor anterior ao reset', () => {
    const fake = createProcessor()
    fake.receive(3072)
    fake.render()
    fake.processor.port.onmessage?.({ data: { type: 'reset', epoch: 2, active: false } })
    expect(fake.latestPlayback()).toMatchObject({
      epoch: 2,
      frame: 0,
      availableFrame: 0,
      advancing: false,
    })
    const before = fake.processor.port.sent.length
    fake.receive(3072)
    expect(fake.processor.port.sent).toHaveLength(before)
    fake.processor.port.onmessage?.({ data: { type: 'reset', epoch: 3, active: true } })
    fake.receive(3072, 3)
    expect(fake.latestPlayback()).toMatchObject({
      epoch: 3,
      frame: 0,
      availableFrame: 3072,
      advancing: true,
    })
  })

  it('conserva o relatório completo a cada quarto de segundo e encerra as mensagens no dispose', () => {
    const fake = createProcessor()
    for (let index = 0; index < 94; index += 1) fake.render()
    expect(messages<AudioStatsMessage>(fake.processor.port, 'stats')).toHaveLength(3)
    expect(messages<AudioPlaybackMessage>(fake.processor.port, 'playback').length).toBeGreaterThan(
      20,
    )
    fake.processor.port.onmessage?.({ data: { type: 'dispose' } })
    const before = fake.processor.port.sent.length
    expect(fake.worker.closed).toBe(true)
    expect(fake.processor.port.closed).toBe(true)
    expect(fake.render().running).toBe(false)
    expect(fake.processor.port.sent).toHaveLength(before)
  })
})
