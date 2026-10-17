import { describe, expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { encodeToBuffer, MAX_REWIND_STATE_BYTES, RewindHistory } from '../../src/runtime/rewind'
import type { MachineCheckpoint } from '../../src/runtime/worker-protocol'
import { buildTestRom } from '../fixtures/rom'

function capture(device: GameBoy, serial = ''): MachineCheckpoint {
  return { version: 1, core: device.snapshotState(), serial }
}

describe('continuação da máquina a partir do rewind binário', () => {
  it('restaura CPU, vídeo, entrada e PCM e continua exatamente do ponto anterior', () => {
    const device = new GameBoy(createVisualDiagnosticRom())
    const history = new RewindHistory()
    for (let frame = 0; frame < 8; frame += 1) device.runFrame()
    device.setButton('right', true)
    device.runCycles(12_345)
    device.bus.apu.discardSamples()
    const saved = capture(device, 'ponto anterior')
    history.record(saved, device.bus.tCycles)
    device.runCycles(140_448)
    const expected = device.snapshotState()
    const expectedPcm = device.bus.apu.drainSamples()
    history.record(capture(device, 'futuro'), device.bus.tCycles)
    const restored = history.stepBack()!
    expect(restored).toEqual(saved)
    device.restoreState(restored.core)
    device.runCycles(140_448)
    expect(device.snapshotState()).toEqual(expected)
    expect(device.bus.apu.drainSamples()).toEqual(expectedPcm)
    expect(history.stepBack()).toBeNull()
  })

  it('preserva DMA parcial, reload pendente, serial parcial e fase de áudio não vazia', () => {
    const device = new GameBoy(buildTestRom({ program: [0x00, 0x18, 0xfd] }))
    const history = new RewindHistory()
    history.record(capture(device), device.bus.tCycles)
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
    device.bus.apu.discardSamples()
    const saved = capture(device, 'antes do byte')
    expect(saved.core.bus.timer.reloadDelay).toBe(2)
    expect(saved.core.bus.dma.index).toBe(2)
    expect(saved.core.bus.dma.byteTCycles).toBe(2)
    expect(saved.core.bus.serial.bitCycles).toBe(18)
    expect(saved.core.bus.apu.sampling.phase).toBeGreaterThan(0)
    history.record(saved, device.bus.tCycles)
    device.runCycles(5000)
    const expected = device.snapshotState()
    const expectedPcm = device.bus.apu.drainSamples()
    expect(expectedPcm.some((sample) => sample !== 0)).toBe(true)
    history.record(capture(device, 'byte futuro'), device.bus.tCycles)
    const restored = history.stepBack()!
    expect(restored).toEqual(saved)
    device.restoreState(restored.core)
    device.runCycles(5000)
    expect(device.snapshotState()).toEqual(expected)
    expect(device.bus.apu.drainSamples()).toEqual(expectedPcm)
    expect(device.bus.ppu.oam).toEqual(Uint8Array.from({ length: 160 }, (_, index) => index))
    expect(device.bus.serial.drainOutput().text).toBe('A')
  })

  it('restaura RAM de bateria e mantém a revisão de persistência monotônica', () => {
    const device = new GameBoy(buildTestRom({ cartridgeType: 3, ramSizeCode: 2 }))
    const history = new RewindHistory()
    device.bus.write8Direct(0, 0x0a)
    device.bus.write8Direct(0xa000, 12)
    history.record(capture(device), 0)
    device.runCycles(100)
    device.bus.write8Direct(0xa000, 99)
    history.record(capture(device), device.bus.tCycles)
    const revision = device.cartridge.batteryRevision
    const restored = history.stepBack()!
    device.restoreState(restored.core)
    expect(device.cartridge.exportBatteryRam()![0]).toBe(12)
    expect(device.cartridge.batteryRevision).toBeGreaterThan(revision)
    device.bus.write8Direct(0xa000, 27)
    device.runCycles(100)
    history.record(capture(device), device.bus.tCycles)
    device.restoreState(history.stepBack()!.core)
    expect(device.cartridge.exportBatteryRam()![0]).toBe(12)
  })

  it('acomoda MBC5 com 128 KiB de RAM e serial completo no slot de 256 KiB', () => {
    const device = new GameBoy(buildTestRom({ cartridgeType: 0x1b, ramSizeCode: 4 }))
    device.bus.serial.restoreState({
      ...device.bus.serial.snapshotState(),
      outputBytes: new Uint8Array(4096).fill(255),
    })
    const saved = capture(device, 'ÿ'.repeat(4096))
    expect(saved.core.cartridge.ram.length).toBe(128 * 1024)
    const length = encodeToBuffer(saved, new Uint8Array(MAX_REWIND_STATE_BYTES))
    expect(length).toBeLessThan(MAX_REWIND_STATE_BYTES)
    expect(length).toBeGreaterThan(128 * 1024)
    const history = new RewindHistory()
    history.record(saved, device.bus.tCycles)
    device.bus.write8Direct(0xc000, 19)
    device.runCycles(100)
    history.record(capture(device), device.bus.tCycles)
    expect(history.stepBack()).toEqual(saved)
  })
})
