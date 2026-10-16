import { stateBoolean, stateBytes, stateInteger, stateRecord } from '../state/validation'

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

export interface PpuState {
  readonly version: 1
  readonly vram: Uint8Array
  readonly oam: Uint8Array
  readonly framebuffer: Uint8Array
  readonly lcdc: number
  readonly statSelect: number
  readonly scy: number
  readonly scx: number
  readonly lyc: number
  readonly bgp: number
  readonly obp0: number
  readonly obp1: number
  readonly wy: number
  readonly wx: number
  readonly line: number
  readonly lineTCycles: number
  readonly mode: PpuMode
  readonly transferEnd: number
  readonly statLine: boolean
  readonly statWriteTCycles: number
  readonly frameId: number
  readonly windowYTriggered: boolean
  readonly windowLine: number
  readonly selectedObjects: Uint8Array
  readonly selectedObjectCount: number
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
    for (let elapsed = 0; elapsed < tCycles; elapsed += 1) {
      this.tickCycle()
    }
  }

  /** Um dot interno, sem reconstruir um intervalo para cada chamada do bus. */
  tickCycle(): void {
    if (!this.lcdEnabled) return
    if (this.currentMode === 2 && this.lineTCycles === 0 && this.line === this.wy) {
      this.windowYTriggered = true
    }
    let boundary = T_CYCLES_PER_LINE
    if (this.currentMode === 2) boundary = 80
    else if (this.currentMode === 3) boundary = this.transferEnd
    else if (this.line === 153 && this.lineTCycles < 4) boundary = 4
    this.lineTCycles += 1
    if (this.statWriteTCycles > 0) this.statWriteTCycles -= 1
    if (this.lineTCycles === boundary) this.advanceBoundary()
    this.updateStatLine()
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

  snapshotState(): PpuState {
    return {
      version: 1,
      vram: this.vram.slice(),
      oam: this.oam.slice(),
      framebuffer: this.framebuffer.slice(),
      lcdc: this.lcdc,
      statSelect: this.statSelect,
      scy: this.scy,
      scx: this.scx,
      lyc: this.lyc,
      bgp: this.bgp,
      obp0: this.obp0,
      obp1: this.obp1,
      wy: this.wy,
      wx: this.wx,
      line: this.line,
      lineTCycles: this.lineTCycles,
      mode: this.currentMode,
      transferEnd: this.transferEnd,
      statLine: this.statLine,
      statWriteTCycles: this.statWriteTCycles,
      frameId: this.completedFrames,
      windowYTriggered: this.windowYTriggered,
      windowLine: this.windowLine,
      selectedObjects: this.selectedObjects.slice(),
      selectedObjectCount: this.selectedObjectCount,
    }
  }

  /** Aplica um estado completo sem escrever registradores nem refazer bordas de STAT. */
  restoreState(value: unknown): void {
    const state = stateRecord(value, 'ppu')
    const valid: PpuState = {
      version: stateInteger(state.version, 1, 1, 'ppu.version') as 1,
      vram: stateBytes(state.vram, 0x2000, 'ppu.vram'),
      oam: stateBytes(state.oam, 0xa0, 'ppu.oam'),
      framebuffer: stateBytes(state.framebuffer, SCREEN_WIDTH * SCREEN_HEIGHT, 'ppu.framebuffer'),
      lcdc: stateInteger(state.lcdc, 0, 0xff, 'ppu.lcdc'),
      statSelect: stateInteger(state.statSelect, 0, 0x78, 'ppu.statSelect'),
      scy: stateInteger(state.scy, 0, 0xff, 'ppu.scy'),
      scx: stateInteger(state.scx, 0, 0xff, 'ppu.scx'),
      lyc: stateInteger(state.lyc, 0, 0xff, 'ppu.lyc'),
      bgp: stateInteger(state.bgp, 0, 0xff, 'ppu.bgp'),
      obp0: stateInteger(state.obp0, 0, 0xff, 'ppu.obp0'),
      obp1: stateInteger(state.obp1, 0, 0xff, 'ppu.obp1'),
      wy: stateInteger(state.wy, 0, 0xff, 'ppu.wy'),
      wx: stateInteger(state.wx, 0, 0xff, 'ppu.wx'),
      line: stateInteger(state.line, 0, 153, 'ppu.line'),
      lineTCycles: stateInteger(state.lineTCycles, 0, T_CYCLES_PER_LINE - 1, 'ppu.lineTCycles'),
      mode: stateInteger(state.mode, 0, 3, 'ppu.mode') as PpuMode,
      // Inclui a duração máxima alcançável pelo renderizador por scanline atual.
      transferEnd: stateInteger(state.transferEnd, 252, 375, 'ppu.transferEnd'),
      statLine: stateBoolean(state.statLine, 'ppu.statLine'),
      statWriteTCycles: stateInteger(state.statWriteTCycles, 0, 4, 'ppu.statWriteTCycles'),
      frameId: stateInteger(state.frameId, 0, Number.MAX_SAFE_INTEGER, 'ppu.frameId'),
      windowYTriggered: stateBoolean(state.windowYTriggered, 'ppu.windowYTriggered'),
      windowLine: stateInteger(state.windowLine, 0, SCREEN_HEIGHT, 'ppu.windowLine'),
      selectedObjects: stateBytes(state.selectedObjects, 10, 'ppu.selectedObjects'),
      selectedObjectCount: stateInteger(
        state.selectedObjectCount,
        0,
        10,
        'ppu.selectedObjectCount',
      ),
    }
    if ((valid.statSelect & 0x87) !== 0) {
      throw new Error('Estado inválido: bits reservados na seleção STAT.')
    }
    if (valid.framebuffer.some((pixel) => pixel > 3)) {
      throw new Error('Estado inválido: pixels da PPU devem estar entre zero e três.')
    }
    let selectedMask = 0n
    for (let index = 0; index < valid.selectedObjects.length; index += 1) {
      const object = valid.selectedObjects[index]!
      if (object > 39) throw new Error('Estado inválido: índice de objeto da PPU fora de OAM.')
      if (index >= valid.selectedObjectCount) continue
      const bit = 1n << BigInt(object)
      if ((selectedMask & bit) !== 0n)
        throw new Error('Estado inválido: objeto selecionado repetido.')
      selectedMask |= bit
    }
    const enabled = (valid.lcdc & 0x80) !== 0
    if (!enabled) {
      if (
        valid.mode !== 0 ||
        valid.line !== 0 ||
        valid.lineTCycles !== 0 ||
        valid.statWriteTCycles !== 0 ||
        valid.windowYTriggered ||
        valid.windowLine !== 0 ||
        valid.selectedObjectCount !== 0
      ) {
        throw new Error('Estado inválido: contadores da PPU incompatíveis com LCD desligado.')
      }
    } else {
      const expectedMode: PpuMode =
        valid.line >= SCREEN_HEIGHT
          ? 1
          : valid.lineTCycles < 80
            ? 2
            : valid.lineTCycles < valid.transferEnd
              ? 3
              : 0
      if (valid.mode !== expectedMode)
        throw new Error('Estado inválido: modo e fase da PPU divergem.')
    }
    if (
      (!valid.windowYTriggered && valid.windowLine !== 0) ||
      (valid.line >= SCREEN_HEIGHT && (valid.windowYTriggered || valid.windowLine !== 0)) ||
      (valid.line < SCREEN_HEIGHT && valid.windowLine > valid.line + (valid.mode === 0 ? 1 : 0))
    ) {
      throw new Error('Estado inválido: contador interno da janela incompatível com a linha.')
    }
    const ly = valid.line === 153 && valid.lineTCycles >= 4 ? 0 : valid.line
    const selected = valid.statWriteTCycles > 0 ? 0x78 : valid.statSelect
    const statHigh =
      enabled &&
      (((selected & 0x40) !== 0 && ly === valid.lyc) ||
        ((selected & 0x20) !== 0 && valid.mode === 2) ||
        ((selected & 0x10) !== 0 && valid.mode === 1) ||
        ((selected & 0x08) !== 0 && valid.mode === 0))
    if (valid.statLine !== statHigh)
      throw new Error('Estado inválido: nível interno de STAT divergente.')

    this.vram.set(valid.vram)
    this.oam.set(valid.oam)
    this.framebuffer.set(valid.framebuffer)
    this.lcdc = valid.lcdc
    this.statSelect = valid.statSelect
    this.scy = valid.scy
    this.scx = valid.scx
    this.lyc = valid.lyc
    this.bgp = valid.bgp
    this.obp0 = valid.obp0
    this.obp1 = valid.obp1
    this.wy = valid.wy
    this.wx = valid.wx
    this.line = valid.line
    this.lineTCycles = valid.lineTCycles
    this.currentMode = valid.mode
    this.transferEnd = valid.transferEnd
    this.statLine = valid.statLine
    this.statWriteTCycles = valid.statWriteTCycles
    this.completedFrames = valid.frameId
    this.windowYTriggered = valid.windowYTriggered
    this.windowLine = valid.windowLine
    this.selectedObjects.set(valid.selectedObjects)
    this.selectedObjectCount = valid.selectedObjectCount
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
