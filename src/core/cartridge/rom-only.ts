import { parseCartridgeHeader } from './header'
import type { CartridgeMetadata } from './header'

export class RomOnlyCartridge {
  readonly metadata: CartridgeMetadata
  private readonly rom: Uint8Array
  private readonly ram: Uint8Array

  constructor(rom: Uint8Array) {
    this.metadata = parseCartridgeHeader(rom)
    if (!this.metadata.isSupported) {
      throw new Error(`Cartucho não suportado nesta etapa. ${this.metadata.warnings.join(' ')}`)
    }
    this.rom = rom.slice()
    this.ram = new Uint8Array(this.metadata.ramSize)
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
    return this.ram[address & 0x1fff] ?? 0xff
  }

  writeRam(address: number, value: number): void {
    const offset = address & 0x1fff
    if (offset < this.ram.length) this.ram[offset] = value & 0xff
  }
}
