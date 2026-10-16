import { decodeState, encodeState, StateFileError } from '../states'
import type { StateRecord, StateSlot } from '../states'
import { validateStateRomId, validateStateSlot, MAX_STATE_BYTES } from '../states/state-codec'
import { LocalSaveDatabase } from './local-database'
import type { LocalDatabaseOptions } from './local-database'
import { STATE_STORE_NAME, STATE_ROM_INDEX } from './schema'

export type StateRepositoryOptions = LocalDatabaseOptions
export interface StateSummary {
  readonly slot: StateSlot
  readonly createdAt: number
  readonly byteLength: number
  readonly checksum: string
  readonly model: StateRecord['model']
  readonly framebuffer: Uint8Array | null
}
interface StateRow {
  readonly version: 1
  readonly romId: string
  readonly slot: StateSlot
  readonly createdAt: number
  readonly bytes: ArrayBuffer
}

function corrupt(): never {
  throw new StateFileError(
    'invalid-data',
    'O slot de estado está danificado. Os dados locais foram preservados.',
  )
}

function previewFrame(payload: unknown): Uint8Array | null {
  let value = payload
  for (const key of ['core', 'bus', 'ppu', 'framebuffer']) {
    if (value === null || typeof value !== 'object') return null
    value = (value as Record<string, unknown>)[key]
  }
  if (!(value instanceof Uint8Array) || value.length !== 160 * 144) return null
  if (value.some((shade) => shade > 3)) return null
  return value.slice()
}

async function checkedRow(
  value: unknown,
  romId: string,
  expectedSlot?: StateSlot,
): Promise<{ record: StateRecord; byteLength: number }> {
  if (value === null || typeof value !== 'object') corrupt()
  const row = value as Record<string, unknown>
  if (
    row.version !== 1 ||
    row.romId !== romId ||
    !(row.bytes instanceof ArrayBuffer) ||
    row.bytes.byteLength > MAX_STATE_BYTES
  )
    corrupt()
  validateStateSlot(row.slot as number)
  if (expectedSlot !== undefined && expectedSlot !== row.slot) corrupt()
  const record = await decodeState(new Uint8Array(row.bytes), romId)
  if (record.slot !== row.slot || record.createdAt !== row.createdAt) corrupt()
  return { record, byteLength: row.bytes.byteLength }
}

/** Três slots por conteúdo de ROM, com checksum verificado em cada leitura. */
export class StateRepository {
  private readonly database: LocalSaveDatabase
  constructor(options: StateRepositoryOptions = {}) {
    this.database = new LocalSaveDatabase(options)
  }

  async listStates(romId: string): Promise<StateSummary[]> {
    validateStateRomId(romId)
    const rows = await this.database.execute<unknown[]>(STATE_STORE_NAME, 'readonly', (store) =>
      store.index(STATE_ROM_INDEX).getAll(romId),
    )
    const checked = await Promise.all(rows.map((row) => checkedRow(row, romId)))
    return checked
      .map(({ record, byteLength }) => ({
        slot: record.slot,
        createdAt: record.createdAt,
        byteLength,
        checksum: record.checksum,
        model: record.model,
        framebuffer: previewFrame(record.payload),
      }))
      .sort((left, right) => left.slot - right.slot)
  }

  async loadState(romId: string, slot: StateSlot): Promise<StateRecord | null> {
    validateStateRomId(romId)
    validateStateSlot(slot)
    const row = await this.database.execute<unknown>(STATE_STORE_NAME, 'readonly', (store) =>
      store.get([romId, slot]),
    )
    return row === undefined ? null : (await checkedRow(row, romId, slot)).record
  }

  async saveState(record: StateRecord): Promise<void> {
    const encoded = await encodeState(record)
    const verified = await decodeState(encoded)
    const row: StateRow = {
      version: 1,
      romId: verified.romId,
      slot: verified.slot,
      createdAt: verified.createdAt,
      bytes: new Uint8Array(encoded).buffer,
    }
    await this.database.execute(STATE_STORE_NAME, 'readwrite', (store) => store.put(row))
  }

  async deleteState(romId: string, slot: StateSlot): Promise<void> {
    validateStateRomId(romId)
    validateStateSlot(slot)
    await this.database.execute(STATE_STORE_NAME, 'readwrite', (store) =>
      store.delete([romId, slot]),
    )
  }

  close(): void {
    this.database.close()
  }
}
