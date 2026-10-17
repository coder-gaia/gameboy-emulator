import type { CartridgeMetadata } from './header'

export interface RomOnlyState {
  version: 1
  mapper: 'ROM_ONLY'
  ram: Uint8Array
}

export interface Mbc1State {
  version: 1
  mapper: 'MBC1'
  ram: Uint8Array
  ramEnabled: boolean
  primaryBank: number
  secondaryBank: number
  bankingMode: number
}

export interface Mbc2State {
  version: 1
  mapper: 'MBC2'
  ram: Uint8Array
  ramEnabled: boolean
  romBank: number
}

export interface CartridgeRtcState {
  version: 1
  seconds: number
  minutes: number
  hours: number
  days: number
  halted: boolean
  carry: boolean
  subsecondTCycles: number
}

export interface Mbc3State {
  version: 1
  mapper: 'MBC3'
  ram: Uint8Array
  ramEnabled: boolean
  romBank: number
  selection: number
  latchValue: number
  rtc: CartridgeRtcState | null
  latchedRtc: Uint8Array
}

export interface Mbc5State {
  version: 1
  mapper: 'MBC5'
  ram: Uint8Array
  ramEnabled: boolean
  romBank: number
  ramBank: number
  rumbleActive: boolean
}

export type CartridgeState = RomOnlyState | Mbc1State | Mbc2State | Mbc3State | Mbc5State

/** Contrato do cartucho físico, independente de armazenamento e APIs de navegador. */
export interface Cartridge {
  readonly metadata: CartridgeMetadata
  readonly batteryRevision: number
  readRom(address: number): number
  writeRom(address: number, value: number): void
  readRam(address: number): number
  writeRam(address: number, value: number): void
  exportBatteryRam(): Uint8Array | null
  importBatteryRam(bytes: Uint8Array): void
  snapshotState(): CartridgeState
  restoreState(state: unknown): void
  /** Tempo determinístico do cristal do RTC, em T-cycles DMG. */
  tick?(tCycles: number): void
  /** Compensação de tempo offline informada explicitamente pelo adaptador. */
  advanceRtcSeconds?(seconds: number): void
  exportBatteryRtc?(): CartridgeRtcState | null
  importBatteryRtc?(state: unknown): void
}
