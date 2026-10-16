import { describe, expect, it } from 'vitest'
import {
  stateBoolean,
  stateBytes,
  stateInteger,
  stateNumber,
  stateRecord,
} from '../../src/core/state/validation'

describe('Validadores de snapshots', () => {
  it('aceita apenas objetos simples, incluindo os sem protótipo', () => {
    const record = { value: 1 }
    const bare: Record<string, unknown> = Object.create(null)
    expect(stateRecord(record, 'registro')).toBe(record)
    expect(stateRecord(bare, 'registro')).toBe(bare)
    for (const value of [null, undefined, 1, 'objeto', [], new Uint8Array(2), new Date()]) {
      expect(() => stateRecord(value, 'registro')).toThrow('registro')
    }
  })

  it('preserva os extremos inteiros e rejeita frações, valores inseguros e conversões', () => {
    expect(stateInteger(0, 0, 255, 'byte')).toBe(0)
    expect(stateInteger(255, 0, 255, 'byte')).toBe(255)
    expect(stateInteger(Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, 'contador')).toBe(
      Number.MAX_SAFE_INTEGER,
    )
    for (const value of [-1, 256, 0.5, NaN, Infinity, '1', true, undefined]) {
      expect(() => stateInteger(value, 0, 255, 'byte')).toThrow('byte')
    }
    expect(() => stateInteger(Number.MAX_SAFE_INTEGER + 1, 0, Infinity, 'contador')).toThrow()
  })

  it('exige booleanos e números finitos no intervalo solicitado', () => {
    expect(stateBoolean(true, 'flag')).toBe(true)
    expect(stateBoolean(false, 'flag')).toBe(false)
    for (const value of [0, 1, null, 'true', undefined]) {
      expect(() => stateBoolean(value, 'flag')).toThrow('flag')
    }
    expect(stateNumber(-1, -1, 1, 'amostra')).toBe(-1)
    expect(stateNumber(0.5, -1, 1, 'amostra')).toBe(0.5)
    expect(stateNumber(1, -1, 1, 'amostra')).toBe(1)
    for (const value of [-1.1, 1.1, NaN, Infinity, -Infinity, '0', null]) {
      expect(() => stateNumber(value, -1, 1, 'amostra')).toThrow('amostra')
    }
  })

  it('copia exatamente o trecho Uint8Array informado e rejeita outros formatos', () => {
    const storage = Uint8Array.of(91, 1, 2, 3, 92)
    const source = storage.subarray(1, 4)
    const copy = stateBytes(source, 3, 'memória')
    expect(copy).toEqual(Uint8Array.of(1, 2, 3))
    expect(copy.buffer).not.toBe(storage.buffer)
    source[0] = 90
    expect(copy[0]).toBe(1)
    copy[1] = 80
    expect(source[1]).toBe(2)
    for (const value of [new Uint8Array(2), [1, 2, 3], new Uint16Array(3), storage.buffer, null]) {
      expect(() => stateBytes(value, 3, 'memória')).toThrow('memória')
    }
  })
})
