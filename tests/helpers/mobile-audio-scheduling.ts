import { vi } from 'vitest'
import { AudioOutput } from '../../src/platform/audio/audio-output'
import type {
  AudioControlMessage,
  AudioNeedMessage,
  AudioPlaybackMessage,
  AudioStatsMessage,
  AudioStreamDiagnostics,
} from '../../src/platform/audio/protocol'
import { VideoBufferPool, VIDEO_FRAME_BYTES } from '../../src/runtime/video-buffer-pool'
import { VideoPresentation } from '../../src/runtime/video-presentation'
import type { EmulatorVideoFrame } from '../../src/runtime/worker-protocol'

const SAMPLE_RATE = 48_000
const QUANTUM = 128
const FRAME_PCM = (SAMPLE_RATE * 70_224) / 4_194_304
const CLOCK_ORIGIN_SECONDS = 10

class SchedulingPort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  send: (message: unknown) => void = () => {}

  postMessage(message: unknown): void {
    this.send(message)
  }

  start(): void {}
  close(): void {}
}

interface NativeProcessor {
  readonly port: SchedulingPort
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

let Processor: (new () => NativeProcessor) | null = null

export async function loadSchedulingProcessor(): Promise<void> {
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      readonly port = new SchedulingPort()
    },
  )
  vi.stubGlobal('sampleRate', SAMPLE_RATE)
  vi.stubGlobal('currentTime', CLOCK_ORIGIN_SECONDS)
  vi.stubGlobal('registerProcessor', (_name: string, registered: new () => NativeProcessor) => {
    Processor = registered
  })
  await import('../../src/platform/audio/pcm-worklet')
}

interface RenderedQuantum {
  readonly contextStartFrame: number
  readonly pcmStartFrame: number
  readonly frames: number
}

interface PendingResponse {
  readonly request: AudioNeedMessage
  readonly deliveryFrame: number
}

export interface SchedulingOptions {
  readonly seconds?: number
  readonly outputDelayMs?: number
  readonly batchMs?: number
  readonly stallAtMs?: number
  readonly stallForMs?: number
  readonly timestampAvailableAtMs?: number
}

export interface SchedulingSample {
  readonly atMs: number
  readonly cursor: number | null
  readonly audibleFrame: number
  readonly presentedFrame: number | null
  readonly renderedPcmFrames: number
}

export interface SchedulingResult {
  readonly samples: SchedulingSample[]
  readonly audioHistory: { readonly atMs: number; readonly diagnostics: AudioStreamDiagnostics }[]
  readonly producedFrames: number
  readonly renderedFrames: number
  readonly missingFrames: number
  readonly droppedVideoFrames: number
  readonly largestVideoLeaseCount: number
  readonly largestRequest: number
  readonly requests: number
}

/**
 * Executa Worklet, AudioOutput e filas reais, com entrega de mensagens em lotes.
 * A forma de onda é constante: cada amostra não nula comprova PCM efetivamente consumido.
 * O relógio de saída é sintético e atrasado; não representa uma medição do Motorola.
 */
