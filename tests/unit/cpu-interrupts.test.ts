import { describe, expect, it } from 'vitest'
import { Cpu } from '../../src/core/cpu'
import { MemoryBus } from '../../src/core/memory'
import { RomOnlyCartridge } from '../../src/core/cartridge'
import { buildTestRom } from '../fixtures/rom'

function setup(program: readonly number[]): { bus: MemoryBus; cpu: Cpu } {
  const rom = buildTestRom({ program })
  rom[0x40] = 0xd9
  const bus = new MemoryBus(new RomOnlyCartridge(rom))
  const cpu = new Cpu(bus)
  cpu.pc = 0x150
  cpu.sp = 0xfffe
  return { bus, cpu }
}

describe('CPU: IRQ com periféricos reais', () => {
  it('EI;HALT com interrupção pendente retorna ao HALT, executando-o outra vez após RETI', () => {
    const { bus, cpu } = setup([0xfb, 0x76, 0x00])
    bus.write8(0xffff, 1)
    bus.write8(0xff0f, 1)
    expect(cpu.step()).toBe(4)
    expect(cpu.step()).toBe(4)
    expect(cpu.ime).toBe(true)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x40)
    expect(bus.read8(0xfffc) | (bus.read8(0xfffd) << 8)).toBe(0x151)
    expect(cpu.snapshot().haltBug).toBe(false)
    expect(cpu.step()).toBe(16)
    expect(cpu.pc).toBe(0x151)
    expect(cpu.step()).toBe(4)
    expect(cpu.halted).toBe(true)
    expect(cpu.pc).toBe(0x152)
  })

  it('HALT bug seguido de RST empilha o endereço do próprio RST', () => {
    const { bus, cpu } = setup([0x76, 0xff, 0x00])
    bus.write8(0xffff, 1)
    bus.write8(0xff0f, 1)
    expect(cpu.step()).toBe(4)
    expect(cpu.step()).toBe(16)
    expect(cpu.pc).toBe(0x38)
    expect(bus.read8(0xfffc) | (bus.read8(0xfffd) << 8)).toBe(0x151)
  })

  it('byte alto do PC sobre IE pode cancelar IRQ sem limpar IF nem restaurar IME', () => {
    const { bus, cpu } = setup([])
    cpu.pc = 0x204
    cpu.sp = 0
    cpu.ime = true
    bus.write8(0xffff, 4)
    bus.write8(0xff0f, 4)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0)
    expect(cpu.ime).toBe(false)
    expect(bus.read8(0xffff)).toBe(2)
    expect(bus.read8(0xff0f) & 0x1f).toBe(4)
    expect(bus.read8(0xfffe)).toBe(4)
  })

  it('byte alto do PC sobre IE pode mudar a prioridade para outra IRQ pendente', () => {
    const { bus, cpu } = setup([])
    cpu.pc = 0x204
    cpu.sp = 0
    cpu.ime = true
    bus.write8(0xffff, 3)
    bus.write8(0xff0f, 3)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x48)
    expect(bus.read8(0xff0f) & 0x1f).toBe(1)
  })

  it('byte baixo do PC sobre IE chega tarde demais para cancelar IRQ', () => {
    const { bus, cpu } = setup([])
    cpu.pc = 0x235
    cpu.sp = 1
    cpu.ime = true
    bus.write8(0xffff, 8)
    bus.write8(0xff0f, 8)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x58)
    expect(bus.read8(0xffff)).toBe(0x35)
    expect(bus.read8(0xff0f) & 0x1f).toBe(0)
  })

  it('timer acorda HALT, empilha o próximo PC e preserva pedidos de menor prioridade', () => {
    const { bus, cpu } = setup([0xfb, 0x00, 0x76, 0x00])
    bus.write8(0xffff, 4)
    cpu.step()
    cpu.step()
    cpu.step()
    expect(cpu.halted).toBe(true)
    bus.write8(0xff05, 0xff)
    bus.write8(0xff04, 0)
    bus.write8(0xff07, 5)
    for (let index = 0; index < 5; index += 1) expect(cpu.step()).toBe(4)
    expect(bus.pendingInterrupts()).toBe(4)
    bus.requestInterrupt(0x10)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x50)
    expect(cpu.halted).toBe(false)
    expect(bus.read8(0xfffc) | (bus.read8(0xfffd) << 8)).toBe(0x153)
    expect(bus.read8(0xff0f) & 0x1f).toBe(0x10)
  })

  it('consulta e reconhece IRQ por fios internos mesmo durante DMA', () => {
    const { bus, cpu } = setup([0x00])
    cpu.pc = 0xff80
    bus.write8(0xff80, 0x00)
    bus.write8(0xffff, 4)
    bus.write8(0xff0f, 4)
    bus.write8(0xff46, 0xc0)
    bus.tick(8)
    cpu.ime = true
    expect(bus.read8(0xff0f)).toBe(0xff)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x50)
    expect(bus.read8Direct(0xff0f) & 0x1f).toBe(0)
    expect(bus.read8(0xfffc) | (bus.read8(0xfffd) << 8)).toBe(0xff80)
  })

  it('STOP reinicia DIV e suspende timer e DMA até a borda de entrada informada pela plataforma', () => {
    const { bus, cpu } = setup([0x10, 0x00, 0x00])
    bus.tick(1024)
    expect(bus.read8(0xff04)).toBe(4)
    expect(cpu.step()).toBe(4)
    expect(bus.timer.systemCounter).toBe(0)
    const cycles = bus.tCycles
    expect(cpu.step()).toBe(0)
    expect(bus.tCycles).toBe(cycles)
    cpu.wakeFromStop()
    expect(cpu.step()).toBe(4)
    expect(bus.timer.systemCounter).toBe(4)
    expect(cpu.pc).toBe(0x153)
  })

  it('EI repetido mantém o primeiro prazo e DI cancela o pedido adiado', () => {
    const repeated = setup([0xfb, 0xfb, 0x00])
    repeated.bus.write8(0xffff, 1)
    repeated.bus.write8(0xff0f, 1)
    repeated.cpu.step()
    repeated.cpu.step()
    expect(repeated.cpu.step()).toBe(20)
    expect(repeated.bus.read8(0xfffc)).toBe(0x52)
    const cancelled = setup([0xfb, 0xf3, 0x00])
    cancelled.bus.write8(0xffff, 1)
    cancelled.bus.write8(0xff0f, 1)
    cancelled.cpu.step()
    cancelled.cpu.step()
    expect(cancelled.cpu.step()).toBe(4)
    expect(cancelled.cpu.ime).toBe(false)
    expect(cancelled.cpu.pc).toBe(0x153)
  })
})
