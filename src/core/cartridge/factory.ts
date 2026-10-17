import type { Cartridge } from './cartridge'
import { parseCartridgeHeader } from './header'
import { Mbc1Cartridge } from './mbc1'
import { Mbc2Cartridge } from './mbc2'
import { Mbc3Cartridge } from './mbc3'
import { Mbc5Cartridge } from './mbc5'
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
    case 'MBC2':
      return new Mbc2Cartridge(rom)
    case 'MBC3':
      return new Mbc3Cartridge(rom)
    case 'MBC5':
      return new Mbc5Cartridge(rom)
    default:
      throw new Error(`Controlador de cartucho não suportado: ${metadata.mapper}.`)
  }
}
