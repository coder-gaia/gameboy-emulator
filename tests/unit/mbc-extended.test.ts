import { describe, expect, it } from 'vitest'
import {
  createCartridge,
  Mbc2Cartridge,
  Mbc3Cartridge,
  Mbc5Cartridge,
  parseCartridgeHeader,
} from '../../src/core/cartridge'
import type { Cartridge } from '../../src/core/cartridge'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import { buildTestRom } from '../fixtures/rom'

function bankedRom(cartridgeType: number, romSizeCode = 0, ramSizeCode = 0): Uint8Array {
  const rom = buildTestRom({ cartridgeType, romSizeCode, ramSizeCode })
  const header = rom.slice(0, 0x150)
  for (let bank = 0; bank < rom.length / 0x4000; bank += 1) {
    rom.fill(bank & 0xff, bank * 0x4000, (bank + 1) * 0x4000)
    rom[bank * 0x4000 + 1] = bank >> 8
  }
  rom.set(header)
  return rom
}

function enable(cartridge: Cartridge): void {
  cartridge.writeRom(0, 0x0a)
}
function selectRtc(cartridge: Mbc3Cartridge, register: number): void {
  cartridge.writeRom(0x4000, register)
}
function writeRtc(cartridge: Mbc3Cartridge, register: number, value: number): void {
  selectRtc(cartridge, register)
  cartridge.writeRam(0xa000, value)
}
function latch(cartridge: Mbc3Cartridge): void {
  cartridge.writeRom(0x6000, 0)
  cartridge.writeRom(0x6000, 1)
}
function readRtc(cartridge: Mbc3Cartridge, register: number): number {
  selectRtc(cartridge, register)
  return cartridge.readRam(0xa000)
}

describe('validação dos novos controladores', () => {
  it.each([
    [0x05, 3, 0, 512, false],
    [0x06, 0, 0, 512, false],
    [0x0f, 6, 0, 0, true],
    [0x10, 6, 3, 32768, true],
    [0x11, 6, 0, 0, false],
    [0x12, 0, 2, 8192, false],
    [0x13, 4, 3, 32768, false],
    [0x19, 8, 0, 0, false],
    [0x1a, 7, 4, 131072, false],
    [0x1b, 8, 5, 65536, false],
    [0x1c, 0, 0, 0, false],
    [0x1d, 0, 5, 65536, false],
    [0x1e, 0, 5, 65536, false],
  ])(
    'aceita tipo %i com ROM %i e RAM %i',
    (cartridgeType, romSizeCode, ramSizeCode, ramSize, hasRtc) => {
      const rom = buildTestRom({ cartridgeType, romSizeCode, ramSizeCode })
      expect(parseCartridgeHeader(rom)).toMatchObject({ isSupported: true, ramSize, hasRtc })
      expect(() => createCartridge(rom)).not.toThrow()
    },
  )

  it.each([
    [0x05, 4, 0],
    [0x06, 0, 2],
    [0x10, 7, 3],
    [0x10, 6, 5],
    [0x0f, 0, 2],
    [0x11, 0, 2],
    [0x19, 0, 2],
    [0x1c, 0, 2],
    [0x1e, 0, 4],
    [0x19, 0x52, 0],
    [0x11, 0x53, 0],
    [0x06, 0, 1],
  ])(
    'rejeita configuração fisicamente incompatível %i/%i/%i',
    (cartridgeType, romSizeCode, ramSizeCode) => {
      const rom = buildTestRom({ cartridgeType, romSizeCode, ramSizeCode })
      expect(parseCartridgeHeader(rom).isSupported).toBe(false)
      expect(() => createCartridge(rom)).toThrow(/não suportado/)
    },
  )
})

