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
  private windowYTriggered = false
  private windowLine = 0
  private readonly selectedObjects = new Uint8Array(10)
  private selectedObjectCount = 0

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
    this.windowYTriggered = false
    this.windowLine = 0
    this.selectedObjectCount = 0
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
          this.windowYTriggered = false
          this.windowLine = 0
          this.selectedObjectCount = 0
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
    if (tCycles > 0 && this.currentMode === 2 && this.lineTCycles === 0 && this.line === this.wy) {
      this.windowYTriggered = true
    }
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
      this.selectObjects()
      this.currentMode = 3
      this.transferEnd = this.computeTransferEnd()
    } else if (this.currentMode === 3) {
      this.renderLine()
      this.currentMode = 0
    } else if (this.lineTCycles === T_CYCLES_PER_LINE) {
      this.lineTCycles = 0
      this.line = (this.line + 1) % 154
      if (this.line === SCREEN_HEIGHT) {
        this.currentMode = 1
        this.completedFrames += 1
        this.windowYTriggered = false
        this.windowLine = 0
        this.requestInterrupt(0x01)
      } else if (this.line < SCREEN_HEIGHT) {
        this.currentMode = 2
        if (this.line === this.wy) this.windowYTriggered = true
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
    const windowMapBase = (this.lcdc & 0x40) !== 0 ? 0x1c00 : 0x1800
    const windowVisible = this.isWindowVisible()
    const windowX = this.wx - 7
    const y = (this.line + this.scy) & 0xff
    const output = this.line * SCREEN_WIDTH
    for (let x = 0; x < SCREEN_WIDTH; x += 1) {
      let color = 0
      if (bgEnabled) {
        color =
          windowVisible && x >= windowX
            ? this.tilePixel(windowMapBase, x - windowX, this.windowLine)
            : this.tilePixel(mapBase, (x + this.scx) & 0xff, y)
      }
      const shade = bgEnabled ? (this.bgp >>> (color * 2)) & 3 : 0
      this.framebuffer[output + x] = this.objectShade(x, color, shade)
    }
    if (windowVisible) this.windowLine += 1
  }

  private isWindowVisible(): boolean {
    return (this.lcdc & 0x21) === 0x21 && this.windowYTriggered && this.wx <= 166
  }

  private selectObjects(): void {
    this.selectedObjectCount = 0
    const height = (this.lcdc & 4) !== 0 ? 16 : 8
    // A seleção usa apenas Y, inclusive para objetos fora da tela em X.
    for (let object = 0; object < 40 && this.selectedObjectCount < 10; object += 1) {
      const y = this.oam[object * 4]! - 16
      if (this.line < y || this.line >= y + height) continue
      // Insertion sort estável: menor X primeiro, empate mantém ordem em OAM.
      let insertion = this.selectedObjectCount
      const x = this.oam[object * 4 + 1]!
      while (insertion > 0) {
        const previous = this.selectedObjects[insertion - 1]!
        if (this.oam[previous * 4 + 1]! <= x) break
        this.selectedObjects[insertion] = previous
        insertion -= 1
      }
      this.selectedObjects[insertion] = object
      this.selectedObjectCount += 1
    }
  }

  private computeTransferEnd(): number {
    let end = 252 + (this.scx & 7)
    const windowVisible = this.isWindowVisible()
    if (windowVisible) end += 6
    if ((this.lcdc & 2) === 0) return end
    let previousTile = -1
    for (let index = 0; index < this.selectedObjectCount; index += 1) {
      const object = this.selectedObjects[index]!
      const oamX = this.oam[object * 4 + 1]!
      if (oamX === 0) {
        end += 11
        continue
      }
      if (oamX >= 168) continue
      const x = oamX - 8
      const inWindow = windowVisible && x >= this.wx - 7
      const tileX = inWindow ? x - (this.wx - 7) : (x + this.scx) & 0xff
      const tile = (tileX >>> 3) + (inWindow ? 32 : 0)
      if (tile !== previousTile) end += Math.max(0, 5 - (tileX & 7))
      end += 6
      previousTile = tile
    }
    return end
  }

  private objectShade(x: number, backgroundColor: number, backgroundShade: number): number {
    if ((this.lcdc & 2) === 0) return backgroundShade
    const height = (this.lcdc & 4) !== 0 ? 16 : 8
    for (let index = 0; index < this.selectedObjectCount; index += 1) {
      const offset = this.selectedObjects[index]! * 4
      const left = this.oam[offset + 1]! - 8
      if (x < left || x >= left + 8) continue
      const flags = this.oam[offset + 3]!
      let row = this.line - (this.oam[offset]! - 16)
      if ((flags & 0x40) !== 0) row = height - 1 - row
      let tile = this.oam[offset + 2]!
      if (height === 16) tile = (tile & 0xfe) + (row >>> 3)
      const address = tile * 16 + (row & 7) * 2
      const bit = (flags & 0x20) !== 0 ? x - left : 7 - (x - left)
      const color =
        ((this.vram[address]! >>> bit) & 1) | (((this.vram[address + 1]! >>> bit) & 1) << 1)
      if (color === 0) continue
      // Primeiro resolve OBJ contra OBJ; só então o vencedor disputa com BG.
      if ((flags & 0x80) !== 0 && backgroundColor !== 0) return backgroundShade
      const palette = (flags & 0x10) !== 0 ? this.obp1 : this.obp0
      return (palette >>> (color * 2)) & 3
    }
    return backgroundShade
  }

  private tilePixel(mapBase: number, x: number, y: number): number {
    const tile = this.vram[mapBase + ((y >>> 3) << 5) + (x >>> 3)]!
    const tileBase = (this.lcdc & 0x10) !== 0 ? tile * 16 : 0x1000 + ((tile << 24) >> 24) * 16
    const row = tileBase + (y & 7) * 2
    const bit = 7 - (x & 7)
    return ((this.vram[row]! >>> bit) & 1) | (((this.vram[row + 1]! >>> bit) & 1) << 1)
  }
}
