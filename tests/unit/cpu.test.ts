import { describe, expect, it } from 'vitest'
import { Cpu, CPU_FLAGS, InvalidOpcodeError, type CpuBus } from '../../src/core/cpu'

const { Z, N, H, C } = CPU_FLAGS
const registers = ['b', 'c', 'd', 'e', 'h', 'l', 'memory', 'a'] as const
const invalidOpcodes = [0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd]

class TestBus implements CpuBus {
  readonly memory = new Uint8Array(0x10000)
  readonly events: string[] = []
  cycles = 0

  read8(address: number): number {
    this.events.push(`r:${address.toString(16)}`)
    return this.memory[address]!
  }

  write8(address: number, value: number): void {
    this.events.push(`w:${address.toString(16)}:${value.toString(16)}`)
    this.memory[address] = value
  }

  tick(tCycles: number): void {
    this.events.push(`t:${tCycles}`)
    this.cycles += tCycles
  }

  executionEvents(): string[] {
    return this.events.filter((event) => event !== 'r:ffff' && event !== 'r:ff0f')
  }
}

function setup(...program: number[]): { cpu: Cpu; bus: TestBus } {
  const bus = new TestBus()
  bus.memory.set(program, 0x100)
  const cpu = new Cpu(bus)
  cpu.reset(false)
  cpu.pc = 0x100
  cpu.sp = 0xd000
  cpu.hl = 0xc000
  bus.events.length = 0
  return { cpu, bus }
}

function operand(cpu: Cpu, bus: TestBus, index: number): number {
  const register = registers[index]!
  return register === 'memory' ? bus.memory[cpu.hl]! : cpu[register]
}

function setOperand(cpu: Cpu, bus: TestBus, index: number, value: number): void {
  const register = registers[index]!
  if (register === 'memory') bus.memory[cpu.hl] = value
  else cpu[register] = value
}

function expectedAlu(operation: number, a: number, value: number, carry: number): [number, number] {
  if (operation <= 3 || operation === 7) {
    const subtraction = operation === 2 || operation === 3 || operation === 7
    const inputCarry = operation === 1 || operation === 3 ? carry : 0
    const wide = subtraction ? a - value - inputCarry : a + value + inputCarry
    const byte = wide & 255
    // XOR identifica carry/borrow no bit 4, independentemente do sinal.
    const half = ((a ^ value ^ wide) & 0x10) !== 0
    const flag =
      (byte === 0 ? Z : 0) |
      (subtraction ? N : 0) |
      (half ? H : 0) |
      (wide < 0 || wide > 255 ? C : 0)
    return [operation === 7 ? a : byte, flag]
  }
  const result = operation === 4 ? a & value : operation === 5 ? a ^ value : a | value
  return [result, (result === 0 ? Z : 0) | (operation === 4 ? H : 0)]
}

describe('SM83: registradores e estado inicial', () => {
  it('configura o estado DMG pós boot sem executar a boot ROM', () => {
    const bus = new TestBus()
    const cpu = new Cpu(bus)
    expect(cpu.snapshot()).toMatchObject({
      a: 1,
      f: Z,
      b: 0,
      c: 0x13,
      d: 0,
      e: 0xd8,
      h: 1,
      l: 0x4d,
      sp: 0xfffe,
      pc: 0x100,
      ime: false,
    })
    expect(bus.cycles).toBe(0)
    bus.memory[0x14d] = 1
    cpu.reset()
    expect(cpu.af).toBe(0x01b0)
    cpu.reset(false)
    expect([cpu.af, cpu.bc, cpu.de, cpu.hl, cpu.sp, cpu.pc, cpu.totalTCycles]).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ])
  })

  it('limita registradores a 8/16 bits e mantém bits reservados de F zerados', () => {
    const { cpu } = setup()
    cpu.af = 0xffff
    cpu.bc = 0x12345
    cpu.de = -1
    cpu.hl = 0x9876
    cpu.pc = 0x10000
    cpu.sp = -1
    expect([cpu.a, cpu.f, cpu.bc, cpu.de, cpu.h, cpu.l, cpu.pc, cpu.sp]).toEqual([
      255, 240, 0x2345, 65535, 0x98, 0x76, 0, 65535,
    ])
    cpu.f = 15
    cpu.a = 256
    expect(cpu.af).toBe(0)
  })
})

