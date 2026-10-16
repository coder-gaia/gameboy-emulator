import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { BatteryRepository, BatteryStorageError, hashRom } from '../../src/platform/storage'
import {
  BATTERY_RECORD_VERSION,
  BATTERY_STORE_NAME,
  SAVE_DATABASE_VERSION,
} from '../../src/platform/storage/schema'

const ROM_A = 'a'.repeat(64)
const ROM_B = 'b'.repeat(64)
const DATABASE_NAME = 'battery-repository-test'
let factory: IDBFactory
let repositories: BatteryRepository[]

function repository(): BatteryRepository {
  const storage = new BatteryRepository({ indexedDB: factory, databaseName: DATABASE_NAME })
  repositories.push(storage)
  return storage
}

async function rawDatabase(version = SAVE_DATABASE_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function replaceRecord(value: unknown): Promise<void> {
  const database = await rawDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BATTERY_STORE_NAME, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.objectStore(BATTERY_STORE_NAME).put(value)
    })
  } finally {
    database.close()
  }
}

beforeEach(() => {
  factory = new IDBFactory()
  repositories = []
})

afterEach(() => {
  for (const storage of repositories) storage.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('repositório IndexedDB de bateria', () => {
  it('retorna null quando o cartucho ainda não tem save', async () => {
    expect(await repository().loadBattery(ROM_A, 8192)).toBeNull()
  })

  it('mantém a RAM após encerrar a conexão e abrir outra instância', async () => {
    const storage = repository()
    const bytes = new Uint8Array(8192)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 73) & 255
    await storage.saveBattery(ROM_A, bytes)
    storage.close()
    expect(await repository().loadBattery(ROM_A, 8192)).toEqual(bytes)
  })

  it('separa jogos pelo SHA-256 completo, mesmo com cabeçalhos e nomes iguais', async () => {
    const storage = repository()
    const firstRom = new Uint8Array(32_768)
    const secondRom = firstRom.slice()
    secondRom[0x7fff] = 1
    const firstId = await hashRom(firstRom)
    const secondId = await hashRom(secondRom)
    expect(firstId).not.toBe(secondId)
    await storage.saveBattery(firstId, new Uint8Array([1, 2]))
    await storage.saveBattery(secondId, new Uint8Array([3, 4]))
    expect(await storage.loadBattery(firstId, 2)).toEqual(new Uint8Array([1, 2]))
    expect(await storage.loadBattery(secondId, 2)).toEqual(new Uint8Array([3, 4]))
  })

  it('captura os bytes antes de abrir o banco e não compartilha buffers na leitura', async () => {
    const storage = repository()
    const source = new Uint8Array([99, 1, 2, 3, 88])
    const save = storage.saveBattery(ROM_A, source.subarray(1, 4))
    source.fill(0)
    await save
    const loaded = await storage.loadBattery(ROM_A, 3)
    expect(loaded).toEqual(new Uint8Array([1, 2, 3]))
    loaded!.fill(9)
    expect(await storage.loadBattery(ROM_A, 3)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('gravações concorrentes terminam completas e a mais recente prevalece', async () => {
    const storage = repository()
    const saves = Array.from({ length: 12 }, (_, value) =>
      storage.saveBattery(ROM_A, new Uint8Array(512).fill(value)),
    )
    await Promise.all(saves)
    expect(await storage.loadBattery(ROM_A, 512)).toEqual(new Uint8Array(512).fill(11))
  })

  it('confirma a transação completa, sem aceitar success de uma escrita depois abortada', async () => {
    const storage = repository()
    await storage.saveBattery(ROM_A, new Uint8Array([1, 2, 3]))
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      const request = original.call(this, value)
      request.addEventListener('success', () => request.transaction!.abort())
      return request
    })
    await expect(storage.saveBattery(ROM_A, new Uint8Array([4, 5, 6]))).rejects.toMatchObject({
      code: 'operation-failed',
    })
    expect(await storage.loadBattery(ROM_A, 3)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('remove somente o save escolhido', async () => {
    const storage = repository()
    await storage.saveBattery(ROM_A, new Uint8Array([1]))
    await storage.saveBattery(ROM_B, new Uint8Array([2]))
    await storage.deleteBattery(ROM_A)
    expect(await storage.loadBattery(ROM_A, 1)).toBeNull()
    expect(await storage.loadBattery(ROM_B, 1)).toEqual(new Uint8Array([2]))
  })

  it('recusa tamanho incompatível preservando o save existente', async () => {
    const storage = repository()
    await storage.saveBattery(ROM_A, new Uint8Array([1, 2, 3]))
    await expect(storage.loadBattery(ROM_A, 8192)).rejects.toMatchObject({
      code: 'incompatible-data',
      message: expect.stringContaining('preservado'),
    })
    expect(await storage.loadBattery(ROM_A, 3)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it.each([
    { version: 2, bytes: new ArrayBuffer(3), byteLength: 3, updatedAt: 0 },
    { version: BATTERY_RECORD_VERSION, bytes: 'corrompido', byteLength: 3, updatedAt: 0 },
    { version: BATTERY_RECORD_VERSION, bytes: new ArrayBuffer(3), byteLength: 2, updatedAt: 0 },
    { version: BATTERY_RECORD_VERSION, bytes: new ArrayBuffer(3), byteLength: 3, updatedAt: -1 },
  ])('informa payload inválido sem substituí-lo: %j', async (payload) => {
    const storage = repository()
    await storage.saveBattery(ROM_A, new Uint8Array([1, 2, 3]))
    await replaceRecord({ ...payload, romId: ROM_A })
    await expect(storage.loadBattery(ROM_A, 3)).rejects.toBeInstanceOf(BatteryStorageError)
  })

  it('informa indisponibilidade e falha de permissão em vez de fingir persistência', async () => {
    const missing = new BatteryRepository({ indexedDB: null })
    await expect(missing.loadBattery(ROM_A, 8192)).rejects.toMatchObject({ code: 'unavailable' })
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw new DOMException('Sem permissão', 'SecurityError')
    })
    await expect(repository().saveBattery(ROM_A, new Uint8Array([1]))).rejects.toMatchObject({
      code: 'unavailable',
      cause: expect.objectContaining({ name: 'SecurityError' }),
    })
  })

  it('preserva a causa e informa quota excedida de uma gravação', async () => {
    const storage = repository()
    await storage.saveBattery(ROM_A, new Uint8Array([1]))
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota esgotada', 'QuotaExceededError')
    })
    await expect(storage.saveBattery(ROM_A, new Uint8Array([2]))).rejects.toMatchObject({
      code: 'quota-exceeded',
      message: expect.stringContaining('ainda não foi salvo'),
    })
    expect(await storage.loadBattery(ROM_A, 1)).toEqual(new Uint8Array([1]))
  })

  it('fecha na mudança de versão, permitindo upgrade sem apagar bateria', async () => {
    const storage = repository()
    await storage.saveBattery(ROM_A, new Uint8Array([7, 8]))
    const upgraded = await rawDatabase(SAVE_DATABASE_VERSION + 1)
    expect(upgraded.version).toBe(SAVE_DATABASE_VERSION + 1)
    upgraded.close()
    await expect(storage.loadBattery(ROM_A, 2)).rejects.toMatchObject({ code: 'incompatible-data' })
    const newer = await rawDatabase(SAVE_DATABASE_VERSION + 1)
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = newer
        .transaction(BATTERY_STORE_NAME)
        .objectStore(BATTERY_STORE_NAME)
        .get(ROM_A)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(record).toMatchObject({ romId: ROM_A, bytes: new Uint8Array([7, 8]).buffer })
    newer.close()
  })

  it('encerrar durante a abertura rejeita a operação e não deixa conexão aberta', async () => {
    const storage = repository()
    const pending = storage.loadBattery(ROM_A, 8192)
    storage.close()
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    await expect(storage.loadBattery(ROM_A, 8192)).rejects.toMatchObject({ code: 'closed' })
  })

  it('informa bloqueio de outra aba sem ficar aguardando indefinidamente', async () => {
    const request = {} as IDBOpenDBRequest
    vi.spyOn(factory, 'open').mockReturnValue(request)
    const pending = repository().loadBattery(ROM_A, 8192)
    request.onblocked!.call(request, new Event('blocked') as IDBVersionChangeEvent)
    await expect(pending).rejects.toMatchObject({ code: 'blocked' })
  })

  it('encerra a espera de uma abertura que não respondeu e cancela seu timer', async () => {
    vi.useFakeTimers()
    vi.spyOn(factory, 'open').mockReturnValue({} as IDBOpenDBRequest)
    const storage = new BatteryRepository({ indexedDB: factory, openTimeoutMs: 50 })
    repositories.push(storage)
    const pending = expect(storage.loadBattery(ROM_A, 8192)).rejects.toMatchObject({
      code: 'timeout',
    })
    await vi.advanceTimersByTimeAsync(50)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uma resposta após timeout fecha a conexão em vez de guardar um banco já abandonado', async () => {
    vi.useFakeTimers()
    const request = {} as IDBOpenDBRequest
    vi.spyOn(factory, 'open').mockReturnValue(request)
    const storage = new BatteryRepository({ indexedDB: factory, openTimeoutMs: 50 })
    repositories.push(storage)
    const pending = expect(storage.loadBattery(ROM_A, 8192)).rejects.toMatchObject({
      code: 'timeout',
    })
    await vi.advanceTimersByTimeAsync(50)
    await pending
    const close = vi.fn()
    Object.defineProperty(request, 'result', { value: { close } })
    request.onsuccess!.call(request, new Event('success'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('recusa banco com estrutura incompatível sem excluir nem recriar seus stores', async () => {
    const database = await rawDatabase()
    database.close()
    await expect(repository().loadBattery(ROM_A, 8192)).rejects.toMatchObject({
      code: 'incompatible-data',
    })
    const preserved = await rawDatabase()
    expect(preserved.objectStoreNames).toHaveLength(0)
    preserved.close()
  })

  it.each(['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)])(
    'recusa identificador inválido %j',
    async (id) => {
      await expect(repository().saveBattery(id, new Uint8Array([1]))).rejects.toMatchObject({
        code: 'invalid-data',
      })
    },
  )

  it.each([0, -1, 1.25, Number.NaN])('recusa tamanho esperado inválido %s', async (length) => {
    await expect(repository().loadBattery(ROM_A, length)).rejects.toMatchObject({
      code: 'invalid-data',
    })
  })
})

describe('hash SHA-256 da ROM', () => {
  it('produz o vetor conhecido de SHA-256 tanto nativo quanto no fallback HTTP', async () => {
    const rom = new TextEncoder().encode('abc')
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await hashRom(rom)).toBe(expected)
    expect(await hashRom(rom, null)).toBe(expected)
  })

  it('considera somente a view recebida e não muda o conteúdo original', async () => {
    const rom = new Uint8Array([255, 97, 98, 99, 254])
    expect(await hashRom(rom.subarray(1, 4))).toBe(await hashRom(new TextEncoder().encode('abc')))
    expect(rom).toEqual(new Uint8Array([255, 97, 98, 99, 254]))
  })
})
