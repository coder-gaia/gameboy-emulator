import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Mbc3Cartridge } from '../../src/core/cartridge'
import type { CartridgeRtcState } from '../../src/core/cartridge'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import { BatteryRepository } from '../../src/platform/storage'
import { BATTERY_STORE_NAME, SAVE_DATABASE_VERSION } from '../../src/platform/storage/schema'
import type { BatteryState, RtcBatteryRecord } from '../../src/platform/storage/schema'
import { BatterySession } from '../../src/runtime/battery-session'
import type { BatteryMemory, BatteryStorage } from '../../src/runtime/battery-session'
import { buildTestRom } from '../fixtures/rom'

const ROM_ID = 'c'.repeat(64)
const DATABASE_NAME = 'battery-rtc-test'
let factory: IDBFactory
let repositories: BatteryRepository[]

function repository(): BatteryRepository {
  const storage = new BatteryRepository({ indexedDB: factory, databaseName: DATABASE_NAME })
  repositories.push(storage)
  return storage
}

function rtc(overrides: Partial<CartridgeRtcState> = {}): CartridgeRtcState {
  return {
    version: 1,
    seconds: 2,
    minutes: 3,
    hours: 4,
    days: 5,
    halted: false,
    carry: false,
    subsecondTCycles: 123,
    ...overrides,
  }
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, SAVE_DATABASE_VERSION)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function rawRecord(value?: unknown): Promise<unknown> {
  const connection = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = connection.transaction(
        BATTERY_STORE_NAME,
        value === undefined ? 'readonly' : 'readwrite',
      )
      const store = transaction.objectStore(BATTERY_STORE_NAME)
      const request = value === undefined ? store.get(ROM_ID) : store.put(value)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    connection.close()
  }
}

function memory(withRam = true): BatteryMemory & {
  cartridge: Mbc3Cartridge
  exportBatteryRtc: NonNullable<BatteryMemory['exportBatteryRtc']>
} {
  const cartridge = new Mbc3Cartridge(
    buildTestRom({ cartridgeType: withRam ? 0x10 : 0x0f, ramSizeCode: withRam ? 2 : 0 }),
  )
  return {
    cartridge,
    get batteryRevision() {
      return cartridge.batteryRevision
    },
    exportBatteryRam: () => cartridge.exportBatteryRam(),
    importBatteryRam: (bytes) => cartridge.importBatteryRam(bytes),
    exportBatteryRtc: () => cartridge.exportBatteryRtc(),
    importBatteryState: vi.fn((bytes, savedRtc, elapsedSeconds) => {
      const state = cartridge.snapshotState()
      state.ram = bytes
      state.rtc = savedRtc
      cartridge.restoreState(state)
      cartridge.advanceRtcSeconds(elapsedSeconds)
    }),
  }
}

beforeEach(() => {
  factory = new IDBFactory()
  repositories = []
})

afterEach(() => {
  for (const storage of repositories) storage.close()
  vi.restoreAllMocks()
})

