import workletUrl from './pcm-worklet.ts?worker&url'
import { AUDIO_MAX_FRAMES, AUDIO_PROCESSOR_NAME, isAudioEpoch } from './protocol'
import { PlaybackTimeline } from './playback-timeline'
import type {
  AudioControlMessage,
  AudioPlaybackMessage,
  AudioStatsMessage,
  AudioStreamDiagnostics,
} from './protocol'

const OUTPUT_TIMESTAMP_STARTUP_TIMEOUT_MS = 1000

export interface AudioDiagnostics extends AudioStreamDiagnostics {
  readonly sampleRate: number
  readonly baseLatencySeconds: number | null
  readonly outputLatencySeconds: number | null
  readonly contextState: string
  readonly connected: boolean
  readonly volume: number
  readonly muted: boolean
  readonly error: string | null
  readonly playback: {
    readonly clockMode: 'output' | 'graph' | 'awaiting-output'
    readonly pcmFrame: number | null
    readonly graphPcmFrame: number | null
    readonly graphContextTimeSeconds: number | null
    readonly outputContextTimeSeconds: number | null
    readonly outputPerformanceTimeMilliseconds: number | null
  }
}

export interface AudioOutputOptions {
  readonly onError?: (error: Error) => void
  readonly contextFactory?: () => AudioContext
  readonly nodeFactory?: (
    context: AudioContext,
    name: string,
    options: AudioWorkletNodeOptions,
  ) => AudioWorkletNode
}

function emptyStats(epoch = 0, active = false): AudioStreamDiagnostics {
  return {
    epoch,
    active,
    primed: false,
    pendingFrames: 0,
    targetFrames: 0,
    roundTripFrames: 0,
    peakRoundTripFrames: 0,
    renderQuantumFrames: 128,
    queuedFrames: 0,
    renderedFrames: 0,
    underrunFrames: 0,
    underruns: 0,
    droppedFrames: 0,
    peakLevel: 0,
    energy: 0,
  }
}

/** Saída local. prepare/resume devem partir de uma ação explícita do jogador. */
export class AudioOutput {
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private gain: GainNode | null = null
  private preparing: Promise<number> | null = null
  private disposed = false
  private connected = false
  private active = false
  private epoch = 0
  private volume = 0.7
  private muted = false
  private failure: string | null = null
  private stats = emptyStats()
  private contextTransitions = 0
  private playbackEpoch: number | null = null
  private playbackFrame = 0
  private availablePlaybackFrame = 0
  private playbackContextTime = 0
  private outputContextTime: number | null = null
  private outputPerformanceTime: number | null = null
  private awaitingOutputTimestamp = false
  private outputTimestampWaitStartedAt: number | null = null
  private graphClockLocked = false
  private readonly playbackTimeline = new PlaybackTimeline()
  private visiblePlaybackFrame = 0

  constructor(private readonly options: AudioOutputOptions = {}) {}

  /** Cria e resume o contexto antes do primeiro await para preservar o gesto. */
  prepare(): Promise<number> {
    if (this.disposed) return Promise.reject(new Error('A saída de áudio foi encerrada.'))
    if (this.preparing) return this.preparing
    if (this.context && this.node) return Promise.resolve(this.context.sampleRate)
    const promise = this.prepareContext()
    this.preparing = promise
    void promise
      .finally(() => {
        if (this.preparing === promise) this.preparing = null
      })
      .catch(() => {})
    return promise
  }

  connect(port: MessagePort, epoch: number): void {
    this.requireReady()
    this.validateEpoch(epoch)
    this.connected = true
    this.active = false
    this.epoch = epoch
    this.stats = emptyStats(epoch)
    this.clearPlayback()
    this.updateGain()
    this.post({ type: 'connect', port, epoch }, [port])
  }

