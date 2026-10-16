import { BatteryStorageError } from './errors'
import { LocalSaveDatabase } from './local-database'
import type { LocalDatabaseOptions } from './local-database'
import { BATTERY_RECORD_VERSION, BATTERY_STORE_NAME } from './schema'
import type { BatteryRecord } from './schema'

export type BatteryRepositoryOptions = LocalDatabaseOptions

function validateRomId(romId: string): void {
  if (!/^[0-9a-f]{64}$/.test(romId)) {
    throw new BatteryStorageError(
      'invalid-data',
      'O identificador do cartucho não é um SHA-256 válido.',
    )
  }
}

function validateLength(length: number): void {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new BatteryStorageError(
      'invalid-data',
      'O tamanho da RAM de bateria deve ser um inteiro positivo.',
    )
  }
}

function readBatteryRecord(value: unknown, romId: string, expectedLength: number): Uint8Array {
  if (value === null || typeof value !== 'object') {
    throw new BatteryStorageError('invalid-data', 'O save local de bateria está danificado.')
  }
  const record = value as Record<string, unknown>
  if (record.version !== BATTERY_RECORD_VERSION) {
    throw new BatteryStorageError(
      'incompatible-data',
      'A versão deste save de bateria não é compatível. O arquivo local foi preservado.',
    )
  }
  if (
    record.romId !== romId ||
    !(record.bytes instanceof ArrayBuffer) ||
    record.byteLength !== record.bytes.byteLength ||
    typeof record.updatedAt !== 'number' ||
    !Number.isSafeInteger(record.updatedAt) ||
    record.updatedAt < 0
  ) {
    throw new BatteryStorageError('invalid-data', 'O save local de bateria está danificado.')
  }
  if (record.byteLength !== expectedLength) {
    throw new BatteryStorageError(
      'incompatible-data',
      `O save local tem ${record.byteLength} bytes, mas o cartucho espera ${expectedLength}. O save foi preservado.`,
    )
  }
  return new Uint8Array(record.bytes.slice(0))
}

/** Persistência de bateria preservada pelo upgrade que acrescenta os slots. */
export class BatteryRepository {
  private readonly database: LocalSaveDatabase

  constructor(options: BatteryRepositoryOptions = {}) {
    this.database = new LocalSaveDatabase(options)
  }

  async loadBattery(romId: string, expectedLength: number): Promise<Uint8Array | null> {
    validateRomId(romId)
    validateLength(expectedLength)
    const value = await this.database.execute<unknown>(BATTERY_STORE_NAME, 'readonly', (store) =>
      store.get(romId),
    )
    return value === undefined ? null : readBatteryRecord(value, romId, expectedLength)
  }

  async saveBattery(romId: string, bytes: Uint8Array): Promise<void> {
    validateRomId(romId)
    validateLength(bytes.byteLength)
    const copy = new Uint8Array(bytes)
    const record: BatteryRecord = {
      version: BATTERY_RECORD_VERSION,
      romId,
      byteLength: copy.byteLength,
      bytes: copy.buffer,
      updatedAt: Date.now(),
    }
    await this.database.execute(BATTERY_STORE_NAME, 'readwrite', (store) => store.put(record))
  }

  async deleteBattery(romId: string): Promise<void> {
    validateRomId(romId)
    await this.database.execute(BATTERY_STORE_NAME, 'readwrite', (store) => store.delete(romId))
  }

  /** Encerra esta instância; operações futuras exigem outro repositório. */
  close(): void {
    this.database.close()
  }
}
