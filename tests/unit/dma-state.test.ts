import { describe, expect, it } from 'vitest'
import { OamDma, type OamDmaState } from '../../src/core/dma'

function createDma() {
  const oam = new Uint8Array(160)
  const operations: string[] = []
  const dma = new OamDma(
    (address) => {
      operations.push(`r:${address}`)
      return ((address & 0xff) ^ ((address >>> 8) * 3)) & 0xff
    },
    (address, value) => {
      operations.push(`w:${address}:${value}`)
      oam[address - 0xfe00] = value
    },
  )
  return { dma, oam, operations }
}

describe('Snapshot completo de OAM DMA', () => {
  it.each([0, 1, 7, 8, 9, 11, 12, 644, 647, 648])(
    'retoma latência e a cópia na fase de %i T-cycles',
    (elapsed) => {
      const original = createDma()
      original.dma.start(0x80)
      original.dma.tick(elapsed)
      const restored = createDma()
      restored.oam.set(original.oam)
      restored.dma.restoreState(original.dma.snapshotState())
      expect(restored.operations).toEqual([])
      expect(restored.dma.snapshotState()).toEqual(original.dma.snapshotState())
      original.operations.length = 0
      for (const tCycles of [1, 3, 5, 44, 600]) {
        original.dma.tick(tCycles)
        restored.dma.tick(tCycles)
        expect(restored.operations).toEqual(original.operations)
        expect(restored.oam).toEqual(original.oam)
        expect(restored.dma.snapshotState()).toEqual(original.dma.snapshotState())
      }
    },
  )

  it.each([0, 1, 3, 7, 8])(
    'preserva origem ativa e origem pendente durante reinício na fase %i',
    (elapsed) => {
      const original = createDma()
      original.dma.start(0x80)
      original.dma.tick(21)
      original.dma.start(0xc0)
      original.dma.tick(elapsed)
      const restored = createDma()
      restored.oam.set(original.oam)
      restored.dma.restoreState(original.dma.snapshotState())
      original.operations.length = 0
      expect(restored.operations).toEqual([])
      if (elapsed < 8) {
        expect(restored.dma.blocksCpuAddress(0x8000)).toBe(true)
        expect(restored.dma.blocksCpuAddress(0xc000)).toBe(false)
      } else {
        expect(restored.dma.blocksCpuAddress(0x8000)).toBe(false)
        expect(restored.dma.blocksCpuAddress(0xc000)).toBe(true)
      }
      for (const tCycles of [1, 3, 4, 640]) {
        original.dma.tick(tCycles)
        restored.dma.tick(tCycles)
        expect(restored.operations).toEqual(original.operations)
        expect(restored.oam).toEqual(original.oam)
        expect(restored.dma.snapshotState()).toEqual(original.dma.snapshotState())
      }
    },
  )

  it('aceita o estado inicial e a fonte espelhada de FF46 sem produzir operações', () => {
    const initial = createDma()
    initial.dma.restoreState(initial.dma.snapshotState())
    expect(initial.operations).toEqual([])
    initial.dma.start(0xff)
    initial.dma.tick(9)
    const restored = createDma()
    restored.dma.restoreState(initial.dma.snapshotState())
    expect(restored.dma.snapshotState().source).toBe(0xdf00)
    expect(restored.operations).toEqual([])
  })

  const invalidFields: [keyof OamDmaState, unknown][] = [
    ['version', 0],
    ['source', 0xe000],
    ['pendingSource', -256],
    ['startupTCycles', 9],
    ['byteTCycles', 4],
    ['index', 161],
    ['transferring', 1],
    ['register', 256],
  ]

  it.each(invalidFields)('rejeita %s inválido antes de alterar a transferência', (field, value) => {
    const { dma, operations } = createDma()
    dma.start(0x80)
    dma.tick(13)
    const before = dma.snapshotState()
    operations.length = 0
    expect(() => dma.restoreState({ ...before, [field]: value })).toThrow()
    expect(dma.snapshotState()).toEqual(before)
    expect(operations).toEqual([])
  })

  it('rejeita desalinhamento e fases inconsistentes sem modificar o estado', () => {
    const { dma, operations } = createDma()
    dma.start(0x80)
    dma.tick(13)
    const before = dma.snapshotState()
    operations.length = 0
    for (const state of [
      null,
      {},
      { ...before, source: 0x8001 },
      { ...before, pendingSource: 0x8001 },
      { ...before, index: 160 },
      { ...before, transferring: false },
      { ...before, pendingSource: 0xc000 },
      { ...before, register: 0xc0 },
    ]) {
      expect(() => dma.restoreState(state)).toThrow()
      expect(dma.snapshotState()).toEqual(before)
      expect(operations).toEqual([])
    }
  })
})
