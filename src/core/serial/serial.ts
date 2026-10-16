const BIT_T_CYCLES = 512
const OUTPUT_CAPACITY = 4096

export interface SerialOutput {
  readonly bytes: Uint8Array
  readonly text: string
  readonly droppedBytes: number
}

export interface SerialState {
  version: 1
  data: number
  control: number
  bitCycles: number
  shiftedBits: number
  outgoing: number
  outputBytes: Uint8Array
  droppedBytes: number
}

export class SerialPort {
  private data = 0
  private control = 0
  private bitCycles = 0
  private shiftedBits = 0
  private outgoing = 0
  private readonly output = new Uint8Array(OUTPUT_CAPACITY)
  private outputStart = 0
  private outputLength = 0
  private droppedBytes = 0

  get pendingOutputBytes(): number {
    return this.outputLength
  }

  snapshotState(): SerialState {
    const outputBytes = new Uint8Array(this.outputLength)
    for (let index = 0; index < this.outputLength; index += 1) {
      outputBytes[index] = this.output[(this.outputStart + index) % OUTPUT_CAPACITY]!
    }
    return {
      version: 1,
      data: this.data,
      control: this.control,
      bitCycles: this.bitCycles,
      shiftedBits: this.shiftedBits,
      outgoing: this.outgoing,
      outputBytes,
      droppedBytes: this.droppedBytes,
    }
  }

  restoreState(value: unknown): void {
    const state = stateRecord(value, 'serial')
    stateInteger(state.version, 1, 1, 'serial.version')
    const data = stateInteger(state.data, 0, 0xff, 'serial.data')
    const control = stateInteger(state.control, 0, 0x81, 'serial.control')
    const bitCycles = stateInteger(state.bitCycles, 0, BIT_T_CYCLES - 1, 'serial.bitCycles')
    const shiftedBits = stateInteger(state.shiftedBits, 0, 8, 'serial.shiftedBits')
    const outgoing = stateInteger(state.outgoing, 0, 0xff, 'serial.outgoing')
    const droppedBytes = stateInteger(
      state.droppedBytes,
      0,
      Number.MAX_SAFE_INTEGER,
      'serial.droppedBytes',
    )
    if (!(state.outputBytes instanceof Uint8Array) || state.outputBytes.length > OUTPUT_CAPACITY) {
      throw new Error('Estado da serial inválido: buffer de saída.')
    }
    const outputBytes = stateBytes(
      state.outputBytes,
      state.outputBytes.length,
      'serial.outputBytes',
    )
    if ((control & ~0x81) !== 0 || ((control & 0x80) !== 0 && shiftedBits === 8)) {
      throw new Error('Estado da serial inválido: controle de transferência.')
    }
    this.data = data
    this.control = control
    this.bitCycles = bitCycles
    this.shiftedBits = shiftedBits
    this.outgoing = outgoing
    this.output.fill(0)
    this.output.set(outputBytes)
    this.outputStart = 0
    this.outputLength = outputBytes.length
    this.droppedBytes = droppedBytes
  }

  readData(): number {
    return this.data
  }

  readControl(): number {
    return this.control | 0x7e
  }

  writeData(value: number): void {
    this.data = value & 0xff
  }

  writeControl(value: number): void {
    this.control = value & 0x81
    this.bitCycles = 0
    this.shiftedBits = 0
    this.outgoing = 0
  }

  /** Avança o link desconectado. Retorna true somente ao completar um byte. */
  tick(tCycles: number): boolean {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('A serial exige uma quantidade inteira e não negativa de T-cycles.')
    }
    if ((this.control & 0x81) !== 0x81) return false

    this.bitCycles += tCycles
    while (this.bitCycles >= BIT_T_CYCLES) {
      this.bitCycles -= BIT_T_CYCLES
      this.outgoing = ((this.outgoing << 1) | (this.data >>> 7)) & 0xff
      this.data = ((this.data << 1) | 1) & 0xff
      this.shiftedBits += 1
      if (this.shiftedBits === 8) {
        this.control &= 0x01
        this.bitCycles = 0
        this.appendOutput(this.outgoing)
        return true
      }
    }
    return false
  }

  private appendOutput(value: number): void {
    if (this.outputLength === OUTPUT_CAPACITY) {
      this.outputStart = (this.outputStart + 1) % OUTPUT_CAPACITY
      this.outputLength -= 1
      this.droppedBytes += 1
    }
    this.output[(this.outputStart + this.outputLength) % OUTPUT_CAPACITY] = value
    this.outputLength += 1
  }

  /** A observação pode alocar; os ciclos e acessos de memória usam buffers fixos. */
  drainOutput(): SerialOutput {
    const bytes = new Uint8Array(this.outputLength)
    let text = ''
    for (let index = 0; index < this.outputLength; index += 1) {
      const value = this.output[(this.outputStart + index) % OUTPUT_CAPACITY]!
      bytes[index] = value
      text += String.fromCharCode(value)
    }
    const droppedBytes = this.droppedBytes
    this.outputStart = 0
    this.outputLength = 0
    this.droppedBytes = 0
    return { bytes, text, droppedBytes }
  }
}
import { stateBytes, stateInteger, stateRecord } from '../state/validation'
