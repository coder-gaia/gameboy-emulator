/** RAM compartilhada pelos mappers. Nenhum buffer interno sai por referência. */
export class CartridgeRam {
  private readonly bytes: Uint8Array
  private revision = 0

  constructor(
    size: number,
    private readonly hasBattery: boolean,
  ) {
    this.bytes = new Uint8Array(size)
  }

  get batteryRevision(): number {
    return this.revision
  }

  read(offset: number): number {
    return this.bytes[offset] ?? 0xff
  }

  write(offset: number, value: number): void {
    if (offset < 0 || offset >= this.bytes.length) return
    const byte = value & 0xff
    if (this.bytes[offset] === byte) return
    this.bytes[offset] = byte
    if (this.hasBattery) this.revision += 1
  }

  exportBatteryRam(): Uint8Array | null {
    return this.hasBattery && this.bytes.length > 0 ? this.bytes.slice() : null
  }

  snapshotState(): Uint8Array {
    return this.bytes.slice()
  }

  restoreState(state: unknown): void {
    this.replaceBytes(stateBytes(state, this.bytes.length, 'RAM do cartucho'))
  }

  importBatteryRam(bytes: Uint8Array): void {
    if (!this.hasBattery || this.bytes.length === 0) {
      throw new Error('Este cartucho não possui RAM de bateria.')
    }
    if (bytes.length !== this.bytes.length) {
      throw new Error(
        `Save de bateria incompatível: esperado ${this.bytes.length} bytes, recebido ${bytes.length}.`,
      )
    }
    this.replaceBytes(bytes)
  }

  private replaceBytes(bytes: Uint8Array): void {
    let changed = false
    for (let index = 0; index < bytes.length; index += 1) {
      if (this.bytes[index] !== bytes[index]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.bytes.set(bytes)
    if (this.hasBattery) this.revision += 1
  }
}
import { stateBytes } from '../state/validation'