describe('MBC2', () => {
  it('decodifica A8 em toda região 0000 a 3fff e ignora 4000 a 7fff', () => {
    const cartridge = new Mbc2Cartridge(bankedRom(6, 3))
    expect(cartridge.readRom(0x4000)).toBe(1)
    for (const address of [0x100, 0x2100, 0x3fff]) {
      cartridge.writeRom(address, 0xf7)
      expect(cartridge.readRom(0x4000)).toBe(7)
      cartridge.writeRom(address, 0x10)
      expect(cartridge.readRom(0x4000)).toBe(1)
    }
    cartridge.writeRom(0x4000, 9)
    expect(cartridge.readRom(0x4000)).toBe(1)
    expect(cartridge.readRom(0x8000)).toBe(0xff)
    for (const address of [0x0000, 0x2000, 0x3eff]) {
      cartridge.writeRom(address, 0x1a)
      cartridge.writeRam(0xa000, 0x72)
      expect(cartridge.readRam(0xa000)).toBe(0xf2)
      cartridge.writeRom(address, 0x1b)
      expect(cartridge.readRam(0xa000)).toBe(0xff)
    }
  })

  it('espelha 512 nibbles por toda RAM e ignora bits altos nas gravações', () => {
    const cartridge = new Mbc2Cartridge(bankedRom(6))
    cartridge.writeRam(0xa000, 0x66)
    enable(cartridge)
    expect(cartridge.readRam(0xa000)).toBe(0xf0)
    cartridge.writeRam(0xbfff, 0xab)
    for (let echo = 0; echo < 16; echo += 1)
      expect(cartridge.readRam(0xa1ff + echo * 512)).toBe(0xfb)
    expect(cartridge.batteryRevision).toBe(1)
    cartridge.writeRam(0xa1ff, 0x4b)
    expect(cartridge.batteryRevision).toBe(1)
    const save = cartridge.exportBatteryRam()!
    expect(save.length).toBe(512)
    expect(save[511]).toBe(11)
    save.fill(0xff)
    expect(cartridge.readRam(0xa000)).toBe(0xf0)
    cartridge.importBatteryRam(save)
    expect(cartridge.readRam(0xa000)).toBe(0xff)
    expect(cartridge.exportBatteryRam()![0]).toBe(15)
    expect(cartridge.batteryRevision).toBe(2)
    expect(() => cartridge.importBatteryRam(new Uint8Array(256))).toThrow(/incompatível/)
  })

  it('mascara bancos ausentes depois de traduzir banco zero', () => {
    const cartridge = new Mbc2Cartridge(bankedRom(5, 1))
    enable(cartridge)
    cartridge.writeRom(0x2100, 4)
    expect(cartridge.readRom(0x4000)).toBe(0)
    cartridge.writeRom(0x2100, 0)
    expect(cartridge.readRom(0x4000)).toBe(1)
    cartridge.writeRam(0xa000, 5)
    expect(cartridge.exportBatteryRam()).toBeNull()
    expect(cartridge.batteryRevision).toBe(0)
  })
})

