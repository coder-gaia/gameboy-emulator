import { parseCartridgeHeader, RomOnlyCartridge } from '../../src/core/cartridge'
import { MemoryBus } from '../../src/core/memory'

/**
 * Algumas ROMs Blargg declaram MBC1 mesmo com somente dois bancos.
 * O adapter de teste preserva o header e modela apenas esse cartucho físico limitado.
 * Não habilita MBC1 na aplicação nem aceita ROMs de jogos maiores.
 */
export class TwoBankTestCartridge {
  private readonly ram: Uint8Array
  private bank = 1
  private ramEnabled = false

  constructor(private readonly rom: Uint8Array) {
    const metadata = parseCartridgeHeader(rom)
    if (metadata.mapper !== 'MBC1' || metadata.romSize !== 0x8000 || metadata.ramSize > 0x2000) {
      throw new Error('O adapter de testes aceita apenas MBC1 de dois bancos com até 8 KiB de RAM.')
    }
    this.ram = new Uint8Array(metadata.ramSize)
  }

  readRom(address: number): number {
    const offset = address < 0x4000 ? address : (this.bank & 1) * 0x4000 + (address & 0x3fff)
    return this.rom[offset] ?? 0xff
  }

  writeRom(address: number, value: number): void {
    if (address < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a
    else if (address < 0x4000) this.bank = value & 0x1f || 1
    // Os bits altos não possuem linhas físicas nesses dois bancos e uma página de RAM.
  }

  readRam(address: number): number {
    return this.ramEnabled ? (this.ram[address & 0x1fff] ?? 0xff) : 0xff
  }

  writeRam(address: number, value: number): void {
    const offset = address & 0x1fff
    if (this.ramEnabled && offset < this.ram.length) this.ram[offset] = value & 0xff
  }
}

export function createHardwareBus(rom: Uint8Array): MemoryBus {
  const metadata = parseCartridgeHeader(rom)
  const bus = new MemoryBus(
    metadata.isSupported ? new RomOnlyCartridge(rom) : new TwoBankTestCartridge(rom),
  )
  bus.ppu.reset(true)
  return bus
}
