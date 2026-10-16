import { parseCartridgeHeader } from '../../core/cartridge'
import { hashRom } from '../storage'
import type { LoadedCartridge } from '../files/load-cartridge'
import type { DemoGame } from './catalog'

export async function loadDemo(game: DemoGame): Promise<LoadedCartridge> {
  const response = await fetch(game.romUrl)
  if (!response.ok) throw new Error('Não foi possível abrir este jogo. Tente novamente.')
  const rom = new Uint8Array(await response.arrayBuffer())
  if ((await hashRom(rom)) !== game.sha256)
    throw new Error('O arquivo deste jogo está incompleto ou mudou. Recarregue a página.')
  const metadata = parseCartridgeHeader(rom)
  if (!metadata.isSupported) throw new Error('Este jogo não é compatível com o emulador atual.')
  return { rom, metadata, fileName: game.romUrl.split('/').at(-1)! }
}
