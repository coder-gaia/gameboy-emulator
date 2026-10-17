import { deepStrictEqual } from 'node:assert'
import { describe, expect, it } from 'vitest'
import { captureHardwareDebug } from '../../src/core/debug'
import { GameBoy } from '../../src/core/gameboy'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import { buildTestRom } from '../fixtures/rom'

function preparedMachine(): GameBoy {
  const device = new GameBoy(
    buildTestRom({ title: 'DEBUG RTC', cartridgeType: 0x10, ramSizeCode: 3, program: [0x76] }),
  )
  const bus = device.bus
  for (let index = 0; index < bus.ppu.vram.length; index += 1) bus.ppu.vram[index] = index & 0xff
  for (let index = 0; index < bus.ppu.oam.length; index += 1)
    bus.ppu.oam[index] = (index + 17) & 0xff
  for (let index = 0; index < 256; index += 1) bus.write8Direct(0xc000 + index, index ^ 0xa5)
  bus.write8Direct(0, 0x0a)
  bus.write8Direct(0xa000, 0x67)
  device.cartridge.advanceRtcSeconds?.(86405)
  device.cartridge.tick?.(12345)
  bus.write8Direct(0xff01, 0x51)
  bus.write8Direct(0xff02, 0x81)
  bus.tick(4096)
  // Modo 3 e DMA parcial tornam as leituras da CPU diferentes dos dados brutos.
  while (bus.ppu.mode !== 3) bus.tick(1)
  bus.write8Direct(0xff46, 0xc0)
  bus.tick(13)
  bus.write8Direct(0xffff, 0x17)
  bus.write8Direct(0xff0f, 0x05)
  device.cpu.pc = 0xc000
  return device
}

describe('captura explícita de hardware', () => {
  it('copia CPU, 12 instruções, tiles, OAM, página de memória e periféricos', () => {
    const device = preparedMachine()
    const captured = captureHardwareDebug(device)
    deepStrictEqual(captured.cpu, device.cpu.snapshot())
    expect(captured.disassembly).toHaveLength(12)
    expect(captured.disassembly[0]!.address).toBe(device.cpu.pc)
    expect(captured.vram.length).toBe(384 * 16)
    deepStrictEqual(captured.vram, device.bus.ppu.vram.slice(0, 0x1800))
    expect(captured.oam.length).toBe(160)
    deepStrictEqual(captured.oam, device.bus.ppu.oam)
    expect(captured.memory.start).toBe(0xc000)
    deepStrictEqual(
      captured.memory.bytes,
      Uint8Array.from({ length: 256 }, (_, index) => index ^ 0xa5),
    )
    deepStrictEqual(captured.ppu, device.bus.ppu.snapshot())
    deepStrictEqual(captured.timer, device.bus.timer.snapshotState())
    deepStrictEqual(captured.dma, device.bus.dma.snapshotState())
    expect(captured.interruptEnable).toBe(0x17)
    expect(captured.interruptFlags).toBe(0xe5)
    expect(captured.cartridge).toMatchObject({
      mapper: 'MBC3',
      title: 'DEBUG RTC',
      romSize: 32768,
      ramSize: 32768,
      hasRtc: true,
      rtc: { days: 1, seconds: 5 },
    })
    expect(captured.tCycles).toBe(device.bus.tCycles)
    expect(captured.frameId).toBe(device.frameId)
  })

  it('ignora bloqueios de CPU sem modificar DMA, LCD, timer, bateria, RTC, serial ou PCM', () => {
    const device = preparedMachine()
    const bus = device.bus
    expect(bus.dma.active).toBe(true)
    expect(bus.ppu.mode).toBe(3)
    expect(bus.read8(0xc000)).toBe(0xff)
    expect(bus.serial.pendingOutputBytes).toBe(1)
    const before = device.snapshotState()
    const revision = device.cartridge.batteryRevision
    const memoryPages = [0, 0x8000, 0x9800, 0xa000, 0xc000, 0xfe00, 0xff00]
    for (const page of memoryPages) {
      const captured = captureHardwareDebug(device, page)
      expect(captured.memory.bytes[0]).toBe(bus.read8Direct(page))
      deepStrictEqual(device.snapshotState(), before)
      expect(device.cartridge.batteryRevision).toBe(revision)
      expect(bus.serial.pendingOutputBytes).toBe(1)
    }
  })

  it('arrays e objetos retornados não compartilham dados mutáveis com a máquina', () => {
    const device = preparedMachine()
    const before = device.snapshotState()
    const captured = captureHardwareDebug(device)
    captured.vram.fill(0xee)
    captured.oam.fill(0xee)
    captured.memory.bytes.fill(0xee)
    captured.disassembly[0]!.bytes.fill(0xee)
    captured.cpu.pc = 0x1234
    captured.ppu.ly = 88
    captured.cartridge.rtc!.days = 300
    deepStrictEqual(device.snapshotState(), before)
    expect(captureHardwareDebug(device)).not.toEqual(captured)
  })

  it('captura ROM sem RTC e página final de memória incluindo IE sem avançar T-cycles', () => {
    const device = new GameBoy(buildTestRom())
    device.bus.write8Direct(0xffff, 0xab)
    const captured = captureHardwareDebug(device, 0xff00)
    expect(captured.cartridge.hasRtc).toBe(false)
    expect(captured.cartridge.rtc).toBeNull()
    expect(captured.memory.bytes.length).toBe(256)
    expect(captured.memory.bytes[255]).toBe(0xab)
    expect(captured.tCycles).toBe(0)
    expect(captured.cpu.totalTCycles).toBe(0)
  })

  it('mantém reload parcial do timer e fase RTC sem alterar o instante observado', () => {
    const device = new GameBoy(buildTestRom({ cartridgeType: 0x0f }))
    device.bus.timer.restoreState({
      version: 1,
      divider: 123,
      counter: 0,
      modulo: 0x73,
      control: 5,
      reloadDelay: 2,
      reloadWindow: 0,
    })
    device.cartridge.tick?.(DMG_CLOCK_HZ - 1)
    const before = device.snapshotState()
    const debug = captureHardwareDebug(device, 0xff00)
    expect(debug.timer.reloadDelay).toBe(2)
    expect(debug.cartridge.rtc!.subsecondTCycles).toBe(DMG_CLOCK_HZ - 1)
    deepStrictEqual(device.snapshotState(), before)
  })

  it('valida alinhamento e limites antes de ler ou alocar a captura', () => {
    const device = preparedMachine()
    const before = device.snapshotState()
    for (const start of [-256, 1, 0xff01, 0x10000, 0.5, NaN, Infinity]) {
      expect(() => captureHardwareDebug(device, start)).toThrow(/alinhado/)
      deepStrictEqual(device.snapshotState(), before)
    }
  })
})
