import { Cpu } from '../../src/core/cpu'
import { MemoryBus } from '../../src/core/memory'
import { RomOnlyCartridge } from '../../src/core/cartridge'

export type HardwareProtocol = 'blargg-serial' | 'mooneye-registers' | 'blargg-memory'

export interface HardwareResult {
  passed: boolean
  reason: string
  serial: string
  steps: number
  tCycles: number
  pc: number
  registers: number[]
}

/** Lê os protocolos reais das suítes, sem modificar o hardware para reconhecê-las. */
export function runHardwareRom(
  rom: Uint8Array,
  protocol: HardwareProtocol,
  maxTCycles: number,
  createBus = (bytes: Uint8Array) => new MemoryBus(new RomOnlyCartridge(bytes)),
): HardwareResult {
  const bus = createBus(rom)
  const cpu = new Cpu(bus)
  let serial = ''
  let steps = 0

  function result(passed: boolean, reason: string): HardwareResult {
    return {
      passed,
      reason,
      serial,
      steps,
      tCycles: cpu.totalTCycles,
      pc: cpu.pc,
      registers: [cpu.b, cpu.c, cpu.d, cpu.e, cpu.h, cpu.l],
    }
  }

  while (cpu.totalTCycles < maxTCycles && steps < 50_000_000) {
    if (protocol === 'mooneye-registers' && bus.read8(cpu.pc) === 0x40) {
      const registers = [cpu.b, cpu.c, cpu.d, cpu.e, cpu.h, cpu.l]
      if (registers.every((value, index) => value === [3, 5, 8, 13, 21, 34][index])) {
        return result(true, 'Registradores Fibonacci no ponto de conclusão Mooneye.')
      }
      if (registers.every((value) => value === 0x42)) {
        return result(false, 'Mooneye sinalizou falha nos registradores.')
      }
    }
    try {
      const consumed = cpu.step()
      steps += 1
      if (consumed === 0) return result(false, 'A CPU parou o clock antes da conclusão.')
    } catch (cause) {
      return result(false, cause instanceof Error ? cause.message : String(cause))
    }
    if (bus.serial.pendingOutputBytes > 0) {
      const output = bus.serial.drainOutput()
      serial = (serial + output.text).slice(-8192)
      if (output.droppedBytes) return result(false, 'O observador serial perdeu dados.')
      if (protocol === 'blargg-serial') {
        if (/\bPassed\b/.test(serial)) return result(true, 'Blargg informou Passed pela serial.')
        if (/\bFailed\b|\bFAILED\b/.test(serial))
          return result(false, 'Blargg informou falha pela serial.')
      }
    }
    if (
      protocol === 'blargg-memory' &&
      bus.read8(0xa001) === 0xde &&
      bus.read8(0xa002) === 0xb0 &&
      bus.read8(0xa003) === 0x61
    ) {
      const status = bus.read8(0xa000)
      if (status < 0x80) return result(status === 0, `Blargg informou status ${status} na RAM.`)
    }
  }
  return result(false, 'Limite de ciclos atingido antes da conclusão.')
}
