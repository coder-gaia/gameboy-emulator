export const AUDIO_REFILL_FRAMES = 512
export const AUDIO_TARGET_FRAMES = 1536
export const AUDIO_MAX_FRAMES = 16_384
export const AUDIO_PROCESSOR_NAME = 'pocket-lab-pcm'

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
