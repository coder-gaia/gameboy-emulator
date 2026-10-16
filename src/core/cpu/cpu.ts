import { CPU_FLAGS, type CpuBus, type CpuSnapshot } from './types'

const { Z, N, H, C } = CPU_FLAGS
const IF = 0xff0f
const IE = 0xffff

export class InvalidOpcodeError extends Error {
  constructor(
    public readonly opcode: number,
    public readonly address: number,
  ) {
    super(
      `Opcode inválido 0x${opcode.toString(16).padStart(2, '0').toUpperCase()} em PC=0x${address.toString(16).padStart(4, '0').toUpperCase()}.`,
    )
    this.name = 'InvalidOpcodeError'
  }
}

/**
 * SM83 DMG. Cada acesso de memória ocupa um M-cycle de 4 T-cycles.
 * O acesso ocorre antes de tick(4), convenção compartilhada pelo barramento.
 * Fontes: https://gbdev.io/pandocs/CPU_Instruction_Set.html
 * https://rgbds.gbdev.io/docs/master/gbz80.7
 */
export class Cpu {
  private readonly bytes = new Uint8Array(8)
  private readonly words = new Uint16Array(2)
  private imeEnableDelay = 0
  private haltBug = false
  private instructionTCycles = 0
  private elapsedTCycles = 0

  public ime = false
  public halted = false
  public stopped = false

  constructor(private readonly bus: CpuBus) {
    this.reset()
  }

  get a(): number {
    return this.bytes[7]!
  }
  set a(value: number) {
    this.bytes[7] = value
  }
  get f(): number {
    return this.bytes[6]!
  }
  set f(value: number) {
    this.bytes[6] = value & 0xf0
  }
  get b(): number {
    return this.bytes[0]!
  }
  set b(value: number) {
    this.bytes[0] = value
  }
  get c(): number {
    return this.bytes[1]!
  }
  set c(value: number) {
    this.bytes[1] = value
  }
  get d(): number {
    return this.bytes[2]!
  }
  set d(value: number) {
    this.bytes[2] = value
  }
  get e(): number {
    return this.bytes[3]!
  }
  set e(value: number) {
    this.bytes[3] = value
  }
  get h(): number {
    return this.bytes[4]!
  }
  set h(value: number) {
    this.bytes[4] = value
  }
  get l(): number {
    return this.bytes[5]!
  }
  set l(value: number) {
    this.bytes[5] = value
  }
  get sp(): number {
    return this.words[0]!
  }
  set sp(value: number) {
    this.words[0] = value
  }
  get pc(): number {
    return this.words[1]!
  }
  set pc(value: number) {
    this.words[1] = value
  }

  get af(): number {
    return (this.a << 8) | this.f
  }
  set af(value: number) {
    this.a = value >>> 8
    this.f = value
  }
  get bc(): number {
    return (this.b << 8) | this.c
  }
  set bc(value: number) {
    this.b = value >>> 8
    this.c = value
  }
  get de(): number {
    return (this.d << 8) | this.e
  }
  set de(value: number) {
    this.d = value >>> 8
    this.e = value
  }
  get hl(): number {
    return (this.h << 8) | this.l
  }
  set hl(value: number) {
    this.h = value >>> 8
    this.l = value
  }
  get totalTCycles(): number {
    return this.elapsedTCycles
  }

  /**
   * Sem boot ROM: A=01, BC=0013, DE=00D8, HL=014D, SP=FFFE, PC=0100.
   * F=B0 para checksum de header diferente de zero; F=80 para checksum zero.
   * A consulta do header não avança o relógio.
   * reset(false) zera os registradores para executar uma boot ROM externa.
   * Este método não altera memória nem registradores do barramento.
   */
  reset(usePostBootState = true): void {
    this.bytes.fill(0)
    this.words.fill(0)
    this.ime = false
    this.imeEnableDelay = 0
    this.halted = false
    this.stopped = false
    this.haltBug = false
    this.instructionTCycles = 0
    this.elapsedTCycles = 0

    if (usePostBootState) {
      this.af = this.bus.read8(0x014d) === 0 ? 0x0180 : 0x01b0
      this.bc = 0x0013
      this.de = 0x00d8
      this.hl = 0x014d
      this.sp = 0xfffe
      this.pc = 0x0100
    }
  }

