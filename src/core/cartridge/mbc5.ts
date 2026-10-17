import { stateBoolean, stateBytes, stateInteger, stateRecord } from '../state/validation'
import type { Cartridge, Mbc5State } from './cartridge'
import { parseCartridgeHeader, ROM_BANK_SIZE } from './header'
import type { CartridgeMetadata } from './header'
import { CartridgeRam } from './ram'

/** MBC5: nove bits de ROM independentes e até quatro bits de banco de RAM. */
export class Mbc5Cartridge implements Cartridge {
  readonly metadata: CartridgeMetadata
  private readonly rom: Uint8Array
  private readonly ram: CartridgeRam
  private ramEnabled = false
  private romBank = 1
  private ramBank = 0
  private rumble = false

  constructor(rom: Uint8Array) {
    this.metadata = parseCartridgeHeader(rom)
    if (this.metadata.mapper !== 'MBC5' || !this.metadata.isSupported)
      throw new Error(`Cartucho MBC5 não suportado. ${this.metadata.warnings.join(' ')}`)
    this.rom = rom.slice()
    this.ram = new CartridgeRam(this.metadata.ramSize, this.metadata.hasBattery)
  }

  get batteryRevision(): number {
    return this.ram.batteryRevision
  }
  get rumbleActive(): boolean {
    return this.rumble
  }

  readRom(address: number): number {
    const normalized = address & 0xffff
    if (normalized >= 0x8000) return 0xff
    const bank = normalized < 0x4000 ? 0 : this.romBank & (this.metadata.romBanks - 1)
    return this.rom[bank * ROM_BANK_SIZE + (normalized & 0x3fff)]!
  }

  writeRom(address: number, value: number): void {
    const normalized = address & 0xffff
    if (normalized < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a
    else if (normalized < 0x3000) this.romBank = (this.romBank & 0x100) | (value & 0xff)
    else if (normalized < 0x4000) this.romBank = (this.romBank & 0xff) | ((value & 1) << 8)
    else if (normalized < 0x6000) {
      this.ramBank = value & (this.metadata.hasRumble ? 7 : 15)
      this.rumble = this.metadata.hasRumble && (value & 8) !== 0
    }
  }

  readRam(address: number): number {
    if (!this.ramEnabled || this.metadata.ramSize === 0) return 0xff
    return this.ram.read(this.ramOffset(address))
  }

  writeRam(address: number, value: number): void {
    if (this.ramEnabled && this.metadata.ramSize > 0) this.ram.write(this.ramOffset(address), value)
  }

  exportBatteryRam(): Uint8Array | null {
    return this.ram.exportBatteryRam()
  }
  importBatteryRam(bytes: Uint8Array): void {
    this.ram.importBatteryRam(bytes)
  }

  snapshotState(): Mbc5State {
    return {
      version: 1,
      mapper: 'MBC5',
      ram: this.ram.snapshotState(),
      ramEnabled: this.ramEnabled,
      romBank: this.romBank,
      ramBank: this.ramBank,
      rumbleActive: this.rumble,
    }
  }

  restoreState(value: unknown): void {
    const state = stateRecord(value, 'cartucho MBC5')
    stateInteger(state.version, 1, 1, 'cartucho.version')
    if (state.mapper !== 'MBC5') throw new Error('Estado de cartucho incompatível: mapper.')
    const ram = stateBytes(state.ram, this.metadata.ramSize, 'cartucho.ram')
    const ramEnabled = stateBoolean(state.ramEnabled, 'MBC5.ramEnabled')
    const romBank = stateInteger(state.romBank, 0, 511, 'MBC5.romBank')
    const ramBank = stateInteger(state.ramBank, 0, this.metadata.hasRumble ? 7 : 15, 'MBC5.ramBank')
    const rumble = stateBoolean(state.rumbleActive, 'MBC5.rumbleActive')
    if (rumble && !this.metadata.hasRumble)
      throw new Error('Estado inválido: este cartucho não possui rumble.')
    this.ram.restoreState(ram)
    this.ramEnabled = ramEnabled
    this.romBank = romBank
    this.ramBank = ramBank
    this.rumble = rumble
  }

  private ramOffset(address: number): number {
    return ((this.ramBank << 13) | (address & 0x1fff)) & (this.metadata.ramSize - 1)
  }
}
