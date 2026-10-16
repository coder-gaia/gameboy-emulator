import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { BatteryRepository, StateRepository } from '../../src/platform/storage'
import { createStateRecord } from '../../src/platform/states'
import {
  BATTERY_STORE_NAME,
  SAVE_DATABASE_VERSION,
  STATE_STORE_NAME,
} from '../../src/platform/storage/schema'

const ROM_A = 'a'.repeat(64)
const ROM_B = 'b'.repeat(64)
const DATABASE_NAME = 'state-repository-test'
let factory: IDBFactory
let opened: { close(): void }[]
function states(): StateRepository {
  const repo = new StateRepository({ indexedDB: factory, databaseName: DATABASE_NAME })
  opened.push(repo)
  return repo
}
function battery(): BatteryRepository {
  const repo = new BatteryRepository({ indexedDB: factory, databaseName: DATABASE_NAME })
  opened.push(repo)
  return repo
}

async function rawDatabase(version = SAVE_DATABASE_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

beforeEach(() => {
  factory = new IDBFactory()
  opened = []
})
afterEach(() => {
  for (const repo of opened) repo.close()
  vi.restoreAllMocks()
})

describe('slots locais de estado', () => {
  it.each(['battery', 'states'])(
    'cria os dois stores quando %s abre o banco primeiro',
    async (first) => {
      const b = battery()
      const s = states()
      if (first === 'battery') await b.loadBattery(ROM_A, 2)
      else await s.listStates(ROM_A)
      await b.saveBattery(ROM_A, new Uint8Array([7, 8]))
      await s.saveState(await createStateRecord(ROM_A, 1, { ram: new Uint8Array([1, 2]) }, 1234))
      expect(await b.loadBattery(ROM_A, 2)).toEqual(new Uint8Array([7, 8]))
      expect(await s.loadState(ROM_A, 1)).toMatchObject({
        slot: 1,
        payload: { ram: new Uint8Array([1, 2]) },
      })
      const db = await rawDatabase()
      expect(Array.from(db.objectStoreNames)).toEqual(['battery', 'states'])
      db.close()
    },
  )

  it.each(['battery', 'states'])(
    'upgrade v1 por %s preserva bytes e metadados de bateria',
    async (first) => {
      await new Promise<void>((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore(BATTERY_STORE_NAME, { keyPath: 'romId' })
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(BATTERY_STORE_NAME, 'readwrite')
          tx.objectStore(BATTERY_STORE_NAME).put({
            version: 1,
            romId: ROM_A,
            bytes: new Uint8Array([7, 8]).buffer,
            byteLength: 2,
            updatedAt: 1234,
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
      const b = battery()
      const s = states()
      if (first === 'battery') await b.loadBattery(ROM_A, 2)
      else await s.listStates(ROM_A)
      expect(await b.loadBattery(ROM_A, 2)).toEqual(new Uint8Array([7, 8]))
      const db = await rawDatabase()
      expect(db.version).toBe(2)
      const record = await new Promise<unknown>((resolve) => {
        const request = db
          .transaction(BATTERY_STORE_NAME)
          .objectStore(BATTERY_STORE_NAME)
          .get(ROM_A)
        request.onsuccess = () => resolve(request.result)
      })
      expect(record).toMatchObject({ version: 1, byteLength: 2, updatedAt: 1234 })
      db.close()
    },
  )

  it('mantém três slots ordenados por ROM e remove somente o selecionado', async () => {
    const repo = states()
    expect(await repo.listStates(ROM_A)).toEqual([])
    expect(await repo.loadState(ROM_A, 1)).toBeNull()
    for (const slot of [3, 1, 2] as const)
      await repo.saveState(await createStateRecord(ROM_A, slot, { counter: slot }, 1000 + slot))
    await repo.saveState(await createStateRecord(ROM_B, 1, { counter: 99 }, 1234))
    expect((await repo.listStates(ROM_A)).map((item) => item.slot)).toEqual([1, 2, 3])
    await repo.deleteState(ROM_A, 2)
    expect(await repo.loadState(ROM_A, 2)).toBeNull()
    expect(await repo.loadState(ROM_A, 3)).toMatchObject({ payload: { counter: 3 } })
    expect(await repo.loadState(ROM_B, 1)).toMatchObject({ payload: { counter: 99 } })
  })

  it('sobrevive a fechar o repositório e devolve cópias independentes dos bytes', async () => {
    const first = states()
    const record = await createStateRecord(ROM_A, 1, { ram: new Uint8Array([1, 2]) }, 1234)
    const saving = first.saveState(record)
    ;(record.payload as { ram: Uint8Array }).ram.fill(9)
    await saving
    first.close()
    const second = states()
    const loaded = (await second.loadState(ROM_A, 1))!
    expect(loaded.payload).toEqual({ ram: new Uint8Array([1, 2]) })
    ;(loaded.payload as { ram: Uint8Array }).ram.fill(8)
    expect((await second.loadState(ROM_A, 1))!.payload).toEqual({ ram: new Uint8Array([1, 2]) })
  })

  it('devolve uma miniatura válida sem compartilhar os bytes do estado persistido', async () => {
    const repo = states()
    const framebuffer = new Uint8Array(160 * 144).fill(2)
    await repo.saveState(
      await createStateRecord(ROM_A, 1, { core: { bus: { ppu: { framebuffer } } } }, 1234),
    )
    const summary = (await repo.listStates(ROM_A))[0]!
    expect(summary.framebuffer).toEqual(framebuffer)
    summary.framebuffer!.fill(3)
    expect((await repo.listStates(ROM_A))[0]!.framebuffer).toEqual(framebuffer)
  })

  it.each([
    { counter: 1 },
    { core: { bus: { ppu: { framebuffer: new Uint8Array(10) } } } },
    { core: { bus: { ppu: { framebuffer: new Uint8Array(160 * 144).fill(4) } } } },
  ])('não usa conteúdo ausente ou inválido como miniatura', async (payload) => {
    const repo = states()
    await repo.saveState(await createStateRecord(ROM_A, 1, payload, 1234))
    expect((await repo.listStates(ROM_A))[0]!.framebuffer).toBeNull()
    expect((await repo.loadState(ROM_A, 1))!.payload).toEqual(payload)
  })

  it('checksum inválido no IndexedDB é reportado sem apagar outros slots ou regravar dados', async () => {
    const repo = states()
    await repo.saveState(await createStateRecord(ROM_A, 1, { counter: 1 }, 1234))
    await repo.saveState(await createStateRecord(ROM_A, 2, { counter: 2 }, 1234))
    const db = await rawDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STATE_STORE_NAME, 'readwrite')
      const store = tx.objectStore(STATE_STORE_NAME)
      const request = store.get([ROM_A, 2])
      request.onsuccess = () => {
        const row = request.result
        const content = JSON.parse(new TextDecoder().decode(row.bytes))
        content.payload.counter = 99
        row.bytes = new TextEncoder().encode(JSON.stringify(content)).buffer
        store.put(row)
      }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    await expect(repo.loadState(ROM_A, 2)).rejects.toMatchObject({ code: 'checksum-mismatch' })
    await expect(repo.listStates(ROM_A)).rejects.toMatchObject({ code: 'checksum-mismatch' })
    expect(await repo.loadState(ROM_A, 1)).toMatchObject({ payload: { counter: 1 } })
    await expect(repo.loadState(ROM_A, 2)).rejects.toMatchObject({ code: 'checksum-mismatch' })
  })

  it('quota e transação abortada preservam o slot anterior', async () => {
    const repo = states()
    const initial = await createStateRecord(ROM_A, 1, { counter: 1 }, 1234)
    await repo.saveState(initial)
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError')
    })
    await expect(
      repo.saveState(await createStateRecord(ROM_A, 1, { counter: 2 }, 1234)),
    ).rejects.toMatchObject({ code: 'quota-exceeded' })
    expect(await repo.loadState(ROM_A, 1)).toEqual(initial)
    spy.mockImplementation(function (this: IDBObjectStore, value: unknown) {
      const request = original.call(this, value)
      request.addEventListener('success', () => request.transaction!.abort())
      return request
    })
    await expect(
      repo.saveState(await createStateRecord(ROM_A, 1, { counter: 3 }, 1234)),
    ).rejects.toMatchObject({ code: 'operation-failed' })
    expect(await repo.loadState(ROM_A, 1)).toEqual(initial)
  })

  it('recusa slot inválido e informa armazenamento indisponível', async () => {
    await expect(states().loadState(ROM_A, 4 as 1)).rejects.toMatchObject({ code: 'invalid-data' })
    const missing = new StateRepository({ indexedDB: null })
    await expect(missing.listStates(ROM_A)).rejects.toMatchObject({ code: 'unavailable' })
    missing.close()
  })
})
