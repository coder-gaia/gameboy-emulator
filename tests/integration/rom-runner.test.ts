import { describe, expect, it } from 'vitest'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { MemoryBus } from '../../src/core/memory'
import { buildTestRom } from '../fixtures/rom'
import { runRom } from '../helpers/rom-runner'
import type { Stepper } from '../helpers/rom-runner'

function createBus(): MemoryBus {
  return new MemoryBus(new RomOnlyCartridge(buildTestRom()))
}

describe('runner de ROMs', () => {
  it('observa saída serial cronometrada sem avançar o bus duas vezes', () => {
    const bus = createBus()
    const message = 'Passed'
    let index = 0
    let pc = 0x150
    const stepper: Stepper = {
      get pc() {
        return pc
      },
      step() {
        bus.write8(0xff01, message.charCodeAt(index))
        bus.write8(0xff02, 0x81)
        index += 1
        pc += 1
        bus.tick(4096)
        return 4096
      },
    }
    const result = runRom(stepper, bus, { serialMarker: 'Passed', maxTCycles: 100_000 })
    expect(result).toMatchObject({
      status: 'completed',
      serialText: 'Passed',
      steps: 6,
      tCycles: 24576,
    })
    expect(result.serialBytes).toEqual(Uint8Array.from([80, 97, 115, 115, 101, 100]))
    expect(bus.tCycles).toBe(24576)
  })

  it('para por callback independente do protocolo serial', () => {
    const bus = createBus()
    const stepper: Stepper = {
      pc: 0x150,
      step: () => {
        bus.tick(4)
        return 4
      },
    }
    const result = runRom(stepper, bus, { done: ({ steps }) => steps === 3 })
    expect(result).toMatchObject({ status: 'completed', steps: 3, tCycles: 12 })
  })

  it('limita ciclos e passos com diagnóstico reproduzível', () => {
    const bus = createBus()
    const stepper: Stepper = {
      pc: 0x150,
      step: () => {
        bus.tick(4)
        return 4
      },
    }
    const cycles = runRom(stepper, bus, { maxTCycles: 12 })
    expect(cycles).toMatchObject({ status: 'timeout', steps: 3, tCycles: 12 })
    expect(cycles.diagnostic).toMatch(/PC=0x0150/)
    expect(runRom(stepper, bus, { maxSteps: 2 })).toMatchObject({ status: 'timeout', steps: 2 })
  })

  it.each([0, -4, Number.NaN, Number.POSITIVE_INFINITY, 0.5])(
    'detecta stepper sem progresso ou inválido: %s',
    (cycles) => {
      const result = runRom({ step: () => cycles }, createBus(), { maxSteps: 10 })
      expect(result.status).toBe('stalled')
      expect(result.steps).toBe(1)
      expect(result.diagnostic).toMatch(/inválidos/)
    },
  )

  it('HALT somente encerra quando solicitado', () => {
    const stepper: Stepper = { halted: true, step: () => 4 }
    expect(runRom(stepper, createBus(), { stopOnHalt: true }).status).toBe('halted')
    expect(runRom(stepper, createBus(), { maxSteps: 2 }).status).toBe('timeout')
  })

  it('rejeita limites e marcador sem significado', () => {
    const bus = createBus()
    const stepper: Stepper = { step: () => 4 }
    expect(() => runRom(stepper, bus, { maxTCycles: 0 })).toThrow(/maxTCycles/)
    expect(() => runRom(stepper, bus, { maxSteps: Number.NaN })).toThrow(/maxSteps/)
    expect(() => runRom(stepper, bus, { serialMarker: '' })).toThrow(/serialMarker/)
  })
})
