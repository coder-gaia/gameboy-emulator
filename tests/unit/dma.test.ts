import { describe, expect, it } from 'vitest'
import { MemoryBus } from '../../src/core/memory'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { OamDma } from '../../src/core/dma'
import { buildTestRom } from '../fixtures/rom'

function setup(): MemoryBus {
  const bus = new MemoryBus(new RomOnlyCartridge(buildTestRom()))
  for (let index = 0; index < 160; index += 1) {
    bus.write8Direct(0xc000 + index, index ^ 0x5a)
    bus.write8Direct(0xd000 + index, index ^ 0xa5)
    bus.write8Direct(0xfe00 + index, 0xff)
  }
  return bus
}

describe('OAM DMA DMG', () => {
  it('aguarda escrita e espera de 8T e copia 160 bytes ao longo dos 640T seguintes', () => {
    const bus = setup()
    bus.write8(0xff46, 0xc0)
    expect(bus.dma.pending).toBe(true)
    expect(bus.dma.active).toBe(false)
    bus.tick(7)
    expect(bus.read8Direct(0xfe00)).toBe(0xff)
    bus.tick(1)
    expect(bus.dma.active).toBe(true)
    bus.tick(3)
    expect(bus.read8Direct(0xfe00)).toBe(0xff)
    bus.tick(1)
    expect(bus.read8Direct(0xfe00)).toBe(0x5a)
    expect(bus.read8Direct(0xfe01)).toBe(0xff)
    bus.tick(635)
    expect(bus.dma.bytesTransferred).toBe(159)
    expect(bus.dma.active).toBe(true)
    bus.tick(1)
    expect(bus.dma.active).toBe(false)
    expect(bus.dma.bytesTransferred).toBe(160)
    for (let index = 0; index < 160; index += 1) {
      expect(bus.read8(0xfe00 + index)).toBe(index ^ 0x5a)
    }
  })

  it('bloqueia o barramento principal e OAM durante DMA de WRAM sem bloquear periféricos', () => {
    const bus = setup()
    bus.write8(0xff80, 0x12)
    bus.write8(0xffff, 4)
    bus.write8(0xff05, 0xff)
    bus.write8(0xff07, 5)
    bus.write8(0xff46, 0xc0)
    bus.tick(8)
    for (const address of [0x100, 0xc000, 0xfe00, 0xff00, 0xff04, 0xff0f]) {
      expect(bus.read8(address)).toBe(0xff)
    }
    bus.write8(0x8000, 0x37)
    expect(bus.read8(0x8000)).toBe(0x37)
    bus.write8(0xc000, 0x44)
    bus.write8(0xff05, 0x44)
    expect(bus.read8Direct(0xc000)).toBe(0x5a)
    expect(bus.read8Direct(0xff05)).toBe(0xff)
    bus.write8(0xff80, 0x34)
    bus.write8(0xffff, 0x1f)
    expect(bus.read8(0xff80)).toBe(0x34)
    expect(bus.read8(0xffff)).toBe(0x1f)
    expect(bus.read8(0xff46)).toBe(0xc0)
    bus.tick(12)
    expect(bus.pendingInterrupts()).toBe(4)
    expect(bus.read8Direct(0xfe02)).toBe(2 ^ 0x5a)
    bus.acknowledgeInterrupt(4)
    expect(bus.pendingInterrupts()).toBe(0)
  })

  it('reinicia pela escrita FF46 mesmo quando o barramento está bloqueado', () => {
    const bus = setup()
    bus.write8(0xff46, 0xc0)
    bus.tick(48)
    expect(bus.dma.bytesTransferred).toBe(10)
    bus.write8(0xff46, 0xd0)
    expect(bus.dma.active).toBe(true)
    bus.tick(8)
    expect(bus.dma.bytesTransferred).toBe(0)
    expect(bus.read8Direct(0xfe0b)).toBe(11 ^ 0x5a)
    bus.tick(4)
    expect(bus.read8Direct(0xfe00)).toBe(0xa5)
    bus.tick(636)
    expect(bus.dma.active).toBe(false)
    for (let index = 0; index < 160; index += 1)
      expect(bus.read8(0xfe00 + index)).toBe(index ^ 0xa5)
    expect(bus.read8(0xff46)).toBe(0xd0)
  })

  it('permite substituir a origem ainda no startup sem iniciar duas transferências', () => {
    const bus = setup()
    bus.write8(0xff46, 0xc0)
    bus.tick(2)
    bus.write8(0xff46, 0xd0)
    bus.tick(648)
    expect(bus.read8(0xfe00)).toBe(0xa5)
    expect(bus.dma.active).toBe(false)
  })

  it('espelha a origem E000-FDFF em WRAM durante DMA', () => {
    const bus = setup()
    bus.write8(0xff46, 0xe0)
    bus.tick(648)
    for (let index = 0; index < 160; index += 1)
      expect(bus.read8(0xfe00 + index)).toBe(index ^ 0x5a)
  })

  it('normaliza origem e valor em bytes e não passa a cópia pela CPU', () => {
    const reads: number[] = []
    const writes: number[] = []
    const dma = new OamDma(
      (address) => {
        reads.push(address)
        return address & 255
      },
      (address, value) => writes.push(address, value),
    )
    dma.start(0x1c0)
    dma.tick(648)
    expect(reads).toHaveLength(160)
    expect([reads[0], reads[159]]).toEqual([0xc000, 0xc09f])
    expect(writes.slice(-2)).toEqual([0xfe9f, 159])
    expect(dma.readRegister()).toBe(0xc0)
  })

  it.each([-1, 0.25, Number.NaN, Number.POSITIVE_INFINITY])('recusa tick inválido %s', (cycles) => {
    expect(() => setup().dma.tick(cycles)).toThrow(/T-cycles/)
  })
})
