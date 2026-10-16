import { describe, expect, it } from 'vitest'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { MemoryBus } from '../../src/core/memory'
import { buildTestRom } from '../fixtures/rom'

function createBus(withRam = true): MemoryBus {
  return new MemoryBus(
    new RomOnlyCartridge(
      buildTestRom({
        cartridgeType: withRam ? 8 : 0,
        ramSizeCode: withRam ? 2 : 0,
      }),
    ),
  )
}

describe('MemoryBus', () => {
  it('mapeia fronteiras de VRAM, RAM externa, WRAM, OAM, IO, HRAM e IE', () => {
    const bus = createBus()
    const addresses = [
      0x8000, 0x9fff, 0xa000, 0xbfff, 0xc000, 0xdfff, 0xfe00, 0xfe9f, 0xff7e, 0xff7f, 0xff80,
      0xfffe, 0xffff,
    ]
    addresses.forEach((address, index) => bus.write8(address, index + 1))
    addresses.forEach((address, index) => expect(bus.read8(address)).toBe(index + 1))
  })

  it('mapeia FF00 como joypad ativo em zero e conecta sua interrupção', () => {
    const bus = createBus()
    expect(bus.read8(0xff00)).toBe(0xff)
    bus.joypad.setButton('right', true)
    expect(bus.read8(0xff00)).toBe(0xff)
    expect(bus.read8(0xff0f) & 0x10).toBe(0)
    bus.write8(0xff00, 0x20)
    expect(bus.read8(0xff00)).toBe(0xee)
    expect(bus.read8(0xff0f) & 0x10).toBe(0x10)
    bus.joypad.releaseAll()
    expect(bus.read8(0xff00)).toBe(0xef)
  })

  it('espelha WRAM nos dois sentidos até FDFF sem atingir OAM', () => {
    const bus = createBus()
    bus.write8(0xc000, 0x12)
    expect(bus.read8(0xe000)).toBe(0x12)
    bus.write8(0xfdff, 0x34)
    expect(bus.read8(0xddff)).toBe(0x34)
    bus.write8(0xde00, 0x56)
    bus.write8(0xfe00, 0x78)
    expect(bus.read8(0xde00)).toBe(0x56)
    expect(bus.read8(0xfe00)).toBe(0x78)
  })

  it('ignora escritas em ROM e na região proibida sem criar memória sombra', () => {
    const bus = createBus(false)
    const entrypoint = bus.read8(0x100)
    bus.write8(0x100, 0x99)
    bus.write8(0xa000, 0x99)
    for (let address = 0xfea0; address <= 0xfeff; address += 1) {
      bus.write8(address, 0x99)
      expect(bus.read8(address)).toBe(0xff)
    }
    expect(bus.read8(0x100)).toBe(entrypoint)
    expect(bus.read8(0xa000)).toBe(0xff)
  })

  it('normaliza endereços e valores sem avançar tempo em acessos', () => {
    const bus = createBus()
    bus.write8(0x1c000, 0x123)
    expect(bus.read8(0xc000)).toBe(0x23)
    bus.write8(-1, 0x45)
    expect(bus.read8(0x1ffff)).toBe(0x45)
    expect(bus.tCycles).toBe(0)
    bus.tick(4)
    bus.tick(8)
    expect(bus.tCycles).toBe(12)
  })

  it('preserva IF e solicita interrupção somente quando a serial conclui', () => {
    const bus = createBus()
    bus.write8(0xff0f, 0xff)
    expect(bus.read8(0xff0f)).toBe(0xff)
    bus.write8(0xff0f, 0x01)
    bus.write8(0xff01, 0x41)
    bus.write8(0xff02, 0x81)
    bus.tick(4095)
    expect(bus.read8(0xff0f)).toBe(0xe1)
    expect(bus.read8(0xff02) & 0x80).toBe(0x80)
    bus.tick(1)
    expect(bus.read8(0xff0f)).toBe(0xe9)
    expect(bus.read8(0xff02) & 0x80).toBe(0)
    expect(bus.serial.drainOutput().text).toBe('A')
    bus.write8(0xff0f, 0)
    bus.tick(4096)
    expect(bus.read8(0xff0f)).toBe(0xe0)
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'recusa ticks inválidos %s',
    (cycles) => {
      expect(() => createBus().tick(cycles)).toThrow(/T-cycles/)
    },
  )
})
