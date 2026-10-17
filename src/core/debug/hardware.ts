import type { CpuSnapshot } from '../cpu'
import type { CartridgeMapper, CartridgeRtcState } from '../cartridge'
import type { OamDmaState } from '../dma'
import type { GameBoy } from '../gameboy'
import type { PpuSnapshot } from '../ppu'
import type { TimerState } from '../timer'
import { disassemble } from './disassembler'
import type { DisassembledInstruction } from './disassembler'

export interface HardwareDebugSnapshot {
  readonly cpu: CpuSnapshot
  readonly disassembly: DisassembledInstruction[]
  readonly vram: Uint8Array
  readonly oam: Uint8Array
  readonly memory: { readonly start: number; readonly bytes: Uint8Array }
  readonly ppu: PpuSnapshot
  readonly timer: TimerState
  readonly dma: OamDmaState
  readonly interruptEnable: number
  readonly interruptFlags: number
  readonly cartridge: {
    readonly mapper: CartridgeMapper
    readonly title: string
    readonly romSize: number
    readonly ramSize: number
    readonly hasRtc: boolean
    readonly rtc: CartridgeRtcState | null
  }
  readonly frameId: number
  readonly tCycles: number
}

/** Inspeção explícita de dados brutos. Nunca executa ou escreve registradores. */
export function captureHardwareDebug(device: GameBoy, memoryStart = 0xc000): HardwareDebugSnapshot {
  if (
    !Number.isSafeInteger(memoryStart) ||
    memoryStart < 0 ||
    memoryStart > 0xff00 ||
    memoryStart % 256 !== 0
  )
    throw new RangeError(
      'O início da memória precisa ser um inteiro de 0 a 65280 alinhado em 256 bytes.',
    )
  const cpu = device.cpu.snapshot()
  const bus = device.bus
  const readByte = (address: number) => bus.read8Direct(address)
  const memory = new Uint8Array(256)
  for (let index = 0; index < memory.length; index += 1)
    memory[index] = readByte(memoryStart + index)
  const metadata = device.cartridge.metadata
  return {
    cpu,
    disassembly: disassemble(readByte, cpu.pc, 12),
    vram: bus.ppu.vram.slice(0, 0x1800),
    oam: bus.ppu.oam.slice(),
    memory: { start: memoryStart, bytes: memory },
    ppu: bus.ppu.snapshot(),
    timer: bus.timer.snapshotState(),
    dma: bus.dma.snapshotState(),
    interruptEnable: readByte(0xffff),
    interruptFlags: readByte(0xff0f),
    cartridge: {
      mapper: metadata.mapper,
      title: metadata.title,
      romSize: metadata.romSize,
      ramSize: metadata.ramSize,
      hasRtc: metadata.hasRtc,
      rtc: device.cartridge.exportBatteryRtc?.() ?? null,
    },
    frameId: device.frameId,
    tCycles: bus.tCycles,
  }
}
