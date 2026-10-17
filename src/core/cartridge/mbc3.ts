import { stateBoolean, stateBytes, stateInteger, stateRecord } from '../state/validation'
import type { Cartridge, CartridgeRtcState, Mbc3State } from './cartridge'
import { parseCartridgeHeader, ROM_BANK_SIZE } from './header'
import type { CartridgeMetadata } from './header'
import { CartridgeRam } from './ram'
import { CartridgeRtc, parseCartridgeRtcState } from './rtc'

/** MBC3 padrão, sem a extensão MBC30. RTC apenas nos tipos 0x0f e 0x10. */
export class Mbc3Cartridge implements Cartridge {
  readonly metadata: CartridgeMetadata
  private readonly rom: Uint8Array
  private readonly ram: CartridgeRam
  private readonly rtc: CartridgeRtc | null
  private readonly latchedRtc = new Uint8Array(5)
  private ramEnabled = false
  private romBank = 1
  private selection = 0
  private latchValue = 0xff

  constructor(rom: Uint8Array) {
    this.metadata = parseCartridgeHeader(rom)
    if (this.metadata.mapper !== 'MBC3' || !this.metadata.isSupported)
      throw new Error(`Cartucho MBC3 não suportado. ${this.metadata.warnings.join(' ')}`)
    this.rom = rom.slice()
    this.ram = new CartridgeRam(this.metadata.ramSize, this.metadata.hasBattery)
    this.rtc = this.metadata.hasRtc ? new CartridgeRtc() : null
  }

  get batteryRevision(): number {
    return this.ram.batteryRevision + (this.rtc?.batteryRevision ?? 0)
  }

  readRom(address: number): number {
    const normalized = address & 0xffff
    if (normalized >= 0x8000) return 0xff
    const bank = normalized < 0x4000 ? 0 : this.romBank & (this.metadata.romBanks - 1)
    return this.rom[bank * ROM_BANK_SIZE + (normalized & 0x3fff)]!
  }

  writeRom(address: number, value: number): void {
    const normalized = address & 0xffff
    const byte = value & 0xff
    if (normalized < 0x2000) this.ramEnabled = (byte & 0x0f) === 0x0a
    else if (normalized < 0x4000) this.romBank = byte & 0x7f || 1
    else if (normalized < 0x6000) this.selection = byte
    else if (normalized < 0x8000) {
      if (this.latchValue === 0 && byte === 1 && this.rtc) {
        for (let index = 0; index < this.latchedRtc.length; index += 1)
          this.latchedRtc[index] = this.rtc.readRegister(index)
      }
      this.latchValue = byte
    }
  }

  readRam(address: number): number {
    if (!this.ramEnabled) return 0xff
    if (this.selection <= 3 && this.metadata.ramSize > 0)
      return this.ram.read(this.ramOffset(address))
    if (this.rtc && this.selection >= 8 && this.selection <= 12)
      return this.latchedRtc[this.selection - 8]!
    return 0xff
  }

  writeRam(address: number, value: number): void {
    if (!this.ramEnabled) return
    if (this.selection <= 3 && this.metadata.ramSize > 0)
      this.ram.write(this.ramOffset(address), value)
    else if (this.rtc && this.selection >= 8 && this.selection <= 12)
      this.rtc.writeRegister(this.selection - 8, value)
  }

  tick(tCycles: number): void {
    this.rtc?.tick(tCycles)
  }
  advanceRtcSeconds(seconds: number): void {
    this.rtc?.advanceSeconds(seconds)
  }
  exportBatteryRam(): Uint8Array | null {
    return this.rtc && this.metadata.ramSize === 0 ? new Uint8Array(0) : this.ram.exportBatteryRam()
  }
  importBatteryRam(bytes: Uint8Array): void {
    if (this.rtc && this.metadata.ramSize === 0) {
      if (bytes.length !== 0)
        throw new Error('Save de bateria incompatível: este cartucho RTC não possui RAM.')
      return
    }
    this.ram.importBatteryRam(bytes)
  }
  exportBatteryRtc(): CartridgeRtcState | null {
    return this.rtc?.snapshotState() ?? null
  }
  importBatteryRtc(state: unknown): void {
    if (!this.rtc) throw new Error('Este cartucho não possui RTC de bateria.')
    this.rtc.restoreState(state)
  }

  snapshotState(): Mbc3State {
    return {
      version: 1,
      mapper: 'MBC3',
      ram: this.ram.snapshotState(),
      ramEnabled: this.ramEnabled,
      romBank: this.romBank,
      selection: this.selection,
      latchValue: this.latchValue,
      rtc: this.rtc?.snapshotState() ?? null,
      latchedRtc: this.latchedRtc.slice(),
    }
  }

  restoreState(value: unknown): void {
    const state = stateRecord(value, 'cartucho MBC3')
    stateInteger(state.version, 1, 1, 'cartucho.version')
    if (state.mapper !== 'MBC3') throw new Error('Estado de cartucho incompatível: mapper.')
    const ram = stateBytes(state.ram, this.metadata.ramSize, 'cartucho.ram')
    const ramEnabled = stateBoolean(state.ramEnabled, 'MBC3.ramEnabled')
    const romBank = stateInteger(state.romBank, 1, 127, 'MBC3.romBank')
    const selection = stateInteger(state.selection, 0, 255, 'MBC3.selection')
    const latchValue = stateInteger(state.latchValue, 0, 255, 'MBC3.latchValue')
    const latchedRtc = stateBytes(state.latchedRtc, 5, 'MBC3.latchedRtc')
    if (
      latchedRtc[0]! > 63 ||
      latchedRtc[1]! > 63 ||
      latchedRtc[2]! > 31 ||
      (latchedRtc[4]! & 0x3e) !== 0
    )
      throw new Error('Estado inválido: registradores RTC latched fora dos bits permitidos.')
    if (!this.rtc && (state.rtc !== null || latchedRtc.some((byte) => byte !== 0)))
      throw new Error('Estado inválido: este cartucho não possui RTC.')
    const rtc = this.rtc ? parseCartridgeRtcState(state.rtc) : null
    // Toda a validação acontece antes da primeira mutação.
    this.ram.restoreState(ram)
    if (rtc) this.rtc!.restoreState(rtc)
    this.ramEnabled = ramEnabled
    this.romBank = romBank
    this.selection = selection
    this.latchValue = latchValue
    this.latchedRtc.set(latchedRtc)
  }

  private ramOffset(address: number): number {
    return ((this.selection << 13) | (address & 0x1fff)) & (this.metadata.ramSize - 1)
  }
}
