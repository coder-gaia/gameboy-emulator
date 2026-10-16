import { hashRom } from '../storage/hash-rom'

export const STATE_FORMAT = 'PocketLab'
export const STATE_FORMAT_VERSION = 1
export const STATE_MODEL = 'DMG-CPU-B'
export const MAX_STATE_BYTES = 1024 * 1024
const MAX_DEPTH = 64
const BYTE_TAG = '$type'
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const ENVELOPE_KEYS = [
  'format',
  'version',
  'romId',
  'model',
  'createdAt',
  'slot',
  'payload',
  'checksum',
]

export type StateSlot = 1 | 2 | 3
export type StateFileErrorCode =
  | 'invalid-data'
  | 'incompatible-version'
  | 'wrong-rom'
  | 'wrong-model'
  | 'checksum-mismatch'
  | 'too-large'

export class StateFileError extends Error {
  constructor(
    readonly code: StateFileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'StateFileError'
  }
}

export interface StateRecord {
  readonly format: typeof STATE_FORMAT
  readonly version: typeof STATE_FORMAT_VERSION
  readonly romId: string
  readonly model: typeof STATE_MODEL
  readonly createdAt: number
  readonly slot: StateSlot
  readonly payload: unknown
  readonly checksum: string
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
interface Budget {
  nodes: number
  stringBytes: number
}

function invalid(
  message = 'O arquivo de estado está danificado ou contém dados inválidos.',
): never {
  throw new StateFileError('invalid-data', message)
}

function tooLarge(): never {
  throw new StateFileError('too-large', 'O estado ultrapassa o limite de 1 MiB.')
}

export function validateStateRomId(romId: string): void {
  if (typeof romId !== 'string' || !/^[0-9a-f]{64}$/.test(romId))
    invalid('O identificador do cartucho no estado não é um SHA-256 válido.')
}

export function validateStateSlot(slot: unknown): asserts slot is StateSlot {
  if (slot !== 1 && slot !== 2 && slot !== 3) invalid('Escolha um slot de estado entre 1 e 3.')
}

function countValue(budget: Budget, depth: number): void {
  budget.nodes += 1
  if (depth > MAX_DEPTH) invalid('O estado contém estruturas aninhadas além do limite permitido.')
  if (budget.nodes > MAX_STATE_BYTES / 2) tooLarge()
}

function jsonValue(value: unknown, budget: Budget, ancestors: Set<object>, depth = 0): JsonValue {
  countValue(budget, depth)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('O estado contém um número inválido.')
    return value
  }
  if (typeof value === 'string') {
    budget.stringBytes += new TextEncoder().encode(value).length
    if (budget.stringBytes > MAX_STATE_BYTES) tooLarge()
    return value
  }
  if (typeof value !== 'object') invalid('O estado contém um tipo de dado não suportado.')
  if (ancestors.has(value)) invalid('O estado contém referências circulares.')
  if (value instanceof Uint8Array) {
    if (value.length > MAX_STATE_BYTES / 2) tooLarge()
    budget.nodes += value.length
    if (budget.nodes > MAX_STATE_BYTES / 2) tooLarge()
    return { [BYTE_TAG]: 'Uint8Array', data: Array.from(value) }
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_STATE_BYTES / 2) tooLarge()
      if (Object.keys(value).length !== value.length)
        invalid('O estado contém um array incompleto.')
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) invalid('O estado contém um array incompleto.')
      }
      return value.map((item) => jsonValue(item, budget, ancestors, depth + 1))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      invalid('O estado contém um objeto não suportado.')
    const output: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key) || key === BYTE_TAG)
        invalid('O estado contém uma chave reservada ou insegura.')
      budget.stringBytes += new TextEncoder().encode(key).length
      if (budget.stringBytes > MAX_STATE_BYTES) tooLarge()
      output[key] = jsonValue((value as Record<string, unknown>)[key], budget, ancestors, depth + 1)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function payloadValue(value: unknown, budget: Budget, depth = 0): unknown {
  countValue(budget, depth)
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid()
    return value
  }
  if (Array.isArray(value)) return value.map((item) => payloadValue(item, budget, depth + 1))
  if (typeof value !== 'object') invalid()
  const record = value as Record<string, unknown>
  if (Object.hasOwn(record, BYTE_TAG)) {
    const keys = Object.keys(record)
    if (
      record[BYTE_TAG] !== 'Uint8Array' ||
      keys.length !== 2 ||
      !Object.hasOwn(record, 'data') ||
      !Array.isArray(record.data)
    )
      invalid('O estado contém uma tag de bytes desconhecida ou inválida.')
    if (record.data.length > MAX_STATE_BYTES / 2) tooLarge()
    budget.nodes += record.data.length
    if (budget.nodes > MAX_STATE_BYTES / 2) tooLarge()
    if (
      !record.data.every(
        (byte) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255,
      )
    )
      invalid('O estado contém bytes fora do intervalo permitido.')
    return new Uint8Array(record.data)
  }
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) invalid('O estado contém uma chave insegura.')
    output[key] = payloadValue(record[key], budget, depth + 1)
  }
  return output
}

