import { describe, expect, it } from 'vitest'
import { Cpu } from '../../src/core/cpu'
import { buildTestRom } from '../fixtures/rom'

class StateTestBus {
  readonly memory = new Uint8Array(65536)
  constructor(program: readonly number[]) {
    this.memory.set(buildTestRom({ program }))
  }
  read8(address: number): number {
    return this.memory[address & 0xffff]!
  }
  write8(address: number, value: number): void {
    this.memory[address & 0xffff] = value & 0xff
  }
  tick(_cycles: number): void {
    void _cycles
  }
}

describe('estado completo da CPU', () => {
  it('continua EI atrasado, HALT bug e atendimento de interrupção com os mesmos ciclos e pilha', () => {
    const bus = new StateTestBus([0xfb, 0x76, 0x3e, 0x42])
    const cpu = new Cpu(bus)
    cpu.step()
    cpu.step()
    bus.memory[0xffff] = 1
    bus.memory[0xff0f] = 1
    const state = cpu.snapshotState()
    expect(state.imeEnableDelay).toBe(1)
    const memory = bus.memory.slice()
    const cycles = [cpu.step(), cpu.step(), cpu.step(), cpu.step()]
    const expected = cpu.snapshotState()
    const expectedMemory = bus.memory.slice()
    cpu.restoreState(state)
    bus.memory.set(memory)
    expect([cpu.step(), cpu.step(), cpu.step(), cpu.step()]).toEqual(cycles)
    expect(cpu.snapshotState()).toEqual(expected)
    expect(bus.memory).toEqual(expectedMemory)

    cpu.restoreState(state)
    bus.memory.set(memory)
    cpu.step()
    const bug = cpu.snapshotState()
    expect(bug.haltBug).toBe(true)
    cpu.step()
    const serviced = cpu.snapshotState()
    cpu.restoreState(bug)
    bus.memory.set(memory)
    cpu.step()
    expect(cpu.snapshotState()).toEqual(serviced)
  })

  it.each([0x76, 0x10])(
    'restaura espera de opcode %i e retoma após o evento correspondente',
    (opcode) => {
      const bus = new StateTestBus([opcode, 0, 0x3c])
      const cpu = new Cpu(bus)
      cpu.step()
      cpu.step()
      const state = cpu.snapshotState()
      cpu.reset()
      cpu.restoreState(state)
      expect(cpu.step()).toBe(opcode === 0x10 ? 0 : 4)
      if (opcode === 0x10) cpu.wakeFromStop()
      else {
        bus.memory[0xffff] = 1
        bus.memory[0xff0f] = 1
      }
      expect(cpu.step()).toBe(4)
    },
  )

  it('recusa campos inválidos sem alterar registradores ou estado de espera', () => {
    const cpu = new Cpu(new StateTestBus([0xfb, 0]))
    cpu.step()
    cpu.step()
    const before = cpu.snapshotState()
    for (const state of [
      null,
      [],
      { ...before, version: 2 },
      { ...before, f: 1 },
      { ...before, imeEnableDelay: 3 },
      { ...before, totalTCycles: 1 },
      { ...before, halted: true, stopped: true },
      { ...before, haltBug: 1 },
    ]) {
      expect(() => cpu.restoreState(state)).toThrow()
      expect(cpu.snapshotState()).toEqual(before)
    }
  })
})
