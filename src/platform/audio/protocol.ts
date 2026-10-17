export const AUDIO_REFILL_FRAMES = 512
export const AUDIO_TARGET_FRAMES = 3072
export const AUDIO_MAX_FRAMES = 16_384
export const AUDIO_MAX_REQUEST_FRAMES = AUDIO_MAX_FRAMES - 128
export const AUDIO_PROCESSOR_NAME = 'pocket-lab-pcm'

/** Reservas temporais, limitadas pela arena PCM e pela margem de overshoot da CPU. */
export function audioBufferProfile(sampleRate: number) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192_000)
    throw new RangeError('A taxa de áudio precisa ser inteira, entre 8000 e 192000 Hz.')
  const align = (frames: number) => Math.ceil(frames / 128) * 128
  const maxFrames = Math.min(AUDIO_MAX_REQUEST_FRAMES, align(sampleRate * 0.128))
  return {
    initialFrames: Math.min(maxFrames, align(sampleRate * 0.064)),
    maxFrames,
    refillFrames: Math.max(128, align(sampleRate * 0.01)),
    requestLimit: maxFrames,
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

export function isAudioEpoch(epoch: number): boolean {
  return Number.isSafeInteger(epoch) && epoch >= 0
}
