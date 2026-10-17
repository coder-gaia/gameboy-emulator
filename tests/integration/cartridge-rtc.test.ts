import { describe, expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import { buildTestRom } from '../fixtures/rom'

describe('RTC integrado ao relógio da máquina', () => {
  it('recebe T-cycles do barramento inclusive em HALT e preserva a fase ao restaurar', () => {
    const machine = new GameBoy(buildTestRom({ cartridgeType: 0x0f, program: [0x76] }))
    machine.runCycles(DMG_CLOCK_HZ + 1234)
    const cycles = machine.bus.tCycles
    expect(machine.cartridge.exportBatteryRtc!()).toMatchObject({
      seconds: 1,
      subsecondTCycles: cycles % DMG_CLOCK_HZ,
    })
    const checkpoint = machine.snapshotState()
    machine.runCycles(4812)
    const expected = machine.snapshotState()
    machine.restoreState(checkpoint)
    expect(machine.snapshotState()).toEqual(checkpoint)
    machine.runCycles(4812)
    expect(machine.snapshotState()).toEqual(expected)
  })

  it('rejeita RTC corrompido sem alterar CPU, barramento, mapper ou revisão de bateria', () => {
    const machine = new GameBoy(
      buildTestRom({ cartridgeType: 0x10, ramSizeCode: 2, program: [0x76] }),
    )
    machine.runCycles(100)
    const before = machine.snapshotState()
    if (before.cartridge.mapper !== 'MBC3') throw new Error('A fixture precisa ser MBC3.')
    const revision = machine.cartridge.batteryRevision
    const invalid = {
      ...before,
      cartridge: {
        ...before.cartridge,
        rtc: { ...before.cartridge.rtc, subsecondTCycles: DMG_CLOCK_HZ },
      },
    }
    expect(() => machine.restoreState(invalid)).toThrow(/subsecondTCycles/)
    expect(machine.snapshotState()).toEqual(before)
    expect(machine.cartridge.batteryRevision).toBe(revision)
  })

  it('salva bancos altos e todos os 128 KiB de RAM do MBC5 no checkpoint', () => {
    const machine = new GameBoy(
      buildTestRom({ cartridgeType: 0x1b, romSizeCode: 8, ramSizeCode: 4, program: [0x76] }),
    )
    machine.bus.write8(0, 0x0a)
    machine.bus.write8(0x2000, 0x8a)
    machine.bus.write8(0x3000, 1)
    machine.bus.write8(0x4000, 15)
    machine.bus.write8(0xbfff, 0x67)
    const state = machine.snapshotState()
    expect(state.cartridge.ram.length).toBe(128 * 1024)
    machine.bus.write8(0xbfff, 0x12)
    machine.bus.write8(0x3000, 0)
    machine.restoreState(state)
    expect(machine.bus.read8(0xbfff)).toBe(0x67)
    expect(machine.snapshotState()).toEqual(state)
  })
})
