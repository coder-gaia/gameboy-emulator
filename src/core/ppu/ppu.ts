export const SCREEN_WIDTH = 160
export const SCREEN_HEIGHT = 144
export const T_CYCLES_PER_LINE = 456
export const T_CYCLES_PER_FRAME = T_CYCLES_PER_LINE * 154

export type PpuMode = 0 | 1 | 2 | 3

export interface PpuSnapshot {
  lcdc: number
  stat: number
  ly: number
  lyc: number
  scx: number
  scy: number
  wx: number
  wy: number
  mode: PpuMode
  lineTCycles: number
  frameId: number
}

/**
 * PPU DMG por scanline. Uma dot equivale a um T-cycle.
 * Modos e registradores seguem Pan Docs. Não modela o pixel FIFO nem
 * escritas raster durante modo 3; os registradores são lidos ao concluir a linha.
 * https://gbdev.io/pandocs/Rendering.html
 * https://gbdev.io/pandocs/STAT.html
 */
export class Ppu {
  readonly vram = new Uint8Array(0x2000)
  readonly oam = new Uint8Array(0xa0)
  readonly framebuffer = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)

  private lcdc = 0x91
  private statSelect = 0
  private scy = 0
  private scx = 0
  private lyc = 0
  private bgp = 0xfc
  private obp0 = 0xff
  private obp1 = 0xff
  private wy = 0
  private wx = 0
  private line = 0
  private lineTCycles = 0
  private currentMode: PpuMode = 2
  private transferEnd = 252
  private statLine = false
  private statWriteTCycles = 0
  private completedFrames = 0

  constructor(private readonly requestInterrupt: (mask: number) => void = () => {}) {}

  get mode(): PpuMode {
    return this.currentMode
  }

  get lcdEnabled(): boolean {
    return (this.lcdc & 0x80) !== 0
  }

  get frameId(): number {
    return this.completedFrames
  }

  get ly(): number {
    // No DMG, LY volta a zero quatro T-cycles após começar a linha 153.
    return this.line === 153 && this.lineTCycles >= 4 ? 0 : this.line
  }

  reset(postBoot = true): void {
    this.vram.fill(0)
    this.oam.fill(0)
    this.framebuffer.fill(0)
    this.lcdc = postBoot ? 0x91 : 0
    this.statSelect = 0
    this.scy = 0
    this.scx = 0
    this.lyc = 0
    this.bgp = postBoot ? 0xfc : 0
    this.obp0 = postBoot ? 0xff : 0
    this.obp1 = postBoot ? 0xff : 0
    this.wy = 0
    this.wx = 0
    this.line = 0
    this.lineTCycles = 0
    this.currentMode = postBoot ? 2 : 0
    this.transferEnd = 252
    this.statLine = false
    this.statWriteTCycles = 0
    this.completedFrames = 0
  }

  readRegister(address: number): number {
    switch (address) {
      case 0xff40:
        return this.lcdc
      case 0xff41:
        return 0x80 | this.statSelect | (this.ly === this.lyc ? 4 : 0) | this.currentMode
      case 0xff42:
        return this.scy
      case 0xff43:
        return this.scx
      case 0xff44:
        return this.ly
      case 0xff45:
        return this.lyc
      case 0xff47:
        return this.bgp
      case 0xff48:
        return this.obp0
      case 0xff49:
        return this.obp1
      case 0xff4a:
        return this.wy
      case 0xff4b:
        return this.wx
      default:
        return 0xff
    }
  }

  writeRegister(address: number, value: number): void {
    const byte = value & 0xff
    switch (address) {
      case 0xff40: {
        const wasEnabled = this.lcdEnabled
        this.lcdc = byte
        if (wasEnabled !== this.lcdEnabled) {
          this.line = 0
          this.lineTCycles = 0
          this.currentMode = this.lcdEnabled ? 2 : 0
          this.statWriteTCycles = 0
          this.statLine = false
          if (!this.lcdEnabled) this.framebuffer.fill(0)
        }
        this.updateStatLine()
        break
      }
      case 0xff41:
        // Escrita em STAT no DMG habilita transitoriamente todas as fontes.
        this.statWriteTCycles = this.lcdEnabled ? 4 : 0
        this.statSelect = byte & 0x78
        this.updateStatLine()
        break
      case 0xff42:
        this.scy = byte
        break
      case 0xff43:
        this.scx = byte
        break
      case 0xff44:
        break
      case 0xff45:
        this.lyc = byte
        this.updateStatLine()
        break
      case 0xff47:
        this.bgp = byte
        break
      case 0xff48:
        this.obp0 = byte
        break
      case 0xff49:
        this.obp1 = byte
        break
      case 0xff4a:
        this.wy = byte
        break
      case 0xff4b:
        this.wx = byte
        break
    }
  }

  tick(tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('A PPU exige uma quantidade inteira e não negativa de T-cycles.')
    }
    if (!this.lcdEnabled) return
    let remaining = tCycles
    while (remaining > 0) {
      let boundary = T_CYCLES_PER_LINE
      if (this.currentMode === 2) boundary = 80
      else if (this.currentMode === 3) boundary = this.transferEnd
      else if (this.line === 153 && this.lineTCycles < 4) boundary = 4
      let elapsed = Math.min(remaining, boundary - this.lineTCycles)
      if (this.statWriteTCycles > 0) elapsed = Math.min(elapsed, this.statWriteTCycles)
      this.lineTCycles += elapsed
      remaining -= elapsed
      this.statWriteTCycles = Math.max(0, this.statWriteTCycles - elapsed)
      if (this.lineTCycles === boundary) this.advanceBoundary()
      this.updateStatLine()
    }
  }

  snapshot(): PpuSnapshot {
    return {
      lcdc: this.lcdc,
      stat: this.readRegister(0xff41),
      ly: this.ly,
      lyc: this.lyc,
      scx: this.scx,
      scy: this.scy,
      wx: this.wx,
      wy: this.wy,
      mode: this.currentMode,
      lineTCycles: this.lineTCycles,
      frameId: this.completedFrames,
    }
  }

  private advanceBoundary(): void {
    if (this.currentMode === 2) {
      this.currentMode = 3
      this.transferEnd = 252 + (this.scx & 7)
    } else if (this.currentMode === 3) {
      this.renderLine()
      this.currentMode = 0
    } else if (this.lineTCycles === T_CYCLES_PER_LINE) {
      this.lineTCycles = 0
      this.line = (this.line + 1) % 154
      if (this.line === SCREEN_HEIGHT) {
        this.currentMode = 1
        this.completedFrames += 1
        this.requestInterrupt(0x01)
      } else if (this.line < SCREEN_HEIGHT) {
        this.currentMode = 2
      }
    }
  }

  private updateStatLine(): void {
    const selected = this.statWriteTCycles > 0 ? 0x78 : this.statSelect
    const high =
      this.lcdEnabled &&
      (((selected & 0x40) !== 0 && this.ly === this.lyc) ||
        ((selected & 0x20) !== 0 && this.currentMode === 2) ||
        ((selected & 0x10) !== 0 && this.currentMode === 1) ||
        ((selected & 0x08) !== 0 && this.currentMode === 0))
    if (high && !this.statLine) this.requestInterrupt(0x02)
    this.statLine = high
  }

  private renderLine(): void {
    const bgEnabled = (this.lcdc & 1) !== 0
    const mapBase = (this.lcdc & 8) !== 0 ? 0x1c00 : 0x1800
    const y = (this.line + this.scy) & 0xff
    const output = this.line * SCREEN_WIDTH
    for (let x = 0; x < SCREEN_WIDTH; x += 1) {
      const color = bgEnabled ? this.tilePixel(mapBase, (x + this.scx) & 0xff, y) : 0
      this.framebuffer[output + x] = (this.bgp >>> (color * 2)) & 3
    }
  }

  private tilePixel(mapBase: number, x: number, y: number): number {
    const tile = this.vram[mapBase + ((y >>> 3) << 5) + (x >>> 3)]!
    const tileBase = (this.lcdc & 0x10) !== 0 ? tile * 16 : 0x1000 + ((tile << 24) >> 24) * 16
    const row = tileBase + (y & 7) * 2
    const bit = 7 - (x & 7)
    return ((this.vram[row]! >>> bit) & 1) | (((this.vram[row + 1]! >>> bit) & 1) << 1)
  }
}