  async resume(epoch: number): Promise<void> {
    const context = this.requireReady()
    this.validateEpoch(epoch)
    if (!this.connected) throw new Error('Conecte o emulador antes de ativar o áudio.')
    if (this.active && this.epoch === epoch) return
    this.epoch = epoch
    this.active = true
    this.failure = null
    this.stats = emptyStats(epoch, true)
    this.clearPlayback()
    this.post({ type: 'reset', epoch, active: true })
    this.updateGain()
    this.contextTransitions += 1
    try {
      await context.resume()
    } catch (cause) {
      if (!this.disposed && epoch === this.epoch) {
        this.active = false
        this.clearPlayback()
        this.updateGain()
        throw new Error('Não foi possível ativar o áudio. Tente novamente pelo botão de som.', {
          cause,
        })
      }
    } finally {
      this.contextTransitions -= 1
    }
  }

  async pause(epoch: number): Promise<void> {
    this.validateEpoch(epoch)
    this.epoch = epoch
    this.active = false
    this.stats = emptyStats(epoch)
    this.clearPlayback()
    this.updateGain()
    this.post({ type: 'reset', epoch, active: false })
    const context = this.context
    if (!context || context.state === 'closed') return
    this.contextTransitions += 1
    try {
      await context.suspend()
    } catch (cause) {
      if (!this.disposed) throw new Error('Não foi possível suspender a saída de áudio.', { cause })
    } finally {
      this.contextTransitions -= 1
    }
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1)
      throw new RangeError('O volume deve ficar entre zero e um.')
    this.volume = volume
    this.updateGain()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.updateGain()
  }

  /** Posição PCM estimada na saída, limitada às amostras já recebidas. */
  getPlaybackFrame(epoch: number): number | null {
    const context = this.context
    if (
      this.disposed ||
      !this.active ||
      !this.connected ||
      !this.node ||
      !context ||
      context.state !== 'running' ||
      epoch !== this.epoch ||
      epoch !== this.playbackEpoch ||
      !Number.isFinite(context.currentTime) ||
      context.currentTime < 0
    )
      return null
    if (this.awaitingOutputTimestamp && !this.expireOutputTimestampWait()) return null
    const now = this.outputPerformanceTime === null ? null : performance.now()
    const contextTime =
      now !== null &&
      now >= 0 &&
      Number.isFinite(now) &&
      this.outputPerformanceTime !== null &&
      this.outputContextTime !== null
        ? this.outputContextTime + (now - this.outputPerformanceTime) / 1000
        : context.currentTime
    const frame = this.playbackTimeline.frameAt(contextTime)
    this.visiblePlaybackFrame = Math.max(
      this.visiblePlaybackFrame,
      Math.min(this.availablePlaybackFrame, frame),
    )
    if (this.outputPerformanceTime === null && this.visiblePlaybackFrame > 0)
      this.graphClockLocked = true
    return this.visiblePlaybackFrame
  }

  getDiagnostics(): AudioDiagnostics {
    return {
      ...this.stats,
      active: this.active,
      epoch: this.epoch,
      sampleRate: this.context?.sampleRate ?? 0,
      baseLatencySeconds:
        typeof this.context?.baseLatency === 'number' && Number.isFinite(this.context.baseLatency)
          ? this.context.baseLatency
          : null,
      outputLatencySeconds:
        typeof this.context?.outputLatency === 'number' &&
        Number.isFinite(this.context.outputLatency)
          ? this.context.outputLatency
          : null,
      contextState: this.context?.state ?? (this.disposed ? 'closed' : 'unprepared'),
      connected: this.connected,
      volume: this.volume,
      muted: this.muted,
      error: this.failure,
      playback: {
        clockMode: this.awaitingOutputTimestamp
          ? 'awaiting-output'
          : this.outputPerformanceTime === null
            ? 'graph'
            : 'output',
        pcmFrame:
          this.playbackEpoch === null || this.awaitingOutputTimestamp
            ? null
            : this.visiblePlaybackFrame,
        graphPcmFrame: this.playbackEpoch === null ? null : this.playbackFrame,
        graphContextTimeSeconds: this.playbackEpoch === null ? null : this.playbackContextTime,
        outputContextTimeSeconds: this.outputContextTime,
        outputPerformanceTimeMilliseconds: this.outputPerformanceTime,
      },
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.active = false
    this.connected = false
    this.stats = emptyStats(this.epoch)
    this.clearPlayback()
    this.updateGain()
    this.post({ type: 'dispose' })
    this.node?.disconnect()
    if (this.node) {
      this.node.onprocessorerror = null
      this.node.port.onmessage = null
      this.node.port.close()
    }
    this.gain?.disconnect()
    const context = this.context
    if (context) context.onstatechange = null
    this.node = null
    this.gain = null
    this.context = null
    if (context && context.state !== 'closed') await context.close()
  }

  private async prepareContext(): Promise<number> {
    let context: AudioContext | null = null
    try {
      if (!this.options.contextFactory && typeof AudioContext === 'undefined')
        throw new Error('Este navegador não oferece saída de áudio compatível.')
      context = this.options.contextFactory?.() ?? new AudioContext({ latencyHint: 'interactive' })
      this.context = context
      if (!context.audioWorklet)
        throw new Error('O som precisa de HTTPS ou localhost e de um navegador com AudioWorklet.')
      // Esta chamada acontece no mesmo turno do clique, antes de carregar o módulo.
      const resumed = context.resume()
      await Promise.all([resumed, context.audioWorklet.addModule(workletUrl)])
      if (this.disposed) throw new Error('A saída de áudio foi encerrada durante a preparação.')
      const nodeOptions: AudioWorkletNodeOptions = {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      }
      const node =
        this.options.nodeFactory?.(context, AUDIO_PROCESSOR_NAME, nodeOptions) ??
        new AudioWorkletNode(context, AUDIO_PROCESSOR_NAME, nodeOptions)
      this.node = node
      this.gain = context.createGain()
      node.port.onmessage = (event: MessageEvent<AudioStatsMessage | AudioPlaybackMessage>) => {
        const message = event.data
        if (message?.type === 'stats' && message.diagnostics.epoch === this.epoch)
          this.stats = message.diagnostics
        else if (message?.type === 'playback') this.receivePlayback(message)
      }
      node.onprocessorerror = () => {
        const error = new Error(
          'A saída de áudio foi interrompida. Desative e ative o som para tentar novamente.',
        )
        this.failure = error.message
        this.active = false
        this.clearPlayback()
        this.updateGain()
        this.options.onError?.(error)
      }
      node.connect(this.gain)
      this.gain.connect(context.destination)
      this.updateGain()
      const preparedContext = context
      context.onstatechange = () => {
        if (
          this.disposed ||
          !this.active ||
          this.contextTransitions !== 0 ||
          preparedContext.state === 'running'
        )
          return
        const error = new Error(
          'O navegador interrompeu o áudio. Ative o som novamente para continuar.',
        )
        this.failure = error.message
        this.active = false
        this.stats = emptyStats(this.epoch)
        this.clearPlayback()
        this.post({ type: 'reset', epoch: this.epoch, active: false })
        this.updateGain()
        this.options.onError?.(error)
      }
      this.failure = null
      return context.sampleRate
    } catch (cause) {
      this.node?.disconnect()
      this.node?.port.close()
      this.gain?.disconnect()
      this.node = null
      this.gain = null
      this.clearPlayback()
      if (this.context === context) this.context = null
      if (context) context.onstatechange = null
      if (context && context.state !== 'closed') await context.close().catch(() => {})
      const error =
        cause instanceof Error && !(cause instanceof DOMException)
          ? cause
          : new Error('Não foi possível preparar o áudio. Tente novamente pelo botão de som.', {
              cause,
            })
      this.failure = error.message
      throw error
    }
  }

  private requireReady(): AudioContext {
    if (this.disposed || !this.context || !this.node)
      throw new Error('Prepare a saída de áudio antes de usá-la.')
    return this.context
  }

  private receivePlayback(message: AudioPlaybackMessage): void {
    if (
      !this.active ||
      message.epoch !== this.epoch ||
      !Number.isSafeInteger(message.frame) ||
      message.frame < 0 ||
      !Number.isSafeInteger(message.availableFrame) ||
      message.availableFrame < message.frame ||
      message.availableFrame - message.frame > AUDIO_MAX_FRAMES ||
      !Number.isFinite(message.contextTime) ||
      message.contextTime < 0 ||
      typeof message.advancing !== 'boolean' ||
      (this.playbackEpoch === message.epoch &&
        (message.frame < this.playbackFrame ||
          message.availableFrame < this.availablePlaybackFrame ||
          message.contextTime < this.playbackContextTime))
    )
      return
    this.playbackEpoch = message.epoch
    this.playbackFrame = message.frame
    this.availablePlaybackFrame = message.availableFrame
    this.playbackContextTime = message.contextTime
    this.playbackTimeline.record(message.contextTime, message.frame, message.advancing)
    this.correlatePlaybackClock()
  }

  private correlatePlaybackClock(): void {
    // Depois de apresentar pelo grafo, trocar para uma saída atrasada congelaria a tela.
    // A próxima geração pode tentar a correlação física desde o começo.
    if (this.awaitingOutputTimestamp) this.expireOutputTimestampWait()
    if (this.graphClockLocked) return
    const context = this.context
    if (!context || typeof context.getOutputTimestamp !== 'function') return
    try {
      const timestamp = context.getOutputTimestamp()
      // Antes da primeira saída, a API pode existir e ainda devolver ambos zerados.
      // Usar o grafo nesse intervalo anteciparia imagens e exigiria congelar depois.
      if (timestamp.contextTime === 0 && timestamp.performanceTime === 0) {
        if (this.outputPerformanceTime === null) {
          this.awaitingOutputTimestamp = true
          this.outputTimestampWaitStartedAt ??= performance.now()
          this.expireOutputTimestampWait()
        }
        return
      }
      if (
        typeof timestamp.contextTime !== 'number' ||
        !Number.isFinite(timestamp.contextTime) ||
        timestamp.contextTime < 0 ||
        typeof timestamp.performanceTime !== 'number' ||
        !Number.isFinite(timestamp.performanceTime) ||
        timestamp.performanceTime <= 0
      )
        return
      this.outputContextTime = timestamp.contextTime
      this.outputPerformanceTime = timestamp.performanceTime
      this.awaitingOutputTimestamp = false
      this.outputTimestampWaitStartedAt = null
    } catch {
      // Uma falha transitória conserva a última correlação de saída válida.
    }
  }

  private expireOutputTimestampWait(): boolean {
    const now = performance.now()
    const started = this.outputTimestampWaitStartedAt
    if (
      started !== null &&
      Number.isFinite(started) &&
      started >= 0 &&
      Number.isFinite(now) &&
      now >= 0 &&
      now - started < OUTPUT_TIMESTAMP_STARTUP_TIMEOUT_MS
    )
      return false
    // Uma implementação que nunca informa a saída não pode bloquear o vídeo.
    this.awaitingOutputTimestamp = false
    this.outputTimestampWaitStartedAt = null
    this.graphClockLocked = true
    return true
  }

  private clearPlayback(): void {
    this.playbackEpoch = null
    this.playbackFrame = 0
    this.availablePlaybackFrame = 0
    this.playbackContextTime = 0
    this.outputContextTime = null
    this.outputPerformanceTime = null
    this.awaitingOutputTimestamp = false
    this.outputTimestampWaitStartedAt = null
    this.graphClockLocked = false
    this.playbackTimeline.reset(this.context?.sampleRate ?? 48_000)
    this.visiblePlaybackFrame = 0
  }

  private validateEpoch(epoch: number): void {
    if (!isAudioEpoch(epoch))
      throw new RangeError('A geração do áudio deve ser um inteiro não negativo.')
  }

  private updateGain(): void {
    if (!this.gain || !this.context) return
    this.gain.gain.setValueAtTime(
      this.active && !this.muted ? this.volume : 0,
      this.context.currentTime,
    )
  }

  private post(message: AudioControlMessage, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(message, transfer)
  }
}