describe('SM83: cargas e barramento', () => {
  it('executa as 63 cargas entre registradores e memória com seus ciclos', () => {
    for (let destination = 0; destination < 8; destination += 1) {
      for (let source = 0; source < 8; source += 1) {
        if (source === 6 && destination === 6) continue
        const { cpu, bus } = setup(0x40 | (destination << 3) | source)
        cpu.f = 0xf0
        setOperand(cpu, bus, source, 0x5a)
        const sourceValue = operand(cpu, bus, source)
        const targetAddress = cpu.hl
        const cycles = cpu.step()
        const actual =
          destination === 6 ? bus.memory[targetAddress] : operand(cpu, bus, destination)
        expect(actual, `LD ${destination},${source}`).toBe(sourceValue)
        expect(cpu.f).toBe(0xf0)
        expect(cycles).toBe(source === 6 || destination === 6 ? 8 : 4)
        expect(bus.cycles).toBe(cycles)
      }
    }
  })

  it('carrega imediatos de 8 e 16 bits e preserva flags', () => {
    for (let index = 0; index < 8; index += 1) {
      const { cpu, bus } = setup(0x06 | (index << 3), 0xa5)
      const target = cpu.hl
      cpu.f = 0x90
      expect(cpu.step()).toBe(index === 6 ? 12 : 8)
      expect(index === 6 ? bus.memory[target] : operand(cpu, bus, index)).toBe(0xa5)
      expect(cpu.pc).toBe(0x102)
      expect(cpu.f).toBe(0x90)
    }
    for (let index = 0; index < 4; index += 1) {
      const { cpu } = setup(0x01 | (index << 4), 0x34, 0x12)
      expect(cpu.step()).toBe(12)
      expect([cpu.bc, cpu.de, cpu.hl, cpu.sp][index]).toBe(0x1234)
    }
  })

  it('implementa BC, DE, HL+ e HL- nas duas direções', () => {
    for (let pair = 0; pair < 4; pair += 1) {
      const { cpu, bus } = setup(0x02 | (pair << 4), 0x0a | (pair << 4))
      cpu.bc = cpu.de = cpu.hl = 0xc100
      cpu.a = 0xab
      expect(cpu.step()).toBe(8)
      expect(bus.memory[0xc100]).toBe(0xab)
      const after = pair === 2 ? 0xc101 : pair === 3 ? 0xc0ff : 0xc100
      expect(cpu.hl).toBe(after)
      bus.memory[after] = 0x42
      expect(cpu.step()).toBe(8)
      expect(cpu.a).toBe(0x42)
      expect(cpu.hl).toBe(pair === 2 ? 0xc102 : pair === 3 ? 0xc0fe : 0xc100)
    }
  })

  it('grava SP em little endian com wrap de endereço e ciclos ordenados', () => {
    const { cpu, bus } = setup(0x08, 0xff, 0xff)
    cpu.sp = 0x1234
    expect(cpu.step()).toBe(20)
    expect([bus.memory[0xffff], bus.memory[0]]).toEqual([0x34, 0x12])
    expect(bus.executionEvents()).toEqual([
      'r:100',
      't:4',
      'r:101',
      't:4',
      'r:102',
      't:4',
      'w:ffff:34',
      't:4',
      'w:0:12',
      't:4',
    ])
  })

  it('carrega e grava dados em endereços absolutos e de I/O', () => {
    const cases = [
      { write: [0xe0, 0x80], read: [0xf0, 0x80], address: 0xff80, cycles: 12 },
      { write: [0xe2], read: [0xf2], address: 0xff80, cycles: 8 },
      { write: [0xea, 0x80, 0xc1], read: [0xfa, 0x80, 0xc1], address: 0xc180, cycles: 16 },
    ]
    for (const entry of cases) {
      const { cpu, bus } = setup(...entry.write, ...entry.read)
      cpu.c = 0x80
      cpu.a = 0x5a
      expect(cpu.step()).toBe(entry.cycles)
      expect(bus.memory[entry.address]).toBe(0x5a)
      cpu.a = 0
      expect(cpu.step()).toBe(entry.cycles)
      expect(cpu.a).toBe(0x5a)
    }
  })

  it('faz wrap de PC entre FFFF e 0000 ao buscar imediatos', () => {
    const { cpu, bus } = setup()
    cpu.pc = 0xfffe
    bus.memory[0xfffe] = 0x01
    bus.memory[0xffff] = 0x34
    bus.memory[0] = 0x12
    expect(cpu.step()).toBe(12)
    expect(cpu.bc).toBe(0x1234)
    expect(cpu.pc).toBe(1)
  })
})

