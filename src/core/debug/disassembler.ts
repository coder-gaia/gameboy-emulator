export interface DisassembledInstruction {
  readonly address: number
  readonly bytes: Uint8Array
  readonly mnemonic: string
  readonly length: number
  readonly valid: boolean
}

export type DebugByteReader = (address: number) => number

const REGISTERS = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'] as const
const PAIRS = ['BC', 'DE', 'HL', 'SP'] as const
const STACK_PAIRS = ['BC', 'DE', 'HL', 'AF'] as const
const MEMORY_PAIRS = ['(BC)', '(DE)', '(HL+)', '(HL-)'] as const
const CONDITIONS = ['NZ', 'Z', 'NC', 'C'] as const
const ALU = ['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'XOR', 'OR', 'CP'] as const
const ROTATIONS = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SWAP', 'SRL'] as const
const SINGLE_BYTE_OPERATIONS = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'] as const

function address(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff)
    throw new RangeError('O endereço do desassemblador precisa ser um inteiro entre 0 e 65535.')
  return value
}

function hex(value: number, width = 2): string {
  return `$${value.toString(16).toUpperCase().padStart(width, '0')}`
}

function signed(value: number): number {
  return value < 0x80 ? value : value - 0x100
}
function signedText(value: number): string {
  const offset = signed(value)
  return offset < 0 ? String(offset) : `+${offset}`
}

/** Decodifica dados, sem executar a CPU ou seguir saltos e chamadas. */
export function disassembleInstruction(
  readByte: DebugByteReader,
  start: number,
): DisassembledInstruction {
  const location = address(start)
  const opcode = readByte(location) & 0xff
  const x = opcode >> 6
  const y = (opcode >> 3) & 7
  const z = opcode & 7
  const p = y >> 1
  const q = y & 1
  const bytes = [opcode]
  const next = () => {
    const value = readByte((location + bytes.length) & 0xffff) & 0xff
    bytes.push(value)
    return value
  }
  const immediate = () => hex(next())
  const word = () => {
    const low = next()
    return hex(low | (next() << 8), 4)
  }
  const relative = () => hex((location + 2 + signed(next())) & 0xffff, 4)
  let mnemonic = ''
  let valid = true

  if (x === 0) {
    switch (z) {
      case 0:
        if (y === 0) mnemonic = 'NOP'
        else if (y === 1) mnemonic = `LD (${word()}), SP`
        else if (y === 2) {
          next()
          mnemonic = 'STOP'
        } else if (y === 3) mnemonic = `JR ${relative()}`
        else mnemonic = `JR ${CONDITIONS[y - 4]}, ${relative()}`
        break
      case 1:
        mnemonic = q === 0 ? `LD ${PAIRS[p]}, ${word()}` : `ADD HL, ${PAIRS[p]}`
        break
      case 2:
        mnemonic = q === 0 ? `LD ${MEMORY_PAIRS[p]}, A` : `LD A, ${MEMORY_PAIRS[p]}`
        break
      case 3:
        mnemonic = `${q === 0 ? 'INC' : 'DEC'} ${PAIRS[p]}`
        break
      case 4:
        mnemonic = `INC ${REGISTERS[y]}`
        break
      case 5:
        mnemonic = `DEC ${REGISTERS[y]}`
        break
      case 6:
        mnemonic = `LD ${REGISTERS[y]}, ${immediate()}`
        break
      case 7:
        mnemonic = SINGLE_BYTE_OPERATIONS[y]!
        break
    }
  } else if (x === 1) mnemonic = opcode === 0x76 ? 'HALT' : `LD ${REGISTERS[y]}, ${REGISTERS[z]}`
  else if (x === 2) mnemonic = `${ALU[y]} A, ${REGISTERS[z]}`
  else {
    switch (z) {
      case 0:
        if (y < 4) mnemonic = `RET ${CONDITIONS[y]}`
        else if (y === 4) mnemonic = `LDH (${hex(0xff00 | next(), 4)}), A`
        else if (y === 5) mnemonic = `ADD SP, ${signedText(next())}`
        else if (y === 6) mnemonic = `LDH A, (${hex(0xff00 | next(), 4)})`
        else mnemonic = `LD HL, SP${signedText(next())}`
        break
      case 1:
        if (q === 0) mnemonic = `POP ${STACK_PAIRS[p]}`
        else mnemonic = ['RET', 'RETI', 'JP HL', 'LD SP, HL'][p]!
        break
      case 2:
        if (y < 4) mnemonic = `JP ${CONDITIONS[y]}, ${word()}`
        else if (y === 4) mnemonic = 'LDH (C), A'
        else if (y === 5) mnemonic = `LD (${word()}), A`
        else if (y === 6) mnemonic = 'LDH A, (C)'
        else mnemonic = `LD A, (${word()})`
        break
      case 3:
        if (y === 0) mnemonic = `JP ${word()}`
        else if (y === 1) {
          const cb = next()
          const group = cb >> 6
          const operation = (cb >> 3) & 7
          const register = REGISTERS[cb & 7]
          mnemonic =
            group === 0
              ? `${ROTATIONS[operation]} ${register}`
              : `${['BIT', 'RES', 'SET'][group - 1]} ${operation}, ${register}`
        } else if (y === 6) mnemonic = 'DI'
        else if (y === 7) mnemonic = 'EI'
        else valid = false
        break
      case 4:
        if (y < 4) mnemonic = `CALL ${CONDITIONS[y]}, ${word()}`
        else valid = false
        break
      case 5:
        if (q === 0) mnemonic = `PUSH ${STACK_PAIRS[p]}`
        else if (p === 0) mnemonic = `CALL ${word()}`
        else valid = false
        break
      case 6:
        mnemonic = `${ALU[y]} A, ${immediate()}`
        break
      case 7:
        mnemonic = `RST ${hex(y * 8)}`
        break
    }
  }

  return {
    address: location,
    bytes: Uint8Array.from(bytes),
    mnemonic: valid ? mnemonic : `INVÁLIDO ${hex(opcode)}`,
    length: bytes.length,
    valid,
  }
}

/** Percorre linearmente até 256 instruções, com wrap no espaço de 16 bits. */
export function disassemble(
  readByte: DebugByteReader,
  start: number,
  count = 12,
): DisassembledInstruction[] {
  let location = address(start)
  if (!Number.isSafeInteger(count) || count < 0 || count > 256)
    throw new RangeError('A quantidade de linhas precisa ser um inteiro entre 0 e 256.')
  const lines: DisassembledInstruction[] = []
  for (let index = 0; index < count; index += 1) {
    const line = disassembleInstruction(readByte, location)
    lines.push(line)
    location = (location + line.length) & 0xffff
  }
  return lines
}
