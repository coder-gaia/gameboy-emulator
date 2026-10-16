import type { CartridgeMetadata } from './header'

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
}
