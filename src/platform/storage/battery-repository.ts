import { BatteryStorageError, storageFailure } from './errors'
import {
  BATTERY_RECORD_VERSION,
  BATTERY_STORE_NAME,
  SAVE_DATABASE_NAME,
  SAVE_DATABASE_VERSION,
} from './schema'
import type { BatteryRecord } from './schema'

export interface BatteryRepositoryOptions {
  readonly indexedDB?: IDBFactory | null
  readonly databaseName?: string
  readonly openTimeoutMs?: number
}

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

/** Persistência local com confirmação somente após o commit da transação. */
export class BatteryRepository {
  private database: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null
  private cancelOpening: (() => void) | null = null
  private closed = false
  private readonly databaseName: string
  private readonly openTimeoutMs: number

  constructor(private readonly options: BatteryRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? SAVE_DATABASE_NAME
    this.openTimeoutMs = options.openTimeoutMs ?? 5_000
    if (!Number.isSafeInteger(this.openTimeoutMs) || this.openTimeoutMs <= 0) {
      throw new BatteryStorageError(
        'invalid-data',
        'O prazo de abertura do armazenamento é inválido.',
      )
    }
  }

  async loadBattery(romId: string, expectedLength: number): Promise<Uint8Array | null> {
    validateRomId(romId)
    validateLength(expectedLength)
    const value = await this.execute<unknown>('readonly', (store) => store.get(romId))
    return value === undefined ? null : readBatteryRecord(value, romId, expectedLength)
  }

  async saveBattery(romId: string, bytes: Uint8Array): Promise<void> {
    validateRomId(romId)
    validateLength(bytes.byteLength)
    // Captura antes de aguardar IndexedDB: a emulação pode continuar alterando a RAM.
    const copy = new Uint8Array(bytes)
    const record: BatteryRecord = {
      version: BATTERY_RECORD_VERSION,
      romId,
      byteLength: copy.byteLength,
      bytes: copy.buffer,
      updatedAt: Date.now(),
    }
    await this.execute('readwrite', (store) => store.put(record))
  }

  async deleteBattery(romId: string): Promise<void> {
    validateRomId(romId)
    await this.execute('readwrite', (store) => store.delete(romId))
  }

  /** Encerra esta instância; operações futuras exigem outro repositório. */
  close(): void {
    this.closed = true
    this.cancelOpening?.()
    this.database?.close()
    this.database = null
  }

  private async execute<Result>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<Result>,
  ): Promise<Result> {
    const database = await this.openDatabase()
    if (this.closed) {
      throw new BatteryStorageError('closed', 'O repositório de saves foi encerrado.')
    }
    return new Promise<Result>((resolve, reject) => {
      let transaction: IDBTransaction | undefined
      let request: IDBRequest<Result>
      let failure: unknown
      const action =
        mode === 'readonly' ? 'ler o save local de bateria' : 'gravar o save local de bateria'
      try {
        transaction = database.transaction(BATTERY_STORE_NAME, mode)
        transaction.oncomplete = () => resolve(request.result)
        transaction.onabort = () => reject(storageFailure(action, failure ?? transaction?.error))
        request = operation(transaction.objectStore(BATTERY_STORE_NAME))
        request.onerror = () => {
          failure = request.error
        }
      } catch (cause) {
        try {
          transaction?.abort()
        } catch {
          // Uma transação já encerrada não aceita outro abort.
        }
        reject(storageFailure(action, cause))
      }
    })
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.closed) {
      return Promise.reject(
        new BatteryStorageError('closed', 'O repositório de saves foi encerrado.'),
      )
    }
    if (this.database) return Promise.resolve(this.database)
    if (this.opening) return this.opening

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const fail = (cause: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.cancelOpening = null
        reject(storageFailure('abrir o armazenamento local de saves', cause))
      }
      this.cancelOpening = () =>
        fail(new BatteryStorageError('closed', 'O repositório de saves foi encerrado.'))
      try {
        const factory =
          this.options.indexedDB === undefined ? globalThis.indexedDB : this.options.indexedDB
        if (!factory) {
          throw new BatteryStorageError(
            'unavailable',
            'IndexedDB está indisponível neste navegador. O progresso desta sessão não será salvo.',
          )
        }
        const request = factory.open(this.databaseName, SAVE_DATABASE_VERSION)
        timeout = setTimeout(
          () =>
            fail(
              new BatteryStorageError(
                'timeout',
                'O armazenamento local não respondeu a tempo. Tente recarregar a página.',
              ),
            ),
          this.openTimeoutMs,
        )
        request.onblocked = () =>
          fail(
            new BatteryStorageError(
              'blocked',
              'Outra aba está bloqueando o armazenamento local. Feche as outras abas do projeto e tente novamente.',
            ),
          )
        request.onerror = () => fail(request.error)
        request.onupgradeneeded = () => {
          try {
            if (settled || this.closed) {
              request.transaction?.abort()
              return
            }
            if (!request.result.objectStoreNames.contains(BATTERY_STORE_NAME)) {
              request.result.createObjectStore(BATTERY_STORE_NAME, { keyPath: 'romId' })
            }
          } catch (cause) {
            fail(cause)
            try {
              request.transaction?.abort()
            } catch {
              // O upgrade pode já ter sido cancelado pelo próprio IndexedDB.
            }
          }
        }
        request.onsuccess = () => {
          const database = request.result
          if (settled || this.closed) {
            database.close()
            return
          }
          if (!database.objectStoreNames.contains(BATTERY_STORE_NAME)) {
            database.close()
            fail(
              new BatteryStorageError(
                'incompatible-data',
                'A estrutura do armazenamento local é incompatível. Os saves existentes foram preservados.',
              ),
            )
            return
          }
          settled = true
          clearTimeout(timeout)
          this.cancelOpening = null
          this.database = database
          database.onversionchange = () => {
            database.close()
            if (this.database === database) this.database = null
          }
          database.onclose = () => {
            if (this.database === database) this.database = null
          }
          resolve(database)
        }
      } catch (cause) {
        fail(cause)
      }
    })
    this.opening = opening
    void opening.then(
      () => {
        if (this.opening === opening) this.opening = null
      },
      () => {
        if (this.opening === opening) this.opening = null
      },
    )
    return opening
  }
}