  /** Avança uma instrução, atendimento de interrupção ou espera de HALT. */
  step(): number {
    this.instructionTCycles = 0

    // STOP suspende o relógio até a plataforma informar a borda do joypad.
    if (this.stopped) return 0

    const pending = this.pendingInterrupts()
    if (pending !== 0) {
      this.halted = false
      if (this.ime) {
        this.serviceInterrupt(pending)
        return this.instructionTCycles
      }
    }

    if (this.halted) {
      this.idle()
      return this.instructionTCycles
    }

    const address = this.pc
    const opcode = this.read8(this.pc)
    if (this.haltBug) this.haltBug = false
    else this.pc += 1

    this.execute(opcode, address)

    if (this.imeEnableDelay > 0) {
      this.imeEnableDelay -= 1
      if (this.imeEnableDelay === 0) this.ime = true
    }

    return this.instructionTCycles
  }

  /** O joypad da plataforma chama este método ao detectar entrada em STOP. */
  wakeFromStop(): void {
    this.stopped = false
  }

  snapshot(): CpuSnapshot {
    return {
      version: 1,
      a: this.a,
      f: this.f,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.e,
      h: this.h,
      l: this.l,
      sp: this.sp,
      pc: this.pc,
      ime: this.ime,
      imeEnableDelay: this.imeEnableDelay,
      halted: this.halted,
      stopped: this.stopped,
      haltBug: this.haltBug,
      totalTCycles: this.elapsedTCycles,
    }
  }

  restore(snapshot: unknown): void {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('Estado da CPU inválido: esperado objeto.')
    }
    const state = snapshot as Record<string, unknown>
    if (state.version !== 1) throw new Error('Versão do estado da CPU incompatível.')

