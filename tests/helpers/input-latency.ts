import type { Page } from '@playwright/test'
import type { AudioStreamDiagnostics } from '../../src/platform/audio/protocol'
import type { EmulatorMessage } from '../../src/runtime/worker-protocol'

interface InputLatencyTrial {
  readonly sequence: number
  readonly phase: 'baseline' | 'measured'
  readonly pressedAt: number
  readonly pointerType: string
  readonly trusted: boolean
  readonly baselineCoreHash: number
  readonly baselineCanvasHash: number
  forwardedAt: number | null
  capturedAt: number | null
  drawnAt: number | null
  releasedAt: number | null
  coreHash: number | null
  canvasHash: number | null
  captureSource: 'video-frame' | 'snapshot' | null
  captureFrameId: number | null
  settledCanvasHash: number | null
  settledDraws: number
}

interface ProducerDiagnostics {
  readonly queuedFrames: number
  readonly producedFrames: number
  readonly sentFrames: number
  readonly droppedFrames: number
  readonly pendingFrames: number
}

interface AudioSample {
  readonly at: number
  readonly diagnostics: AudioStreamDiagnostics
}

interface ProducerSample {
  readonly at: number
  readonly epoch: number
  readonly diagnostics: ProducerDiagnostics
}

interface InputLatencyProbe {
  armed: boolean
  phase: 'baseline' | 'measured'
  readonly trials: InputLatencyTrial[]
  latestCoreHash: number | null
  latestCanvasHash: number | null
  readonly audio: AudioSample[]
  readonly producer: ProducerSample[]
  audioSamples: number
  producerSamples: number
}

type ObservedWindow = Window & typeof globalThis & { __inputLatencyProbe: InputLatencyProbe }

/** Observa entrada nativa e pixels reais; não altera ROM, PCM, comandos ou relógios. */
export async function observeInputLatency(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: InputLatencyProbe = {
      armed: false,
      phase: 'measured',
      trials: [],
      latestCoreHash: null,
      latestCanvasHash: null,
      audio: [],
      producer: [],
      audioSamples: 0,
      producerSamples: 0,
    }
    ;(window as ObservedWindow).__inputLatencyProbe = probe
    const pendingTrial = (): InputLatencyTrial | null => probe.trials.at(-1) ?? null

    // O jardim é estático. Somente A troca o personagem nesta região de 8 por 16 pixels.
    function coreHash(pixels: Uint8Array): number {
      let hash = 2_166_136_261
      for (let y = 72; y < 88; y += 1)
        for (let x = 76; x < 84; x += 1) hash = Math.imul(hash ^ pixels[y * 160 + x]!, 16_777_619)
      return hash >>> 0
    }

    function canvasHash(image: ImageData): number {
      let hash = 2_166_136_261
      for (let y = 72; y < 88; y += 1) {
        for (let x = 76; x < 84; x += 1) {
          const offset = (y * image.width + x) * 4
          for (let channel = 0; channel < 4; channel += 1)
            hash = Math.imul(hash ^ image.data[offset + channel]!, 16_777_619)
        }
      }
      return hash >>> 0
    }

    function capture(pixels: Uint8Array, frameId: number, source: 'video-frame' | 'snapshot') {
      if (pixels.length !== 160 * 144) return
      const hash = coreHash(pixels)
      probe.latestCoreHash = hash
      const trial = pendingTrial()
      if (
        trial &&
        trial.forwardedAt !== null &&
        trial.capturedAt === null &&
        hash !== trial.baselineCoreHash
      ) {
        trial.capturedAt = performance.now()
        trial.coreHash = hash
        trial.captureSource = source
        trial.captureFrameId = frameId
      }
    }

    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = (event.target as Element | null)?.closest('button')
        if (
          !probe.armed ||
          target?.getAttribute('aria-label') !== 'Botão A' ||
          probe.latestCoreHash === null ||
          probe.latestCanvasHash === null
        )
          return
        probe.armed = false
        probe.trials.push({
          sequence: probe.trials.length + 1,
          phase: probe.phase,
          pressedAt: performance.now(),
          pointerType: event.pointerType,
          trusted: event.isTrusted,
          baselineCoreHash: probe.latestCoreHash,
          baselineCanvasHash: probe.latestCanvasHash,
          forwardedAt: null,
          capturedAt: null,
          drawnAt: null,
          releasedAt: null,
          coreHash: null,
          canvasHash: null,
          captureSource: null,
          captureFrameId: null,
          settledCanvasHash: null,
          settledDraws: 0,
        })
      },
      true,
    )

    const nativeDraw = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (
      image: ImageData,
      dx: number,
      dy: number,
      ...dirty: number[]
    ) {
      if (this.canvas.getAttribute('aria-label') !== 'Tela do emulador')
        return Reflect.apply(nativeDraw, this, [image, dx, dy, ...dirty])
      const hash = canvasHash(image)
      const result = Reflect.apply(nativeDraw, this, [image, dx, dy, ...dirty])
      const now = performance.now()
      probe.latestCanvasHash = hash
      const trial = pendingTrial()
      if (
        trial &&
        trial.capturedAt !== null &&
        trial.drawnAt === null &&
        hash !== trial.baselineCanvasHash
      ) {
        trial.drawnAt = now
        trial.canvasHash = hash
      }
      if (trial && trial.releasedAt !== null && trial.drawnAt !== null) {
        // O primeiro pixel pode vir de uma imagem parcialmente atualizada pelo PPU.
        // Preserva sua latência e aguarda a região final, estável entre desenhos.
        if (hash === trial.baselineCanvasHash) {
          trial.settledCanvasHash = null
          trial.settledDraws = 0
        } else {
          trial.settledDraws = hash === trial.settledCanvasHash ? trial.settledDraws + 1 : 1
          trial.settledCanvasHash = hash
        }
      }
      return result
    }

    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }: MessageEvent<EmulatorMessage>) => {
          if (data.type === 'video-frame')
            capture(data.frame.framebuffer, data.frame.frameId, 'video-frame')
          if (!('snapshot' in data) || !data.snapshot) return
          const snapshot = data.snapshot as typeof data.snapshot & {
            audioProducer?: ProducerDiagnostics
          }
          if (!snapshot.audioDriven) capture(snapshot.framebuffer, snapshot.frameId, 'snapshot')
          if (snapshot.audioProducer) {
            probe.producer[probe.producerSamples % 256] = {
              at: performance.now(),
              epoch: snapshot.audioEpoch,
              diagnostics: { ...snapshot.audioProducer },
            }
            probe.producerSamples += 1
          }
        })
      }
    }
    const nativePost = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ): void {
      const envelope = message as {
        command?: { type?: string; button?: string; pressed?: boolean }
      }
      const command = envelope?.command
      const trial = pendingTrial()
      if (trial && command?.type === 'input' && command.button === 'a') {
        if (command.pressed && trial.forwardedAt === null) trial.forwardedAt = performance.now()
        if (!command.pressed && trial.forwardedAt !== null) trial.releasedAt = performance.now()
      }
      Reflect.apply(nativePost, this, [message, options])
    }

    const NativeNode = window.AudioWorkletNode
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options)
        this.port.addEventListener('message', ({ data }) => {
          if (data?.type !== 'stats') return
          probe.audio[probe.audioSamples % 256] = {
            at: performance.now(),
            diagnostics: { ...data.diagnostics },
          }
          probe.audioSamples += 1
        })
        this.port.start()
      }
    }
  })
}

