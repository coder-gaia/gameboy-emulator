import type { CartridgeRtcState } from '../core/cartridge'
import type { BatteryState } from '../platform/storage/schema'

export interface BatteryMemory {
  readonly batteryRevision: number
  exportBatteryRam(): Uint8Array | null
  importBatteryRam(bytes: Uint8Array): void | Promise<void>
  exportBatteryRtc?(): CartridgeRtcState | null
  importBatteryState?(
    bytes: Uint8Array,
    rtc: CartridgeRtcState,
    elapsedSeconds: number,
  ): void | Promise<void>
}

export interface BatteryStorage {
  loadBattery(romId: string, expectedLength: number): Promise<Uint8Array | null>
  saveBattery(romId: string, bytes: Uint8Array): Promise<void>
  loadBatteryState?(romId: string, expectedLength: number): Promise<BatteryState | null>
  saveBatteryState?(romId: string, state: BatteryState): Promise<void>
}

/** Uma leitura inválida nunca autoriza sobrescrever o save já existente. */
export class BatterySession {
  private enabled = false
  private persistedRevision = -1
  private queuedRevision: number | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: BatteryStorage,
    readonly romId: string,
    private readonly memory: BatteryMemory,
    private readonly now: () => number = Date.now,
  ) {}

  async restore(): Promise<boolean> {
    this.enabled = false
    const ram = this.memory.exportBatteryRam()
    if (ram === null) return false
    let restored = false
    if (this.memory.exportBatteryRtc?.()) {
      if (!this.storage.loadBatteryState || !this.memory.importBatteryState)
        throw new Error('O armazenamento não disponibilizou suporte ao relógio do cartucho.')
      const saved = await this.storage.loadBatteryState(this.romId, ram.length)
      if (saved !== null) {
        if (saved.rtc) {
          const elapsed = Math.floor(Math.max(0, this.now() - saved.updatedAt) / 1000)
          if (!Number.isSafeInteger(elapsed))
            throw new Error('O tempo offline do cartucho é inválido.')
          await this.memory.importBatteryState(saved.bytes, saved.rtc, elapsed)
        } else await this.memory.importBatteryRam(saved.bytes)
        restored = true
      }
    } else {
      const saved = await this.storage.loadBattery(this.romId, ram.length)
      if (saved !== null) await this.memory.importBatteryRam(saved)
      restored = saved !== null
    }
    this.persistedRevision = this.memory.batteryRevision
    this.enabled = true
    return restored
  }

  flush(): Promise<void> {
    if (!this.enabled) return this.pending
    const revision = this.memory.batteryRevision
    const rtc = this.memory.exportBatteryRtc?.() ?? null
    // O instante offline também precisa avançar durante uma pausa sem mudanças na RAM.
    if (!rtc && (revision === this.persistedRevision || revision === this.queuedRevision))
      return this.pending
    const bytes = this.memory.exportBatteryRam()
    if (bytes === null) return this.pending
    const updatedAt = this.now()
    this.queuedRevision = revision
    this.pending = this.pending
      .catch(() => {})
      .then(() => {
        if (rtc) {
          if (!this.storage.saveBatteryState)
            throw new Error('Não foi possível salvar o relógio do cartucho.')
          return this.storage.saveBatteryState(this.romId, { bytes, rtc, updatedAt })
        }
        return this.storage.saveBattery(this.romId, bytes)
      })
      .then(() => {
        this.persistedRevision = revision
      })
      .finally(() => {
        if (this.queuedRevision === revision) this.queuedRevision = null
      })
    return this.pending
  }
}
