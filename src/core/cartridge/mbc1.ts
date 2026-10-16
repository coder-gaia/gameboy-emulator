import { parseCartridgeHeader, ROM_BANK_SIZE } from './header'
import type { CartridgeMetadata } from './header'
import type { Cartridge, Mbc1State } from './cartridge'
import { CartridgeRam } from './ram'
import { stateBoolean, stateBytes, stateInteger, stateRecord } from '../state/validation'

/**
 * MBC1 com fiação padrão: ROM de até 2 MiB, RAM de até 32 KiB.
 * ROM de 1 MiB ou mais usa os bits secundários para ROM e até 8 KiB de RAM.
 * MBC1M e sua fiação alternativa de multicart não fazem parte deste mapper.
 * Fonte: https://gbdev.io/pandocs/MBC1.html
 */
export class Mbc1Cartridge implements Cartridge {
  readonly metadata: CartridgeMetadata
  private readonly rom: Uint8Array
  private readonly ram: CartridgeRam
  private readonly romBankMask: number
  private readonly ramAddressMask: number
  private ramEnabled = false
  private primaryBank = 0
  private secondaryBank = 0
  private bankingMode = 0

  constructor(rom: Uint8Array) {
    this.metadata = parseCartridgeHeader(rom)
    if (this.metadata.mapper !== 'MBC1' || !this.metadata.isSupported) {
      throw new Error(`Cartucho MBC1 não suportado. ${this.metadata.warnings.join(' ')}`)
    }
    this.rom = rom.slice()
    this.ram = new CartridgeRam(this.metadata.ramSize, this.metadata.hasBattery)
    this.romBankMask = this.metadata.romBanks - 1
    this.ramAddressMask = this.metadata.ramSize - 1
  }

  get batteryRevision(): number {
    return this.ram.batteryRevision
  }

  readRom(address: number): number {
    const normalized = address & 0xffff
    if (normalized >= 0x8000) return 0xff
    const bank =
      normalized < 0x4000
        ? this.bankingMode === 1
          ? this.secondaryBank << 5
          : 0
        : (this.secondaryBank << 5) | (this.primaryBank === 0 ? 1 : this.primaryBank)
    const offset = (bank & this.romBankMask) * ROM_BANK_SIZE + (normalized & 0x3fff)
    return this.rom[offset]!
  }

  writeRom(address: number, value: number): void {
    const normalized = address & 0xffff
    if (normalized < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a
    else if (normalized < 0x4000) this.primaryBank = value & 0x1f
    else if (normalized < 0x6000) this.secondaryBank = value & 3
    else if (normalized < 0x8000) this.bankingMode = value & 1
  }

  readRam(address: number): number {
    if (!this.ramEnabled || this.metadata.ramSize === 0) return 0xff
    return this.ram.read(this.ramOffset(address))
  }

  writeRam(address: number, value: number): void {
    if (!this.ramEnabled || this.metadata.ramSize === 0) return
    this.ram.write(this.ramOffset(address), value)
  }

  exportBatteryRam(): Uint8Array | null {
    return this.ram.exportBatteryRam()
  }

  importBatteryRam(bytes: Uint8Array): void {
    this.ram.importBatteryRam(bytes)
  }

  snapshotState(): Mbc1State {
    return {
      version: 1,
      mapper: 'MBC1',
      ram: this.ram.snapshotState(),
      ramEnabled: this.ramEnabled,
      primaryBank: this.primaryBank,
      secondaryBank: this.secondaryBank,
      bankingMode: this.bankingMode,
    }
  }

  restoreState(value: unknown): void {
    const state = stateRecord(value, 'cartucho MBC1')
    stateInteger(state.version, 1, 1, 'cartucho.version')
    if (state.mapper !== 'MBC1') throw new Error('Estado de cartucho incompatível: mapper.')
    const ram = stateBytes(state.ram, this.metadata.ramSize, 'cartucho.ram')
    const ramEnabled = stateBoolean(state.ramEnabled, 'MBC1.ramEnabled')
    const primaryBank = stateInteger(state.primaryBank, 0, 31, 'MBC1.primaryBank')
    const secondaryBank = stateInteger(state.secondaryBank, 0, 3, 'MBC1.secondaryBank')
    const bankingMode = stateInteger(state.bankingMode, 0, 1, 'MBC1.bankingMode')
    this.ram.restoreState(ram)
    this.ramEnabled = ramEnabled
    this.primaryBank = primaryBank
    this.secondaryBank = secondaryBank
    this.bankingMode = bankingMode
  }

  private ramOffset(address: number): number {
    const bank = this.bankingMode === 1 ? this.secondaryBank : 0
    return ((bank << 13) | (address & 0x1fff)) & this.ramAddressMask
  }
}
