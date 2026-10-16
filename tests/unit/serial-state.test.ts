import { describe, expect, it } from 'vitest'
import { SerialPort } from '../../src/core/serial'

function transmit(port: SerialPort, value: number): void {
  port.writeData(value)
  port.writeControl(0x81)
  port.tick(4096)
}

describe('estado completo da serial', () => {
  it('restaura byte em andamento, temporizador e saída ainda não consumida', () => {
    const first = new SerialPort()
    transmit(first, 0x4f)
    transmit(first, 0x4b)
    first.writeData(0xa5)
    first.writeControl(0x81)
    first.tick(512 * 3 + 17)
    const state = first.snapshotState()
    const second = new SerialPort()
    second.restoreState(state)
    state.outputBytes.fill(0)
    expect(second.tick(4096 - (512 * 3 + 17) - 1)).toBe(false)
    expect(first.tick(4096 - (512 * 3 + 17) - 1)).toBe(false)
    expect(second.tick(1)).toBe(true)
    expect(first.tick(1)).toBe(true)
    expect(second.snapshotState()).toEqual(first.snapshotState())
    expect(second.drainOutput()).toEqual(first.drainOutput())
  })

  it('preserva ordem lógica, overflow e drops após wrap do buffer', () => {
    const first = new SerialPort()
    for (let index = 0; index < 4100; index += 1) transmit(first, index & 0xff)
    const second = new SerialPort()
    second.restoreState(first.snapshotState())
    transmit(first, 0xee)
    transmit(second, 0xee)
    expect(second.drainOutput()).toEqual(first.drainOutput())
  })

  it('rejeita estado inválido antes de alterar transferência ou buffer', () => {
    const port = new SerialPort()
    transmit(port, 0x45)
    const before = port.snapshotState()
    for (const state of [
      { ...before, version: 2 },
      { ...before, bitCycles: 512 },
      { ...before, control: 2 },
      { ...before, shiftedBits: 9 },
      { ...before, outgoing: 256 },
      { ...before, droppedBytes: -1 },
      { ...before, outputBytes: new Uint8Array(4097) },
    ]) {
      expect(() => port.restoreState(state)).toThrow()
      expect(port.snapshotState()).toEqual(before)
    }
  })
})
