export interface BatteryMemory {
  readonly batteryRevision: number
  exportBatteryRam(): Uint8Array | null
  importBatteryRam(bytes: Uint8Array): void | Promise<void>
}

export interface BatteryStorage {
  loadBattery(romId: string, expectedLength: number): Promise<Uint8Array | null>
  saveBattery(romId: string, bytes: Uint8Array): Promise<void>
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
  ) {}

  async restore(): Promise<boolean> {
    this.enabled = false
    const ram = this.memory.exportBatteryRam()
    if (ram === null) return false
    const saved = await this.storage.loadBattery(this.romId, ram.length)
    if (saved !== null) await this.memory.importBatteryRam(saved)
    this.persistedRevision = this.memory.batteryRevision
    this.enabled = true
    return saved !== null
  }

  flush(): Promise<void> {
    const revision = this.memory.batteryRevision
    if (!this.enabled || revision === this.persistedRevision || revision === this.queuedRevision)
      return this.pending
    const bytes = this.memory.exportBatteryRam()
    if (bytes === null) return this.pending
    this.queuedRevision = revision
    this.pending = this.pending
      .catch(() => {})
      .then(() => this.storage.saveBattery(this.romId, bytes))
      .then(() => {
        this.persistedRevision = revision
      })
      .finally(() => {
        if (this.queuedRevision === revision) this.queuedRevision = null
      })
    return this.pending
  }
}