describe('SM83: ALU e flags', () => {
  const values = [0, 1, 8, 15, 16, 0x7f, 0x80, 0x99, 0xfe, 0xff]

  it('verifica aritmética e lógica nos limites de byte e nibble para todos os operandos', () => {
    for (let operation = 0; operation < 8; operation += 1) {
      for (let source = 0; source < 8; source += 1) {
        for (const accumulator of values) {
          for (const value of values) {
            for (const carry of [0, 1]) {
              const { cpu, bus } = setup(0x80 | (operation << 3) | source)
              cpu.a = accumulator
              setOperand(cpu, bus, source, value)
              cpu.f = Z | N | H | (carry ? C : 0)
              const [expectedA, expectedF] = expectedAlu(
                operation,
                cpu.a,
                operand(cpu, bus, source),
                carry,
              )
              const cycles = cpu.step()
              if (cpu.a !== expectedA || cpu.f !== expectedF || cycles !== (source === 6 ? 8 : 4)) {
                throw new Error(
                  `ALU op=${operation} src=${source} A=${accumulator} value=${value} carry=${carry}: A=${cpu.a}/${expectedA}, F=${cpu.f}/${expectedF}, ciclos=${cycles}`,
                )
              }
            }
          }
        }
      }
    }
  })

  it('verifica as versões imediatas da ALU', () => {
    for (let operation = 0; operation < 8; operation += 1) {
      for (const accumulator of values) {
        for (const value of values) {
          const { cpu } = setup(0xc6 | (operation << 3), value)
          cpu.a = accumulator
          cpu.f = C
          const [a, f] = expectedAlu(operation, accumulator, value, 1)
          expect(cpu.step()).toBe(8)
          expect([cpu.a, cpu.f]).toEqual([a, f])
        }
      }
    }
  })

  it('INC e DEC preservam carry e calculam zero/half carry para todo byte', () => {
    for (let target = 0; target < 8; target += 1) {
      for (const decrement of [false, true]) {
        for (let value = 0; value < 256; value += 1) {
          const { cpu, bus } = setup((decrement ? 0x05 : 0x04) | (target << 3))
          setOperand(cpu, bus, target, value)
          cpu.f = C
          const targetAddress = cpu.hl
          const expected = (value + (decrement ? -1 : 1)) & 255
          const half = decrement ? (value & 15) === 0 : (value & 15) === 15
          const cycles = cpu.step()
          const actual = target === 6 ? bus.memory[targetAddress] : operand(cpu, bus, target)
          const flags = C | (decrement ? N : 0) | (expected === 0 ? Z : 0) | (half ? H : 0)
          if (actual !== expected || cpu.f !== flags || cycles !== (target === 6 ? 12 : 4)) {
            throw new Error(`INC/DEC target=${target} value=${value} decrement=${decrement}`)
          }
        }
      }
    }
  })

  it('incrementa/decrementa pares com wrap sem alterar flags', () => {
    for (let pair = 0; pair < 4; pair += 1) {
      for (const decrement of [false, true]) {
        const { cpu } = setup((decrement ? 0x0b : 0x03) | (pair << 4))
        cpu.bc = cpu.de = cpu.hl = cpu.sp = decrement ? 0 : 0xffff
        cpu.f = 0xf0
        expect(cpu.step()).toBe(8)
        expect([cpu.bc, cpu.de, cpu.hl, cpu.sp][pair]).toBe(decrement ? 0xffff : 0)
        expect(cpu.f).toBe(0xf0)
      }
    }
  })

  it('ADD HL calcula carry em bits 11/15 e preserva Z', () => {
    const cases = [
      [0x0fff, 1, 0x1000, Z | H],
      [0xffff, 1, 0, Z | H | C],
      [0x7fff, 1, 0x8000, Z | H],
      [0x1000, 0x1000, 0x2000, Z],
    ]
    for (const [left, right, result, flags] of cases) {
      const { cpu } = setup(0x09)
      cpu.hl = left!
      cpu.bc = right!
      cpu.f = 0xf0
      expect(cpu.step()).toBe(8)
      expect([cpu.hl, cpu.f]).toEqual([result, flags])
    }
    const { cpu } = setup(0x29)
    cpu.hl = 0x8888
    expect(cpu.step()).toBe(8)
    expect([cpu.hl, cpu.f]).toEqual([0x1110, H | C])
  })

  it('ADD SP e LD HL,SP+e8 usam offset signed e flags da soma unsigned baixa', () => {
    const cases = [
      [0x0001, 0xff, 0x0000, H | C],
      [0x0080, 0x80, 0x0000, C],
      [0x0000, 0xff, 0xffff, 0],
      [0xffff, 0x01, 0x0000, H | C],
      [0xfff8, 0x08, 0x0000, H | C],
      [0x1230, 0xf0, 0x1220, C],
      [0x1000, 0x7f, 0x107f, 0],
    ]
    for (const opcode of [0xe8, 0xf8]) {
      for (const [sp, offset, result, flags] of cases) {
        const { cpu } = setup(opcode, offset!)
        cpu.sp = sp!
        cpu.f = 0xf0
        expect(cpu.step()).toBe(opcode === 0xe8 ? 16 : 12)
        expect(opcode === 0xe8 ? cpu.sp : cpu.hl).toBe(result)
        expect(cpu.f).toBe(flags)
        if (opcode === 0xf8) expect(cpu.sp).toBe(sp)
      }
    }
    const { cpu } = setup(0xf9)
    cpu.hl = 0x1234
    cpu.f = 0xf0
    expect(cpu.step()).toBe(8)
    expect([cpu.sp, cpu.f]).toEqual([0x1234, 0xf0])
  })

  it('DAA trata soma e subtração BCD e casos com correção manual', () => {
    const cases = [
      [0x9a, 0, 0, Z | C],
      [0x13, H, 0x19, 0],
      [0x0f, N | H, 0x09, N],
      [0xff, N | H | C, 0x99, N | C],
      [0x99, 0, 0x99, 0],
      [0x00, N | C, 0xa0, N | C],
    ]
    for (const [a, flags, result, expectedFlags] of cases) {
      const { cpu } = setup(0x27)
      cpu.a = a!
      cpu.f = flags!
      expect(cpu.step()).toBe(4)
      expect([cpu.a, cpu.f]).toEqual([result, expectedFlags])
    }
    const bcd = (decimal: number): number => (Math.floor(decimal / 10) << 4) | (decimal % 10)
    for (let left = 0; left < 100; left += 1) {
      for (let right = 0; right < 100; right += 1) {
        for (const subtraction of [false, true]) {
          const { cpu } = setup(subtraction ? 0xd6 : 0xc6, bcd(right), 0x27)
          cpu.a = bcd(left)
          cpu.step()
          cpu.step()
          const decimal = subtraction ? left - right : left + right
          const expected = bcd((decimal + 100) % 100)
          if (
            cpu.a !== expected ||
            Boolean(cpu.f & C) !== (decimal < 0 || decimal >= 100) ||
            Boolean(cpu.f & H)
          ) {
            throw new Error(
              `BCD ${left} ${subtraction ? '-' : '+'} ${right}: A=${cpu.a} F=${cpu.f}`,
            )
          }
        }
      }
    }
  })

  it('CPL, SCF e CCF preservam somente as flags especificadas', () => {
    const { cpu } = setup(0x2f, 0x37, 0x3f, 0x3f)
    cpu.a = 0x55
    cpu.f = Z | C
    expect(cpu.step()).toBe(4)
    expect([cpu.a, cpu.f]).toEqual([0xaa, 0xf0])
    cpu.step()
    expect(cpu.f).toBe(Z | C)
    cpu.step()
    expect(cpu.f).toBe(Z)
    cpu.step()
    expect(cpu.f).toBe(Z | C)
  })
})

