import type { Cartridge } from '../cartridge'
import { OamDma } from '../dma'
import { SerialPort } from '../serial'
import { Timer } from '../timer'
import { Ppu } from '../ppu'
import { Joypad } from '../joypad'

export class MemoryBus {
  readonly serial = new SerialPort()
  readonly timer = new Timer()
  readonly ppu = new Ppu((mask) => this.requestInterrupt(mask))
  readonly joypad = new Joypad((mask) => this.requestInterrupt(mask))
  readonly dma = new OamDma(
    (address) => this.read8Direct(address),
    (address, value) => this.write8Direct(address, value),
  )
  tCycles = 0
  private readonly wram = new Uint8Array(0x2000)
  private readonly io = new Uint8Array(0x80)
  private readonly hram = new Uint8Array(0x7f)
  private interruptEnable = 0

  constructor(
    readonly cartridge: Pick<Cartridge, 'readRom' | 'writeRom' | 'readRam' | 'writeRam'>,
  ) {
    // O bus isolado começa sem LCD; GameBoy aplica o estado pós boot da máquina.
    this.ppu.reset(false)
  }

  read8(address: number): number {
    const normalized = address & 0xffff
    // IE possui ligação interna própria; permanece acessível durante DMA.
    if (this.dma.blocksCpuAddress(normalized)) return 0xff
    if (this.ppu.lcdEnabled && this.ppu.mode === 3 && normalized >= 0x8000 && normalized < 0xa000)
      return 0xff
    if (
      this.ppu.lcdEnabled &&
      (this.ppu.mode === 2 || this.ppu.mode === 3) &&
      normalized >= 0xfe00 &&
      normalized < 0xfea0
    )
      return 0xff
    return this.read8Direct(normalized)
  }

  /** Acesso interno, sem restrições da CPU e sem avanço do relógio. */
  read8Direct(address: number): number {
    const normalized = address & 0xffff
    if (normalized < 0x8000) return this.cartridge.readRom(normalized)
    if (normalized < 0xa000) return this.ppu.vram[normalized - 0x8000]!
    if (normalized < 0xc000) return this.cartridge.readRam(normalized)
    if (normalized < 0xe000) return this.wram[normalized - 0xc000]!
    if (normalized < 0xfe00) return this.wram[normalized - 0xe000]!
    if (normalized < 0xfea0) return this.ppu.oam[normalized - 0xfe00]!
    if (normalized < 0xff00) return 0xff
    if (normalized === 0xffff) return this.interruptEnable
    if (normalized >= 0xff80) return this.hram[normalized - 0xff80]!
    if (normalized === 0xff00) return this.joypad.read()
    if (normalized === 0xff01) return this.serial.readData()
    if (normalized === 0xff02) return this.serial.readControl()
    if (normalized >= 0xff04 && normalized <= 0xff07) return this.timer.read8(normalized)
    if (normalized === 0xff46) return this.dma.readRegister()
    if (normalized >= 0xff40 && normalized <= 0xff4b) return this.ppu.readRegister(normalized)
    if (normalized === 0xff0f) return this.io[0x0f]! | 0xe0
    return this.io[normalized - 0xff00]!
  }

  write8(address: number, value: number): void {
    const normalized = address & 0xffff
    if (this.dma.blocksCpuAddress(normalized)) return
    if (this.ppu.lcdEnabled && this.ppu.mode === 3 && normalized >= 0x8000 && normalized < 0xa000)
      return
    if (
      this.ppu.lcdEnabled &&
      (this.ppu.mode === 2 || this.ppu.mode === 3) &&
      normalized >= 0xfe00 &&
      normalized < 0xfea0
    )
      return
    this.write8Direct(normalized, value)
  }

  /** Acesso interno de DMA/fixtures; os registradores mantêm seus efeitos. */
  write8Direct(address: number, value: number): void {
    const normalized = address & 0xffff
    const byte = value & 0xff
    if (normalized < 0x8000) this.cartridge.writeRom(normalized, byte)
    else if (normalized < 0xa000) this.ppu.vram[normalized - 0x8000] = byte
    else if (normalized < 0xc000) this.cartridge.writeRam(normalized, byte)
    else if (normalized < 0xe000) this.wram[normalized - 0xc000] = byte
    else if (normalized < 0xfe00) this.wram[normalized - 0xe000] = byte
    else if (normalized < 0xfea0) this.ppu.oam[normalized - 0xfe00] = byte
    else if (normalized < 0xff00) return
    else if (normalized === 0xffff) this.interruptEnable = byte
    else if (normalized >= 0xff80) this.hram[normalized - 0xff80] = byte
    else if (normalized === 0xff00) this.joypad.write(byte)
    else if (normalized === 0xff01) this.serial.writeData(byte)
    else if (normalized === 0xff02) this.serial.writeControl(byte)
    else if (normalized >= 0xff04 && normalized <= 0xff07) this.timer.write8(normalized, byte)
    else if (normalized === 0xff46) this.dma.start(byte)
    else if (normalized >= 0xff40 && normalized <= 0xff4b) this.ppu.writeRegister(normalized, byte)
    else if (normalized === 0xff0f) this.io[0x0f] = byte & 0x1f
    else this.io[normalized - 0xff00] = byte
  }

  requestInterrupt(mask: number): void {
    this.io[0x0f] = this.io[0x0f]! | (mask & 0x1f)
  }

  pendingInterrupts(): number {
    return this.interruptEnable & this.io[0x0f]! & 0x1f
  }

  acknowledgeInterrupt(mask: number): void {
    this.io[0x0f] = this.io[0x0f]! & ~mask & 0x1f
  }

  resetDivider(): void {
    this.timer.resetDivider()
  }

  tick(tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('O barramento exige uma quantidade inteira e não negativa de T-cycles.')
    }
    this.tCycles += tCycles
    // Periféricos compartilham a ordem de cada T-cycle, inclusive durante HALT.
    for (let elapsed = 0; elapsed < tCycles; elapsed += 1) {
      if (this.timer.tick(1)) this.requestInterrupt(0x04)
      this.dma.tick(1)
      this.ppu.tick(1)
    }
    if (this.serial.tick(tCycles)) this.requestInterrupt(0x08)
  }
}
