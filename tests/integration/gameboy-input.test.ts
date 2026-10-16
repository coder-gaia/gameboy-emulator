import { describe, expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { buildTestRom } from '../fixtures/rom'

function garden() {
  const device = new GameBoy(createVisualDiagnosticRom())
  for (let frame = 0; frame < 8; frame += 1) device.runFrame()
  return device
}

describe('entrada real do cartucho visual', () => {
  it('move o personagem pela ROM, mantém a janela fixa e solta a direção', () => {
    const device = garden()
    const before = device.framebuffer.slice()
    const x = device.bus.read8Direct(0xfe01)
    const footer = before.slice(128 * 160)
    device.setButton('right', true)
    for (let frame = 0; frame < 4; frame += 1) device.runFrame()
    device.setButton('right', false)
    expect(device.bus.read8Direct(0xfe01)).toBe(x + 4)
    expect(device.framebuffer).not.toEqual(before)
    expect(device.framebuffer.slice(128 * 160)).toEqual(footer)
    const stopped = device.bus.read8Direct(0xfe01)
    for (let frame = 0; frame < 3; frame += 1) device.runFrame()
    expect(device.bus.read8Direct(0xfe01)).toBe(stopped)
  })

  it('alterna aparência uma vez por pressão de A e recentraliza com B', () => {
    const device = garden()
    const tile = device.bus.read8Direct(0xfe02)
    const initialX = device.bus.read8Direct(0xfe01)
    device.setButton('a', true)
    for (let frame = 0; frame < 4; frame += 1) device.runFrame()
    expect(device.bus.read8Direct(0xfe02)).not.toBe(tile)
    device.releaseButtons()
    device.setButton('right', true)
    for (let frame = 0; frame < 8; frame += 1) device.runFrame()
    device.releaseButtons()
    expect(device.bus.read8Direct(0xfe01)).toBeGreaterThan(initialX)
    device.setButton('b', true)
    device.runFrame()
    expect(device.bus.read8Direct(0xfe01)).toBe(initialX)
  })

  it('acorda de STOP somente por uma queda em linha selecionada do joypad', () => {
    const device = new GameBoy(buildTestRom({ program: [0x10, 0x00, 0x00] }))
    device.bus.write8(0xff00, 0x20)
    device.step()
    device.step()
    expect(device.cpu.stopped).toBe(true)
    device.setButton('a', true)
    expect(device.cpu.stopped).toBe(true)
    device.setButton('right', true)
    expect(device.cpu.stopped).toBe(false)
    expect(device.bus.read8Direct(0xff0f) & 0x10).toBe(0x10)
    expect(device.step()).toBe(4)
  })
})