function metadata(record: Record<string, unknown>) {
  if (record.format !== STATE_FORMAT) invalid('Este arquivo não é um estado do Pocket Lab.')
  if (record.version !== STATE_FORMAT_VERSION)
    throw new StateFileError(
      'incompatible-version',
      'A versão deste arquivo de estado não é compatível.',
    )
  if (record.model !== STATE_MODEL)
    throw new StateFileError('wrong-model', 'Este estado pertence a outro modelo de console.')
  validateStateRomId(record.romId as string)
  const slot = record.slot
  validateStateSlot(slot)
  if (
    typeof record.createdAt !== 'number' ||
    !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0
  )
    invalid('A data do estado é inválida.')
  return {
    format: STATE_FORMAT,
    version: STATE_FORMAT_VERSION,
    romId: record.romId as string,
    model: STATE_MODEL,
    createdAt: record.createdAt,
    slot,
  } as const
}

function bytesOf(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  if (bytes.byteLength > MAX_STATE_BYTES) tooLarge()
  return bytes
}

function budget(): Budget {
  return { nodes: 0, stringBytes: 0 }
}

export async function createStateRecord(
  romId: string,
  slot: StateSlot,
  payload: unknown,
  createdAt = Date.now(),
): Promise<StateRecord> {
  const info = metadata({
    format: STATE_FORMAT,
    version: STATE_FORMAT_VERSION,
    model: STATE_MODEL,
    romId,
    slot,
    createdAt,
  })
  const normalized = jsonValue(payload, budget(), new Set())
  const content = { ...info, payload: normalized }
  const checksum = await hashRom(bytesOf(content))
  bytesOf({ ...content, checksum })
  return { ...info, payload: payloadValue(normalized, budget()), checksum }
}

export async function encodeState(record: StateRecord): Promise<Uint8Array> {
  if (record === null || typeof record !== 'object') invalid()
  if (
    Object.keys(record).length !== ENVELOPE_KEYS.length ||
    ENVELOPE_KEYS.some((key) => !Object.hasOwn(record, key))
  )
    invalid()
  const info = metadata(record as unknown as Record<string, unknown>)
  const suppliedChecksum = record.checksum
  const payload = jsonValue(record.payload, budget(), new Set())
  const content = { ...info, payload }
  const checksum = await hashRom(bytesOf(content))
  if (suppliedChecksum !== checksum)
    throw new StateFileError('checksum-mismatch', 'O conteúdo do estado mudou ou está corrompido.')
  return bytesOf({ ...content, checksum })
}

export async function decodeState(bytes: Uint8Array, expectedRomId?: string): Promise<StateRecord> {
  if (bytes.byteLength > MAX_STATE_BYTES) tooLarge()
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (cause) {
    throw new StateFileError('invalid-data', 'O arquivo de estado não contém JSON UTF-8 válido.', {
      cause,
    })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) invalid()
  const record = parsed as Record<string, unknown>
  if (
    Object.keys(record).length !== ENVELOPE_KEYS.length ||
    ENVELOPE_KEYS.some((key) => !Object.hasOwn(record, key))
  )
    invalid()
  const info = metadata(record)
  if (expectedRomId !== undefined) {
    validateStateRomId(expectedRomId)
    if (info.romId !== expectedRomId)
      throw new StateFileError(
        'wrong-rom',
        'Este estado pertence a outro cartucho. Escolha o jogo correspondente.',
      )
  }
  if (typeof record.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(record.checksum))
    invalid('O checksum do estado é inválido.')
  const payload = payloadValue(record.payload, budget())
  const normalized = jsonValue(payload, budget(), new Set())
  const checksum = await hashRom(bytesOf({ ...info, payload: normalized }))
  if (checksum !== record.checksum)
    throw new StateFileError(
      'checksum-mismatch',
      'O arquivo de estado está corrompido ou foi modificado.',
    )
  return { ...info, payload, checksum }
}
