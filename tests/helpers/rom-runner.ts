import type { MemoryBus } from '../../src/core/memory'

export interface Stepper {
  step(): number
  readonly pc?: number
  readonly halted?: boolean
}

export interface RomRunProgress {
  readonly tCycles: number
  readonly steps: number
  readonly serialText: string
  readonly pc: number | undefined
}

export interface RomRunOptions {
  readonly maxTCycles?: number
  readonly maxSteps?: number
  readonly serialMarker?: string
  readonly stopOnHalt?: boolean
  readonly done?: (progress: RomRunProgress) => boolean
}

export interface RomRunResult extends RomRunProgress {
  readonly status: 'completed' | 'halted' | 'timeout' | 'stalled'
  readonly serialBytes: Uint8Array
  readonly diagnostic: string
}

/** O stepper avança o bus; o runner nunca soma ciclos uma segunda vez. */
export function runRom(
  stepper: Stepper,
  bus: MemoryBus,
  options: RomRunOptions = {},
): RomRunResult {
  const maxTCycles = options.maxTCycles ?? 4_194_304 * 5
  const maxSteps = options.maxSteps ?? 1_000_000
  if (!Number.isSafeInteger(maxTCycles) || maxTCycles <= 0) {
    throw new Error('maxTCycles precisa ser um inteiro positivo.')
  }
  if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) {
    throw new Error('maxSteps precisa ser um inteiro positivo.')
  }
  if (options.serialMarker === '') throw new Error('serialMarker não pode ser vazio.')

  let tCycles = 0
  let steps = 0
  let serialText = ''
  const serialBytes: number[] = []

  function progress(): RomRunProgress {
    return { tCycles, steps, serialText, pc: stepper.pc }
  }

  function result(status: RomRunResult['status'], reason: string): RomRunResult {
    const pc =
      stepper.pc === undefined ? 'indisponível' : `0x${stepper.pc.toString(16).padStart(4, '0')}`
    return {
      ...progress(),
      status,
      serialBytes: Uint8Array.from(serialBytes),
      diagnostic: `${reason} Passos=${steps}; T-cycles=${tCycles}; PC=${pc}; serial=${JSON.stringify(serialText.slice(-120))}.`,
    }
  }

  while (steps < maxSteps && tCycles < maxTCycles) {
    const consumed = stepper.step()
    steps += 1
    if (!Number.isSafeInteger(consumed) || consumed <= 0) {
      return result('stalled', `O stepper retornou ciclos inválidos: ${consumed}.`)
    }
    tCycles += consumed
    if (bus.serial.pendingOutputBytes > 0) {
      const output = bus.serial.drainOutput()
      serialText += output.text
      for (const byte of output.bytes) serialBytes.push(byte)
      if (output.droppedBytes > 0) {
        return result('stalled', `A observação serial perdeu ${output.droppedBytes} bytes.`)
      }
    }
    if (
      (options.serialMarker !== undefined && serialText.includes(options.serialMarker)) ||
      options.done?.(progress())
    ) {
      return result('completed', 'Condição de conclusão atingida.')
    }
    if (options.stopOnHalt && stepper.halted) return result('halted', 'A CPU entrou em HALT.')
  }
  return result('timeout', 'Limite de execução atingido sem conclusão.')
}
