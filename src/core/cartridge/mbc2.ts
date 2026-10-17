import { stateBoolean, stateBytes, stateInteger, stateRecord } from '../state/validation'
import type { Cartridge, Mbc2State } from './cartridge'
import { parseCartridgeHeader, ROM_BANK_SIZE } from './header'
import type { CartridgeMetadata } from './header'
import { CartridgeRam } from './ram'

/** MBC2: A8 distingue RAM enable de ROM bank, RAM interna com 512 nibbles. */
export class Mbc2Cartridge implements Cartridge {
  readonly metadata: CartridgeMetadata
  private readonly rom: Uint8Array
  private readonly ram: CartridgeRam
  private ramEnabled = false
  private romBank = 1

  constructor(rom: Uint8Array) {
    this.metadata = parseCartridgeHeader(rom)
    if (this.metadata.mapper !== 'MBC2' || !this.metadata.isSupported)
      throw new Error(`Cartucho MBC2 não suportado. ${this.metadata.warnings.join(' ')}`)
    this.rom = rom.slice()
    this.ram = new CartridgeRam(512, this.metadata.hasBattery)
  }

  get batteryRevision(): number {
    return this.ram.batteryRevision
  }

  readRom(address: number): number {
    const normalized = address & 0xffff
    if (normalized >= 0x8000) return 0xff
    const bank = normalized < 0x4000 ? 0 : this.romBank & (this.metadata.romBanks - 1)
    return this.rom[bank * ROM_BANK_SIZE + (normalized & 0x3fff)]!
  }

  writeRom(address: number, value: number): void {
    const normalized = address & 0xffff
    if (normalized >= 0x4000) return
    if ((normalized & 0x100) === 0) this.ramEnabled = (value & 0x0f) === 0x0a
    else this.romBank = value & 0x0f || 1
  }

  readRam(address: number): number {
    return this.ramEnabled ? 0xf0 | this.ram.read(address & 0x1ff) : 0xff
  }

  writeRam(address: number, value: number): void {
    if (this.ramEnabled) this.ram.write(address & 0x1ff, value & 0x0f)
  }

  exportBatteryRam(): Uint8Array | null {
    return this.ram.exportBatteryRam()
  }
  importBatteryRam(bytes: Uint8Array): void {
    if (bytes.length !== 512) {
      this.ram.importBatteryRam(bytes)
      return
    }
    // Arquivos .sav de outros emuladores podem preencher os bits altos com 1.
    this.ram.importBatteryRam(bytes.map((byte) => byte & 0x0f))
  }

  snapshotState(): Mbc2State {
    return {
      version: 1,
      mapper: 'MBC2',
      ram: this.ram.snapshotState(),
      ramEnabled: this.ramEnabled,
      romBank: this.romBank,
    }
  }

  restoreState(value: unknown): void {
    const state = stateRecord(value, 'cartucho MBC2')
    stateInteger(state.version, 1, 1, 'cartucho.version')
    if (state.mapper !== 'MBC2') throw new Error('Estado de cartucho incompatível: mapper.')
    const ram = stateBytes(state.ram, 512, 'cartucho.ram')
    if (ram.some((byte) => byte > 15))
      throw new Error('Estado inválido: a RAM MBC2 contém valores acima de 4 bits.')
    const ramEnabled = stateBoolean(state.ramEnabled, 'MBC2.ramEnabled')
    const romBank = stateInteger(state.romBank, 1, 15, 'MBC2.romBank')
    this.ram.restoreState(ram)
    this.ramEnabled = ramEnabled
    this.romBank = romBank
  }
}
