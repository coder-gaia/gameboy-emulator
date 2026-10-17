import { DMG_CLOCK_HZ } from '../../core/model'
import type { MachineCheckpoint } from '../worker-protocol'
import { decode, encodeToBuffer, MAX_REWIND_STATE_BYTES } from './codec'

export const REWIND_MAX_BYTES = 8 * 1024 * 1024
export const REWIND_MAX_SECONDS = 20
export const REWIND_CAPTURE_HZ = 10
const MAX_ENTRIES = REWIND_MAX_SECONDS * REWIND_CAPTURE_HZ + 1
const WORKSPACE_BYTES = MAX_REWIND_STATE_BYTES * 3

interface Transition {
  offset: number
  length: number
  sparse: boolean
  beforeLength: number
  afterLength: number
  beforeTCycles: number
  afterTCycles: number
}

export interface RewindStats {
  entries: number
  availableSeconds: number
  allocatedBytes: number
  usedBytes: number
  maxSeconds: number
  maxBytes: number
}

export interface RewindOptions {
  maxBytes?: number
  maxSeconds?: number
}

/** Uma arena limita buffers de histórico e trabalho. Payload decodificado e ROM ficam fora dela. */
export class RewindHistory {
  private readonly arena: Uint8Array
  private readonly anchor: Uint8Array
  private readonly cursor: Uint8Array
  private readonly scratch: Uint8Array
  private readonly pool: Uint8Array
  private readonly transitions: Transition[] = []
  private readonly maxSeconds: number
  private anchorLength = 0
  private cursorLength = 0
  private anchorTCycles = 0
  private cursorTCycles = 0
  private tail = 0
  private poolUsed = 0

