import { describe, expect, it } from 'vitest'
import { Ppu } from '../../src/core/ppu'

function createPpu(): Ppu {
  const ppu = new Ppu()
  ppu.writeRegister(0xff47, 0xe4)
  ppu.writeRegister(0xff48, 0xe4)
  ppu.writeRegister(0xff49, 0xe4)
  ppu.writeRegister(0xff40, 0x93)
  return ppu
}

function fillTile(ppu: Ppu, tile: number, color: number): void {
  for (let row = 0; row < 8; row += 1) {
    ppu.vram[tile * 16 + row * 2] = (color & 1) !== 0 ? 0xff : 0
    ppu.vram[tile * 16 + row * 2 + 1] = (color & 2) !== 0 ? 0xff : 0
  }
}

function object(ppu: Ppu, index: number, x: number, y: number, tile: number, flags = 0): void {
  ppu.oam.set([y + 16, x + 8, tile, flags], index * 4)
}

function pixels(ppu: Ppu, x: number, y: number, count: number): number[] {
  const start = y * 160 + x
  return Array.from(ppu.framebuffer.subarray(start, start + count))
}

describe('Ppu DMG: objetos', () => {
  it('aplica OBP0 e OBP1 mantendo cor zero transparente', () => {
    const ppu = createPpu()
    fillTile(ppu, 0, 2)
    ppu.vram[16] = 0x60
    ppu.vram[17] = 0x20
    ppu.writeRegister(0xff48, 0x1b)
    ppu.writeRegister(0xff49, 0x93)
    object(ppu, 0, 0, 0, 1)
    object(ppu, 1, 8, 0, 1, 0x10)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 4)).toEqual([2, 2, 0, 2])
    expect(pixels(ppu, 8, 0, 4)).toEqual([2, 0, 2, 2])
  })

  it('seleciona os dez primeiros objetos por Y mesmo quando X está fora da tela', () => {
    const ppu = createPpu()
    fillTile(ppu, 1, 3)
    for (let index = 0; index < 10; index += 1) object(ppu, index, -8, 0, 1)
    object(ppu, 10, 0, 0, 1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 8)).toEqual(Array(8).fill(0))
    object(ppu, 0, -8, -16, 1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 1, 8)).toEqual(Array(8).fill(3))
  })

  it('prioriza menor X e depois menor endereço OAM', () => {
    const ppu = createPpu()
    fillTile(ppu, 1, 1)
    fillTile(ppu, 2, 2)
    fillTile(ppu, 3, 3)
    object(ppu, 0, 5, 0, 1)
    object(ppu, 1, 2, 0, 2)
    object(ppu, 2, 2, 0, 3)
    ppu.tick(456)
    expect(pixels(ppu, 2, 0, 11)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1])
  })

  it('deixa pixels transparentes revelarem objetos de menor prioridade', () => {
    const ppu = createPpu()
    fillTile(ppu, 1, 2)
    ppu.vram[32] = 0xf0
    object(ppu, 0, 0, 0, 2)
    object(ppu, 1, 0, 0, 1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 8)).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
  })

  it('resolve prioridade de objetos antes da prioridade contra o fundo', () => {
    const ppu = createPpu()
    fillTile(ppu, 0, 1)
    fillTile(ppu, 1, 2)
    fillTile(ppu, 2, 3)
    object(ppu, 0, 0, 0, 1, 0x80)
    object(ppu, 1, 0, 0, 2)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 8)).toEqual(Array(8).fill(1))
  })

  it('compara prioridade com cor original do fundo antes de aplicar BGP', () => {
    const ppu = createPpu()
    ppu.vram[0] = 0x0f
    ppu.writeRegister(0xff47, 0xe3)
    fillTile(ppu, 1, 2)
    object(ppu, 0, 0, 0, 1, 0x80)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 8)).toEqual([2, 2, 2, 2, 0, 0, 0, 0])
  })

  it('espelha horizontal e verticalmente e recorta sprites nas bordas', () => {
    const ppu = createPpu()
    ppu.vram[16] = 0x80
    ppu.vram[16 + 14 + 1] = 0x01
    object(ppu, 0, 0, 0, 1)
    object(ppu, 1, 8, 0, 1, 0x20)
    object(ppu, 2, 16, 0, 1, 0x40)
    object(ppu, 3, 24, 0, 1, 0x60)
    object(ppu, 4, -7, 0, 1, 0x20)
    object(ppu, 5, 159, 0, 1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 1)).toEqual([1])
    expect(pixels(ppu, 8, 0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(pixels(ppu, 16, 0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 2])
    expect(pixels(ppu, 24, 0, 8)).toEqual([2, 0, 0, 0, 0, 0, 0, 0])
    expect(pixels(ppu, 159, 0, 1)).toEqual([1])
  })

  it('ignora bit zero do tile 8x16 e espelha o objeto completo', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0x97)
    fillTile(ppu, 2, 1)
    fillTile(ppu, 3, 2)
    object(ppu, 0, 0, 0, 3)
    object(ppu, 1, 8, 0, 3, 0x40)
    ppu.tick(456 * 16)
    expect(pixels(ppu, 0, 0, 8)).toEqual(Array(8).fill(1))
    expect(pixels(ppu, 0, 8, 8)).toEqual(Array(8).fill(2))
    expect(pixels(ppu, 8, 0, 8)).toEqual(Array(8).fill(2))
    expect(pixels(ppu, 8, 8, 8)).toEqual(Array(8).fill(1))
  })

  it('desliga objetos sem desativar o fundo e mantém objetos com BG desativado', () => {
    const ppu = createPpu()
    fillTile(ppu, 0, 1)
    fillTile(ppu, 1, 2)
    object(ppu, 0, 0, 0, 1, 0x80)
    ppu.writeRegister(0xff40, 0x91)
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 8)).toEqual(Array(8).fill(1))
    ppu.writeRegister(0xff47, 0xff)
    ppu.writeRegister(0xff40, 0x92)
    ppu.tick(456)
    expect(pixels(ppu, 0, 1, 8)).toEqual(Array(8).fill(2))
    expect(pixels(ppu, 8, 1, 8)).toEqual(Array(8).fill(0))
  })
})

