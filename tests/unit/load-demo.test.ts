import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_GAMES } from '../../src/platform/games/catalog'
import { loadDemo } from '../../src/platform/games/load-demo'
import { hashRom } from '../../src/platform/storage'
import { buildTestRom } from '../fixtures/rom'

afterEach(() => vi.unstubAllGlobals())

describe('carregamento da demonstração', () => {
  it('verifica bytes completos por SHA-256 antes de entregar o cartucho', async () => {
    const rom = buildTestRom({ title: 'DEMO TEST' })
    const game = { ...DEMO_GAMES[0]!, romUrl: '/games/test.gb', sha256: await hashRom(rom) }
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(rom)))
    vi.stubGlobal('fetch', fetchMock)
    const loaded = await loadDemo(game)
    expect(fetchMock).toHaveBeenCalledWith('/games/test.gb')
    expect(loaded).toMatchObject({
      fileName: 'test.gb',
      metadata: { title: 'DEMO TEST', isSupported: true },
    })
    expect(loaded.rom).toEqual(rom)
  })

  it('recusa alteração de um byte mesmo quando o cabeçalho continua válido', async () => {
    const rom = buildTestRom()
    const game = { ...DEMO_GAMES[0]!, sha256: await hashRom(rom) }
    rom[rom.length - 1] = 1
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(rom))))
    await expect(loadDemo(game)).rejects.toThrow('incompleto ou mudou')
  })

  it('informa resposta HTTP inválida antes de tentar executar seu conteúdo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Falha de hospedagem', { status: 503 })),
    )
    await expect(loadDemo(DEMO_GAMES[0]!)).rejects.toThrow('Não foi possível abrir este jogo')
  })

  it('não inicia uma ROM de controlador incompatível mesmo com hash correto', async () => {
    const rom = buildTestRom({ cartridgeType: 0x19 })
    const game = { ...DEMO_GAMES[0]!, sha256: await hashRom(rom) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(rom))))
    await expect(loadDemo(game)).rejects.toThrow('não é compatível')
  })
})
