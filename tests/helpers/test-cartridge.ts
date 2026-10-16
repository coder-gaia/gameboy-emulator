import { createCartridge } from '../../src/core/cartridge'
import { MemoryBus } from '../../src/core/memory'

/** Os testes de hardware usam os mesmos mappers disponíveis na aplicação. */
export function createHardwareBus(rom: Uint8Array): MemoryBus {
  const bus = new MemoryBus(createCartridge(rom))
  bus.ppu.reset(true)
  return bus
}
