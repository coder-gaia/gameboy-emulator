import { DMG_CLOCK_HZ } from '../model'
import { stateBoolean, stateInteger, stateRecord } from '../state/validation'
import type { CartridgeRtcState } from './cartridge'

/** Valida também os bits fisicamente graváveis fora dos valores normais do relógio. */
export function parseCartridgeRtcState(value: unknown): CartridgeRtcState {
  const state = stateRecord(value, 'RTC do cartucho')
  stateInteger(state.version, 1, 1, 'RTC.version')
  return {
    version: 1,
    seconds: stateInteger(state.seconds, 0, 63, 'RTC.seconds'),
    minutes: stateInteger(state.minutes, 0, 63, 'RTC.minutes'),
    hours: stateInteger(state.hours, 0, 31, 'RTC.hours'),
    days: stateInteger(state.days, 0, 511, 'RTC.days'),
    halted: stateBoolean(state.halted, 'RTC.halted'),
    carry: stateBoolean(state.carry, 'RTC.carry'),
    subsecondTCycles: stateInteger(
      state.subsecondTCycles,
      0,
      DMG_CLOCK_HZ - 1,
      'RTC.subsecondTCycles',
    ),
  }
}

function advanceCounter(
  value: number,
  pulses: number,
  limit: number,
  mask: number,
): [number, number] {
  // Valores ilegais escritos nos bits físicos passam pelo wrap binário antes
  // de voltar à faixa normal. O carry só ocorre ao atingir o limite normal.
  if (value >= limit) {
    const untilWrap = mask + 1 - value
    if (pulses < untilWrap) return [value + pulses, 0]
    pulses -= untilWrap
    value = 0
  }
  const remainder = value + (pulses % limit)
  return [remainder % limit, Math.floor(pulses / limit) + Math.floor(remainder / limit)]
}

/** Cristal de cartucho determinístico. Nenhuma consulta ao relógio do sistema. */
export class CartridgeRtc {
  private seconds = 0
  private minutes = 0
  private hours = 0
  private days = 0
  private halted = false
  private carry = false
  private subsecondTCycles = 0
  private revision = 0

  get batteryRevision(): number {
    return this.revision
  }

  tick(tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0)
      throw new Error('O RTC exige uma quantidade inteira e não negativa de T-cycles.')
    if (this.halted || tCycles === 0) return
    const fraction = this.subsecondTCycles + (tCycles % DMG_CLOCK_HZ)
    const seconds = Math.floor(tCycles / DMG_CLOCK_HZ) + Math.floor(fraction / DMG_CLOCK_HZ)
    this.subsecondTCycles = fraction % DMG_CLOCK_HZ
    if (seconds > 0) this.advanceSeconds(seconds)
  }

  advanceSeconds(seconds: number): void {
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      throw new Error('O avanço do RTC exige segundos inteiros e não negativos.')
    if (this.halted || seconds === 0) return
    let pulses: number
    ;[this.seconds, pulses] = advanceCounter(this.seconds, seconds, 60, 63)
    ;[this.minutes, pulses] = advanceCounter(this.minutes, pulses, 60, 63)
    ;[this.hours, pulses] = advanceCounter(this.hours, pulses, 24, 31)
    const days = this.days + pulses
    this.days = days % 512
    if (days >= 512) this.carry = true
    this.revision += 1
  }

  readRegister(index: number): number {
    switch (index) {
      case 0:
        return this.seconds
      case 1:
        return this.minutes
      case 2:
        return this.hours
      case 3:
        return this.days & 0xff
      case 4:
        return (this.days >> 8) | (this.halted ? 0x40 : 0) | (this.carry ? 0x80 : 0)
      default:
        return 0xff
    }
  }

  writeRegister(index: number, value: number): void {
    const before = this.readRegister(index)
    const beforeFraction = this.subsecondTCycles
    switch (index) {
      case 0:
        this.seconds = value & 63
        this.subsecondTCycles = 0
        break
      case 1:
        this.minutes = value & 63
        break
      case 2:
        this.hours = value & 31
        break
      case 3:
        this.days = (this.days & 0x100) | (value & 0xff)
        break
      case 4:
        this.days = (this.days & 0xff) | ((value & 1) << 8)
        this.halted = (value & 0x40) !== 0
        this.carry = (value & 0x80) !== 0
        break
      default:
        return
    }
    if (this.readRegister(index) !== before || this.subsecondTCycles !== beforeFraction)
      this.revision += 1
  }

  snapshotState(): CartridgeRtcState {
    return {
      version: 1,
      seconds: this.seconds,
      minutes: this.minutes,
      hours: this.hours,
      days: this.days,
      halted: this.halted,
      carry: this.carry,
      subsecondTCycles: this.subsecondTCycles,
    }
  }

  restoreState(value: unknown): void {
    const state = parseCartridgeRtcState(value)
    const changed =
      state.seconds !== this.seconds ||
      state.minutes !== this.minutes ||
      state.hours !== this.hours ||
      state.days !== this.days ||
      state.halted !== this.halted ||
      state.carry !== this.carry ||
      state.subsecondTCycles !== this.subsecondTCycles
    this.seconds = state.seconds
    this.minutes = state.minutes
    this.hours = state.hours
    this.days = state.days
    this.halted = state.halted
    this.carry = state.carry
    this.subsecondTCycles = state.subsecondTCycles
    if (changed) this.revision += 1
  }
}