describe('SM83: rotações e instruções CB', () => {
  function expectedRotation(operation: number, value: number, carry: number): [number, number] {
    const bits = Array.from({ length: 8 }, (_, bit) => (value >>> bit) & 1)
    let shifted: number[]
    let outputCarry = 0
    switch (operation) {
      case 0:
        shifted = [bits[7]!, ...bits.slice(0, 7)]
        outputCarry = bits[7]!
        break
      case 1:
        shifted = [...bits.slice(1), bits[0]!]
        outputCarry = bits[0]!
        break
      case 2:
        shifted = [carry, ...bits.slice(0, 7)]
        outputCarry = bits[7]!
        break
      case 3:
        shifted = [...bits.slice(1), carry]
        outputCarry = bits[0]!
        break
      case 4:
        shifted = [0, ...bits.slice(0, 7)]
        outputCarry = bits[7]!
        break
      case 5:
        shifted = [...bits.slice(1), bits[7]!]
        outputCarry = bits[0]!
        break
      case 6:
        shifted = [...bits.slice(4), ...bits.slice(0, 4)]
        break
      default:
        shifted = [...bits.slice(1), 0]
        outputCarry = bits[0]!
    }
    const result = shifted.reduce((sum, bit, index) => sum + (bit << index), 0)
    return [result, (result === 0 ? Z : 0) | (outputCarry ? C : 0)]
  }

  it('verifica resultado, flags e ciclos de todos os 256 opcodes CB', () => {
    for (let opcode = 0; opcode < 256; opcode += 1) {
      for (const value of [0, 1, 0x80, 0x81, 0x7f, 0xff]) {
        for (const carry of [0, 1]) {
          const { cpu, bus } = setup(0xcb, opcode)
          const target = opcode & 7
          const group = opcode >>> 6
          const operation = (opcode >>> 3) & 7
          setOperand(cpu, bus, target, value)
          const address = cpu.hl
          const originalFlags = Z | N | H | (carry ? C : 0)
          cpu.f = originalFlags
          let result = value
          let flags = originalFlags
          if (group === 0) [result, flags] = expectedRotation(operation, value, carry)
          if (group === 1) flags = (carry ? C : 0) | H | ((value & (1 << operation)) === 0 ? Z : 0)
          if (group === 2) result = value & (255 - (1 << operation))
          if (group === 3) result = value | (1 << operation)
          const cycles = cpu.step()
          const actual = target === 6 ? bus.memory[address] : operand(cpu, bus, target)
          const expectedCycles = target === 6 ? (group === 1 ? 12 : 16) : 8
          if (actual !== result || cpu.f !== flags || cycles !== expectedCycles) {
            throw new Error(
              `CB ${opcode.toString(16)} value=${value} carry=${carry}: result=${actual}/${result} F=${cpu.f}/${flags} T=${cycles}/${expectedCycles}`,
            )
          }
          const writes = bus.events.filter((event) => event.startsWith('w:'))
          expect(writes.length).toBe(target === 6 && group !== 1 ? 1 : 0)
        }
      }
    }
  })

  it('as quatro rotações de A sempre apagam Z, mesmo com resultado zero', () => {
    for (let operation = 0; operation < 4; operation += 1) {
      for (const value of [0, 1, 0x80, 0xff]) {
        for (const carry of [0, 1]) {
          const { cpu } = setup(0x07 | (operation << 3))
          cpu.a = value
          cpu.f = Z | N | H | (carry ? C : 0)
          const [result, flags] = expectedRotation(operation, value, carry)
          expect(cpu.step()).toBe(4)
          expect([cpu.a, cpu.f]).toEqual([result, flags & ~Z])
        }
      }
    }
  })
})

