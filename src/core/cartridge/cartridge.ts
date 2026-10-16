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

export type CartridgeState = RomOnlyState | Mbc1State

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
}
