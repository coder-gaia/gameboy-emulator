import { describe, expect, it } from 'vitest'
import { Cpu } from '../../src/core/cpu'
import { MemoryBus } from '../../src/core/memory'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { createDiagnosticRom } from '../../src/core/diagnostics/cartridge'
import { runRom } from '../helpers/rom-runner'
import { buildTestRom } from '../fixtures/rom'

describe('CPU e barramento integrados', () => {
  it('executa a ROM própria de diagnóstico até HALT e transmite OK', () => {
    const bus = new MemoryBus(new RomOnlyCartridge(createDiagnosticRom()))
    const cpu = new Cpu(bus)
    const result = runRom(cpu, bus, { stopOnHalt: true, maxSteps: 2000, maxTCycles: 20_000 })
    expect(result.status).toBe('halted')
    expect(result.serialText).toBe('OK')
    expect(bus.read8(0xc000)).toBe(0x10)
    expect(cpu.bc).toBe(0x0013)
    expect(cpu.hl).toBe(0xc000)
    expect(cpu.af).toBe(0x7fa0)
    expect(cpu.sp).toBe(0xfffe)
    expect(cpu.pc).toBe(0x017d)
    expect(cpu.totalTCycles).toBe(bus.tCycles)
    expect(bus.read8(0xff0f) & 8).toBe(8)
  })

  it('limita uma ROM de loop infinito sem bloquear o runner', () => {
    const bus = new MemoryBus(new RomOnlyCartridge(buildTestRom({ program: [0x18, 0xfe] })))
    const cpu = new Cpu(bus)
    const result = runRom(cpu, bus, { maxSteps: 25 })
    expect(result.status).toBe('timeout')
    expect(result.steps).toBe(25)
    expect(cpu.pc).toBe(0x150)
    expect(result.tCycles).toBe(16 + 24 * 12)
    expect(bus.tCycles).toBe(cpu.totalTCycles)
  })

  it('retoma execução determinística ao restaurar CPU e memória isolada', () => {
    const rom = buildTestRom({ program: [0x3e, 0x10, 0xc6, 0x0f, 0x27, 0x76] })
    const firstBus = new MemoryBus(new RomOnlyCartridge(rom))
    const first = new Cpu(firstBus)
    first.step()
    first.step()
    const snapshot = first.snapshot()
    const secondBus = new MemoryBus(new RomOnlyCartridge(rom))
    const second = new Cpu(secondBus)
    second.restore(snapshot)
    for (let index = 0; index < 3; index += 1) expect(second.step()).toBe(first.step())
    expect(second.snapshot()).toEqual(first.snapshot())
  })
})
