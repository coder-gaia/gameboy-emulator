import { describe, expect, it } from 'vitest'
import { createCartridge, Mbc1Cartridge } from '../../src/core/cartridge'
import { buildTestRom } from '../fixtures/rom'

describe('estado dos mappers', () => {
  it.each([8, 9])('restaura RAM ROM Only tipo %i, inclusive sem bateria', (cartridgeType) => {
    const cartridge = createCartridge(buildTestRom({ cartridgeType, ramSizeCode: 2 }))
    cartridge.writeRam(0xa000, 0x42)
    const state = cartridge.snapshotState()
    cartridge.writeRam(0xa000, 0x99)
    const revision = cartridge.batteryRevision
    cartridge.restoreState(state)
    expect(cartridge.readRam(0xa000)).toBe(0x42)
    expect(cartridge.batteryRevision).toBe(cartridgeType === 9 ? revision + 1 : 0)
    state.ram[0] = 0
    expect(cartridge.readRam(0xa000)).toBe(0x42)
  })

  it.each([2, 3])(
    'restaura registros e bancos RAM do MBC1 tipo %i sem voltar a revisão no tempo',
    (cartridgeType) => {
      const rom = buildTestRom({ cartridgeType, romSizeCode: 4, ramSizeCode: 3 })
      for (let bank = 1; bank < 32; bank += 1) rom[bank * 0x4000] = bank
      const cartridge = new Mbc1Cartridge(rom)
      cartridge.writeRom(0, 0x0a)
      cartridge.writeRom(0x6000, 1)
      cartridge.writeRom(0x4000, 3)
      cartridge.writeRom(0x2000, 7)
      cartridge.writeRam(0xbfff, 0x73)
      const state = cartridge.snapshotState()
      cartridge.writeRom(0x4000, 0)
      cartridge.writeRam(0xa000, 0x55)
      const revision = cartridge.batteryRevision
      cartridge.restoreState(state)
      expect(cartridge.readRom(0x4000)).toBe(7)
      expect(cartridge.readRam(0xbfff)).toBe(0x73)
      expect(cartridge.batteryRevision).toBe(cartridgeType === 3 ? revision + 1 : 0)
      cartridge.restoreState(state)
      expect(cartridge.batteryRevision).toBe(cartridgeType === 3 ? revision + 1 : 0)
      cartridge.writeRom(0x4000, 0)
      expect(cartridge.readRam(0xa000)).toBe(0)
    },
  )

  it('rejeita registradores inválidos e outro mapper antes de alterar RAM ou revisão', () => {
    const cartridge = createCartridge(buildTestRom({ cartridgeType: 3, ramSizeCode: 2 }))
    cartridge.writeRom(0, 0x0a)
    cartridge.writeRam(0xa000, 0x42)
    const before = cartridge.snapshotState()
    const revision = cartridge.batteryRevision
    const modifiedRam = new Uint8Array(8192).fill(0xff)
    for (const state of [
      { ...before, mapper: 'ROM_ONLY' },
      { ...before, ram: new Uint8Array(1) },
      { ...before, ram: modifiedRam, primaryBank: 32 },
      { ...before, bankingMode: 2 },
      { ...before, secondaryBank: 4 },
      { ...before, ramEnabled: 1 },
    ]) {
      expect(() => cartridge.restoreState(state)).toThrow()
      expect(cartridge.snapshotState()).toEqual(before)
      expect(cartridge.batteryRevision).toBe(revision)
    }
  })
})
