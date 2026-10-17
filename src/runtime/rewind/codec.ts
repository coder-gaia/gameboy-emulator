export const MAX_REWIND_STATE_BYTES = 128 * 1024
const MAX_DEPTH = 64
const MAGIC = [0x50, 0x4c, 0x52, 1] as const
const TAG = { null: 0, false: 1, true: 2, number: 3, string: 4, bytes: 5, array: 6, object: 7 }

/** Codec interno síncrono. Números usam Float64 LE; strings preservam unidades UTF-16. */
export function encodeToBuffer(value: unknown, target: Uint8Array): number {
  const capacity = Math.min(target.byteLength, MAX_REWIND_STATE_BYTES)
  const view = new DataView(target.buffer, target.byteOffset, capacity)
  const ancestors = new Set<object>()
  let offset = 0
  const reserve = (length: number): void => {
    if (length > capacity - offset) throw new Error('O estado excede o limite binário do rewind.')
  }
  const byte = (number: number): void => {
    reserve(1)
    target[offset++] = number
  }
  const uint32 = (number: number): void => {
    reserve(4)
    view.setUint32(offset, number, true)
    offset += 4
  }
  const string = (text: string): void => {
    reserve(4 + text.length * 2)
    uint32(text.length)
    for (let index = 0; index < text.length; index += 1) {
      view.setUint16(offset, text.charCodeAt(index), true)
      offset += 2
    }
  }
  const encode = (item: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error('O estado excede a profundidade do rewind.')
    if (item === null) return byte(TAG.null)
    if (typeof item === 'boolean') return byte(item ? TAG.true : TAG.false)
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('O rewind exige números finitos.')
      byte(TAG.number)
      reserve(8)
      view.setFloat64(offset, item, true)
      offset += 8
      return
    }
    if (typeof item === 'string') {
      byte(TAG.string)
      string(item)
      return
    }
    if (item instanceof Uint8Array) {
      byte(TAG.bytes)
      uint32(item.length)
      reserve(item.length)
      target.set(item, offset)
      offset += item.length
      return
    }
    if (typeof item !== 'object')
      throw new Error('O estado contém um tipo não suportado no rewind.')
    if (ancestors.has(item)) throw new Error('O estado do rewind contém uma referência circular.')
    ancestors.add(item)
    try {
      if (Array.isArray(item)) {
        const keys = Reflect.ownKeys(item)
        if (keys.length !== item.length + 1 || keys.some((key) => typeof key !== 'string'))
          throw new Error('Arrays do rewind devem ser densos e conter somente seus elementos.')
        byte(TAG.array)
        uint32(item.length)
        for (let index = 0; index < item.length; index += 1) {
          const property = Object.getOwnPropertyDescriptor(item, String(index))
          if (!property || !Object.hasOwn(property, 'value'))
            throw new Error('O rewind não aceita propriedades calculadas.')
          encode(property.value, depth + 1)
        }
        return
      }
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error('O rewind aceita somente objetos simples e Uint8Array.')
      const keys = Object.keys(item).sort()
      if (Reflect.ownKeys(item).length !== keys.length)
        throw new Error('O rewind exige propriedades próprias, enumeráveis e textuais.')
      byte(TAG.object)
      uint32(keys.length)
      for (const key of keys) {
        const property = Object.getOwnPropertyDescriptor(item, key)!
        if (!Object.hasOwn(property, 'value'))
          throw new Error('O rewind não aceita propriedades calculadas.')
        string(key)
        encode(property.value, depth + 1)
      }
    } finally {
      ancestors.delete(item)
    }
  }
  for (const part of MAGIC) byte(part)
  encode(value, 0)
  return offset
}

/** A saída não compartilha buffers nem referências com a arena do histórico. */
export function decode(source: Uint8Array): unknown {
  if (source.byteLength > MAX_REWIND_STATE_BYTES)
    throw new Error('O estado excede o limite binário do rewind.')
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  let offset = 0
  const requireBytes = (length: number): void => {
    if (length > source.byteLength - offset)
      throw new Error('O estado binário do rewind está truncado.')
  }
  const byte = (): number => {
    requireBytes(1)
    return source[offset++]!
  }
  const uint32 = (): number => {
    requireBytes(4)
    const value = view.getUint32(offset, true)
    offset += 4
    return value
  }
  const string = (): string => {
    const length = uint32()
    requireBytes(length * 2)
    let text = ''
    for (let index = 0; index < length; index += 1) {
      text += String.fromCharCode(view.getUint16(offset, true))
      offset += 2
    }
    return text
  }
  const read = (depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new Error('O estado excede a profundidade do rewind.')
    switch (byte()) {
      case TAG.null:
        return null
      case TAG.false:
        return false
      case TAG.true:
        return true
      case TAG.number: {
        requireBytes(8)
        const number = view.getFloat64(offset, true)
        offset += 8
        if (!Number.isFinite(number)) throw new Error('O rewind exige números finitos.')
        return number
      }
      case TAG.string:
        return string()
      case TAG.bytes: {
        const length = uint32()
        requireBytes(length)
        const bytes = Uint8Array.from(source.subarray(offset, offset + length))
        offset += length
        return bytes
      }
      case TAG.array: {
        const length = uint32()
        requireBytes(length)
        const items: unknown[] = []
        for (let index = 0; index < length; index += 1) items.push(read(depth + 1))
        return items
      }
      case TAG.object: {
        const length = uint32()
        requireBytes(length * 5)
        const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>
        let previous: string | null = null
        for (let index = 0; index < length; index += 1) {
          const key = string()
          if (previous !== null && key <= previous)
            throw new Error('As chaves do rewind devem ser únicas e ordenadas.')
          previous = key
          record[key] = read(depth + 1)
        }
        return record
      }
      default:
        throw new Error('O estado binário contém uma tag de rewind desconhecida.')
    }
  }
  for (const part of MAGIC) {
    if (byte() !== part) throw new Error('A versão binária do rewind é incompatível.')
  }
  const value = read(0)
  if (offset !== source.byteLength)
    throw new Error('O estado binário do rewind contém dados extras.')
  return value
}
