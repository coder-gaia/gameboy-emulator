import type { RomOnlyCartridge } from '../cartridge'
import { SerialPort } from '../serial'

export class MemoryBus {
  readonly serial = new SerialPort()
  tCycles = 0
  private readonly vram = new Uint8Array(0x2000)
  private readonly wram = new Uint8Array(0x2000)
  private readonly oam = new Uint8Array(0xa0)
  private readonly io = new Uint8Array(0x80)
  private readonly hram = new Uint8Array(0x7f)
  private interruptEnable = 0

  constructor(readonly cartridge: RomOnlyCartridge) {}

  read8(address: number): number {
    const normalized = address & 0xffff
    if (normalized < 0x8000) return this.cartridge.readRom(normalized)
    if (normalized < 0xa000) return this.vram[normalized - 0x8000]!
    if (normalized < 0xc000) return this.cartridge.readRam(normalized)
    if (normalized < 0xe000) return this.wram[normalized - 0xc000]!
    if (normalized < 0xfe00) return this.wram[normalized - 0xe000]!
    if (normalized < 0xfea0) return this.oam[normalized - 0xfe00]!
    if (normalized < 0xff00) return 0xff
    if (normalized === 0xffff) return this.interruptEnable
    if (normalized >= 0xff80) return this.hram[normalized - 0xff80]!
    if (normalized === 0xff01) return this.serial.readData()
    if (normalized === 0xff02) return this.serial.readControl()
    if (normalized === 0xff0f) return this.io[0x0f]! | 0xe0
    return this.io[normalized - 0xff00]!
  }

  write8(address: number, value: number): void {
    const normalized = address & 0xffff
    const byte = value & 0xff
    if (normalized < 0x8000) this.cartridge.writeRom(normalized, byte)
    else if (normalized < 0xa000) this.vram[normalized - 0x8000] = byte
    else if (normalized < 0xc000) this.cartridge.writeRam(normalized, byte)
    else if (normalized < 0xe000) this.wram[normalized - 0xc000] = byte
    else if (normalized < 0xfe00) this.wram[normalized - 0xe000] = byte
    else if (normalized < 0xfea0) this.oam[normalized - 0xfe00] = byte
    else if (normalized < 0xff00) return
    else if (normalized === 0xffff) this.interruptEnable = byte
    else if (normalized >= 0xff80) this.hram[normalized - 0xff80] = byte
    else if (normalized === 0xff01) this.serial.writeData(byte)
    else if (normalized === 0xff02) this.serial.writeControl(byte)
    else if (normalized === 0xff0f) this.io[0x0f] = byte & 0x1f
    else this.io[normalized - 0xff00] = byte
  }

  tick(tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('O barramento exige uma quantidade inteira e não negativa de T-cycles.')
    }
    this.tCycles += tCycles
    if (this.serial.tick(tCycles)) this.io[0x0f] = this.io[0x0f]! | 0x08
  }
}