describe('SM83: saltos e pilha', () => {
  it('JR usa offset signed, inclusive wrap', () => {
    const { cpu, bus } = setup(0x18, 0xfe)
    expect(cpu.step()).toBe(12)
    expect(cpu.pc).toBe(0x100)
    cpu.pc = 0xfffd
    bus.memory[0xfffd] = 0x18
    bus.memory[0xfffe] = 0x02
    expect(cpu.step()).toBe(12)
    expect(cpu.pc).toBe(1)
  })

  it('JR, JP, CALL e RET condicionais distinguem taken e not taken', () => {
    for (let condition = 0; condition < 4; condition += 1) {
      for (const taken of [false, true]) {
        const flag = condition < 2 ? Z : C
        const flags = (condition % 2 === 1) === taken ? flag : 0
        const jr = setup(0x20 | (condition << 3), 0x10)
        jr.cpu.f = flags
        expect(jr.cpu.step()).toBe(taken ? 12 : 8)
        expect(jr.cpu.pc).toBe(taken ? 0x112 : 0x102)
        const jp = setup(0xc2 | (condition << 3), 0x34, 0x12)
        jp.cpu.f = flags
        expect(jp.cpu.step()).toBe(taken ? 16 : 12)
        expect(jp.cpu.pc).toBe(taken ? 0x1234 : 0x103)
        const call = setup(0xc4 | (condition << 3), 0x34, 0x12)
        call.cpu.f = flags
        expect(call.cpu.step()).toBe(taken ? 24 : 12)
        expect(call.cpu.pc).toBe(taken ? 0x1234 : 0x103)
        expect(call.cpu.sp).toBe(taken ? 0xcffe : 0xd000)
        if (taken) expect([call.bus.memory[0xcffe], call.bus.memory[0xcfff]]).toEqual([3, 1])
        const ret = setup(0xc0 | (condition << 3))
        ret.cpu.f = flags
        ret.bus.memory[0xd000] = 0x34
        ret.bus.memory[0xd001] = 0x12
        expect(ret.cpu.step()).toBe(taken ? 20 : 8)
        expect(ret.cpu.pc).toBe(taken ? 0x1234 : 0x101)
        expect(ret.cpu.sp).toBe(taken ? 0xd002 : 0xd000)
      }
    }
  })

  it('CALL e RET preservam o endereço de retorno e a ordem dos acessos', () => {
    const { cpu, bus } = setup(0xcd, 0x00, 0x20)
    bus.memory[0x2000] = 0xc9
    expect(cpu.step()).toBe(24)
    expect(bus.executionEvents()).toEqual([
      'r:100',
      't:4',
      'r:101',
      't:4',
      'r:102',
      't:4',
      't:4',
      'w:cfff:1',
      't:4',
      'w:cffe:3',
      't:4',
    ])
    expect(cpu.pc).toBe(0x2000)
    bus.events.length = 0
    expect(cpu.step()).toBe(16)
    expect([cpu.pc, cpu.sp]).toEqual([0x103, 0xd000])
    expect(bus.executionEvents()).toEqual([
      'r:2000',
      't:4',
      'r:cffe',
      't:4',
      'r:cfff',
      't:4',
      't:4',
    ])
  })

  it('PUSH e POP tratam todos os pares, wrap de SP e bits reservados de AF', () => {
    for (let pair = 0; pair < 4; pair += 1) {
      const { cpu, bus } = setup(0xc5 | (pair << 4), 0xc1 | (pair << 4))
      cpu.bc = cpu.de = cpu.hl = cpu.af = 0x12f0
      cpu.sp = 0
      expect(cpu.step()).toBe(16)
      expect(cpu.sp).toBe(0xfffe)
      expect([bus.memory[0xfffe], bus.memory[0xffff]]).toEqual([0xf0, 0x12])
      bus.memory[0xfffe] = 0xff
      expect(cpu.step()).toBe(12)
      expect([cpu.bc, cpu.de, cpu.hl, cpu.af][pair]).toBe(pair === 3 ? 0x12f0 : 0x12ff)
      expect(cpu.sp).toBe(0)
    }
  })

  it('implementa oito vetores RST e JP absoluto/HL', () => {
    for (let vector = 0; vector < 8; vector += 1) {
      const { cpu, bus } = setup(0xc7 | (vector << 3))
      expect(cpu.step()).toBe(16)
      expect(cpu.pc).toBe(vector * 8)
      expect([bus.memory[0xcffe], bus.memory[0xcfff]]).toEqual([1, 1])
    }
    const { cpu, bus } = setup(0xc3, 0x00, 0x20)
    expect(cpu.step()).toBe(16)
    expect(cpu.pc).toBe(0x2000)
    bus.memory[0x2000] = 0xe9
    cpu.hl = 0x4321
    expect(cpu.step()).toBe(4)
    expect(cpu.pc).toBe(0x4321)
  })
})