describe('envelope de bateria RTC no IndexedDB', () => {
  it('persiste RTC sem RAM em envelope v2 e mantém o schema do banco em v2', async () => {
    const storage = repository()
    const savedRtc = rtc()
    const save = storage.saveBatteryState(ROM_ID, {
      bytes: new Uint8Array(0),
      rtc: savedRtc,
      updatedAt: 123_456,
    })
    savedRtc.seconds = 59
    await save
    storage.close()
    const reopened = repository()
    expect(await reopened.loadBatteryState(ROM_ID, 0)).toEqual({
      bytes: new Uint8Array(0),
      rtc: rtc(),
      updatedAt: 123_456,
    })
    expect(await rawRecord()).toEqual({
      version: 2,
      romId: ROM_ID,
      byteLength: 0,
      bytes: new ArrayBuffer(0),
      rtc: rtc(),
      updatedAt: 123_456,
    })
    const connection = await database()
    expect(connection.version).toBe(2)
    connection.close()
  })

  it('copia RAM e RTC juntos antes do I/O e devolve cópias independentes', async () => {
    const storage = repository()
    const source = new Uint8Array([9, 1, 2, 3, 8])
    const sourceRtc = rtc()
    const save = storage.saveBatteryState(ROM_ID, {
      bytes: source.subarray(1, 4),
      rtc: sourceRtc,
      updatedAt: 456,
    })
    source.fill(0)
    sourceRtc.hours = 12
    await save
    const loaded = (await storage.loadBatteryState(ROM_ID, 3))!
    expect(loaded).toEqual({ bytes: new Uint8Array([1, 2, 3]), rtc: rtc(), updatedAt: 456 })
    loaded.bytes.fill(9)
    loaded.rtc!.hours = 13
    expect(await storage.loadBatteryState(ROM_ID, 3)).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      rtc: rtc(),
      updatedAt: 456,
    })
  })

  it('continua lendo RAM v1 sem converter nem apagar o registro antigo', async () => {
    const storage = repository()
    vi.spyOn(Date, 'now').mockReturnValue(77_000)
    await storage.saveBattery(ROM_ID, new Uint8Array([4, 5]))
    const original = await rawRecord()
    expect(await storage.loadBatteryState(ROM_ID, 2)).toEqual({
      bytes: new Uint8Array([4, 5]),
      rtc: null,
      updatedAt: 77_000,
    })
    expect(await storage.loadBattery(ROM_ID, 2)).toEqual(new Uint8Array([4, 5]))
    expect(await rawRecord()).toEqual(original)
  })

  it('rejeita versão futura sem substituir os bytes ou o RTC existentes', async () => {
    const storage = repository()
    await storage.saveBatteryState(ROM_ID, { bytes: new Uint8Array(0), rtc: rtc(), updatedAt: 100 })
    const future = { ...((await rawRecord()) as RtcBatteryRecord), version: 3 }
    await rawRecord(future)
    await expect(storage.loadBatteryState(ROM_ID, 0)).rejects.toMatchObject({
      code: 'incompatible-data',
    })
    expect(await rawRecord()).toEqual(future)
  })

  it.each([
    { seconds: 64 },
    { minutes: 64 },
    { hours: 32 },
    { days: 512 },
    { halted: 'sim' },
    { carry: 1 },
    { subsecondTCycles: DMG_CLOCK_HZ },
    { version: 2 },
  ])('preserva RTC corrompido e informa a falha: %j', async (invalid) => {
    const storage = repository()
    await storage.saveBatteryState(ROM_ID, {
      bytes: new Uint8Array([7]),
      rtc: rtc(),
      updatedAt: 100,
    })
    const damaged = { ...((await rawRecord()) as RtcBatteryRecord), rtc: { ...rtc(), ...invalid } }
    await rawRecord(damaged)
    await expect(storage.loadBatteryState(ROM_ID, 1)).rejects.toMatchObject({
      code: 'invalid-data',
    })
    expect(await rawRecord()).toEqual(damaged)
  })

  it('rejeita snapshot inválido antes de substituir um save válido', async () => {
    const storage = repository()
    const valid = { bytes: new Uint8Array([3]), rtc: rtc(), updatedAt: 100 }
    await storage.saveBatteryState(ROM_ID, valid)
    for (const invalid of [
      { ...valid, updatedAt: -1 },
      { ...valid, updatedAt: Number.NaN },
      { ...valid, rtc: rtc({ seconds: 64 }) },
      { ...valid, rtc: null },
    ]) {
      await expect(storage.saveBatteryState(ROM_ID, invalid)).rejects.toThrow()
      expect(await storage.loadBatteryState(ROM_ID, 1)).toEqual(valid)
    }
  })

  it('quota excedida preserva o último par RAM e RTC confirmado', async () => {
    const storage = repository()
    const previous = { bytes: new Uint8Array([1, 2]), rtc: rtc(), updatedAt: 100 }
    await storage.saveBatteryState(ROM_ID, previous)
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota esgotada', 'QuotaExceededError')
    })
    await expect(
      storage.saveBatteryState(ROM_ID, {
        bytes: new Uint8Array([3, 4]),
        rtc: rtc({ seconds: 22 }),
        updatedAt: 200,
      }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' })
    expect(await storage.loadBatteryState(ROM_ID, 2)).toEqual(previous)
  })

  it('aborto depois do success do put não confirma metade do novo snapshot', async () => {
    const storage = repository()
    const previous = { bytes: new Uint8Array([1]), rtc: rtc(), updatedAt: 100 }
    await storage.saveBatteryState(ROM_ID, previous)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      const request = put.call(this, value)
      request.addEventListener('success', () => request.transaction!.abort())
      return request
    })
    await expect(
      storage.saveBatteryState(ROM_ID, {
        bytes: new Uint8Array([2]),
        rtc: rtc({ days: 111 }),
        updatedAt: 200,
      }),
    ).rejects.toMatchObject({ code: 'operation-failed' })
    expect(await storage.loadBatteryState(ROM_ID, 1)).toEqual(previous)
  })
})

