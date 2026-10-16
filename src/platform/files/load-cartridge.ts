import { MAX_ROM_SIZE, parseCartridgeHeader } from '../../core/cartridge'
import type { CartridgeMetadata } from '../../core/cartridge'

export interface LoadedCartridge {
  fileName: string
  metadata: CartridgeMetadata
  rom: Uint8Array
}

export async function loadCartridgeFile(file: File): Promise<LoadedCartridge> {
  if (!/\.(gb|gbc)$/i.test(file.name)) {
    throw new Error('Escolha um arquivo de cartucho com extensão .gb ou .gbc.')
  }
  if (file.size > MAX_ROM_SIZE) throw new Error('O cartucho ultrapassa o limite de 8 MiB.')
  const rom = new Uint8Array(await file.arrayBuffer())
  return { fileName: file.name, rom, metadata: parseCartridgeHeader(rom) }
}
