import { Cpu } from './cpu'
import { MemoryBus } from './memory'
import { createCartridge } from './cartridge'
import type { Cartridge } from './cartridge'
import { DMG_FRAME_T_CYCLES, DMG_MODEL } from './model'
import type { JoypadButton } from './joypad'
import { sha256 } from '@noble/hashes/sha2.js'
import { stateInteger, stateRecord } from './state/validation'

export interface GameBoyState {
  version: 1
  model: typeof DMG_MODEL
  romId: string
  cpu: ReturnType<Cpu['snapshotState']>
  cartridge: ReturnType<Cartridge['snapshotState']>
  bus: ReturnType<MemoryBus['snapshotState']>
}

/** Máquina DMG independente do navegador. A execução sempre possui orçamento. */
export class GameBoy {
  readonly bus: MemoryBus
  readonly cpu: Cpu
  readonly cartridge: Cartridge
  readonly romId: string
  private readonly rom: Uint8Array

  constructor(rom: Uint8Array) {
    this.rom = rom.slice()
    this.romId = Array.from(sha256(this.rom), (byte) => byte.toString(16).padStart(2, '0')).join('')
    this.cartridge = createCartridge(rom)
    this.bus = new MemoryBus(this.cartridge)
    this.bus.ppu.reset(true)
    this.bus.apu.reset(true)
    this.bus.apu.setDividerCounter(this.bus.timer.systemCounter)
    this.cpu = new Cpu(this.bus)
  }

  get framebuffer(): Uint8Array {
    return this.bus.ppu.framebuffer
  }
  get frameId(): number {
    return this.bus.ppu.frameId
  }
  step(): number {
    return this.cpu.step()
  }

  setButton(button: JoypadButton, pressed: boolean): void {
    const previous = this.bus.joypad.read()
    this.bus.joypad.setButton(button, pressed)
    if ((previous & ~this.bus.joypad.read() & 0x0f) !== 0) this.cpu.wakeFromStop()
  }

  releaseButtons(): void {
    this.bus.joypad.releaseAll()
  }

  snapshotState(): GameBoyState {
    return {
      version: 1,
      model: DMG_MODEL,
      romId: this.romId,
      cpu: this.cpu.snapshotState(),
      cartridge: this.cartridge.snapshotState(),
      bus: this.bus.snapshotState(),
    }
  }

  restoreState(value: unknown): void {
    const state = stateRecord(value, 'Estado do Game Boy')
    stateInteger(state.version, 1, 1, 'Versão do núcleo')
    if (state.model !== DMG_MODEL)
      throw new Error('O estado usa um modelo de Game Boy incompatível.')
    if (state.romId !== this.romId) throw new Error('Este estado pertence a outro cartucho.')
    // Nenhuma parte da máquina atual muda antes de validar todos os componentes.
    const candidate = new GameBoy(this.rom)
    candidate.cpu.restoreState(state.cpu)
    candidate.cartridge.restoreState(state.cartridge)
    candidate.bus.restoreState(state.bus)
    this.cpu.restoreState(candidate.cpu.snapshotState())
    this.cartridge.restoreState(candidate.cartridge.snapshotState())
    this.bus.restoreState(candidate.bus.snapshotState())
  }

  runCycles(budget: number): number {
    if (!Number.isSafeInteger(budget) || budget < 0)
      throw new Error('O orçamento de ciclos precisa ser um inteiro não negativo.')
    let consumed = 0
    while (consumed < budget) {
      const cycles = this.step()
      if (cycles === 0) break
      consumed += cycles
    }
    return consumed
  }

  runFrame(): number {
    return this.runCycles(DMG_FRAME_T_CYCLES)
  }
}