describe('MBC5', () => {
  it('seleciona banco 000 e 100 com registradores independentes e até banco 1ff', () => {
    const cartridge = new Mbc5Cartridge(bankedRom(0x19, 8))
    expect(cartridge.readRom(0x4000)).toBe(1)
    cartridge.writeRom(0x2000, 0)
    expect(cartridge.readRom(0x4000)).toBe(0)
    expect(cartridge.readRom(0x4001)).toBe(0)
    cartridge.writeRom(0x3000, 0xff)
    expect(cartridge.readRom(0x4000)).toBe(0)
    expect(cartridge.readRom(0x4001)).toBe(1)
    cartridge.writeRom(0x2fff, 0xff)
    expect(cartridge.readRom(0x4000)).toBe(255)
    expect(cartridge.readRom(0x4001)).toBe(1)
    cartridge.writeRom(0x3fff, 0xfe)
    expect(cartridge.readRom(0x4001)).toBe(0)
    expect(cartridge.readRom(0x200)).toBe(0)
    cartridge.writeRom(0x7fff, 0)
    expect(cartridge.readRom(0x4000)).toBe(255)
  })

  it('mantém dezesseis bancos de RAM e bateria com revisão monotônica', () => {
    const cartridge = new Mbc5Cartridge(bankedRom(0x1b, 0, 4))
    cartridge.writeRam(0xa000, 0xaa)
    expect(cartridge.readRam(0xa000)).toBe(0xff)
    enable(cartridge)
    for (let bank = 0; bank < 16; bank += 1) {
      cartridge.writeRom(0x4000, bank | 0xf0)
      cartridge.writeRam(0xa000, bank + 1)
      cartridge.writeRam(0xbfff, bank + 17)
    }
    expect(cartridge.exportBatteryRam()!.length).toBe(128 * 1024)
    for (let bank = 0; bank < 16; bank += 1) {
      cartridge.writeRom(0x4000, bank)
      expect(cartridge.readRam(0xa000)).toBe(bank + 1)
      expect(cartridge.readRam(0xbfff)).toBe(bank + 17)
    }
    expect(cartridge.batteryRevision).toBe(32)
    const save = cartridge.exportBatteryRam()!
    cartridge.importBatteryRam(save)
    expect(cartridge.batteryRevision).toBe(32)
    save[0] = 99
    cartridge.importBatteryRam(save)
    expect(cartridge.batteryRevision).toBe(33)
  })

  it('separa o bit rumble do banco RAM e restaura o motor lógico', () => {
    const cartridge = new Mbc5Cartridge(bankedRom(0x1e, 0, 5))
    enable(cartridge)
    cartridge.writeRom(0x4000, 7)
    cartridge.writeRam(0xa000, 77)
    cartridge.writeRom(0x4000, 15)
    expect(cartridge.readRam(0xa000)).toBe(77)
    expect(cartridge.rumbleActive).toBe(true)
    const state = cartridge.snapshotState()
    cartridge.writeRom(0x4000, 0)
    expect(cartridge.rumbleActive).toBe(false)
    cartridge.restoreState(state)
    expect(cartridge.rumbleActive).toBe(true)
    expect(cartridge.readRam(0xa000)).toBe(77)
  })
})

