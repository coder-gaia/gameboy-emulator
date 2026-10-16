import { describe, expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { buildTestRom } from '../fixtures/rom'

describe('vídeo real da máquina DMG', () => {
  it('executa a fixture visual pela CPU e apresenta quatro tons e janela', () => {
    const device = new GameBoy(createVisualDiagnosticRom())
    for (let frame = 0; frame < 5; frame += 1) device.runFrame()
    const before = device.framebuffer.slice()
    const frameId = device.frameId
    expect(new Set(before)).toEqual(new Set([0, 1, 2, 3]))
    device.runFrame()
    expect(device.framebuffer).toEqual(before)
    expect(device.frameId).toBeGreaterThan(frameId)
    expect(device.cpu.totalTCycles).toBe(device.bus.tCycles)
  })

  it('termina o orçamento mesmo quando o LCD está desligado', () => {
    const device = new GameBoy(buildTestRom({ program: [0x18, 0xfe] }))
    device.bus.write8(0xff40, 0)
    expect(device.runFrame()).toBeGreaterThanOrEqual(70_224)
    expect(device.frameId).toBe(0)
  })

  it('bloqueia VRAM e OAM somente nos modos de acesso restrito da CPU', () => {
    const device = new GameBoy(buildTestRom())
    device.bus.write8Direct(0xfe00, 0x77)
    expect(device.bus.read8(0xfe00)).toBe(0xff)
    device.bus.write8(0x8000, 0x55)
    expect(device.bus.read8(0x8000)).toBe(0x55)
    device.bus.tick(80)
    expect(device.bus.read8(0x8000)).toBe(0xff)
    device.bus.write8(0x8000, 0x11)
    expect(device.bus.read8Direct(0x8000)).toBe(0x55)
    device.bus.tick(172)
    expect(device.bus.read8(0x8000)).toBe(0x55)
    expect(device.bus.read8(0xfe00)).toBe(0x77)
  })
})
