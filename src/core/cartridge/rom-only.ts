import { parseCartridgeHeader } from './header'
import type { CartridgeMetadata } from './header'
import type { Cartridge } from './cartridge'
import { CartridgeRam } from './ram'

export class RomOnlyCartridge implements Cartridge {
  readonly metadata: CartridgeMetadata
  private readonly rom: Uint8Array
  private readonly ram: CartridgeRam

  constructor(rom: Uint8Array) {
    this.metadata = parseCartridgeHeader(rom)
    if (this.metadata.mapper !== 'ROM_ONLY' || !this.metadata.isSupported) {
      throw new Error(`Cartucho não suportado nesta etapa. ${this.metadata.warnings.join(' ')}`)
    }
    this.rom = rom.slice()
    this.ram = new CartridgeRam(this.metadata.ramSize, this.metadata.hasBattery)
  }

  get batteryRevision(): number {
    return this.ram.batteryRevision
  }

  readRom(address: number): number {
    const normalized = address & 0xffff
    return normalized < 0x8000 ? this.rom[normalized]! : 0xff
  }

  writeRom(_address: number, _value: number): void {
    // Cartuchos sem MBC não possuem registradores graváveis na região de ROM.
    void _address
    void _value
  }

  readRam(address: number): number {
    return this.ram.read(address & 0x1fff)
  }

  writeRam(address: number, value: number): void {
    this.ram.write(address & 0x1fff, value)
  }

  exportBatteryRam(): Uint8Array | null {
    return this.ram.exportBatteryRam()
  }

  importBatteryRam(bytes: Uint8Array): void {
    this.ram.importBatteryRam(bytes)
  }
}