describe('MBC3 e RTC', () => {
  it('mantém bancos 20, 40 e 60 e quatro bancos RAM sem disponibilizar RTC em tipo 13', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x13, 6, 3))
    for (const bank of [0, 0x20, 0x40, 0x60, 0xff]) {
      cartridge.writeRom(0x2000, bank)
      expect(cartridge.readRom(0x4000)).toBe(bank & 0x7f || 1)
    }
    enable(cartridge)
    for (let bank = 0; bank < 4; bank += 1) {
      cartridge.writeRom(0x4000, bank)
      cartridge.writeRam(0xa000, bank + 10)
    }
    for (let bank = 0; bank < 4; bank += 1) {
      cartridge.writeRom(0x4000, bank)
      expect(cartridge.readRam(0xa000)).toBe(bank + 10)
    }
    for (const selection of [4, 7, 8, 12, 13, 255]) {
      cartridge.writeRom(0x4000, selection)
      expect(cartridge.readRam(0xa000)).toBe(0xff)
      cartridge.writeRam(0xa000, 1)
    }
    expect(cartridge.exportBatteryRtc()).toBeNull()
    expect(() => cartridge.importBatteryRtc({})).toThrow(/não possui RTC/)
  })

  it('latch exige a sequência exata 00 depois 01 e não interrompe o relógio', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x0f))
    enable(cartridge)
    writeRtc(cartridge, 8, 10)
    latch(cartridge)
    expect(readRtc(cartridge, 8)).toBe(10)
    cartridge.tick(2 * DMG_CLOCK_HZ)
    expect(readRtc(cartridge, 8)).toBe(10)
    cartridge.writeRom(0x6000, 1)
    expect(readRtc(cartridge, 8)).toBe(10)
    cartridge.writeRom(0x6000, 2)
    cartridge.writeRom(0x6000, 1)
    expect(readRtc(cartridge, 8)).toBe(10)
    latch(cartridge)
    expect(readRtc(cartridge, 8)).toBe(12)
    cartridge.writeRom(0, 0)
    writeRtc(cartridge, 8, 45)
    expect(readRtc(cartridge, 8)).toBe(0xff)
    enable(cartridge)
    latch(cartridge)
    expect(readRtc(cartridge, 8)).toBe(12)
  })

  it('avança exatamente em T-cycles, conserva a fase subsegundo e descarta o tempo em halt', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x0f))
    enable(cartridge)
    cartridge.tick(DMG_CLOCK_HZ - 1)
    expect(cartridge.exportBatteryRtc()).toMatchObject({
      seconds: 0,
      subsecondTCycles: DMG_CLOCK_HZ - 1,
    })
    expect(cartridge.batteryRevision).toBe(0)
    cartridge.tick(1)
    expect(cartridge.exportBatteryRtc()).toMatchObject({ seconds: 1, subsecondTCycles: 0 })
    expect(cartridge.batteryRevision).toBe(1)
    cartridge.tick(123)
    writeRtc(cartridge, 12, 0x40)
    const frozen = cartridge.exportBatteryRtc()
    cartridge.tick(3 * DMG_CLOCK_HZ)
    cartridge.advanceRtcSeconds(10_000)
    expect(cartridge.exportBatteryRtc()).toEqual(frozen)
    writeRtc(cartridge, 12, 0)
    cartridge.tick(DMG_CLOCK_HZ - 123)
    expect(cartridge.exportBatteryRtc()).toMatchObject({
      seconds: 2,
      subsecondTCycles: 0,
      halted: false,
    })
  })

  it('propaga segundos/minutos/horas/dias, torna carry persistente e permite limpá-lo', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x10, 0, 2))
    enable(cartridge)
    writeRtc(cartridge, 8, 59)
    writeRtc(cartridge, 9, 59)
    writeRtc(cartridge, 10, 23)
    writeRtc(cartridge, 11, 255)
    writeRtc(cartridge, 12, 1)
    cartridge.advanceRtcSeconds(1)
    latch(cartridge)
    expect([8, 9, 10, 11, 12].map((register) => readRtc(cartridge, register))).toEqual([
      0, 0, 0, 0, 0x80,
    ])
    cartridge.advanceRtcSeconds(512 * 86400 + 3661)
    expect(cartridge.exportBatteryRtc()).toMatchObject({
      seconds: 1,
      minutes: 1,
      hours: 1,
      days: 0,
      carry: true,
    })
    writeRtc(cartridge, 12, 0)
    expect(cartridge.exportBatteryRtc()!.carry).toBe(false)
    expect(cartridge.exportBatteryRam()!.length).toBe(8192)
  })

  it('persiste bateria RTC sem RAM e restaura o instante sem substituir latch ou registradores', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x0f))
    enable(cartridge)
    cartridge.advanceRtcSeconds(20)
    cartridge.tick(321)
    latch(cartridge)
    const rtc = cartridge.exportBatteryRtc()!
    expect(cartridge.exportBatteryRam()).toEqual(new Uint8Array(0))
    expect(() => cartridge.importBatteryRam(new Uint8Array(1))).toThrow(/não possui RAM/)
    cartridge.importBatteryRam(new Uint8Array(0))
    rtc.seconds = 33
    expect(cartridge.exportBatteryRtc()!.seconds).toBe(20)
    const revision = cartridge.batteryRevision
    cartridge.importBatteryRtc(rtc)
    expect(cartridge.batteryRevision).toBe(revision + 1)
    expect(readRtc(cartridge, 8)).toBe(20)
    latch(cartridge)
    expect(readRtc(cartridge, 8)).toBe(33)
    cartridge.importBatteryRtc(rtc)
    expect(cartridge.batteryRevision).toBe(revision + 1)
  })

  it('valida entradas explícitas e suporta intervalos longos sem loops por segundo', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x0f))
    for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => cartridge.tick(value)).toThrow(/T-cycles/)
      expect(() => cartridge.advanceRtcSeconds(value)).toThrow(/segundos/)
    }
    cartridge.advanceRtcSeconds(Number.MAX_SAFE_INTEGER)
    const state = cartridge.exportBatteryRtc()!
    const expectedSeconds = Number(BigInt(Number.MAX_SAFE_INTEGER) % 60n)
    const expectedDays = Number((BigInt(Number.MAX_SAFE_INTEGER) / 86400n) % 512n)
    expect(state.seconds).toBe(expectedSeconds)
    expect(state.days).toBe(expectedDays)
    expect(state.carry).toBe(true)
  })

  it('respeita máscaras, wrap inválido e preservação ou reset da fase segundo rtc3test', () => {
    const cartridge = new Mbc3Cartridge(bankedRom(0x0f))
    enable(cartridge)
    for (const [register, expected] of [
      [8, 63],
      [9, 63],
      [10, 31],
      [11, 255],
      [12, 0xc1],
    ]) {
      writeRtc(cartridge, register!, 0xff)
      latch(cartridge)
      expect(readRtc(cartridge, register!)).toBe(expected)
    }
    writeRtc(cartridge, 12, 1)
    cartridge.advanceRtcSeconds(1)
    expect(cartridge.exportBatteryRtc()).toMatchObject({
      seconds: 0,
      minutes: 63,
      hours: 31,
      days: 511,
    })
    writeRtc(cartridge, 8, 59)
    cartridge.advanceRtcSeconds(1)
    expect(cartridge.exportBatteryRtc()).toMatchObject({
      seconds: 0,
      minutes: 0,
      hours: 31,
      days: 511,
    })
    writeRtc(cartridge, 8, 59)
    writeRtc(cartridge, 9, 59)
    cartridge.advanceRtcSeconds(1)
    expect(cartridge.exportBatteryRtc()).toMatchObject({
      seconds: 0,
      minutes: 0,
      hours: 0,
      days: 511,
    })
    cartridge.tick(123)
    for (const register of [9, 10, 11, 12]) {
      writeRtc(cartridge, register, 0)
      expect(cartridge.exportBatteryRtc()!.subsecondTCycles).toBe(123)
    }
    const revision = cartridge.batteryRevision
    writeRtc(cartridge, 8, 0)
    expect(cartridge.exportBatteryRtc()!.subsecondTCycles).toBe(0)
    expect(cartridge.batteryRevision).toBe(revision + 1)
  })
})