    const integer = (key: string, maximum: number): number => {
      const value = state[key]
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > maximum
      ) {
        throw new Error(`Estado da CPU inválido: ${key}.`)
      }
      return value
    }
    for (const key of ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l']) integer(key, 0xff)
    for (const key of ['sp', 'pc']) integer(key, 0xffff)
    integer('imeEnableDelay', 2)
    integer('totalTCycles', Number.MAX_SAFE_INTEGER)
    if ((integer('f', 0xff) & 0x0f) !== 0)
      throw new Error('Estado da CPU inválido: bits reservados de F.')
    for (const key of ['ime', 'halted', 'stopped', 'haltBug']) {
      if (typeof state[key] !== 'boolean') throw new Error(`Estado da CPU inválido: ${key}.`)
    }
    if (state.halted && state.stopped)
      throw new Error('Estado da CPU inválido: HALT e STOP simultâneos.')

    const valid = snapshot as CpuSnapshot
    this.a = valid.a
    this.f = valid.f
    this.b = valid.b
    this.c = valid.c
    this.d = valid.d
    this.e = valid.e
    this.h = valid.h
    this.l = valid.l
    this.sp = valid.sp
    this.pc = valid.pc
    this.ime = valid.ime
    this.imeEnableDelay = valid.imeEnableDelay
    this.halted = valid.halted
    this.stopped = valid.stopped
    this.haltBug = valid.haltBug
    this.elapsedTCycles = valid.totalTCycles
    this.instructionTCycles = 0
  }

  private tick(): void {
    this.bus.tick(4)
    this.instructionTCycles += 4
    this.elapsedTCycles += 4
  }

  private idle(cycles = 4): void {
    for (let elapsed = 0; elapsed < cycles; elapsed += 4) this.tick()
  }

  private read8(address: number): number {
    const value = this.bus.read8(address & 0xffff) & 0xff
    this.tick()
    return value
  }

  private write8(address: number, value: number): void {
    this.bus.write8(address & 0xffff, value & 0xff)
    this.tick()
  }

  private fetch8(): number {
    const value = this.read8(this.pc)
    this.pc += 1
    return value
  }

  private fetch16(): number {
    const low = this.fetch8()
    return low | (this.fetch8() << 8)
  }

  private push(value: number): void {
    this.sp -= 1
    this.write8(this.sp, value >>> 8)
    this.sp -= 1
    this.write8(this.sp, value)
  }

  private pop(): number {
    const low = this.read8(this.sp)
    this.sp += 1
    const high = this.read8(this.sp)
    this.sp += 1
    return low | (high << 8)
  }

  private pendingInterrupts(): number {
    // IE/IF são consultados por fios internos, sem consumir M-cycles extras.
    return this.bus.read8(IE) & this.bus.read8(IF) & 0x1f
  }

  private serviceInterrupt(pending: number): void {
    let index = 0
    while ((pending & (1 << index)) === 0) index += 1
    this.ime = false
    this.imeEnableDelay = 0
    this.haltBug = false
    this.bus.write8(IF, this.bus.read8(IF) & ~(1 << index))
    this.idle(8)
    this.push(this.pc)
    this.pc = 0x40 + index * 8
    this.idle()
  }

  private readR8(index: number): number {
    if (index === 6) return this.read8(this.hl)
    return this.bytes[index]!
  }

  private writeR8(index: number, value: number): void {
    if (index === 6) this.write8(this.hl, value)
    else this.bytes[index] = value
  }

  private readR16(index: number): number {
    switch (index) {
      case 0:
        return this.bc
      case 1:
        return this.de
      case 2:
        return this.hl
      default:
        return this.sp
    }
  }

  private writeR16(index: number, value: number): void {
    switch (index) {
      case 0:
        this.bc = value
        break
      case 1:
        this.de = value
        break
      case 2:
        this.hl = value
        break
      default:
        this.sp = value
    }
  }

  private condition(index: number): boolean {
    switch (index) {
      case 0:
        return (this.f & Z) === 0
      case 1:
        return (this.f & Z) !== 0
      case 2:
        return (this.f & C) === 0
      default:
        return (this.f & C) !== 0
    }
  }

  private signed(value: number): number {
    return value < 0x80 ? value : value - 0x100
  }

  private execute(opcode: number, address: number): void {
    if (opcode >= 0x40 && opcode <= 0x7f) {
      if (opcode === 0x76) {
        if (!this.ime && this.pendingInterrupts() !== 0) this.haltBug = true
        else this.halted = true
      } else {
        this.writeR8((opcode >>> 3) & 7, this.readR8(opcode & 7))
      }
      return
    }
    if (opcode >= 0x80 && opcode <= 0xbf) {
      this.alu((opcode >>> 3) & 7, this.readR8(opcode & 7))
      return
    }

    if (opcode < 0x40) {
      const pair = (opcode >>> 4) & 3
      if ((opcode & 0x0f) === 0x01) {
        this.writeR16(pair, this.fetch16())
        return
      }
      if ((opcode & 0x0f) === 0x03 || (opcode & 0x0f) === 0x0b) {
        this.writeR16(pair, this.readR16(pair) + ((opcode & 8) === 0 ? 1 : -1))
        this.idle()
        return
      }
      if ((opcode & 0x0f) === 0x09) {
        const left = this.hl
        const right = this.readR16(pair)
        const result = left + right
        this.hl = result
        this.f =
          (this.f & Z) |
          ((left & 0xfff) + (right & 0xfff) > 0xfff ? H : 0) |
          (result > 0xffff ? C : 0)
        this.idle()
        return
      }
      if ((opcode & 7) === 4 || (opcode & 7) === 5) {
        const target = (opcode >>> 3) & 7
        const value = this.readR8(target)
        const decrement = (opcode & 1) !== 0
        const result = (value + (decrement ? -1 : 1)) & 0xff
        const half = decrement ? (value & 0x0f) === 0 : (value & 0x0f) === 0x0f
        this.f = (this.f & C) | (result === 0 ? Z : 0) | (decrement ? N : 0) | (half ? H : 0)
        this.writeR8(target, result)
        return
      }
      if ((opcode & 7) === 6) {
        this.writeR8((opcode >>> 3) & 7, this.fetch8())
        return
      }
      if ((opcode & 0x0f) === 2 || (opcode & 0x0f) === 0x0a) {
        const pointer = pair < 2 ? this.readR16(pair) : this.hl
        if ((opcode & 8) === 0) this.write8(pointer, this.a)
        else this.a = this.read8(pointer)
        if (pair === 2) this.hl += 1
        if (pair === 3) this.hl -= 1
        return
      }
    }

    if (opcode >= 0xc0) {
      if ((opcode & 0xc7) === 0xc6) {
        this.alu((opcode >>> 3) & 7, this.fetch8())
        return
      }
      if ((opcode & 0xc7) === 0xc7) {
        this.idle()
        this.push(this.pc)
        this.pc = opcode & 0x38
        return
      }
      if ((opcode & 0xcf) === 0xc1) {
        const pair = (opcode >>> 4) & 3
        const value = this.pop()
        if (pair === 3) this.af = value
        else this.writeR16(pair, value)
        return
      }
      if ((opcode & 0xcf) === 0xc5) {
        this.idle()
        const pair = (opcode >>> 4) & 3
        this.push(pair === 3 ? this.af : this.readR16(pair))
        return
      }
      if (opcode < 0xe0) {
        if ((opcode & 7) === 0) {
          this.idle()
          if (this.condition((opcode >>> 3) & 3)) {
            this.pc = this.pop()
            this.idle()
          }
          return
        }
        if ((opcode & 7) === 2) {
          const target = this.fetch16()
          if (this.condition((opcode >>> 3) & 3)) {
            this.pc = target
            this.idle()
          }
          return
        }
        if ((opcode & 7) === 4) {
          const target = this.fetch16()
          if (this.condition((opcode >>> 3) & 3)) {
            this.idle()
            this.push(this.pc)
            this.pc = target
          }
          return
        }
      }
    }

    switch (opcode) {
      case 0x00:
        return
      case 0x08: {
        const target = this.fetch16()
        this.write8(target, this.sp)
        this.write8(target + 1, this.sp >>> 8)
        return
      }
      case 0x10:
        // STOP 00 ocupa dois bytes, mas somente um M-cycle no DMG.
        this.pc += 1
        this.stopped = true
        return
      case 0x18: {
        const offset = this.signed(this.fetch8())
        this.pc += offset
        this.idle()
        return
      }
      case 0x20:
      case 0x28:
      case 0x30:
      case 0x38: {
        const offset = this.signed(this.fetch8())
        if (this.condition((opcode >>> 3) & 3)) {
          this.pc += offset
          this.idle()
        }
        return
      }
      case 0x07:
        this.a = this.rotate(0, this.a)
        this.f &= ~Z
        return
      case 0x0f:
        this.a = this.rotate(1, this.a)
        this.f &= ~Z
        return
      case 0x17:
        this.a = this.rotate(2, this.a)
        this.f &= ~Z
        return
      case 0x1f:
        this.a = this.rotate(3, this.a)
        this.f &= ~Z
        return
      case 0x27:
        this.daa()
        return
      case 0x2f:
        this.a ^= 0xff
        this.f |= N | H
        return
      case 0x37:
        this.f = (this.f & Z) | C
        return
      case 0x3f:
        this.f = (this.f & Z) | ((this.f & C) === 0 ? C : 0)
        return
      case 0xc3:
        this.pc = this.fetch16()
        this.idle()
        return
      case 0xc9:
        this.pc = this.pop()
        this.idle()
        return
      case 0xcb:
        this.executeCb(this.fetch8())
        return
      case 0xcd: {
        const target = this.fetch16()
        this.idle()
        this.push(this.pc)
        this.pc = target
        return
      }
      case 0xd9:
        this.pc = this.pop()
        this.idle()
        this.ime = true
        this.imeEnableDelay = 0
        return
      case 0xe0:
        this.write8(0xff00 | this.fetch8(), this.a)
        return
      case 0xe2:
        this.write8(0xff00 | this.c, this.a)
        return
      case 0xe8: {
        const result = this.addSignedSp()
        this.idle(8)
        this.sp = result
        return
      }
      case 0xe9:
        this.pc = this.hl
        return
      case 0xea:
        this.write8(this.fetch16(), this.a)
        return
      case 0xf0:
        this.a = this.read8(0xff00 | this.fetch8())
        return
      case 0xf2:
        this.a = this.read8(0xff00 | this.c)
        return
      case 0xf3:
        this.ime = false
        this.imeEnableDelay = 0
        return
      case 0xf8: {
        const result = this.addSignedSp()
        this.idle()
        this.hl = result
        return
      }
      case 0xf9:
        this.sp = this.hl
        this.idle()
        return
      case 0xfa:
        this.a = this.read8(this.fetch16())
        return
      case 0xfb:
        if (!this.ime && this.imeEnableDelay === 0) this.imeEnableDelay = 2
        return
      default:
        throw new InvalidOpcodeError(opcode, address)
    }
  }

  private alu(operation: number, value: number): void {
    const accumulator = this.a
    const carry = (operation === 1 || operation === 3) && (this.f & C) !== 0 ? 1 : 0
    switch (operation) {
      case 0:
      case 1: {
        const result = accumulator + value + carry
        this.a = result
        this.f =
          (this.a === 0 ? Z : 0) |
          ((accumulator & 15) + (value & 15) + carry > 15 ? H : 0) |
          (result > 0xff ? C : 0)
        return
      }
      case 2:
      case 3:
      case 7: {
        const result = accumulator - value - carry
        const byte = result & 0xff
        if (operation !== 7) this.a = byte
        this.f =
          N |
          (byte === 0 ? Z : 0) |
          ((accumulator & 15) < (value & 15) + carry ? H : 0) |
          (result < 0 ? C : 0)
        return
      }
      case 4:
        this.a &= value
        this.f = (this.a === 0 ? Z : 0) | H
        return
      case 5:
        this.a ^= value
        this.f = this.a === 0 ? Z : 0
        return
      case 6:
        this.a |= value
        this.f = this.a === 0 ? Z : 0
        return
    }
  }

  private addSignedSp(): number {
    const offset = this.fetch8()
    this.f =
      ((this.sp & 0x0f) + (offset & 0x0f) > 0x0f ? H : 0) |
      ((this.sp & 0xff) + offset > 0xff ? C : 0)
    return (this.sp + this.signed(offset)) & 0xffff
  }

  private daa(): void {
    let correction = 0
    let carry = (this.f & C) !== 0
    if ((this.f & N) === 0) {
      if ((this.f & H) !== 0 || (this.a & 0x0f) > 9) correction |= 0x06
      if (carry || this.a > 0x99) {
        correction |= 0x60
        carry = true
      }
      this.a += correction
    } else {
      if ((this.f & H) !== 0) correction |= 0x06
      if (carry) correction |= 0x60
      this.a -= correction
    }
    this.f = (this.f & N) | (this.a === 0 ? Z : 0) | (carry ? C : 0)
  }

  private rotate(operation: number, value: number): number {
    const oldCarry = (this.f & C) !== 0 ? 1 : 0
    let result = 0
    let carry = 0
    switch (operation) {
      case 0:
        carry = value >>> 7
        result = (value << 1) | carry
        break
      case 1:
        carry = value & 1
        result = (value >>> 1) | (carry << 7)
        break
      case 2:
        carry = value >>> 7
        result = (value << 1) | oldCarry
        break
      case 3:
        carry = value & 1
        result = (value >>> 1) | (oldCarry << 7)
        break
      case 4:
        carry = value >>> 7
        result = value << 1
        break
      case 5:
        carry = value & 1
        result = (value >>> 1) | (value & 0x80)
        break
      case 6:
        result = (value << 4) | (value >>> 4)
        break
      case 7:
        carry = value & 1
        result = value >>> 1
        break
    }
    result &= 0xff
    this.f = (result === 0 ? Z : 0) | (carry !== 0 ? C : 0)
    return result
  }

  private executeCb(opcode: number): void {
    const group = opcode >>> 6
    const operation = (opcode >>> 3) & 7
    const target = opcode & 7
    const value = this.readR8(target)
    if (group === 0) this.writeR8(target, this.rotate(operation, value))
    else if (group === 1) this.f = (this.f & C) | H | ((value & (1 << operation)) === 0 ? Z : 0)
    else if (group === 2) this.writeR8(target, value & ~(1 << operation))
    else this.writeR8(target, value | (1 << operation))
  }
}
