import { describe, expect, it } from 'vitest'
import { createCartridge, Mbc1Cartridge, RomOnlyCartridge } from '../../src/core/cartridge'
import type { Cartridge } from '../../src/core/cartridge'
import { buildTestRom } from '../fixtures/rom'

function bankedRom(romSizeCode = 6, ramSizeCode = 0, cartridgeType = ramSizeCode ? 3 : 1) {
  const rom = buildTestRom({ cartridgeType, romSizeCode, ramSizeCode })
  const header = rom.slice(0, 0x150)
  for (let bank = 0; bank < rom.length / 0x4000; bank += 1) {
    rom.fill(bank, bank * 0x4000, (bank + 1) * 0x4000)
  }
  rom.set(header)
  return rom
}

describe('Mbc1Cartridge', () => {
  it('inicia nos bancos ROM 0 e 1, com RAM desabilitada, e copia a ROM', () => {
    const rom = bankedRom(6, 2)
    const cartridge = new Mbc1Cartridge(rom)
    rom.fill(0xee)
    expect(cartridge.readRom(0x200)).toBe(0)
    expect(cartridge.readRom(0x3fff)).toBe(0)
    expect(cartridge.readRom(0x4000)).toBe(1)
    expect(cartridge.readRom(0x7fff)).toBe(1)
    expect(cartridge.readRom(0x8000)).toBe(0xff)
    expect(cartridge.readRom(0x14000)).toBe(1)
    expect(cartridge.readRam(0xa000)).toBe(0xff)
    expect(cartridge.batteryRevision).toBe(0)
  })

  it('limita o registro primário a cinco bits e traduz zero antes de mascarar o banco físico', () => {
    const cartridge = new Mbc1Cartridge(bankedRom(3))
    cartridge.writeRom(0x2000, 0xe3)
    expect(cartridge.readRom(0x4000)).toBe(3)
    cartridge.writeRom(0x3fff, 0x20)
    expect(cartridge.readRom(0x4000)).toBe(1)
    cartridge.writeRom(0x2000, 0x10)
    expect(cartridge.readRom(0x4000)).toBe(0)
    cartridge.writeRom(0x2000, 0x18)
    expect(cartridge.readRom(0x4000)).toBe(8)
  })

  it.each([
    [0, 2, 1],
    [1, 4, 3],
    [2, 8, 7],
    [3, 16, 15],
    [4, 32, 31],
    [5, 64, 63],
    [6, 128, 127],
  ])('ignora linhas de endereço ausentes na ROM de código %i', (size, banks, lastBank) => {
    const cartridge = new Mbc1Cartridge(bankedRom(size))
    cartridge.writeRom(0x2000, 0x1f)
    cartridge.writeRom(0x4000, 0xff)
    expect(cartridge.readRom(0x4000)).toBe(lastBank)
    cartridge.writeRom(0x6000, 1)
    expect(cartridge.readRom(0x200)).toBe(banks >= 64 ? (banks === 64 ? 32 : 96) : 0)
  })

  it.each([
    [0, 1, 0],
    [1, 33, 32],
    [2, 65, 64],
    [3, 97, 96],
  ])('não seleciona os bancos proibidos com registro secundário %i', (upper, switchable, fixed) => {
    const cartridge = new Mbc1Cartridge(bankedRom())
    cartridge.writeRom(0x2000, 0)
    cartridge.writeRom(0x4000, upper)
    expect(cartridge.readRom(0x4000)).toBe(switchable)
    expect(cartridge.readRom(0x200)).toBe(0)
    cartridge.writeRom(0x6000, 1)
    expect(cartridge.readRom(0x200)).toBe(fixed)
    expect(cartridge.readRom(0x4000)).toBe(switchable)
  })

  it('o modo avançado mantém os bits altos da região 4000 e conserva ambos os registros', () => {
    const cartridge = new Mbc1Cartridge(bankedRom())
    cartridge.writeRom(0x2000, 5)
    cartridge.writeRom(0x4000, 0xfe)
    cartridge.writeRom(0x7fff, 0xff)
    expect(cartridge.readRom(0x200)).toBe(64)
    expect(cartridge.readRom(0x4000)).toBe(69)
    cartridge.writeRom(0x6000, 2)
    expect(cartridge.readRom(0x200)).toBe(0)
    expect(cartridge.readRom(0x4000)).toBe(69)
    cartridge.writeRom(0x8000, 0)
    expect(cartridge.readRom(0x4000)).toBe(69)
  })

  it('habilita RAM por nibble baixo A e ignora todas as escritas enquanto desabilitada', () => {
    const cartridge = new Mbc1Cartridge(bankedRom(0, 2))
    cartridge.writeRam(0xa000, 0x88)
    expect(cartridge.batteryRevision).toBe(0)
    for (const value of [0x0a, 0x1a, 0xfa]) {
      cartridge.writeRom(0x1fff, value)
      cartridge.writeRam(0xa000, value)
      expect(cartridge.readRam(0xa000)).toBe(value)
      cartridge.writeRom(0, 0x0b)
      expect(cartridge.readRam(0xa000)).toBe(0xff)
      cartridge.writeRam(0xa000, 0x99)
      cartridge.writeRom(0, 0x0a)
      expect(cartridge.readRam(0xa000)).toBe(value)
    }
  })

  it('mantém quatro bancos RAM no modo avançado e usa somente banco zero no simples', () => {
    const cartridge = new Mbc1Cartridge(bankedRom(4, 3))
    cartridge.writeRom(0, 0x0a)
    cartridge.writeRam(0xa000, 0x10)
    cartridge.writeRom(0x6000, 1)
    for (let bank = 1; bank < 4; bank += 1) {
      cartridge.writeRom(0x4000, bank)
      cartridge.writeRam(0xa000, bank + 0x10)
      cartridge.writeRam(0xbfff, bank + 0x20)
    }
    for (let bank = 1; bank < 4; bank += 1) {
      cartridge.writeRom(0x4000, bank | 0xfc)
      expect(cartridge.readRam(0xa000)).toBe(bank + 0x10)
      expect(cartridge.readRam(0xbfff)).toBe(bank + 0x20)
    }
    cartridge.writeRom(0x6000, 0)
    expect(cartridge.readRam(0xa000)).toBe(0x10)
    cartridge.writeRam(0xbfff, 0x55)
    cartridge.writeRom(0x6000, 1)
    expect(cartridge.readRam(0xbfff)).toBe(0x23)
    cartridge.writeRom(0x4000, 0)
    expect(cartridge.readRam(0xbfff)).toBe(0x55)
  })

  it('ignora seleção de banco na RAM física de 8 KiB e espelha RAM homebrew de 2 KiB', () => {
    const full = new Mbc1Cartridge(bankedRom(6, 2))
    full.writeRom(0, 0x0a)
    full.writeRam(0xa000, 0x77)
    full.writeRom(0x6000, 1)
    full.writeRom(0x4000, 3)
    expect(full.readRam(0xa000)).toBe(0x77)
    const small = new Mbc1Cartridge(bankedRom(0, 1))
    small.writeRom(0, 0x0a)
    small.writeRam(0xa7ff, 0x66)
    expect(small.readRam(0xafff)).toBe(0x66)
    expect(small.readRam(0xbfff)).toBe(0x66)
  })

  it('não cria RAM ausente e recusa outros controladores no construtor específico', () => {
    const cartridge = new Mbc1Cartridge(bankedRom(0))
    cartridge.writeRom(0, 0x0a)
    cartridge.writeRam(0xa000, 0x77)
    expect(cartridge.readRam(0xa000)).toBe(0xff)
    expect(() => new Mbc1Cartridge(buildTestRom())).toThrow(/MBC1 não suportado/)
  })

  it('preserva todos os bancos de bateria independentemente da seleção ou habilitação de RAM', () => {
    const cartridge = new Mbc1Cartridge(bankedRom(4, 3))
    cartridge.writeRom(0, 0x0a)
    cartridge.writeRam(0xa000, 0x11)
    cartridge.writeRom(0x6000, 1)
    cartridge.writeRom(0x4000, 3)
    cartridge.writeRam(0xbfff, 0x44)
    cartridge.writeRom(0, 0)
    expect(cartridge.batteryRevision).toBe(2)
    const save = cartridge.exportBatteryRam()!
    expect(save[0]).toBe(0x11)
    expect(save[0x7fff]).toBe(0x44)

    save[0x7fff] = 0x88
    cartridge.importBatteryRam(save)
    expect(cartridge.batteryRevision).toBe(3)
    expect(cartridge.readRam(0xbfff)).toBe(0xff)
    cartridge.writeRom(0, 0x0a)
    expect(cartridge.readRam(0xbfff)).toBe(0x88)
    cartridge.writeRom(0x4000, 0)
    expect(cartridge.readRam(0xa000)).toBe(0x11)
    expect(cartridge.batteryRevision).toBe(3)
  })
})

