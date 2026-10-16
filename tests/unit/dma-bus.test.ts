import { describe, expect, it } from 'vitest'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { MemoryBus } from '../../src/core/memory'
import { buildTestRom } from '../fixtures/rom'

function setup(): MemoryBus {
  const bus = new MemoryBus(
    new RomOnlyCartridge(buildTestRom({ cartridgeType: 8, ramSizeCode: 2 })),
  )
  bus.write8(0x8000, 0x51)
  bus.write8(0xc000, 0x73)
  bus.write8(0xa000, 0x92)
  bus.write8(0xff80, 0x36)
  return bus
}

describe('OAM DMA: barramentos separados do DMG', () => {
  it('mantém VRAM acessível durante cópia do barramento principal', () => {
    const bus = setup()
    bus.write8(0xff46, 0xc0)
    bus.tick(8)
    expect(bus.read8(0x8000)).toBe(0x51)
    expect(bus.read8(0xc000)).toBe(0xff)
    expect(bus.read8(0xe000)).toBe(0xff)
    expect(bus.read8(0xa000)).toBe(0xff)
    expect(bus.read8(0x100)).toBe(0xff)
    bus.write8(0x8000, 0x45)
    bus.write8(0xc000, 0x67)
    expect(bus.read8Direct(0x8000)).toBe(0x45)
    expect(bus.read8Direct(0xc000)).toBe(0x73)
  })

  it('mantém ROM, RAM externa, WRAM e echo acessíveis durante cópia da VRAM', () => {
    const bus = setup()
    bus.write8(0xff46, 0x80)
    bus.tick(8)
    expect(bus.read8(0x8000)).toBe(0xff)
    expect(bus.read8(0xc000)).toBe(0x73)
    expect(bus.read8(0xe000)).toBe(0x73)
    expect(bus.read8(0xa000)).toBe(0x92)
    expect(bus.read8(0x100)).toBe(bus.read8Direct(0x100))
    bus.write8(0xc000, 0x67)
    bus.write8(0xa000, 0x28)
    bus.write8(0x8000, 0x45)
    expect(bus.read8Direct(0xc000)).toBe(0x67)
    expect(bus.read8Direct(0xa000)).toBe(0x28)
    expect(bus.read8Direct(0x8000)).toBe(0x51)
  })

  it('protege OAM durante cópia, mantendo HRAM, IE e DMA acessíveis', () => {
    const bus = setup()
    bus.write8(0xff46, 0x80)
    bus.tick(12)
    expect(bus.read8(0xfe00)).toBe(0xff)
    expect(bus.read8Direct(0xfe00)).toBe(0x51)
    bus.write8(0xfe00, 0x69)
    expect(bus.read8Direct(0xfe00)).toBe(0x51)
    expect(bus.read8(0xff80)).toBe(0x36)
    bus.write8(0xffff, 0x04)
    expect(bus.read8(0xffff)).toBe(0x04)
    expect(bus.read8(0xff46)).toBe(0x80)
  })

  it('troca o barramento ocupado somente quando a nova origem torna-se ativa', () => {
    const bus = setup()
    bus.write8(0xff46, 0x80)
    bus.tick(12)
    bus.write8(0xff46, 0xc0)
    expect(bus.read8(0xff46)).toBe(0xc0)
    expect(bus.read8(0xc000)).toBe(0x73)
    expect(bus.read8(0x8000)).toBe(0xff)
    bus.tick(7)
    expect(bus.read8(0xc000)).toBe(0x73)
    expect(bus.read8(0x8000)).toBe(0xff)
    bus.tick(1)
    expect(bus.read8(0xc000)).toBe(0xff)
    expect(bus.read8(0x8000)).toBe(0x51)
    bus.write8(0xff46, 0x80)
    expect(bus.read8(0xc000)).toBe(0xff)
    expect(bus.read8(0x8000)).toBe(0x51)
    bus.tick(8)
    expect(bus.read8(0xc000)).toBe(0x73)
    expect(bus.read8(0x8000)).toBe(0xff)
  })

  it('não bloqueia nenhum barramento durante a espera da primeira transferência', () => {
    const bus = setup()
    bus.write8(0xff46, 0xc0)
    bus.tick(7)
    expect(bus.read8(0xc000)).toBe(0x73)
    expect(bus.read8(0x8000)).toBe(0x51)
    bus.tick(1)
    expect(bus.read8(0xc000)).toBe(0xff)
    expect(bus.read8(0x8000)).toBe(0x51)
  })

  it('preserva bloqueios da PPU independentemente do barramento usado pelo DMA', () => {
    const bus = setup()
    bus.ppu.reset(true)
    bus.write8Direct(0x8000, 0x51)
    bus.tick(80)
    expect(bus.ppu.mode).toBe(3)
    bus.write8(0xff46, 0xc0)
    bus.tick(8)
    expect(bus.dma.blocksCpuAddress(0x8000)).toBe(false)
    expect(bus.read8(0x8000)).toBe(0xff)
    bus.write8(0x8000, 0x45)
    expect(bus.read8Direct(0x8000)).toBe(0x51)
    bus.tick(164)
    expect(bus.ppu.mode).toBe(0)
    expect(bus.dma.active).toBe(true)
    expect(bus.read8(0x8000)).toBe(0x51)
    bus.write8(0x8000, 0x45)
    expect(bus.read8Direct(0x8000)).toBe(0x45)
  })
})
