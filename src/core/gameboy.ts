import { Cpu } from './cpu'
import { MemoryBus } from './memory'
import { RomOnlyCartridge } from './cartridge'
import { DMG_FRAME_T_CYCLES } from './model'
import type { JoypadButton } from './joypad'

/** Máquina DMG independente do navegador. A execução sempre possui orçamento. */
export class GameBoy {
  readonly bus: MemoryBus
  readonly cpu: Cpu

  constructor(rom: Uint8Array) {
    this.bus = new MemoryBus(new RomOnlyCartridge(rom))
    this.bus.ppu.reset(true)
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