  constructor({
    maxBytes = REWIND_MAX_BYTES,
    maxSeconds = REWIND_MAX_SECONDS,
  }: RewindOptions = {}) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < WORKSPACE_BYTES + MAX_REWIND_STATE_BYTES ||
      maxBytes > REWIND_MAX_BYTES
    )
      throw new Error('O orçamento do rewind deve estar entre 1 MiB e 8 MiB.')
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > REWIND_MAX_SECONDS)
      throw new Error('A duração do rewind deve ser positiva e de no máximo 20 segundos.')
    this.maxSeconds = maxSeconds
    this.arena = new Uint8Array(maxBytes)
    this.anchor = this.arena.subarray(0, MAX_REWIND_STATE_BYTES)
    this.cursor = this.arena.subarray(MAX_REWIND_STATE_BYTES, MAX_REWIND_STATE_BYTES * 2)
    this.scratch = this.arena.subarray(MAX_REWIND_STATE_BYTES * 2, WORKSPACE_BYTES)
    this.pool = this.arena.subarray(WORKSPACE_BYTES)
  }

  get stats(): RewindStats {
    return {
      entries: this.anchorLength === 0 ? 0 : this.transitions.length + 1,
      availableSeconds: (this.cursorTCycles - this.anchorTCycles) / DMG_CLOCK_HZ,
      allocatedBytes: this.arena.buffer.byteLength,
      // Os três slots de trabalho são reservados mesmo quando o histórico está vazio.
      usedBytes: WORKSPACE_BYTES + this.poolUsed,
      maxSeconds: this.maxSeconds,
      maxBytes: this.arena.byteLength,
    }
  }

  record(checkpoint: MachineCheckpoint, tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0)
      throw new Error('O histórico exige um timestamp inteiro em T-cycles.')
    if (this.anchorLength > 0 && tCycles < this.cursorTCycles)
      throw new Error('O tempo do rewind deve avançar. Limpe o histórico ao carregar outro estado.')
    // Uma captura inválida não altera a âncora, o cursor ou os deltas já disponíveis.
    const length = encodeToBuffer(checkpoint, this.scratch)
    if (this.anchorLength === 0) {
      this.setInitial(length, tCycles)
      return
    }
    if (tCycles === this.cursorTCycles) {
      if (this.transitions.length === 0) {
        this.setInitial(length, tCycles)
        return
      }
      // Entradas podem mudar sem avanço de CPU. Substituímos o mesmo instante.
      this.removeNewest()
    }
    const maximum = Math.max(this.cursorLength, length)
    let runs = 0
    let changed = 0
    let previousChanged = false
    for (let index = 0; index < maximum; index += 1) {
      const different = this.xorAt(index, length) !== 0
      if (different) {
        changed += 1
        if (!previousChanged) runs += 1
      }
      previousChanged = different
    }
    const sparseLength = 4 + runs * 8 + changed
    const sparse = sparseLength < maximum
    const deltaLength = sparse ? sparseLength : maximum
    while (this.poolUsed + deltaLength > this.pool.length) this.removeOldest()
    const transition: Transition = {
      offset: this.tail,
      length: deltaLength,
      sparse,
      beforeLength: this.cursorLength,
      afterLength: length,
      beforeTCycles: this.cursorTCycles,
      afterTCycles: tCycles,
    }
    let output = 0
    const writeByte = (value: number): void => {
      this.pool[(transition.offset + output++) % this.pool.length] = value
    }
    const writeUint32 = (value: number): void => {
      for (let shift = 0; shift < 32; shift += 8) writeByte((value >>> shift) & 255)
    }
    if (sparse) {
      writeUint32(runs)
      let index = 0
      while (index < maximum) {
        if (this.xorAt(index, length) === 0) {
          index += 1
          continue
        }
        const start = index
        while (index < maximum && this.xorAt(index, length) !== 0) index += 1
        writeUint32(start)
        writeUint32(index - start)
        for (let position = start; position < index; position += 1)
          writeByte(this.xorAt(position, length))
      }
    } else {
      for (let index = 0; index < maximum; index += 1) writeByte(this.xorAt(index, length))
    }
    this.tail = (this.tail + deltaLength) % this.pool.length
    this.poolUsed += deltaLength
    this.transitions.push(transition)
    this.cursor.set(this.scratch.subarray(0, length))
    this.cursorLength = length
    this.cursorTCycles = tCycles
    while (
      this.transitions.length + 1 > MAX_ENTRIES ||
      this.cursorTCycles - this.anchorTCycles > this.maxSeconds * DMG_CLOCK_HZ
    )
      this.removeOldest()
  }

  /** Remove a transição futura e devolve um checkpoint independente da arena. */
  stepBack(): MachineCheckpoint | null {
    if (this.transitions.length === 0) return null
    this.removeNewest()
    return decode(this.cursor.subarray(0, this.cursorLength)) as MachineCheckpoint
  }

  clear(): void {
    this.transitions.length = 0
    this.anchorLength = 0
    this.cursorLength = 0
    this.anchorTCycles = 0
    this.cursorTCycles = 0
    this.tail = 0
    this.poolUsed = 0
  }

  private setInitial(length: number, tCycles: number): void {
    this.anchor.set(this.scratch.subarray(0, length))
    this.cursor.set(this.scratch.subarray(0, length))
    this.anchorLength = length
    this.cursorLength = length
    this.anchorTCycles = tCycles
    this.cursorTCycles = tCycles
  }

  private xorAt(index: number, afterLength: number): number {
    return (
      (index < this.cursorLength ? this.cursor[index]! : 0) ^
      (index < afterLength ? this.scratch[index]! : 0)
    )
  }

  private apply(target: Uint8Array, currentLength: number, transition: Transition): void {
    const maximum = Math.max(transition.beforeLength, transition.afterLength)
    if (currentLength < maximum) target.fill(0, currentLength, maximum)
    const readByte = (offset: number): number =>
      this.pool[(transition.offset + offset) % this.pool.length]!
    const readUint32 = (offset: number): number =>
      (readByte(offset) |
        (readByte(offset + 1) << 8) |
        (readByte(offset + 2) << 16) |
        (readByte(offset + 3) << 24)) >>>
      0
    if (!transition.sparse) {
      for (let index = 0; index < maximum; index += 1)
        target[index] = target[index]! ^ readByte(index)
      return
    }
    const runs = readUint32(0)
    let offset = 4
    for (let run = 0; run < runs; run += 1) {
      const start = readUint32(offset)
      const length = readUint32(offset + 4)
      offset += 8
      for (let index = 0; index < length; index += 1)
        target[start + index] = target[start + index]! ^ readByte(offset + index)
      offset += length
    }
  }

  private removeOldest(): void {
    const oldest = this.transitions.shift()
    if (!oldest) throw new Error('O delta excede o orçamento reservado ao rewind.')
    this.apply(this.anchor, this.anchorLength, oldest)
    this.anchorLength = oldest.afterLength
    this.anchorTCycles = oldest.afterTCycles
    this.poolUsed -= oldest.length
  }

  private removeNewest(): void {
    const newest = this.transitions.pop()!
    this.apply(this.cursor, this.cursorLength, newest)
    this.cursorLength = newest.beforeLength
    this.cursorTCycles = newest.beforeTCycles
    this.tail = newest.offset
    this.poolUsed -= newest.length
  }
}
