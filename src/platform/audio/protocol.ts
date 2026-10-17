export const AUDIO_REFILL_FRAMES = 512
export const AUDIO_TARGET_FRAMES = 3072
export const AUDIO_MAX_FRAMES = 32_768
/** A arena PCM da APU comporta 16384 frames; cada pedido reserva 128 para overshoot. */
export const AUDIO_MAX_REQUEST_FRAMES = 16_256
export const AUDIO_PROCESSOR_NAME = 'pocket-lab-pcm'

/** Reservas temporais, limitadas pela arena PCM e pela margem de overshoot da CPU. */
export function audioBufferProfile(sampleRate: number) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192_000)
    throw new RangeError('A taxa de áudio precisa ser inteira, entre 8000 e 192000 Hz.')
  const align = (frames: number) => Math.ceil(frames / 128) * 128
  const maxFrames = Math.min(AUDIO_MAX_FRAMES - 128, align(sampleRate * 0.384))
  return {
    initialFrames: Math.min(maxFrames, align(sampleRate * 0.064)),
    maxFrames,
    refillFrames: Math.max(128, align(sampleRate * 0.01)),
    // O alvo limita a reserva adaptativa; o pedido também precisa repor o consumo em voo.
    requestLimit: AUDIO_MAX_REQUEST_FRAMES,
  }
}

export interface AudioNeedMessage {
  readonly type: 'need'
  readonly frames: number
  readonly epoch: number
}

/** PCM estéreo intercalado: esquerda, direita, esquerda, direita. */
export interface AudioSamplesMessage {
  readonly type: 'samples'
  readonly samples: Float32Array
  readonly epoch: number
}

export interface PcmDiagnostics {
  readonly queuedFrames: number
  readonly renderedFrames: number
  readonly underrunFrames: number
  readonly underruns: number
  readonly droppedFrames: number
  readonly peakLevel: number
  readonly energy: number
}

export interface AudioStreamDiagnostics extends PcmDiagnostics {
  readonly epoch: number
  readonly active: boolean
  readonly primed: boolean
  readonly pendingFrames: number
  readonly targetFrames: number
  readonly roundTripFrames: number
  readonly peakRoundTripFrames: number
  readonly renderQuantumFrames: number
}

export type AudioControlMessage =
  | { readonly type: 'connect'; readonly port: MessagePort; readonly epoch: number }
  | { readonly type: 'reset'; readonly epoch: number; readonly active: boolean }
  | { readonly type: 'dispose' }

export interface AudioStatsMessage {
  readonly type: 'stats'
  readonly diagnostics: AudioStreamDiagnostics
}

/** Cursor no relógio do AudioContext, independente dos diagnósticos completos. */
export interface AudioPlaybackMessage {
  readonly type: 'playback'
  readonly epoch: number
  readonly frame: number
  readonly availableFrame: number
  readonly contextTime: number
  readonly advancing: boolean
}

export function isAudioEpoch(epoch: number): boolean {
  return Number.isSafeInteger(epoch) && epoch >= 0
}
