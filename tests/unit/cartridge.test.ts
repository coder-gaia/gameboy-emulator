import { describe, expect, it } from 'vitest'
import {
  computeHeaderChecksum,
  parseCartridgeHeader,
  RomOnlyCartridge,
  createCartridge,
  Mbc1Cartridge,
} from '../../src/core/cartridge'
import { buildTestRom, updateTestHeaderChecksum } from '../fixtures/rom'

describe('cabeçalho do cartucho', () => {
  it('lê metadados de uma ROM sintética DMG e detecta bateria', () => {
    const rom = buildTestRom({ title: 'BANCADA', cartridgeType: 0x09, ramSizeCode: 0x02 })
    expect(parseCartridgeHeader(rom)).toMatchObject({
      title: 'BANCADA',
      mapper: 'ROM_ONLY',
      cartridgeType: 0x09,
      romSize: 32_768,
      ramSize: 8192,
      romBanks: 2,
      cgbMode: 'dmg',
      hasBattery: true,
      checksumValid: true,
      isSupported: true,
      warnings: [],
    })
  })

  it('calcula o checksum conhecido de 25 bytes zerados', () => {
    expect(computeHeaderChecksum(new Uint8Array(0x150))).toBe(0xe7)
    expect(() => computeHeaderChecksum(new Uint8Array(0x14d))).toThrow(/cabeçalho/)
  })

  it('avisa sobre checksum inválido sem bloquear homebrew', () => {
    const rom = buildTestRom()
    rom[0x14d] = rom[0x14d]! ^ 0xff
    const metadata = parseCartridgeHeader(rom)
    expect(metadata.checksumValid).toBe(false)
    expect(metadata.warnings.join(' ')).toMatch(/Checksum/)
    expect(() => new RomOnlyCartridge(rom)).not.toThrow()
  })

  it.each([
    [0x01, 'MBC1', false],
    [0x03, 'MBC1', true],
    [0x05, 'MBC2', false],
    [0x06, 'MBC2', true],
    [0x0f, 'MBC3', true],
    [0x13, 'MBC3', true],
    [0x19, 'MBC5', false],
    [0x1e, 'MBC5', true],
    [0x7f, 'UNKNOWN', false],
  ])(
    'identifica tipo %i e reserva cada controlador à classe correspondente',
    (cartridgeType, mapper, battery) => {
      const rom = buildTestRom({ cartridgeType })
      expect(parseCartridgeHeader(rom)).toMatchObject({
        mapper,
        hasBattery: battery,
        isSupported: mapper === 'MBC1',
      })
      expect(() => new RomOnlyCartridge(rom)).toThrow(/não suportado/)
      if (mapper === 'MBC1') expect(createCartridge(rom)).toBeInstanceOf(Mbc1Cartridge)
      else expect(() => createCartridge(rom)).toThrow(/não suportado/)
    },
  )

  it('aceita as variantes normais de MBC1 e rejeita configurações fisicamente incompatíveis', () => {
    expect(
      parseCartridgeHeader(buildTestRom({ cartridgeType: 1, romSizeCode: 6 })).isSupported,
    ).toBe(true)
    expect(
      parseCartridgeHeader(buildTestRom({ cartridgeType: 2, romSizeCode: 4, ramSizeCode: 3 }))
        .isSupported,
    ).toBe(true)
    expect(
      parseCartridgeHeader(buildTestRom({ cartridgeType: 3, romSizeCode: 6, ramSizeCode: 2 }))
        .isSupported,
    ).toBe(true)
    for (const options of [
      { cartridgeType: 1, ramSizeCode: 2 },
      { cartridgeType: 1, romSizeCode: 7 },
      { cartridgeType: 1, romSizeCode: 0x52 },
      { cartridgeType: 3, ramSizeCode: 4 },
      { cartridgeType: 3, romSizeCode: 5, ramSizeCode: 3 },
      { cartridgeType: 3, cgbFlag: 0xc0 },
    ]) {
      const rom = buildTestRom(options)
      expect(parseCartridgeHeader(rom).isSupported).toBe(false)
      expect(() => createCartridge(rom)).toThrow(/não suportado/)
    }
  })

  it('limita o título CGB a 11 caracteres e recusa uma ROM exclusiva de Color', () => {
    const compatible = buildTestRom({ title: 'ONZE LETRAS', cgbFlag: 0x80 })
    compatible.set([0x41, 0x42, 0x43, 0x44], 0x13f)
    updateTestHeaderChecksum(compatible)
    expect(parseCartridgeHeader(compatible)).toMatchObject({
      title: 'ONZE LETRAS',
      cgbMode: 'compatible',
      isSupported: true,
    })
    const required = buildTestRom({ cgbFlag: 0xc0 })
    expect(parseCartridgeHeader(required).cgbMode).toBe('required')
    expect(() => new RomOnlyCartridge(required)).toThrow(/Game Boy Color/)
  })

  it('preserva até 16 caracteres de título DMG e normaliza caracteres fora de ASCII', () => {
    const rom = buildTestRom({ title: '1234567890ABCDEF' })
    rom[0x136] = 0x1f
    updateTestHeaderChecksum(rom)
    expect(parseCartridgeHeader(rom).title).toBe('12?4567890ABCDEF')
    expect(parseCartridgeHeader(buildTestRom({ title: '' })).title).toBe('Sem título')
  })

  it.each([
    [0x00, 2],
    [0x01, 4],
    [0x02, 8],
    [0x03, 16],
    [0x04, 32],
    [0x05, 64],
    [0x06, 128],
    [0x07, 256],
    [0x08, 512],
    [0x52, 72],
    [0x53, 80],
    [0x54, 96],
  ])('decodifica tamanho de ROM %i', (romSizeCode, banks) => {
    const metadata = parseCartridgeHeader(buildTestRom({ cartridgeType: 0x19, romSizeCode }))
    expect(metadata.romBanks).toBe(banks)
    expect(metadata.romSize).toBe(banks * 0x4000)
  })

  it.each([
    [0x00, 0],
    [0x01, 2048],
    [0x02, 8192],
    [0x03, 32768],
    [0x04, 131072],
    [0x05, 65536],
  ])('decodifica tamanho de RAM %i', (ramSizeCode, bytes) => {
    const metadata = parseCartridgeHeader(buildTestRom({ cartridgeType: 0x03, ramSizeCode }))
    expect(metadata.ramSize).toBe(bytes)
  })

  it('recusa arquivos pequenos, grandes e desalinhados', () => {
    expect(() => parseCartridgeHeader(new Uint8Array(0x7fff))).toThrow(/32 KiB/)
    expect(() => parseCartridgeHeader(new Uint8Array(0x800001))).toThrow(/8 MiB/)
    expect(() => parseCartridgeHeader(new Uint8Array(0x8001))).toThrow(/16 KiB/)
  })

  it('recusa tamanhos desconhecidos e divergência entre cabeçalho e arquivo', () => {
    const rom = buildTestRom()
    rom[0x148] = 0x09
    expect(() => parseCartridgeHeader(rom)).toThrow(/ROM desconhecido/)
    rom[0x148] = 0x00
    rom[0x149] = 0x06
    expect(() => parseCartridgeHeader(rom)).toThrow(/RAM desconhecido/)
    rom[0x149] = 0x00
    rom[0x148] = 0x01
    expect(() => parseCartridgeHeader(rom)).toThrow(/declara 65536.*32768/)
  })

  it('recusa configurações que não cabem em cartucho sem MBC', () => {
    expect(parseCartridgeHeader(buildTestRom({ romSizeCode: 1 })).isSupported).toBe(false)
    expect(
      parseCartridgeHeader(buildTestRom({ cartridgeType: 8, ramSizeCode: 3 })).isSupported,
    ).toBe(false)
    expect(parseCartridgeHeader(buildTestRom({ ramSizeCode: 2 })).isSupported).toBe(false)
  })
})

describe('RomOnlyCartridge', () => {
  it('copia ROM e ignora escritas no espaço imutável', () => {
    const rom = buildTestRom()
    rom[0x7fff] = 0xa5
    const cartridge = new RomOnlyCartridge(rom)
    rom[0x7fff] = 0
    cartridge.writeRom(0x7fff, 0xff)
    expect(cartridge.readRom(0x7fff)).toBe(0xa5)
    expect(cartridge.readRom(0x8000)).toBe(0xff)
    expect(cartridge.readRom(0x17fff)).toBe(0xa5)
  })

  it('mantém RAM externa e responde FF quando ela está ausente', () => {
    const absent = new RomOnlyCartridge(buildTestRom())
    absent.writeRam(0xa000, 0x12)
    expect(absent.readRam(0xa000)).toBe(0xff)
    const present = new RomOnlyCartridge(buildTestRom({ cartridgeType: 9, ramSizeCode: 2 }))
    present.writeRam(0xa000, 0x123)
    present.writeRam(0xbfff, 0x45)
    expect(present.readRam(0xa000)).toBe(0x23)
    expect(present.readRam(0xbfff)).toBe(0x45)
  })
})
