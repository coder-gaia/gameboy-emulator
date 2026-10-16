import { runHardwareRom } from './hardware-runner'
import type { HardwareResult } from './hardware-runner'
import { createHardwareBus } from './test-cartridge'

export interface AudioHardwareResult extends HardwareResult {
  memoryStatus: number
  memoryOutput: string
}

/** Observa o protocolo oficial dmg_sound na RAM do cartucho original. */
export function runAudioHardwareRom(rom: Uint8Array, maxTCycles: number): AudioHardwareResult {
  const bus = createHardwareBus(rom)
  const result = runHardwareRom(rom, 'blargg-memory', maxTCycles, () => bus)
  let memoryOutput = ''
  for (let address = 0xa004; address <= 0xbfff; address += 1) {
    const byte = bus.read8(address)
    if (byte === 0) break
    memoryOutput += String.fromCharCode(byte)
  }
  return { ...result, memoryStatus: bus.read8(0xa000), memoryOutput }
}