describe('Ppu DMG: janela', () => {
  it.each([144, 153, 255])('mantém WY=%s fora da tela nos quadros seguintes', (wy) => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf1)
    ppu.writeRegister(0xff4a, wy)
    ppu.writeRegister(0xff4b, 7)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    fillTile(ppu, 0, 1)
    fillTile(ppu, 1, 3)
    // O bus real avança um T-cycle por vez, incluindo o início do VBlank.
    for (let cycle = 0; cycle < 456 * 155; cycle += 1) ppu.tick(1)
    expect(pixels(ppu, 0, 0, 160)).toEqual(Array(160).fill(1))
  })

  it('posiciona janela em WX menos sete com mapa independente do fundo', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf1)
    ppu.writeRegister(0xff4a, 1)
    ppu.writeRegister(0xff4b, 15)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    fillTile(ppu, 0, 1)
    fillTile(ppu, 1, 3)
    ppu.tick(456 * 2)
    expect(pixels(ppu, 0, 0, 16)).toEqual(Array(16).fill(1))
    expect(pixels(ppu, 0, 1, 16)).toEqual([...Array(8).fill(1), ...Array(8).fill(3)])
  })

  it('pausa contador interno enquanto WX esconde a janela', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf1)
    ppu.writeRegister(0xff4b, 7)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    ppu.vram[16] = 0xff
    ppu.vram[16 + 2 + 1] = 0xff
    ppu.vram[16 + 4] = 0xff
    ppu.vram[16 + 4 + 1] = 0xff
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 8)).toEqual(Array(8).fill(1))
    ppu.writeRegister(0xff4b, 167)
    ppu.tick(456 * 5)
    expect(pixels(ppu, 0, 5, 8)).toEqual(Array(8).fill(0))
    ppu.writeRegister(0xff4b, 7)
    ppu.tick(456)
    expect(pixels(ppu, 0, 6, 8)).toEqual(Array(8).fill(2))
    ppu.writeRegister(0xff40, 0xd1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 7, 8)).toEqual(Array(8).fill(0))
    ppu.writeRegister(0xff40, 0xf1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 8, 8)).toEqual(Array(8).fill(3))
  })

  it('retém condição Y quando WY muda após o disparo', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf1)
    ppu.writeRegister(0xff4b, 7)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    fillTile(ppu, 1, 2)
    ppu.tick(456)
    ppu.writeRegister(0xff4a, 100)
    ppu.tick(456)
    expect(pixels(ppu, 0, 1, 8)).toEqual(Array(8).fill(2))
  })

  it('não inicia janela quando WY já passou sem coincidir com LY', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff4a, 100)
    ppu.writeRegister(0xff4b, 7)
    ppu.writeRegister(0xff40, 0xf1)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    fillTile(ppu, 1, 2)
    ppu.tick(456 * 10)
    ppu.writeRegister(0xff4a, 0)
    ppu.tick(456)
    expect(pixels(ppu, 0, 10, 8)).toEqual(Array(8).fill(0))
  })

  it('recorta pixels da esquerda para WX abaixo de sete', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf1)
    ppu.writeRegister(0xff4b, 3)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    ppu.vram[16] = 0x05
    ppu.vram[17] = 0x03
    ppu.tick(456)
    expect(pixels(ppu, 0, 0, 4)).toEqual([0, 1, 2, 3])
  })

  it('desativa janela junto com BG sem avançar seu contador', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf0)
    ppu.writeRegister(0xff4b, 7)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    ppu.vram[16] = 0xff
    ppu.vram[19] = 0xff
    ppu.tick(456 * 3)
    expect(pixels(ppu, 0, 2, 8)).toEqual(Array(8).fill(0))
    ppu.writeRegister(0xff40, 0xf1)
    ppu.tick(456)
    expect(pixels(ppu, 0, 3, 8)).toEqual(Array(8).fill(1))
  })

  it('zera contador da janela ao começar novo quadro', () => {
    const ppu = createPpu()
    ppu.writeRegister(0xff40, 0xf1)
    ppu.writeRegister(0xff4b, 7)
    ppu.vram.fill(1, 0x1c00, 0x2000)
    ppu.vram[16] = 0xff
    ppu.vram[19] = 0xff
    ppu.tick(456 * 154 + 456)
    expect(pixels(ppu, 0, 0, 8)).toEqual(Array(8).fill(1))
  })
})