export async function armInputLatency(
  page: Page,
  phase: 'baseline' | 'measured' = 'measured',
): Promise<void> {
  await page.evaluate((phase) => {
    const probe = (window as ObservedWindow).__inputLatencyProbe
    if (probe.trials.filter((trial) => trial.phase === phase).length >= 12)
      throw new Error('As doze pressões desta etapa já foram observadas.')
    const previous = probe.trials.at(-1)
    if (
      probe.armed ||
      probe.latestCoreHash === null ||
      probe.latestCanvasHash === null ||
      (previous && previous.settledDraws < 3)
    )
      throw new Error('A região do personagem ainda não está estável para a próxima pressão.')
    probe.phase = phase
    probe.armed = true
  }, phase)
}

export async function readInputLatency(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ObservedWindow).__inputLatencyProbe
    return {
      observedAt: performance.now(),
      latestCoreHash: probe.latestCoreHash,
      latestCanvasHash: probe.latestCanvasHash,
      trials: probe.trials.map((trial) => ({
        ...trial,
        forwardingMs: trial.forwardedAt === null ? null : trial.forwardedAt - trial.pressedAt,
        coreResponseMs: trial.capturedAt === null ? null : trial.capturedAt - trial.pressedAt,
        presentationMs:
          trial.drawnAt === null || trial.capturedAt === null
            ? null
            : trial.drawnAt - trial.capturedAt,
        totalMs: trial.drawnAt === null ? null : trial.drawnAt - trial.pressedAt,
      })),
      audioHistory: Array.from(
        { length: Math.min(probe.audioSamples, 256) },
        (_, index) => probe.audio[(Math.max(0, probe.audioSamples - 256) + index) % 256]!,
      ),
      producerHistory: Array.from(
        { length: Math.min(probe.producerSamples, 256) },
        (_, index) => probe.producer[(Math.max(0, probe.producerSamples - 256) + index) % 256]!,
      ),
    }
  })
}

export function latencyPercentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new Error('A medição não contém pressões concluídas.')
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!
}