describe('sessão de bateria com relógio offline', () => {
  it('restaura RAM e RTC e avança segundos offline inteiros com carry de 512 dias', async () => {
    const storage = repository()
    const savedRtc = rtc({ seconds: 58, minutes: 59, hours: 23, days: 511 })
    await storage.saveBatteryState(ROM_ID, {
      bytes: new Uint8Array(8192).fill(0x42),
      rtc: savedRtc,
      updatedAt: 1_000_000,
    })
    const cartridge = memory()
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 1_005_999)
    expect(await session.restore()).toBe(true)
    expect(cartridge.importBatteryState).toHaveBeenCalledWith(
      new Uint8Array(8192).fill(0x42),
      savedRtc,
      5,
    )
    expect(cartridge.exportBatteryRtc()).toEqual(
      rtc({
        seconds: 3,
        minutes: 0,
        hours: 0,
        days: 0,
        carry: true,
      }),
    )
    expect(cartridge.exportBatteryRam()).toEqual(new Uint8Array(8192).fill(0x42))
  })

  it('respeita halt e preserva a fração do cristal durante uma semana offline', async () => {
    const storage = repository()
    const savedRtc = rtc({ halted: true, subsecondTCycles: DMG_CLOCK_HZ - 1 })
    await storage.saveBatteryState(ROM_ID, {
      bytes: new Uint8Array(0),
      rtc: savedRtc,
      updatedAt: 100_000,
    })
    const cartridge = memory(false)
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 604_900_000)
    expect(await session.restore()).toBe(true)
    expect(cartridge.exportBatteryRtc()).toEqual(savedRtc)
    cartridge.cartridge.tick(DMG_CLOCK_HZ * 10)
    expect(cartridge.exportBatteryRtc()).toEqual(savedRtc)
  })

  it('relógio do sistema voltando não recua o RTC nem gera tempo negativo', async () => {
    const storage = repository()
    const savedRtc = rtc()
    await storage.saveBatteryState(ROM_ID, {
      bytes: new Uint8Array(0),
      rtc: savedRtc,
      updatedAt: 100_000,
    })
    const cartridge = memory(false)
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 90_000)
    expect(await session.restore()).toBe(true)
    expect(cartridge.importBatteryState).toHaveBeenCalledWith(new Uint8Array(0), savedRtc, 0)
    expect(cartridge.exportBatteryRtc()).toEqual(savedRtc)
  })

  it('recupera RAM v1 sem alterar o registro e migra preservando os bytes no flush', async () => {
    const storage = repository()
    await storage.saveBattery(ROM_ID, new Uint8Array(8192).fill(0x31))
    const cartridge = memory()
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 200_000)
    expect(await session.restore()).toBe(true)
    expect(cartridge.importBatteryState).not.toHaveBeenCalled()
    expect(cartridge.exportBatteryRam()).toEqual(new Uint8Array(8192).fill(0x31))
    expect(await rawRecord()).toMatchObject({ version: 1 })
    await session.flush()
    expect(await storage.loadBatteryState(ROM_ID, 8192)).toEqual({
      bytes: new Uint8Array(8192).fill(0x31),
      rtc: rtc({ seconds: 0, minutes: 0, hours: 0, days: 0, subsecondTCycles: 0 }),
      updatedAt: 200_000,
    })
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    await session.flush()
    expect(await rawRecord()).toMatchObject({ version: 2, updatedAt: 200_000 })
  })

  it('cartucho com RTC e RAM zero persiste após o primeiro segundo', async () => {
    const storage = repository()
    const cartridge = memory(false)
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 55_000)
    expect(await session.restore()).toBe(false)
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    await session.flush()
    expect(await storage.loadBatteryState(ROM_ID, 0)).toEqual({
      bytes: new Uint8Array(0),
      rtc: rtc({ seconds: 1, minutes: 0, hours: 0, days: 0, subsecondTCycles: 0 }),
      updatedAt: 55_000,
    })
  })

  it('falha ao recuperar versão futura mantém a sessão impedida de sobrescrever', async () => {
    const storage = repository()
    await storage.saveBatteryState(ROM_ID, { bytes: new Uint8Array(0), rtc: rtc(), updatedAt: 100 })
    const future = { ...((await rawRecord()) as RtcBatteryRecord), version: 3 }
    await rawRecord(future)
    const cartridge = memory(false)
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 100_000)
    await expect(session.restore()).rejects.toMatchObject({ code: 'incompatible-data' })
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    await session.flush()
    expect(await rawRecord()).toEqual(future)
  })

  it('captura RAM, RTC e timestamp antes da fila de gravação e mantém a ordem', async () => {
    const cartridge = memory()
    const states: BatteryState[] = []
    let unlock: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const storage: BatteryStorage = {
      loadBattery: vi.fn().mockResolvedValue(null),
      saveBattery: vi.fn(),
      loadBatteryState: vi.fn().mockResolvedValue(null),
      saveBatteryState: vi.fn(async (_id, state) => {
        await gate
        states.push(state)
      }),
    }
    let now = 1000
    const session = new BatterySession(storage, ROM_ID, cartridge, () => now)
    await session.restore()
    cartridge.cartridge.writeRom(0, 0x0a)
    cartridge.cartridge.writeRam(0xa000, 1)
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    const first = session.flush()
    now = 2000
    cartridge.cartridge.writeRam(0xa000, 2)
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    const second = session.flush()
    now = 99_000
    cartridge.cartridge.writeRam(0xa000, 3)
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    unlock!()
    await Promise.all([first, second])
    expect(states).toHaveLength(2)
    expect(states.map((state) => [state.bytes[0], state.rtc!.seconds, state.updatedAt])).toEqual([
      [1, 1, 1000],
      [2, 2, 2000],
    ])
    expect(storage.saveBattery).not.toHaveBeenCalled()
    await session.flush()
    expect(states.map((state) => [state.bytes[0], state.rtc!.seconds, state.updatedAt])).toEqual([
      [1, 1, 1000],
      [2, 2, 2000],
      [3, 3, 99_000],
    ])
  })

  it('permite repetir flush após quota sem perder a última captura de RAM e RTC', async () => {
    const storage = repository()
    const cartridge = memory(false)
    const session = new BatterySession(storage, ROM_ID, cartridge, () => 1000)
    await session.restore()
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    await session.flush()
    const previous = await storage.loadBatteryState(ROM_ID, 0)
    cartridge.cartridge.tick(DMG_CLOCK_HZ)
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota esgotada', 'QuotaExceededError')
    })
    await expect(session.flush()).rejects.toMatchObject({ code: 'quota-exceeded' })
    expect(await storage.loadBatteryState(ROM_ID, 0)).toEqual(previous)
    put.mockRestore()
    await session.flush()
    expect((await storage.loadBatteryState(ROM_ID, 0))!.rtc!.seconds).toBe(2)
  })

  it('atualiza o instante de pausa e a fração RTC mesmo sem nova revisão inteira', async () => {
    const storage = repository()
    const cartridge = memory(false)
    let now = 1000
    const session = new BatterySession(storage, ROM_ID, cartridge, () => now)
    await session.restore()
    cartridge.cartridge.tick(DMG_CLOCK_HZ / 4)
    const revision = cartridge.batteryRevision
    await session.flush()
    expect(await storage.loadBatteryState(ROM_ID, 0)).toEqual({
      bytes: new Uint8Array(0),
      rtc: rtc({ seconds: 0, minutes: 0, hours: 0, days: 0, subsecondTCycles: DMG_CLOCK_HZ / 4 }),
      updatedAt: 1000,
    })
    now = 10_000
    await session.flush()
    expect((await storage.loadBatteryState(ROM_ID, 0))!.updatedAt).toBe(10_000)
    now = 10_250
    cartridge.cartridge.tick(DMG_CLOCK_HZ / 4)
    expect(cartridge.batteryRevision).toBe(revision)
    await session.flush()
    expect(await storage.loadBatteryState(ROM_ID, 0)).toEqual({
      bytes: new Uint8Array(0),
      rtc: rtc({ seconds: 0, minutes: 0, hours: 0, days: 0, subsecondTCycles: DMG_CLOCK_HZ / 2 }),
      updatedAt: 10_250,
    })
  })
})
