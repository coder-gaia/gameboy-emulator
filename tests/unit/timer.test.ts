import { describe, expect, it } from 'vitest'
import { Timer } from '../../src/core/timer'
import { MemoryBus } from '../../src/core/memory'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { buildTestRom } from '../fixtures/rom'

describe('Timer DMG', () => {
  it('expõe os oito bits altos de DIV, reinicia por qualquer escrita e faz wrap de 16 bits', () => {
    const timer = new Timer()
    timer.tick(255)
    expect(timer.read8(0xff04)).toBe(0)
    timer.tick(1)
    expect(timer.read8(0xff04)).toBe(1)
    timer.tick(0xff00)
    expect(timer.systemCounter).toBe(0)
    timer.tick(1234)
    timer.write8(0xff04, 0xff)
    expect(timer.systemCounter).toBe(0)
  })

  it.each([
    [0, 1024],
    [1, 16],
    [2, 64],
    [3, 256],
  ])('incrementa TIMA na borda de descida do seletor %i a cada %i T-cycles', (select, period) => {
    const timer = new Timer()
    timer.write8(0xff07, select | 4)
    timer.tick(period - 1)
    expect(timer.read8(0xff05)).toBe(0)
    timer.tick(1)
    expect(timer.read8(0xff05)).toBe(1)
    timer.tick(period * 2)
    expect(timer.read8(0xff05)).toBe(3)
    expect(timer.read8(0xff07)).toBe(0xfc | select)
  })

  it('mantém o divisor contando com timer desligado e não incrementa TIMA na borda de subida', () => {
    const timer = new Timer()
    timer.tick(8)
    timer.write8(0xff07, 5)
    expect(timer.read8(0xff05)).toBe(0)
    timer.tick(8)
    expect(timer.read8(0xff05)).toBe(1)
    timer.write8(0xff07, 1)
    timer.tick(1024)
    expect(timer.read8(0xff05)).toBe(1)
  })

  it('escrever DIV quando o bit selecionado está alto gera um incremento antecipado', () => {
    const timer = new Timer()
    timer.write8(0xff07, 5)
    timer.tick(8)
    timer.write8(0xff04, 0)
    expect(timer.read8(0xff05)).toBe(1)
    timer.write8(0xff04, 99)
    expect(timer.read8(0xff05)).toBe(1)
  })

  it('alterar TAC ou desligar o timer DMG gera pulso somente se o sinal cair', () => {
    const timer = new Timer()
    timer.tick(8)
    timer.write8(0xff07, 5)
    timer.write8(0xff07, 6)
    expect(timer.read8(0xff05)).toBe(1)
    timer.write8(0xff07, 5)
    expect(timer.read8(0xff05)).toBe(1)
    timer.write8(0xff07, 1)
    expect(timer.read8(0xff05)).toBe(2)
  })

  function overflow(): Timer {
    const timer = new Timer()
    timer.write8(0xff05, 0xff)
    timer.write8(0xff06, 0x42)
    timer.write8(0xff07, 5)
    expect(timer.tick(16)).toBe(false)
    expect(timer.read8(0xff05)).toBe(0)
    return timer
  }

  it('overflow aguarda exatamente quatro T-cycles antes de copiar TMA e pedir IRQ', () => {
    const timer = overflow()
    expect(timer.tick(3)).toBe(false)
    expect(timer.read8(0xff05)).toBe(0)
    expect(timer.tick(1)).toBe(true)
    expect(timer.read8(0xff05)).toBe(0x42)
    expect(timer.tick(12)).toBe(false)
    expect(timer.read8(0xff05)).toBe(0x43)
  })

  it.each([0, 1, 2, 3])(
    'escrita em TIMA após %i T-cycles cancela reload e IRQ pendentes',
    (delay) => {
      const timer = overflow()
      timer.tick(delay)
      timer.write8(0xff05, 0x73)
      expect(timer.tick(4 - delay)).toBe(false)
      expect(timer.read8(0xff05)).toBe(0x73)
    },
  )

  it.each([0, 1, 2, 3])(
    'escrita em TIMA durante o T-cycle %i da janela de reload é ignorada',
    (delay) => {
      const timer = overflow()
      expect(timer.tick(4 + delay)).toBe(true)
      timer.write8(0xff05, 0x73)
      expect(timer.read8(0xff05)).toBe(0x42)
      timer.tick(4 - delay)
      timer.write8(0xff05, 0x73)
      expect(timer.read8(0xff05)).toBe(0x73)
    },
  )

  it('escrita em TMA altera o reload pendente e o TIMA durante sua janela de carga', () => {
    const timer = overflow()
    timer.write8(0xff06, 0x81)
    expect(timer.tick(4)).toBe(true)
    expect(timer.read8(0xff05)).toBe(0x81)
    timer.write8(0xff06, 0x92)
    expect(timer.read8(0xff05)).toBe(0x92)
    timer.tick(4)
    timer.write8(0xff06, 0xa3)
    expect(timer.read8(0xff05)).toBe(0x92)
  })

  it('DIV e TAC não cancelam reload pendente; escrita manual FF em TIMA não pede IRQ', () => {
    const timer = overflow()
    timer.write8(0xff04, 0)
    timer.write8(0xff07, 0)
    expect(timer.tick(4)).toBe(true)
    timer.tick(4)
    timer.write8(0xff05, 0xff)
    expect(timer.tick(4096)).toBe(false)
  })

  it('integra a IRQ do timer ao barramento e preserva os demais pedidos em IF', () => {
    const bus = new MemoryBus(new RomOnlyCartridge(buildTestRom()))
    bus.write8(0xff0f, 0x09)
    bus.write8(0xff05, 0xff)
    bus.write8(0xff06, 0x38)
    bus.write8(0xff07, 5)
    bus.tick(19)
    expect(bus.read8(0xff0f)).toBe(0xe9)
    bus.tick(1)
    expect(bus.read8(0xff0f)).toBe(0xed)
    expect(bus.read8(0xff05)).toBe(0x38)
  })

  it('avanços fragmentados e em lote têm o mesmo resultado', () => {
    const one = new Timer()
    const many = new Timer()
    for (const timer of [one, many]) {
      timer.write8(0xff05, 0xf8)
      timer.write8(0xff06, 0x27)
      timer.write8(0xff07, 5)
    }
    const irqOne = one.tick(20_003)
    let irqMany = false
    for (let index = 0; index < 20_003; index += 1) irqMany = many.tick(1) || irqMany
    expect(irqOne).toBe(irqMany)
    for (const address of [0xff04, 0xff05, 0xff06, 0xff07]) {
      expect(one.read8(address)).toBe(many.read8(address))
    }
  })

  it.each([-1, 0.25, Number.NaN, Number.POSITIVE_INFINITY])('recusa tick inválido %s', (cycles) => {
    expect(() => new Timer().tick(cycles)).toThrow(/T-cycles/)
  })
})
