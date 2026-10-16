import type { CpuSnapshot } from '../core/cpu'
import type { JoypadButton } from '../core/joypad'

export interface EmulatorSnapshot {
  framebuffer: Uint8Array
  frameId: number
  cpu: CpuSnapshot
  nextBytes: number[]
  serial: string
  batteryRevision: number
  batteryRam?: Uint8Array | null
  playing: boolean
  audioEpoch: number
}

export type EmulatorCommand =
  | { type: 'init'; rom: Uint8Array }
  | { type: 'play'; playing: boolean }
  | { type: 'input'; button: JoypadButton; pressed: boolean }
  | { type: 'release-input' }
  | { type: 'step'; count: number }
  | { type: 'inspect' }
  | { type: 'import-battery'; bytes: Uint8Array }
  | { type: 'audio-port'; port: MessagePort; sampleRate: number; epoch: number }
  | { type: 'audio-disable' }

export interface EmulatorRequest {
  id: number
  command: EmulatorCommand
}

export type EmulatorMessage =
  | { type: 'reply'; id: number; snapshot?: EmulatorSnapshot; error?: string }
  | { type: 'frame'; snapshot: EmulatorSnapshot }
  | { type: 'error'; error: string }