describe('estados dos novos mappers', () => {
  it.each([0x06, 0x10, 0x1b])('restaura RAM, banking e fase de RTC no tipo %i', (type) => {
    const cartridge = createCartridge(bankedRom(type, 1, type === 6 ? 0 : 3))
    enable(cartridge)
    cartridge.writeRom(0x2100, 3)
    cartridge.writeRam(0xa000, 11)
    cartridge.tick?.(123)
    const state = cartridge.snapshotState()
    cartridge.writeRom(0x2100, 1)
    cartridge.writeRam(0xa000, 4)
    const revision = cartridge.batteryRevision
    cartridge.restoreState(state)
    expect(cartridge.snapshotState()).toEqual(state)
    expect(cartridge.batteryRevision).toBeGreaterThan(revision)
    state.ram[0] = 3
    expect(cartridge.readRam(0xa000) & 15).toBe(11)
  })

  it.each([0x06, 0x10, 0x1b])('rejeita estado corrupto de forma atômica no tipo %i', (type) => {
    const cartridge = createCartridge(bankedRom(type, 0, type === 6 ? 0 : 2))
    enable(cartridge)
    cartridge.writeRam(0xa000, 5)
    const before = cartridge.snapshotState()
    const revision = cartridge.batteryRevision
    const invalid = [
      null,
      { ...before, version: 2 },
      { ...before, mapper: 'MBC1' },
      { ...before, ram: new Uint8Array(0) },
      { ...before, ramEnabled: 1 },
      { ...before, romBank: -1 },
      { ...before, romBank: 512 },
      ...(type === 6 ? [{ ...before, ram: new Uint8Array(512).fill(16) }] : []),
      ...(type === 0x10
        ? [
            { ...before, rtc: null },
            { ...before, rtc: { ...(before.mapper === 'MBC3' ? before.rtc : {}), seconds: 64 } },
            { ...before, latchedRtc: new Uint8Array([0, 0, 0, 0, 2]) },
          ]
        : []),
      ...(type === 0x1b
        ? [
            { ...before, rumbleActive: true },
            { ...before, ramBank: 16 },
          ]
        : []),
    ]
    for (const state of invalid) {
      expect(() => cartridge.restoreState(state)).toThrow()
      expect(cartridge.snapshotState()).toEqual(before)
      expect(cartridge.batteryRevision).toBe(revision)
    }
  })
})
