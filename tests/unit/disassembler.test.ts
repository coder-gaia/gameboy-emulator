import { describe, expect, it } from 'vitest'
import { disassemble, disassembleInstruction } from '../../src/core/debug'

// Comprimentos por linha da tabela SM83, independentes do decodificador.
// CB é contado junto com o segundo opcode e STOP inclui o byte seguinte.
const LENGTH_ROWS = [
  '1311112131111121',
  '2311112121111121',
  '2311112121111121',
  '2311112121111121',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1133312111323321',
  '1131312111313121',
  '2111112121311121',
  '2111112121311121',
] as const
const INVALID = new Set([0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd])
const REGISTERS = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'] as const

function decode(bytes: readonly number[], location = 0xc000) {
  const memory = new Uint8Array(65536)
  bytes.forEach((byte, index) => {
    memory[(location + index) & 0xffff] = byte
  })
  return disassembleInstruction((address) => memory[address]!, location)
}

describe('desassemblador SM83', () => {
  it.each(Array.from({ length: 256 }, (_, opcode) => opcode))(
    'decodifica comprimento, validade e bytes exatos do opcode base %i',
    (opcode) => {
      const reads: number[] = []
      const input = [opcode, 0x34, 0x12]
      const line = disassembleInstruction((address) => {
        reads.push(address)
        return input[address - 0xc000]!
      }, 0xc000)
      const length = Number(LENGTH_ROWS[opcode >> 4]![opcode & 15])
      expect(line.address).toBe(0xc000)
      expect(line.length).toBe(length)
      expect(line.bytes).toEqual(Uint8Array.from(input.slice(0, length)))
      expect(reads).toEqual(Array.from({ length }, (_, offset) => 0xc000 + offset))
      expect(line.valid).toBe(!INVALID.has(opcode))
      expect(line.mnemonic).not.toMatch(/undefined|NaN/)
      expect(line.mnemonic).not.toBe('')
      if (INVALID.has(opcode))
        expect(line.mnemonic).toBe(`INVÁLIDO $${opcode.toString(16).toUpperCase()}`)
    },
  )

  const cbCases = [
    ...['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SWAP', 'SRL'].flatMap((operation) =>
      REGISTERS.map((register) => `${operation} ${register}`),
    ),
    ...['BIT', 'RES', 'SET'].flatMap((operation) =>
      Array.from({ length: 8 }, (_, bit) =>
        REGISTERS.map((register) => `${operation} ${bit}, ${register}`),
      ).flat(),
    ),
  ]
  it.each(cbCases.map((mnemonic, opcode) => [opcode, mnemonic] as const))(
    'decodifica opcode CB %i como %s',
    (opcode, mnemonic) => {
      expect(decode([0xcb, opcode])).toEqual({
        address: 0xc000,
        bytes: new Uint8Array([0xcb, opcode]),
        mnemonic,
        length: 2,
        valid: true,
      })
    },
  )

  it.each([
    [[0x00], 'NOP'],
    [[0x01, 0x34, 0x12], 'LD BC, $1234'],
    [[0x02], 'LD (BC), A'],
    [[0x0a], 'LD A, (BC)'],
    [[0x22], 'LD (HL+), A'],
    [[0x3a], 'LD A, (HL-)'],
    [[0x03], 'INC BC'],
    [[0x3b], 'DEC SP'],
    [[0x34], 'INC (HL)'],
    [[0x3d], 'DEC A'],
    [[0x36, 0x34], 'LD (HL), $34'],
    [[0x08, 0x34, 0x12], 'LD ($1234), SP'],
    [[0x39], 'ADD HL, SP'],
    [[0x76], 'HALT'],
    [[0x7e], 'LD A, (HL)'],
    [[0x77], 'LD (HL), A'],
    [[0xc0], 'RET NZ'],
    [[0xc1], 'POP BC'],
    [[0xf5], 'PUSH AF'],
    [[0xc2, 0x34, 0x12], 'JP NZ, $1234'],
    [[0xda, 0x34, 0x12], 'JP C, $1234'],
    [[0xdc, 0x34, 0x12], 'CALL C, $1234'],
    [[0xcd, 0x34, 0x12], 'CALL $1234'],
    [[0xc9], 'RET'],
    [[0xd9], 'RETI'],
    [[0xe9], 'JP HL'],
    [[0xf9], 'LD SP, HL'],
    [[0xe0, 0x34], 'LDH ($FF34), A'],
    [[0xf0, 0x34], 'LDH A, ($FF34)'],
    [[0xe2], 'LDH (C), A'],
    [[0xf2], 'LDH A, (C)'],
    [[0xea, 0x34, 0x12], 'LD ($1234), A'],
    [[0xfa, 0x34, 0x12], 'LD A, ($1234)'],
    [[0xf3], 'DI'],
    [[0xfb], 'EI'],
    [[0xc7], 'RST $00'],
    [[0xff], 'RST $38'],
    [[0x07], 'RLCA'],
    [[0x0f], 'RRCA'],
    [[0x17], 'RLA'],
    [[0x1f], 'RRA'],
    [[0x27], 'DAA'],
    [[0x2f], 'CPL'],
    [[0x37], 'SCF'],
    [[0x3f], 'CCF'],
  ] as const)('apresenta operandos para %j como %s', (bytes, mnemonic) => {
    expect(decode(bytes).mnemonic).toBe(mnemonic)
  })

  it.each(['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'XOR', 'OR', 'CP'])(
    'apresenta A e registradores ou imediato na família %s',
    (operation) => {
      const family = ['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'XOR', 'OR', 'CP'].indexOf(operation)
      for (let register = 0; register < REGISTERS.length; register += 1) {
        expect(decode([0x80 + family * 8 + register]).mnemonic).toBe(
          `${operation} A, ${REGISTERS[register]}`,
        )
      }
      expect(decode([0xc6 + family * 8, 0x34]).mnemonic).toBe(`${operation} A, $34`)
    },
  )

  it.each([
    [[0x18, 0], 0xc000, 'JR $C002'],
    [[0x18, 0xfe], 0xc000, 'JR $C000'],
    [[0x20, 0x80], 0xc000, 'JR NZ, $BF82'],
    [[0x28, 0x7f], 0xffff, 'JR Z, $0080'],
    [[0x30, 0xfd], 0, 'JR NC, $FFFF'],
    [[0x38, 0xff], 0xc000, 'JR C, $C001'],
    [[0xe8, 0x80], 0, 'ADD SP, -128'],
    [[0xe8, 0x7f], 0, 'ADD SP, +127'],
    [[0xf8, 0xff], 0, 'LD HL, SP-1'],
    [[0xf8, 0], 0, 'LD HL, SP+0'],
  ] as const)('resolve saltos e offsets assinados de %j em %i', (bytes, start, mnemonic) => {
    expect(decode(bytes, start).mnemonic).toBe(mnemonic)
  })

  it('inclui STOP e seu byte seguinte, sem executar a parada ou validar padding como opcode', () => {
    expect(decode([0x10, 0])).toMatchObject({
      mnemonic: 'STOP',
      length: 2,
      valid: true,
      bytes: new Uint8Array([0x10, 0]),
    })
    expect(decode([0x10, 0xd3])).toMatchObject({
      mnemonic: 'STOP',
      length: 2,
      valid: true,
      bytes: new Uint8Array([0x10, 0xd3]),
    })
  })

  it('lê word e prefixo CB com wrap e percorre instruções linearmente sem seguir fluxo', () => {
    expect(decode([0xc3, 0x34, 0x12], 0xffff)).toMatchObject({
      address: 0xffff,
      length: 3,
      mnemonic: 'JP $1234',
    })
    expect(decode([0xcb, 0x7e], 0xffff).mnemonic).toBe('BIT 7, (HL)')
    const memory = new Uint8Array(65536)
    memory[0xffff] = 0xc3
    memory[0] = 0x34
    memory[1] = 0x12
    memory[2] = 0xd3
    const lines = disassemble((address) => memory[address]!, 0xffff)
    expect(lines).toHaveLength(12)
    expect(lines.slice(0, 3).map((line) => line.address)).toEqual([0xffff, 2, 3])
    expect(lines[1]).toMatchObject({ valid: false, length: 1 })
    lines[0]!.bytes.fill(0)
    expect(memory[0xffff]).toBe(0xc3)
    expect(disassemble((address) => memory[address]!, 0, 0)).toEqual([])
  })

  it('recusa endereços e contagens inválidos antes de consultar a memória', () => {
    const noRead = () => {
      throw new Error('Não deveria ler memória.')
    }
    for (const start of [-1, 65536, 0.5, NaN, Infinity]) {
      expect(() => disassembleInstruction(noRead, start)).toThrow(/endereço/)
      expect(() => disassemble(noRead, start)).toThrow(/endereço/)
    }
    for (const count of [-1, 257, 0.5, NaN, Infinity])
      expect(() => disassemble(noRead, 0, count)).toThrow(/quantidade/)
  })
})
