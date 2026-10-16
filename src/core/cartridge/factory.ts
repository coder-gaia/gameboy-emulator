import type { Cartridge } from './cartridge'
import { parseCartridgeHeader } from './header'
import { Mbc1Cartridge } from './mbc1'
import { RomOnlyCartridge } from './rom-only'

export function createCartridge(rom: Uint8Array): Cartridge {
  const metadata = parseCartridgeHeader(rom)
  if (!metadata.isSupported) {
    throw new Error(`Cartucho não suportado. ${metadata.warnings.join(' ')}`)
  }
  switch (metadata.mapper) {
    case 'ROM_ONLY':
      return new RomOnlyCartridge(rom)
    case 'MBC1':
      return new Mbc1Cartridge(rom)
    default:
      throw new Error(`Controlador de cartucho não suportado: ${metadata.mapper}.`)
  }
}
