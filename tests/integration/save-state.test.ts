import { describe, expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { buildTestRom } from '../fixtures/rom'

describe('continuação determinística do estado completo', () => {
  it('retoma a mesma partida com CPU, vídeo, entrada e PCM idênticos', () => {
    const device = new GameBoy(createVisualDiagnosticRom())
    for (let frame = 0; frame < 8; frame += 1) device.runFrame()
    device.setButton('right', true)
    device.runCycles(12_345)
    device.bus.apu.clearSamples()
    const saved = device.snapshotState()
    device.runCycles(140_448)
    const expected = device.snapshotState()
    const samples = device.bus.apu.drainSamples()
    device.restoreState(saved)
    device.runCycles(140_448)
    expect(device.snapshotState()).toEqual(expected)
    expect(device.bus.apu.drainSamples()).toEqual(samples)
  })

  it('preserva DMA parcial, reload do timer, serial e resampler de áudio', () => {
    const device = new GameBoy(buildTestRom({ program: [0x00, 0x18, 0xfd] }))
    device.bus.write8Direct(0xff40, 0)
    device.bus.write8Direct(0xff80, 0x00)
    device.bus.write8Direct(0xff81, 0x18)
    device.bus.write8Direct(0xff82, 0xfd)
    device.cpu.restoreState({ ...device.cpu.snapshotState(), pc: 0xff80 })
    for (let index = 0; index < 160; index += 1) device.bus.write8Direct(0xc000 + index, index)
    device.bus.write8Direct(0xff01, 0x41)
    device.bus.write8Direct(0xff02, 0x81)
    device.bus.write8Direct(0xff05, 0xff)
    device.bus.write8Direct(0xff07, 5)
    device.bus.write8Direct(0xff12, 0xf3)
    device.bus.write8Direct(0xff13, 0xc0)
    device.bus.write8Direct(0xff14, 0x87)
    device.bus.write8Direct(0xff46, 0xc0)
    device.bus.tick(18)
    device.bus.apu.clearSamples()
    const saved = device.snapshotState()
    device.runCycles(5000)
    const expected = device.snapshotState()
    const samples = device.bus.apu.drainSamples()
    expect(samples.some((value) => value !== 0)).toBe(true)
    device.restoreState(saved)
    device.runCycles(5000)
    expect(device.snapshotState()).toEqual(expected)
    expect(device.bus.apu.drainSamples()).toEqual(samples)
    expect(device.bus.ppu.oam).toEqual(Uint8Array.from({ length: 160 }, (_, index) => index))
    expect(device.bus.serial.drainOutput().text).toBe('A')
  })

  it('rejeita componente inválido sem alterar nenhuma parte da máquina', () => {
    const device = new GameBoy(createVisualDiagnosticRom())
    device.runFrame()
    const before = device.snapshotState()
    const invalid = {
      ...before,
      cpu: { ...before.cpu, a: 99 },
      bus: { ...before.bus, apu: { ...before.bus.apu, version: 99 } },
    }
    expect(() => device.restoreState(invalid)).toThrow()
    expect(device.snapshotState()).toEqual(before)
  })

  it('vincula o estado aos bytes da ROM, ao modelo e à versão', () => {
    const first = new GameBoy(buildTestRom())
    const otherRom = buildTestRom()
    otherRom[0x7000] = 1
    const other = new GameBoy(otherRom)
    const state = first.snapshotState()
    expect(() => other.restoreState(state)).toThrow('outro cartucho')
    expect(() => first.restoreState({ ...state, model: 'CGB' })).toThrow('modelo')
    expect(() => first.restoreState({ ...state, version: 2 })).toThrow()
    state.bus.wram[0] = 123
    expect(first.bus.read8Direct(0xc000)).toBe(0)
  })
})