describe('SM83: interrupções e espera', () => {
  it('EI aguarda uma instrução, EI repetido preserva o prazo e DI cancela', () => {
    const { cpu, bus } = setup(0xfb, 0x00, 0x00)
    bus.memory[0xffff] = 1
    bus.memory[0xff0f] = 1
    expect(cpu.step()).toBe(4)
    expect(cpu.ime).toBe(false)
    expect(cpu.step()).toBe(4)
    expect(cpu.ime).toBe(true)
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x40)
    expect(bus.memory[0xff0f]).toBe(0)
    expect([bus.memory[0xcffe], bus.memory[0xcfff]]).toEqual([2, 1])
    const repeated = setup(0xfb, 0xfb, 0x00)
    repeated.cpu.step()
    repeated.cpu.step()
    expect(repeated.cpu.ime).toBe(true)
    const cancelled = setup(0xfb, 0xf3, 0x00)
    cancelled.bus.memory[0xffff] = 1
    cancelled.bus.memory[0xff0f] = 1
    cancelled.cpu.step()
    cancelled.cpu.step()
    cancelled.cpu.step()
    expect(cancelled.cpu.ime).toBe(false)
    expect(cancelled.cpu.pc).toBe(0x103)
  })

  it('seleciona a interrupção de maior prioridade e RETI habilita IME imediatamente', () => {
    const { cpu, bus } = setup()
    cpu.ime = true
    bus.memory[0xffff] = 0x1f
    bus.memory[0xff0f] = 0xf6
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x48)
    expect(cpu.ime).toBe(false)
    expect(bus.memory[0xff0f]).toBe(0xf4)
    expect(bus.executionEvents()).toEqual([
      't:4',
      't:4',
      'w:cfff:1',
      't:4',
      'w:ff0f:f4',
      'w:cffe:0',
      't:4',
      't:4',
    ])
    bus.memory[0x48] = 0xd9
    expect(cpu.step()).toBe(16)
    expect([cpu.pc, cpu.sp, cpu.ime]).toEqual([0x100, 0xd000, true])
    expect(cpu.step()).toBe(20)
    expect(cpu.pc).toBe(0x50)
  })

  it('HALT avança periféricos e acorda por interrupção habilitada com IME desligado', () => {
    const { cpu, bus } = setup(0x76, 0x00)
    expect(cpu.step()).toBe(4)
    expect(cpu.halted).toBe(true)
    expect(cpu.step()).toBe(4)
    expect(cpu.pc).toBe(0x101)
    bus.memory[0xff0f] = 1
    expect(cpu.step()).toBe(4)
    expect(cpu.halted).toBe(true)
    bus.memory[0xffff] = 1
    expect(cpu.step()).toBe(4)
    expect(cpu.halted).toBe(false)
    expect(cpu.pc).toBe(0x102)
    expect(bus.memory[0xff0f]).toBe(1)
  })

  it('reproduz halt bug omitindo um incremento de PC', () => {
    const { cpu, bus } = setup(0x76, 0x3e, 0x12)
    bus.memory[0xffff] = 1
    bus.memory[0xff0f] = 1
    cpu.step()
    expect(cpu.halted).toBe(false)
    expect(cpu.snapshot().haltBug).toBe(true)
    expect(cpu.step()).toBe(8)
    expect([cpu.a, cpu.pc]).toEqual([0x3e, 0x102])
  })

  it('STOP consome o padding e suspende o relógio até wakeFromStop', () => {
    const { cpu, bus } = setup(0x10, 0x00, 0x00)
    expect(cpu.step()).toBe(4)
    expect(cpu.pc).toBe(0x102)
    expect(cpu.stopped).toBe(true)
    expect(cpu.step()).toBe(0)
    expect(bus.cycles).toBe(4)
    cpu.wakeFromStop()
    expect(cpu.step()).toBe(4)
    expect(cpu.pc).toBe(0x103)
  })
})

