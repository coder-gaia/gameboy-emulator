import { describe, expect, it } from 'vitest'
import { Ppu, T_CYCLES_PER_FRAME } from '../../src/core/ppu'

function createPpu() {
  const interrupts: number[] = []
  const ppu = new Ppu((mask) => interrupts.push(mask))
  ppu.writeRegister(0xff47, 0xe4)
  return { ppu, interrupts }
}

function setTileRow(ppu: Ppu, offset: number, pixels: number[]): void {
  let low = 0
  let high = 0
  pixels.forEach((color, x) => {
    low |= (color & 1) << (7 - x)
    high |= (color >>> 1) << (7 - x)
  })
  ppu.vram[offset] = low
  ppu.vram[offset + 1] = high
}

describe('Ppu DMG: modos e registradores', () => {
  it('alterna modos 2, 3 e 0 em uma linha de 456 T-cycles', () => {
    const { ppu } = createPpu()
    expect(ppu.mode).toBe(2)
    ppu.tick(79)
    expect(ppu.mode).toBe(2)
    ppu.tick(1)
    expect(ppu.mode).toBe(3)
    ppu.tick(171)
    expect(ppu.mode).toBe(3)
    ppu.tick(1)
    expect(ppu.mode).toBe(0)
    ppu.tick(203)
    expect(ppu.ly).toBe(0)
    ppu.tick(1)
    expect(ppu.mode).toBe(2)
    expect(ppu.ly).toBe(1)
  })

  it('entra em VBlank ao concluir a imagem e mantém dez linhas de intervalo', () => {
    const { ppu, interrupts } = createPpu()
    ppu.tick(456 * 144)
    expect(ppu.mode).toBe(1)
    expect(ppu.ly).toBe(144)
    expect(ppu.frameId).toBe(1)
    expect(interrupts).toEqual([1])
    ppu.tick(456 * 10)
    expect(ppu.mode).toBe(2)
    expect(ppu.ly).toBe(0)
    ppu.tick(T_CYCLES_PER_FRAME)
    expect(ppu.frameId).toBe(2)
    expect(interrupts).toEqual([1, 1])
  })

  it('zera LY no quarto T-cycle da linha 153 mantendo modo 1', () => {
    const { ppu } = createPpu()
    ppu.tick(456 * 153 + 3)
    expect(ppu.ly).toBe(153)
    ppu.tick(1)
    expect(ppu.ly).toBe(0)
    expect(ppu.mode).toBe(1)
    ppu.tick(452)
    expect(ppu.mode).toBe(2)
    expect(ppu.ly).toBe(0)
  })

  it('desliga LCD, libera os modos e permanece em LY zero até religar', () => {
    const { ppu } = createPpu()
    ppu.tick(900)
    ppu.framebuffer.fill(3)
    ppu.writeRegister(0xff40, 0x11)
    expect(ppu.lcdEnabled).toBe(false)
    expect(ppu.mode).toBe(0)
    expect(ppu.ly).toBe(0)
    expect(ppu.framebuffer.every((pixel) => pixel === 0)).toBe(true)
    ppu.tick(T_CYCLES_PER_FRAME)
    expect(ppu.frameId).toBe(0)
    expect(ppu.ly).toBe(0)
    ppu.writeRegister(0xff40, 0x91)
    expect(ppu.mode).toBe(2)
    ppu.tick(456)
    expect(ppu.ly).toBe(1)
  })

  it('preserva campos somente leitura de STAT e ignora escritas em LY', () => {
    const { ppu } = createPpu()
    expect(ppu.readRegister(0xff41)).toBe(0x86)
    ppu.writeRegister(0xff41, 0xff)
    expect(ppu.readRegister(0xff41)).toBe(0xfe)
    ppu.writeRegister(0xff44, 50)
    expect(ppu.ly).toBe(0)
    ppu.writeRegister(0xff45, 1)
    expect(ppu.readRegister(0xff41) & 4).toBe(0)
    ppu.tick(456)
    expect(ppu.readRegister(0xff41) & 4).toBe(4)
    expect(ppu.readRegister(0xff46)).toBe(0xff)
  })

  it('solicita STAT apenas na subida da combinação das fontes', () => {
    const { ppu, interrupts } = createPpu()
    ppu.writeRegister(0xff41, 0x28)
    expect(interrupts).toEqual([2])
    ppu.tick(252)
    expect(interrupts).toEqual([2, 2])
    // Modo 0 e modo 2 adjacentes mantêm a mesma linha STAT alta.
    ppu.tick(204)
    expect(interrupts).toEqual([2, 2])
    ppu.tick(252)
    expect(interrupts).toEqual([2, 2, 2])
  })

  it('atualiza coincidência e interrupção ao escrever LYC', () => {
    const { ppu, interrupts } = createPpu()
    ppu.writeRegister(0xff45, 10)
    ppu.tick(80)
    ppu.writeRegister(0xff41, 0x40)
    expect(interrupts).toEqual([])
    ppu.tick(4)
    ppu.writeRegister(0xff45, 0)
    expect(interrupts).toEqual([2])
    ppu.writeRegister(0xff45, 0)
    expect(interrupts).toEqual([2])
    ppu.writeRegister(0xff45, 1)
    ppu.tick(456 - 84)
    expect(interrupts).toEqual([2, 2])
  })

  it('reproduz interrupção transitória de escrita STAT no DMG', () => {
    const { ppu, interrupts } = createPpu()
    ppu.writeRegister(0xff45, 10)
    ppu.writeRegister(0xff41, 0)
    expect(interrupts).toEqual([2])
    ppu.tick(4)
    ppu.writeRegister(0xff41, 0)
    expect(interrupts).toEqual([2, 2])
    ppu.tick(76)
    ppu.writeRegister(0xff41, 0)
    expect(interrupts).toEqual([2, 2])
  })

  it('faz reset sem depender de APIs de navegador', () => {
    const { ppu } = createPpu()
    ppu.vram.fill(2)
    ppu.oam.fill(3)
    ppu.tick(T_CYCLES_PER_FRAME)
    ppu.reset(false)
    expect(ppu.lcdEnabled).toBe(false)
    expect(ppu.frameId).toBe(0)
    expect(ppu.vram.every((byte) => byte === 0)).toBe(true)
    expect(ppu.oam.every((byte) => byte === 0)).toBe(true)
    ppu.reset()
    expect(ppu.readRegister(0xff40)).toBe(0x91)
    expect(ppu.mode).toBe(2)
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'recusa T-cycles inválidos: %s',
    (cycles) => expect(() => createPpu().ppu.tick(cycles)).toThrow(/T-cycles/),
  )
})

describe('Ppu DMG: fundo', () => {
  it('decodifica os dois planos de bits de tiles e aplica BGP', () => {
    const { ppu } = createPpu()
    setTileRow(ppu, 0, [0, 1, 2, 3, 3, 2, 1, 0])
    ppu.writeRegister(0xff47, 0x1b)
    ppu.tick(456)
    expect(Array.from(ppu.framebuffer.subarray(0, 8))).toEqual([3, 2, 1, 0, 0, 1, 2, 3])
  })

  it('endereça tiles assinados em 9000 incluindo índices 80 e FF', () => {
    const { ppu } = createPpu()
    ppu.writeRegister(0xff40, 0x81)
    ppu.vram[0x1800] = 0x80
    ppu.vram[0x1801] = 0xff
    ppu.vram[0x1802] = 0
    setTileRow(ppu, 0x800, Array(8).fill(1))
    setTileRow(ppu, 0xff0, Array(8).fill(2))
    setTileRow(ppu, 0x1000, Array(8).fill(3))
    ppu.tick(456)
    expect(Array.from(ppu.framebuffer.subarray(0, 24))).toEqual([
      ...Array(8).fill(1),
      ...Array(8).fill(2),
      ...Array(8).fill(3),
    ])
  })

  it('seleciona mapa 9C00 e scroll com retorno em X e Y', () => {
    const { ppu } = createPpu()
    ppu.writeRegister(0xff40, 0x99)
    ppu.writeRegister(0xff42, 255)
    ppu.writeRegister(0xff43, 255)
    ppu.vram[0x1fff] = 1
    ppu.vram[0x1fe0] = 2
    ppu.vram[0x1c1f] = 3
    ppu.vram[0x1c00] = 4
    setTileRow(ppu, 16 + 14, Array(8).fill(1))
    setTileRow(ppu, 32 + 14, Array(8).fill(2))
    setTileRow(ppu, 48, Array(8).fill(3))
    setTileRow(ppu, 64, Array(8).fill(1))
    ppu.tick(456 * 2)
    expect(Array.from(ppu.framebuffer.subarray(0, 3))).toEqual([1, 2, 2])
    expect(Array.from(ppu.framebuffer.subarray(160, 163))).toEqual([3, 1, 1])
  })

  it('incorpora SCX fino no período de transferência mantendo 456 por linha', () => {
    const { ppu } = createPpu()
    ppu.writeRegister(0xff43, 7)
    ppu.tick(258)
    expect(ppu.mode).toBe(3)
    ppu.tick(1)
    expect(ppu.mode).toBe(0)
    ppu.tick(197)
    expect(ppu.ly).toBe(1)
    expect(ppu.mode).toBe(2)
  })

  it('mantém fundo desligado branco independentemente de BGP', () => {
    const { ppu } = createPpu()
    ppu.vram.fill(0xff, 0, 16)
    ppu.writeRegister(0xff40, 0x90)
    ppu.writeRegister(0xff47, 0xe7)
    ppu.tick(456)
    // LCDC.0 no DMG apaga BG e janela; BGP não recolore a tela em branco.
    expect(ppu.framebuffer.subarray(0, 160).every((pixel) => pixel === 0)).toBe(true)
  })

  it('produz quadros determinísticos com ticks agrupados ou pequenos', () => {
    const first = createPpu().ppu
    const second = createPpu().ppu
    for (let offset = 0; offset < first.vram.length; offset += 1) {
      first.vram[offset] = (offset * 37 + 11) & 0xff
    }
    second.vram.set(first.vram)
    first.tick(T_CYCLES_PER_FRAME)
    for (let cycle = 0; cycle < T_CYCLES_PER_FRAME; cycle += 4) second.tick(4)
    expect(second.framebuffer).toEqual(first.framebuffer)
    expect(second.snapshot()).toEqual(first.snapshot())
  })
})
