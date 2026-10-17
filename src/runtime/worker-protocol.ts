import type { CpuSnapshot } from '../core/cpu'
import type { JoypadButton } from '../core/joypad'
import type { GameBoyState } from '../core/gameboy'
import type { CartridgeRtcState } from '../core/cartridge'
import type { HardwareDebugSnapshot } from '../core/debug'

export interface EmulatorReplyPayload {
  checkpoint?: MachineCheckpoint
  hardware?: HardwareDebugSnapshot
}

export interface MachineCheckpoint {
  version: 1
  core: GameBoyState
  serial: string
}

export interface RewindStatus {
  enabled: boolean
  active: boolean
  entries: number
  availableSeconds: number
  allocatedBytes: number
  usedBytes: number
  maxSeconds: number
  maxBytes: number
}

export interface EmulatorVideoFrame {
  epoch: number
  slot: number
  token: number
  frameId: number
  pcmFrame: number
  framebuffer: Uint8Array
}

export interface EmulatorSnapshot {
  framebuffer: Uint8Array
  frameId: number
  cpu: CpuSnapshot
  nextBytes: number[]
  serial: string
  batteryRevision: number
  batteryRam?: Uint8Array | null
  batteryRtc?: CartridgeRtcState | null
  playing: boolean
  audioEpoch: number
  audioDriven: boolean
  romId: string
  rewind: RewindStatus
}

export type EmulatorCommand =
  | { type: 'init'; rom: Uint8Array }
  | { type: 'play'; playing: boolean }
  | { type: 'input'; button: JoypadButton; pressed: boolean }
  | { type: 'release-input' }
  | { type: 'step'; count: number }
  | { type: 'inspect' }
  | { type: 'inspect-hardware'; memoryStart: number }
  | { type: 'recycle-video'; slot: number; token: number; buffer: ArrayBuffer }
  | { type: 'import-battery'; bytes: Uint8Array }
  | {
      type: 'import-battery-state'
      bytes: Uint8Array
      rtc: CartridgeRtcState
      elapsedSeconds: number
    }
  // epoch é o piso solicitado; a resposta informa a geração alocada pelo Worker.
  | { type: 'audio-port'; port: MessagePort; sampleRate: number; epoch: number }
  | { type: 'audio-disable' }
  | { type: 'capture-state' }
  | { type: 'load-state'; checkpoint: unknown }
  | { type: 'rewind-config'; enabled: boolean }
  | { type: 'rewind-start' }
  | { type: 'rewind-end' }

export interface EmulatorRequest {
  id: number
  command: EmulatorCommand
}

export type EmulatorMessage =
  | ({
      type: 'reply'
      id: number
      snapshot?: EmulatorSnapshot
      error?: string
    } & EmulatorReplyPayload)
  | { type: 'frame'; snapshot: EmulatorSnapshot }
  | { type: 'video-frame'; frame: EmulatorVideoFrame }
  | { type: 'error'; error: string }