describe('SM83: diagnóstico e serialização', () => {
  it('identifica os onze opcodes inválidos por opcode e PC', () => {
    for (const opcode of invalidOpcodes) {
      const { cpu, bus } = setup(opcode)
      try {
        cpu.step()
        throw new Error('Opcode inválido foi aceito.')
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidOpcodeError)
        expect(error).toMatchObject({ opcode, address: 0x100 })
        expect((error as Error).message).toContain('PC=0x0100')
      }
      expect(bus.cycles).toBe(4)
    }
  })

  it('todos os 245 opcodes base válidos são decodificados', () => {
    for (let opcode = 0; opcode < 256; opcode += 1) {
      if (invalidOpcodes.includes(opcode)) continue
      const { cpu } = setup(opcode, 0, 0)
      expect(() => cpu.step(), `Opcode ${opcode.toString(16)}`).not.toThrow()
      expect(cpu.f & 15).toBe(0)
    }
  })

  it('executa uma rotina completa com loop, chamada e resultado em memória', () => {
    const { cpu, bus } = setup(
      0x06,
      0x05, // LD B,5
      0x3e,
      0x00, // LD A,0
      0x80, // ADD A,B
      0x05, // DEC B
      0x20,
      0xfc, // JR NZ,loop
      0xcd,
      0x00,
      0x02, // CALL 0200
      0x76, // HALT
    )
    bus.memory.set([0xea, 0x00, 0xc1, 0xc9], 0x200)
    let steps = 0
    while (!cpu.halted && steps < 100) {
      cpu.step()
      steps += 1
    }
    expect(steps).toBe(21)
    expect([cpu.a, cpu.b, bus.memory[0xc100], cpu.sp, cpu.pc]).toEqual([15, 0, 15, 0xd000, 0x10c])
    expect(cpu.totalTCycles).toBe(bus.cycles)
  })

  it('restaura estado e repete a mesma sequência com resultado determinístico', () => {
    const { cpu, bus } = setup(0xfb, 0x3e, 0x0f, 0xc6, 0x01, 0x27, 0xea, 0x00, 0xc1, 0x76)
    cpu.step()
    const initialCpu = JSON.parse(JSON.stringify(cpu.snapshot())) as unknown
    const initialMemory = bus.memory.slice()
    const initialCycles = bus.cycles
    const run = (): {
      state: ReturnType<Cpu['snapshot']>
      memory: Uint8Array
      cycles: number[]
    } => {
      const cycles = Array.from({ length: 5 }, () => cpu.step())
      return { state: cpu.snapshot(), memory: bus.memory.slice(), cycles }
    }
    const first = run()
    cpu.restore(initialCpu)
    bus.memory.set(initialMemory)
    bus.cycles = initialCycles
    expect(run()).toEqual(first)
  })

  it('valida o estado inteiro antes de alterar a CPU', () => {
    const { cpu } = setup(0x00)
    cpu.step()
    const original = cpu.snapshot()
    const corruptions: unknown[] = [
      null,
      [],
      {},
      { ...original, version: 2 },
      { ...original, a: 256 },
      { ...original, f: 15 },
      { ...original, sp: -1 },
      { ...original, pc: 1.5 },
      { ...original, totalTCycles: Number.NaN },
      { ...original, totalTCycles: Number.MAX_SAFE_INTEGER + 1 },
      { ...original, ime: 1 },
      { ...original, halted: true, stopped: true },
      { ...original, imeEnableDelay: 3 },
      { ...original, haltBug: undefined },
    ]
    for (const state of corruptions) {
      expect(() => cpu.restore(state)).toThrow()
      expect(cpu.snapshot()).toEqual(original)
    }
  })
})