describe('factory de cartuchos', () => {
  it('mantém ROM Only e seleciona MBC1 sem modificar o arquivo original', () => {
    expect(createCartridge(buildTestRom())).toBeInstanceOf(RomOnlyCartridge)
    const rom = bankedRom(0)
    const original = rom.slice()
    expect(createCartridge(rom)).toBeInstanceOf(Mbc1Cartridge)
    expect(rom).toEqual(original)
  })
})

describe.each([
  ['ROM Only', () => createCartridge(buildTestRom({ cartridgeType: 9, ramSizeCode: 2 }))],
  ['MBC1', () => createCartridge(bankedRom(4, 3))],
] as const)('bateria de %s', (_mapper, create) => {
  function enabled(): Cartridge {
    const cartridge = create()
    cartridge.writeRom(0, 0x0a)
    return cartridge
  }

  it('exporta uma cópia independente e só avança revisão por mudança de conteúdo', () => {
    const cartridge = enabled()
    expect(cartridge.batteryRevision).toBe(0)
    cartridge.writeRam(0xa000, 0x142)
    expect(cartridge.batteryRevision).toBe(1)
    cartridge.writeRam(0xa000, 0x42)
    expect(cartridge.batteryRevision).toBe(1)
    const save = cartridge.exportBatteryRam()!
    expect(save[0]).toBe(0x42)
    save[0] = 0xff
    expect(cartridge.readRam(0xa000)).toBe(0x42)
    expect(cartridge.batteryRevision).toBe(1)
  })

  it('importa dados sem reter a referência e preserva estado quando o tamanho é inválido', () => {
    const cartridge = enabled()
    const save = cartridge.exportBatteryRam()!
    save[0] = 0x73
    save[save.length - 1] = 0x91
    cartridge.importBatteryRam(save)
    expect(cartridge.batteryRevision).toBe(1)
    expect(cartridge.readRam(0xa000)).toBe(0x73)
    expect(cartridge.exportBatteryRam()!.at(-1)).toBe(0x91)
    cartridge.importBatteryRam(save)
    expect(cartridge.batteryRevision).toBe(1)
    save[0] = 0
    expect(cartridge.readRam(0xa000)).toBe(0x73)
    expect(() => cartridge.importBatteryRam(new Uint8Array(save.length - 1))).toThrow(
      /incompatível/,
    )
    expect(cartridge.readRam(0xa000)).toBe(0x73)
    expect(cartridge.batteryRevision).toBe(1)
  })
})

it.each([
  buildTestRom(),
  buildTestRom({ cartridgeType: 8, ramSizeCode: 2 }),
  bankedRom(0),
  bankedRom(0, 2, 2),
  buildTestRom({ cartridgeType: 3, ramSizeCode: 0 }),
])('não exporta nem importa save em cartucho sem RAM de bateria', (rom) => {
  const cartridge = createCartridge(rom)
  cartridge.writeRom(0, 0x0a)
  cartridge.writeRam(0xa000, 0x11)
  expect(cartridge.batteryRevision).toBe(0)
  expect(cartridge.exportBatteryRam()).toBeNull()
  expect(() => cartridge.importBatteryRam(new Uint8Array(0))).toThrow(/não possui RAM de bateria/)
})
