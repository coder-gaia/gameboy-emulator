import { describe, expect, it } from 'vitest'
import { Apu } from '../../src/core/apu'
import { decode, encodeToBuffer, MAX_REWIND_STATE_BYTES } from '../../src/runtime/rewind'

function packed(value: unknown): Uint8Array {
  const target = new Uint8Array(MAX_REWIND_STATE_BYTES)
  return target.slice(0, encodeToBuffer(value, target))
}

describe('codec binário do rewind', () => {
  it('preserva números Float64, booleanos, strings UTF-16 e arrays tipados', () => {
    const value = {
      numbers: [0, -0, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Math.PI, 1e-300],
      nested: { empty: null, yes: true, no: false, text: 'Ação 🌱\ud800\udfff' },
      bytes: new Uint8Array([0, 1, 128, 255]),
      empty: [],
    }
    const restored = decode(packed(value)) as typeof value
    expect(restored).toEqual(value)
    expect(Object.is(restored.numbers[1], -0)).toBe(true)
    expect(restored.nested.text).toBe(value.nested.text)
    expect(restored.bytes).toBeInstanceOf(Uint8Array)
  })

  it('ordena chaves para produzir os mesmos bytes com ordens de inserção diferentes', () => {
    expect(packed({ z: 2, a: { y: false, b: 1 } })).toEqual(packed({ a: { b: 1, y: false }, z: 2 }))
  })

  it('preserva resampler e capacitores da APU sem arredondar floats', () => {
    const apu = new Apu(44_100)
    apu.reset(true)
    apu.writeRegister(0xff12, 0xf3)
    apu.writeRegister(0xff13, 0xc0)
    apu.writeRegister(0xff14, 0x87)
    apu.tick(12_345)
    const state = apu.snapshotState()
    const restored = decode(packed(state))
    expect(restored).toEqual(state)
    const clone = new Apu()
    clone.restoreState(restored)
    apu.discardSamples()
    apu.tick(20_000)
    clone.tick(20_000)
    expect(clone.snapshotState()).toEqual(apu.snapshotState())
    expect(clone.drainSamples()).toEqual(apu.drainSamples())
  })

  it('respeita offsets de views e devolve arrays independentes do buffer codificado', () => {
    const backing = new Uint8Array(1000).fill(77)
    const target = backing.subarray(20, 900)
    const value = { bytes: new Uint8Array([1, 2, 3]) }
    const length = encodeToBuffer(value, target)
    expect(backing.subarray(0, 20)).toEqual(new Uint8Array(20).fill(77))
    expect(backing.subarray(20 + length)).toEqual(new Uint8Array(980 - length).fill(77))
    const restored = decode(target.subarray(0, length)) as typeof value
    target.fill(0)
    expect(restored.bytes).toEqual(new Uint8Array([1, 2, 3]))
    const nodeBuffer = Buffer.from(packed(value))
    const fromBuffer = decode(nodeBuffer) as typeof value
    nodeBuffer.fill(0)
    expect(fromBuffer.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(Buffer.isBuffer(fromBuffer.bytes)).toBe(false)
  })

  it('aceita até 128 KiB e rejeita overflow mesmo com destino maior', () => {
    const largest = new Uint8Array(MAX_REWIND_STATE_BYTES - 9)
    const target = new Uint8Array(MAX_REWIND_STATE_BYTES * 2)
    expect(encodeToBuffer(largest, target)).toBe(MAX_REWIND_STATE_BYTES)
    expect(decode(target.subarray(0, MAX_REWIND_STATE_BYTES))).toEqual(largest)
    expect(() => encodeToBuffer(new Uint8Array(MAX_REWIND_STATE_BYTES), target)).toThrow('limite')
    expect(() => encodeToBuffer({ value: 1 }, new Uint8Array(4))).toThrow('limite')
    expect(() => decode(target)).toThrow('limite')
  })

  it.each([NaN, Infinity, -Infinity])('rejeita número não finito: %s', (value) => {
    expect(() => packed(value)).toThrow('finitos')
  })

  it.each([
    undefined,
    1n,
    Symbol('estado'),
    () => 1,
    new Date(0),
    new Map(),
    new Set(),
    new ArrayBuffer(1),
    new Uint16Array(2),
  ])('rejeita tipos fora do formato: %s', (value) => {
    expect(() => packed(value)).toThrow()
  })

  it('rejeita ciclos, arrays esparsos e profundidade excessiva', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => packed(circular)).toThrow('circular')
    expect(() => packed(new Array(3))).toThrow('densos')
    let deep: unknown = null
    for (let depth = 0; depth < 66; depth += 1) deep = { nested: deep }
    expect(() => packed(deep)).toThrow('profundidade')
    const shared = { value: 1 }
    expect(decode(packed({ first: shared, second: shared }))).toEqual({
      first: shared,
      second: shared,
    })
  })

  it('não executa getters e rejeita propriedades que seriam omitidas silenciosamente', () => {
    let called = false
    const getter = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        called = true
        return 3
      },
    })
    expect(() => packed(getter)).toThrow('calculadas')
    expect(called).toBe(false)
    expect(() => packed({ [Symbol('oculto')]: 1 })).toThrow('propriedades')
    expect(() => packed(Object.defineProperty({}, 'oculto', { value: 1 }))).toThrow('propriedades')
  })

  it('mantém chaves especiais em objeto sem protótipo, sem poluir Object.prototype', () => {
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    value.__proto__ = { rewindPolluted: true }
    value.constructor = 'dado' as unknown as ObjectConstructor
    const restored = decode(packed(value)) as Record<string, unknown>
    expect(Object.getPrototypeOf(restored)).toBe(null)
    expect(restored.__proto__).toEqual({ rewindPolluted: true })
    expect(restored.constructor).toBe('dado')
    expect(Object.hasOwn(Object.prototype, 'rewindPolluted')).toBe(false)
  })

  it('rejeita truncamento, versão, tags, comprimentos e dados extras inválidos', () => {
    const valid = packed({ bytes: new Uint8Array([1, 2]), count: 3 })
    for (let length = 0; length < valid.length; length += 1)
      expect(() => decode(valid.subarray(0, length))).toThrow()
    const version = valid.slice()
    version[3] = 99
    expect(() => decode(version)).toThrow('versão')
    const tag = packed(null)
    tag[4] = 255
    expect(() => decode(tag)).toThrow('tag')
    const array = packed([])
    new DataView(array.buffer).setUint32(5, 0xffffffff, true)
    expect(() => decode(array)).toThrow('truncado')
    const number = packed(1)
    new DataView(number.buffer).setFloat64(5, Infinity, true)
    expect(() => decode(number)).toThrow('finitos')
    expect(() => decode(Uint8Array.from([...valid, 0]))).toThrow('extras')
  })
})
