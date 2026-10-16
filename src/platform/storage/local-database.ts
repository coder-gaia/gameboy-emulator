import { BatteryStorageError, storageFailure } from './errors'
import {
  BATTERY_STORE_NAME,
  SAVE_DATABASE_NAME,
  SAVE_DATABASE_VERSION,
  STATE_ROM_INDEX,
  STATE_STORE_NAME,
} from './schema'

export interface LocalDatabaseOptions {
  readonly indexedDB?: IDBFactory | null
  readonly databaseName?: string
  readonly openTimeoutMs?: number
}

function hasCurrentSchema(database: IDBDatabase): boolean {
  if (
    !database.objectStoreNames.contains(BATTERY_STORE_NAME) ||
    !database.objectStoreNames.contains(STATE_STORE_NAME)
  )
    return false
  const transaction = database.transaction([BATTERY_STORE_NAME, STATE_STORE_NAME])
  const battery = transaction.objectStore(BATTERY_STORE_NAME)
  const states = transaction.objectStore(STATE_STORE_NAME)
  return (
    battery.keyPath === 'romId' &&
    !battery.autoIncrement &&
    Array.isArray(states.keyPath) &&
    states.keyPath.length === 2 &&
    states.keyPath[0] === 'romId' &&
    states.keyPath[1] === 'slot' &&
    !states.autoIncrement &&
    states.indexNames.contains(STATE_ROM_INDEX) &&
    states.index(STATE_ROM_INDEX).keyPath === 'romId'
  )
}

/** Bateria e slots compartilham a migração, nunca a ordem de abertura da UI. */
export class LocalSaveDatabase {
  private database: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null
  private cancelOpening: (() => void) | null = null
  private closed = false
  private readonly databaseName: string
  private readonly openTimeoutMs: number

  constructor(private readonly options: LocalDatabaseOptions = {}) {
    this.databaseName = options.databaseName ?? SAVE_DATABASE_NAME
    this.openTimeoutMs = options.openTimeoutMs ?? 5_000
    if (!Number.isSafeInteger(this.openTimeoutMs) || this.openTimeoutMs <= 0)
      throw new BatteryStorageError(
        'invalid-data',
        'O prazo de abertura do armazenamento é inválido.',
      )
  }

  close(): void {
    this.closed = true
    this.cancelOpening?.()
    this.database?.close()
    this.database = null
  }

  async execute<Result>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<Result>,
  ): Promise<Result> {
    const database = await this.openDatabase()
    if (this.closed)
      throw new BatteryStorageError('closed', 'O repositório de saves foi encerrado.')
    return new Promise<Result>((resolve, reject) => {
      let transaction: IDBTransaction | undefined
      let request: IDBRequest<Result>
      let failure: unknown
      const target = storeName === BATTERY_STORE_NAME ? 'o save local de bateria' : 'o estado local'
      const action = `${mode === 'readonly' ? 'ler' : 'gravar'} ${target}`
      try {
        transaction = database.transaction(storeName, mode)
        transaction.oncomplete = () => resolve(request.result)
        transaction.onabort = () => reject(storageFailure(action, failure ?? transaction?.error))
        request = operation(transaction.objectStore(storeName))
        request.onerror = () => {
          failure = request.error
        }
      } catch (cause) {
        try {
          transaction?.abort()
        } catch {
          /* A transação pode já ter sido encerrada. */
        }
        reject(storageFailure(action, cause))
      }
    })
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.closed)
      return Promise.reject(
        new BatteryStorageError('closed', 'O repositório de saves foi encerrado.'),
      )
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
        if (!factory)
          throw new BatteryStorageError(
            'unavailable',
            'IndexedDB está indisponível neste navegador. O progresso desta sessão não será salvo.',
          )
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
            const database = request.result
            if (!database.objectStoreNames.contains(BATTERY_STORE_NAME))
              database.createObjectStore(BATTERY_STORE_NAME, { keyPath: 'romId' })
            const states = database.objectStoreNames.contains(STATE_STORE_NAME)
              ? request.transaction!.objectStore(STATE_STORE_NAME)
              : database.createObjectStore(STATE_STORE_NAME, { keyPath: ['romId', 'slot'] })
            if (!states.indexNames.contains(STATE_ROM_INDEX))
              states.createIndex(STATE_ROM_INDEX, 'romId')
          } catch (cause) {
            fail(cause)
            try {
              request.transaction?.abort()
            } catch {
              /* O upgrade pode já ter sido cancelado. */
            }
          }
        }
        request.onsuccess = () => {
          const database = request.result
          if (settled || this.closed) {
            database.close()
            return
          }
          try {
            if (!hasCurrentSchema(database)) {
              database.close()
              fail(
                new BatteryStorageError(
                  'incompatible-data',
                  'A estrutura do armazenamento local é incompatível. Os saves existentes foram preservados.',
                ),
              )
              return
            }
          } catch (cause) {
            database.close()
            fail(cause)
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
    const finish = (): void => {
      if (this.opening === opening) this.opening = null
    }
    void opening.then(finish, finish)
    return opening
  }
}
