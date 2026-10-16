import { describe, expect, it } from 'vitest'
import { Ppu, T_CYCLES_PER_FRAME, type PpuState } from '../../src/core/ppu'

function createPpu() {
  const interrupts: number[] = []
  const ppu = new Ppu((mask) => interrupts.push(mask))
  ppu.writeRegister(0xff40, 0)
  for (let index = 0; index < ppu.vram.length; index += 1) {
    ppu.vram[index] = (index * 37 + 11) & 0xff
  }
  for (let object = 0; object < 12; object += 1) {
    ppu.oam.set([16, 8 + ((object * 13) % 150), object * 2, (object & 3) << 4], object * 4)
  }
  ppu.writeRegister(0xff47, 0xe4)
  ppu.writeRegister(0xff48, 0xe4)
  ppu.writeRegister(0xff49, 0x1b)
  ppu.writeRegister(0xff42, 19)
  ppu.writeRegister(0xff43, 3)
  ppu.writeRegister(0xff4a, 2)
  ppu.writeRegister(0xff4b, 40)
  ppu.writeRegister(0xff40, 0xf7)
  ppu.writeRegister(0xff41, 0x78)
  return { ppu, interrupts }
}

describe('Snapshot completo da PPU', () => {
  it.each([
    0,
    79,
    80,
    120,
    400,
    456 * 9 + 200,
    456 * 144 + 133,
    456 * 153 + 3,
    456 * 153 + 4,
    T_CYCLES_PER_FRAME - 1,
  ])('retoma renderização e IRQ sem desvio a partir do T-cycle %i', (elapsed) => {
    const original = createPpu()
    original.ppu.tick(elapsed)
    const interrupts: number[] = []
    const restored = new Ppu((mask) => interrupts.push(mask))
    restored.restoreState(original.ppu.snapshotState())
    expect(interrupts).toEqual([])
    expect(restored.snapshotState()).toEqual(original.ppu.snapshotState())
    original.interrupts.length = 0
    for (const tCycles of [1, 3, 16, 80, 200, 456, 1000, T_CYCLES_PER_FRAME * 2]) {
      original.ppu.tick(tCycles)
      restored.tick(tCycles)
      expect(restored.snapshotState()).toEqual(original.ppu.snapshotState())
      expect(interrupts).toEqual(original.interrupts)
    }
  })

  it('preserva o glitch transitório de STAT sem repetir a borda já publicada', () => {
    const original = new Ppu()
    original.tick(300)
    original.writeRegister(0xff41, 0)
    original.tick(1)
    const interrupts: number[] = []
    const restored = new Ppu((mask) => interrupts.push(mask))
    restored.restoreState(original.snapshotState())
    expect(restored.snapshotState().statWriteTCycles).toBe(3)
    expect(restored.snapshotState().statLine).toBe(true)
    expect(interrupts).toEqual([])
    restored.tick(2)
    expect(restored.snapshotState().statLine).toBe(true)
    restored.tick(1)
    expect(restored.snapshotState().statLine).toBe(false)
    expect(interrupts).toEqual([])
    restored.writeRegister(0xff41, 0)
    expect(interrupts).toEqual([2])
  })

  it('copia VRAM, OAM, imagem e seleção interna nas duas direções', () => {
    const { ppu } = createPpu()
    ppu.tick(400)
    const saved = ppu.snapshotState()
    const before = saved.vram[0]
    ppu.vram[0] = ppu.vram[0]! ^ 0xff
    expect(saved.vram[0]).toBe(before)
    const restored = new Ppu()
    restored.restoreState(saved)
    const expected = restored.snapshotState()
    saved.vram.fill(0)
    saved.oam.fill(0)
    saved.framebuffer.fill(0)
    saved.selectedObjects.fill(39)
    expect(restored.snapshotState()).toEqual(expected)
    restored.oam.fill(77)
    expect(saved.oam.every((value) => value === 0)).toBe(true)
  })

  it('retoma LCD desligado e reset sem transformar a restauração em uma escrita LCDC', () => {
    const { ppu } = createPpu()
    ppu.tick(900)
    ppu.writeRegister(0xff40, 0x17)
    const interrupts: number[] = []
    const restored = new Ppu((mask) => interrupts.push(mask))
    restored.restoreState(ppu.snapshotState())
    restored.tick(T_CYCLES_PER_FRAME)
    expect(restored.snapshotState()).toEqual(ppu.snapshotState())
    expect(interrupts).toEqual([])
    for (const postBoot of [false, true]) {
      ppu.reset(postBoot)
      restored.restoreState(ppu.snapshotState())
      expect(restored.snapshotState()).toEqual(ppu.snapshotState())
    }
  })

  it('preserva a janela já ativada quando WY muda e objetos selecionados antes de DMA', () => {
    const { ppu } = createPpu()
    ppu.tick(456 * 3 + 100)
    ppu.writeRegister(0xff4a, 200)
    ppu.oam.fill(0)
    const state = ppu.snapshotState()
    expect(state.windowYTriggered).toBe(true)
    expect(state.selectedObjectCount).toBe(10)
    const restored = new Ppu()
    restored.restoreState(state)
    ppu.tick(1000)
    restored.tick(1000)
    expect(restored.snapshotState()).toEqual(ppu.snapshotState())
  })

  const invalidFields: [keyof PpuState, unknown][] = [
    ['version', 2],
    ['vram', new Uint8Array(0x1fff)],
    ['oam', new Uint8Array(159)],
    ['framebuffer', new Uint8Array(160 * 144 + 1)],
    ['lcdc', 256],
    ['statSelect', 0x80],
    ['scy', -1],
    ['scx', NaN],
    ['lyc', 256],
    ['bgp', '228'],
    ['obp0', Infinity],
    ['obp1', 0.5],
    ['wy', null],
    ['wx', undefined],
    ['line', 154],
    ['lineTCycles', 456],
    ['mode', 4],
    ['transferEnd', 376],
    ['statLine', 1],
    ['statWriteTCycles', 5],
    ['frameId', Number.MAX_SAFE_INTEGER + 1],
    ['windowYTriggered', 'true'],
    ['windowLine', 145],
    ['selectedObjects', new Uint8Array(9)],
    ['selectedObjectCount', 11],
  ]

  it.each(invalidFields)(
    'rejeita %s inválido sem tocar buffers ou registradores',
    (field, value) => {
      const { ppu, interrupts } = createPpu()
      ppu.tick(456 * 3 + 120)
      const before = ppu.snapshotState()
      interrupts.length = 0
      expect(() => ppu.restoreState({ ...before, [field]: value })).toThrow()
      expect(ppu.snapshotState()).toEqual(before)
      expect(interrupts).toEqual([])
    },
  )

  it('rejeita fases incoerentes e conteúdo inválido antes de aplicar qualquer campo', () => {
    const { ppu, interrupts } = createPpu()
    ppu.tick(456 * 3 + 120)
    const before = ppu.snapshotState()
    const pixels = before.framebuffer.slice()
    pixels[0] = 4
    const repeated = before.selectedObjects.slice()
    repeated[1] = repeated[0]!
    const outside = before.selectedObjects.slice()
    outside[9] = 40
    interrupts.length = 0
    for (const state of [
      null,
      {},
      { ...before, vram: Array.from(before.vram) },
      { ...before, statSelect: 1 },
      { ...before, framebuffer: pixels },
      { ...before, selectedObjects: repeated },
      { ...before, selectedObjects: outside },
      { ...before, mode: 2 },
      { ...before, lcdc: before.lcdc & 0x7f },
      { ...before, windowYTriggered: false },
      { ...before, windowLine: 5 },
      { ...before, statLine: !before.statLine },
      { ...before, vram: new Uint8Array(0x2000), scx: 99, selectedObjectCount: -1 },
    ]) {
      expect(() => ppu.restoreState(state)).toThrow()
      expect(ppu.snapshotState()).toEqual(before)
      expect(interrupts).toEqual([])
    }
  })
})