export async function simulateMobileAudioScheduling(
  options: SchedulingOptions = {},
): Promise<SchedulingResult> {
  if (!Processor) throw new Error('O Worklet precisa ser registrado antes da simulação.')
  const finishFrame = Math.round((options.seconds ?? 8) * SAMPLE_RATE)
  const batchFrames = Math.round(((options.batchMs ?? 128) * SAMPLE_RATE) / 1000)
  const outputDelayFrames = Math.round(((options.outputDelayMs ?? 312) * SAMPLE_RATE) / 1000)
  const stallAtFrame = Math.round(
    ((options.stallAtMs ?? Number.POSITIVE_INFINITY) * SAMPLE_RATE) / 1000,
  )
  const stallForFrames = Math.round(((options.stallForMs ?? 0) * SAMPLE_RATE) / 1000)
  vi.stubGlobal('currentTime', CLOCK_ORIGIN_SECONDS)
  const processor = new Processor()
  const workerPort = new SchedulingPort()
  const mainMessages: (AudioPlaybackMessage | AudioStatsMessage)[] = []
  const rendered: RenderedQuantum[] = []
  const samples: SchedulingSample[] = []
  const audioHistory: SchedulingResult['audioHistory'][number][] = []
  const pending: { value: PendingResponse | null } = { value: null }
  const pool = new VideoBufferPool()
  const video = new VideoPresentation((frame) => recycle(frame))
  const pixels = new Uint8Array(VIDEO_FRAME_BYTES)
  const left = new Float32Array(QUANTUM)
  const right = new Float32Array(QUANTUM)
  let nowFrame = 0
  let nextNativeFrame = 0
  let nextUiFrame = 0
  let nextBatchFrame = batchFrames
  let nextVideoFrame = 1
  let producedFrames = 0
  let renderedFrames = 0
  let missingFrames = 0
  let droppedVideoFrames = 0
  let largestVideoLeaseCount = 0
  let largestRequest = 0
  let requests = 0
  let stallInjected = false
  let playbackStarted = false

  const gain = { gain: { setValueAtTime() {} }, connect() {}, disconnect() {} }
  const node = {
    port: {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage(message: AudioControlMessage) {
        processor.port.onmessage?.({ data: message })
      },
      close() {},
    },
    connect() {},
    disconnect() {},
    onprocessorerror: null,
  }
  const context = {
    sampleRate: SAMPLE_RATE,
    currentTime: CLOCK_ORIGIN_SECONDS,
    state: 'suspended' as AudioContextState,
    onstatechange: null,
    baseLatency: 0.12825,
    outputLatency: outputDelayFrames / SAMPLE_RATE,
    destination: {},
    audioWorklet: { async addModule() {} },
    createGain: () => gain,
    async resume() {
      context.state = 'running'
    },
    async suspend() {
      context.state = 'suspended'
    },
    async close() {
      context.state = 'closed'
    },
    getOutputTimestamp: () =>
      nowFrame / SAMPLE_RATE < (options.timestampAvailableAtMs ?? 0) / 1000
        ? { contextTime: 0, performanceTime: 0 }
        : {
            contextTime: CLOCK_ORIGIN_SECONDS + (nowFrame - outputDelayFrames) / SAMPLE_RATE,
            performanceTime: (CLOCK_ORIGIN_SECONDS + nowFrame / SAMPLE_RATE) * 1000,
          },
  }
  const performanceClock = vi
    .spyOn(performance, 'now')
    .mockImplementation(() => (CLOCK_ORIGIN_SECONDS + nowFrame / SAMPLE_RATE) * 1000)
  const output = new AudioOutput({
    contextFactory: () => context as unknown as AudioContext,
    nodeFactory: () => node as unknown as AudioWorkletNode,
  })

  function recycle(frame: EmulatorVideoFrame): void {
    if (!pool.recycle(frame.slot, frame.token, frame.framebuffer.buffer as ArrayBuffer))
      throw new Error('Um buffer de vídeo foi devolvido incorretamente.')
  }

  function flushMainMessages(): void {
    for (const message of mainMessages) {
      node.port.onmessage?.({ data: message } as MessageEvent)
      if (message.type === 'stats')
        audioHistory.push({
          atMs: (nowFrame / SAMPLE_RATE) * 1000,
          diagnostics: message.diagnostics,
        })
    }
    mainMessages.length = 0
  }

  function audiblePosition(): number {
    const heardContextFrame = nowFrame - outputDelayFrames
    if (heardContextFrame <= 0) return 0
    const index = Math.min(rendered.length - 1, Math.floor(heardContextFrame / QUANTUM))
    const quantum = rendered[index]
    if (!quantum) return 0
    return (
      quantum.pcmStartFrame +
      Math.min(quantum.frames, Math.max(0, heardContextFrame - quantum.contextStartFrame))
    )
  }

  processor.port.send = (message) => {
    const typed = message as AudioPlaybackMessage | AudioStatsMessage
    if (typed.type === 'playback' || typed.type === 'stats') mainMessages.push(typed)
  }
  workerPort.send = (message) => {
    const request = message as AudioNeedMessage
    if (request.type !== 'need') return
    if (pending.value) throw new Error('Houve mais de uma demanda PCM em voo.')
    let deliveryFrame = (Math.floor(nowFrame / batchFrames) + 1) * batchFrames
    if (!stallInjected && nowFrame >= stallAtFrame) {
      stallInjected = true
      deliveryFrame += stallForFrames
    }
    pending.value = { request, deliveryFrame }
    largestRequest = Math.max(largestRequest, request.frames)
    requests += 1
  }

  video.reset(1)
  try {
    await output.prepare()
    output.connect(workerPort as unknown as MessagePort, 1)
    await output.resume(1)
    flushMainMessages()
    while (nowFrame < finishFrame) {
      nowFrame = Math.min(nextNativeFrame, nextUiFrame, nextBatchFrame)
      context.currentTime = CLOCK_ORIGIN_SECONDS + nowFrame / SAMPLE_RATE
      if (nowFrame === nextBatchFrame) {
        if (pending.value && pending.value.deliveryFrame <= nowFrame) {
          const { request } = pending.value
          pending.value = null
          producedFrames += request.frames
          while (nextVideoFrame * FRAME_PCM <= producedFrames) {
            const lease = pool.lease(pixels)
            if (lease)
              video.push({
                ...lease,
                epoch: 1,
                frameId: nextVideoFrame,
                pcmFrame: Math.round(nextVideoFrame * FRAME_PCM),
              })
            else droppedVideoFrames += 1
            nextVideoFrame += 1
          }
          largestVideoLeaseCount = Math.max(largestVideoLeaseCount, pool.leasedBuffers)
          workerPort.onmessage?.({
            data: {
              type: 'samples',
              samples: new Float32Array(request.frames * 2).fill(0.25),
              epoch: 1,
            },
          })
        }
        flushMainMessages()
        nextBatchFrame += batchFrames
      }
      if (nowFrame === nextNativeFrame) {
        vi.stubGlobal('currentTime', context.currentTime)
        const pcmStartFrame = renderedFrames
        processor.process([], [[left, right]])
        let pcmFrames = 0
        for (let index = 0; index < QUANTUM; index += 1) {
          if (left[index] === 0.25 && right[index] === 0.25) pcmFrames += 1
          else if (left[index] !== 0 || right[index] !== 0)
            throw new Error('O Worklet alterou a forma de onda usada como marcador de consumo.')
        }
        if (pcmFrames > 0) playbackStarted = true
        if (playbackStarted) missingFrames += QUANTUM - pcmFrames
        renderedFrames += pcmFrames
        rendered.push({ contextStartFrame: nowFrame, pcmStartFrame, frames: pcmFrames })
        nextNativeFrame += QUANTUM
      }
      if (nowFrame === nextUiFrame) {
        const cursor = output.getPlaybackFrame(1)
        const frame = cursor === null ? null : video.takeDue(cursor)
        samples.push({
          atMs: (nowFrame / SAMPLE_RATE) * 1000,
          cursor,
          audibleFrame: audiblePosition(),
          presentedFrame: frame?.frameId ?? null,
          renderedPcmFrames: renderedFrames,
        })
        if (frame) recycle(frame)
        nextUiFrame += SAMPLE_RATE / 60
      }
    }
    flushMainMessages()
    return {
      samples,
      audioHistory,
      producedFrames,
      renderedFrames,
      missingFrames,
      droppedVideoFrames,
      largestVideoLeaseCount,
      largestRequest,
      requests,
    }
  } finally {
    video.clear()
    await output.dispose()
    performanceClock.mockRestore()
  }
}
