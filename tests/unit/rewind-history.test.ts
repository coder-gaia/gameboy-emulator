import { describe, expect, it } from 'vitest'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import type { GameBoyState } from '../../src/core/gameboy'
import type { MachineCheckpoint } from '../../src/runtime/worker-protocol'
import {
  encodeToBuffer,
  MAX_REWIND_STATE_BYTES,
  REWIND_CAPTURE_HZ,
  REWIND_MAX_BYTES,
  REWIND_MAX_SECONDS,
  RewindHistory,
} from '../../src/runtime/rewind'

const WORKSPACE_BYTES = MAX_REWIND_STATE_BYTES * 3
const time = (index: number) => Math.floor((index * DMG_CLOCK_HZ) / REWIND_CAPTURE_HZ)

// O histórico trata o payload como dados. A validação da máquina pertence à M08.
function checkpoint(value: number, bytes = new Uint8Array(16), serial = ''): MachineCheckpoint {
  return { version: 1, core: { value, bytes } as unknown as GameBoyState, serial }
}

function expectSamePayload(actual: MachineCheckpoint | null, expected: MachineCheckpoint): void {
  expect(actual).not.toBeNull()
  expect(actual!.version).toBe(expected.version)
  expect(actual!.serial).toBe(expected.serial)
  const restored = actual!.core as unknown as { value: number; bytes: Uint8Array }
  const original = expected.core as unknown as typeof restored
  expect(Object.keys(restored).sort()).toEqual(['bytes', 'value'])
  expect(restored.value).toBe(original.value)
  expect(restored.bytes).toBeInstanceOf(Uint8Array)
  // Compara todos os bytes em código nativo, sem o custo de inspeção do matcher por elemento.
  expect(Buffer.from(restored.bytes).equals(Buffer.from(original.bytes))).toBe(true)
}

describe('histórico limitado de rewind', () => {
  it('aloca somente a arena contratada e não inventa histórico antes da segunda captura', () => {
    const history = new RewindHistory()
    expect(history.stats).toEqual({
      entries: 0,
      availableSeconds: 0,
      allocatedBytes: REWIND_MAX_BYTES,
      usedBytes: WORKSPACE_BYTES,
      maxSeconds: REWIND_MAX_SECONDS,
      maxBytes: REWIND_MAX_BYTES,
    })
    expect(history.stepBack()).toBeNull()
    history.record(checkpoint(0), 0)
    expect(history.stats.entries).toBe(1)
    expect(history.stepBack()).toBeNull()
    history.record(checkpoint(1), time(1))
    expect(history.stepBack()).toEqual(checkpoint(0))
    expect(history.stats.entries).toBe(1)
  })

  it('comprime alterações esparsas e mantém cópias independentes do chamador', () => {
    const history = new RewindHistory()
    const bytes = new Uint8Array(80_000)
    const first = checkpoint(0, bytes)
    history.record(first, 0)
    bytes[10] = 42
    history.record(checkpoint(1, bytes), time(1))
    bytes.fill(255)
    expect(history.stats.usedBytes - WORKSPACE_BYTES).toBeLessThan(200)
    expect(history.stepBack()).toEqual(checkpoint(0, new Uint8Array(80_000)))
  })

  it('usa XOR denso no pior caso alternado e preserva os estados em ambas as direções', () => {
    const history = new RewindHistory()
    const first = checkpoint(0, new Uint8Array(80_000))
    const second = checkpoint(
      1,
      Uint8Array.from({ length: 80_000 }, (_, index) => index % 2),
    )
    const size = encodeToBuffer(second, new Uint8Array(MAX_REWIND_STATE_BYTES))
    history.record(first, 0)
    history.record(second, time(1))
    expect(history.stats.usedBytes - WORKSPACE_BYTES).toBe(size)
    expect(history.stepBack()).toEqual(first)
    history.record(second, time(1))
    history.record(checkpoint(2, new Uint8Array(80_000).fill(129)), time(2))
    expect(history.stepBack()).toEqual(second)
  })

  it('preserva crescimento e redução de buffers e strings através de XOR reversível', () => {
    const history = new RewindHistory()
    const values = [
      checkpoint(0, new Uint8Array(), ''),
      checkpoint(1, new Uint8Array(700).fill(1), 'texto 🌱'),
      checkpoint(2, new Uint8Array(3).fill(2), 'x'),
      checkpoint(3, new Uint8Array(5000).fill(3), 'A'.repeat(4096)),
      checkpoint(4, new Uint8Array(1), ''),
    ]
    values.forEach((value, index) => history.record(value, time(index)))
    for (let index = values.length - 2; index >= 0; index -= 1)
      expect(history.stepBack()).toEqual(values[index])
    expect(history.stepBack()).toBeNull()
  })

  it('promove a âncora após wrap e evicção sem ultrapassar o orçamento', () => {
    const history = new RewindHistory({ maxBytes: 512 * 1024 })
    const values: MachineCheckpoint[] = []
    for (let index = 0; index < 60; index += 1) {
      const value = checkpoint(index, new Uint8Array(50_000).fill(index % 2 ? 255 : 0))
      values.push(value)
      history.record(value, time(index))
      expect(history.stats.usedBytes).toBeLessThanOrEqual(history.stats.maxBytes)
      expect(history.stats.allocatedBytes).toBe(512 * 1024)
    }
    expect(history.stats.entries).toBe(3)
    expect(history.stepBack()).toEqual(values[58])
    expect(history.stepBack()).toEqual(values[57])
    expect(history.stepBack()).toBeNull()
    expect(history.stats.usedBytes).toBe(WORKSPACE_BYTES)
  })

  it('mantém no máximo 20 segundos reais e 201 pontos, com tempo fracionário em T-cycles', () => {
    const history = new RewindHistory()
    for (let index = 0; index <= 260; index += 1) {
      history.record(checkpoint(index), time(index))
      expect(history.stats.entries).toBeLessThanOrEqual(201)
      expect(history.stats.availableSeconds).toBeLessThanOrEqual(20)
    }
    expect(history.stats.entries).toBe(201)
    expect(history.stats.availableSeconds).toBe(20)
    for (let index = 259; index >= 60; index -= 1)
      expect(history.stepBack()).toEqual(checkpoint(index))
    expect(history.stepBack()).toBeNull()
    const denseTimes = new RewindHistory()
    for (let index = 0; index < 300; index += 1) denseTimes.record(checkpoint(index), index * 4)
    expect(denseTimes.stats.entries).toBe(201)
  })

  it('limita tempo real mesmo com poucas capturas e com uma longa interrupção entre pontos', () => {
    const history = new RewindHistory({ maxSeconds: 1 })
    history.record(checkpoint(0), 0)
    history.record(checkpoint(1), DMG_CLOCK_HZ)
    expect(history.stats.availableSeconds).toBe(1)
    history.record(checkpoint(2), DMG_CLOCK_HZ + 4)
    expect(history.stats.entries).toBe(2)
    expect(history.stats.availableSeconds).toBe(4 / DMG_CLOCK_HZ)
    expect(history.stepBack()).toEqual(checkpoint(1))
    history.record(checkpoint(9), DMG_CLOCK_HZ * 30)
    expect(history.stats.entries).toBe(1)
    expect(history.stats.availableSeconds).toBe(0)
    expect(history.stepBack()).toBeNull()
  })

  it('combina deltas esparsos e densos com wrap, comprimentos variáveis e ramos novos', () => {
    const history = new RewindHistory({ maxBytes: 512 * 1024 })
    const expected: MachineCheckpoint[] = []
    let seed = 12345
    for (let index = 0; index < 140; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const length = 100 + (seed % 110_000)
      const value = checkpoint(
        index,
        Uint8Array.from({ length }, (_, position) => (position + (index % 3)) & 255),
        'x'.repeat(index % 20),
      )
      history.record(value, time(index))
      expected.push(value)
      while (expected.length > history.stats.entries) expected.shift()
      expect(history.stats.usedBytes).toBeLessThanOrEqual(512 * 1024)
      if (index % 7 === 0 && expected.length > 1) {
        expected.pop()
        expectSamePayload(history.stepBack(), expected.at(-1)!)
      }
    }
    while (expected.length > 1) {
      expected.pop()
      expectSamePayload(history.stepBack(), expected.at(-1)!)
    }
    expect(history.stepBack()).toBeNull()
  })

  it('elimina o futuro ao voltar e registra somente o ramo novo', () => {
    const history = new RewindHistory()
    for (let index = 0; index < 5; index += 1) history.record(checkpoint(index), time(index))
    expect(history.stepBack()).toEqual(checkpoint(3))
    expect(history.stepBack()).toEqual(checkpoint(2))
    history.record(checkpoint(30), time(3))
    history.record(checkpoint(40), time(4))
    expect(history.stepBack()).toEqual(checkpoint(30))
    expect(history.stepBack()).toEqual(checkpoint(2))
    expect(history.stepBack()).toEqual(checkpoint(1))
    expect(history.stepBack()).toEqual(checkpoint(0))
    expect(history.stepBack()).toBeNull()
  })

  it('substitui mudanças no mesmo T-cycle sem criar pontos de duração zero', () => {
    const history = new RewindHistory()
    history.record(checkpoint(0), 0)
    history.record(checkpoint(5), 0)
    history.record(checkpoint(1), time(1))
    history.record(checkpoint(9), time(1))
    history.record(checkpoint(2), time(2))
    expect(history.stats.entries).toBe(3)
    expect(history.stepBack()).toEqual(checkpoint(9))
    expect(history.stepBack()).toEqual(checkpoint(5))
  })

  it('uma captura inválida não perde histórico, incluindo substituição do instante atual', () => {
    const history = new RewindHistory()
    history.record(checkpoint(0), 0)
    history.record(checkpoint(1), time(1))
    const before = history.stats
    expect(() =>
      history.record(checkpoint(9, new Uint8Array(MAX_REWIND_STATE_BYTES)), time(1)),
    ).toThrow()
    expect(history.stats).toEqual(before)
    expect(() => history.record(checkpoint(2), time(1) - 1)).toThrow('tempo')
    expect(() => history.record(checkpoint(2), NaN)).toThrow('timestamp')
    expect(history.stepBack()).toEqual(checkpoint(0))
  })

  it('clear remove dados e permite iniciar outro tempo, sem reter payload devolvido', () => {
    const history = new RewindHistory()
    history.record(checkpoint(0), 100)
    history.record(checkpoint(1), 200)
    const returned = history.stepBack()!
    const bytes = (returned.core as unknown as { bytes: Uint8Array }).bytes
    bytes.fill(255)
    history.record(checkpoint(2), 300)
    expect(history.stepBack()).toEqual(checkpoint(0))
    history.clear()
    expect(history.stats.entries).toBe(0)
    expect(history.stats.availableSeconds).toBe(0)
    expect(history.stats.usedBytes).toBe(WORKSPACE_BYTES)
    history.record(checkpoint(7), 0)
    history.record(checkpoint(8), 4)
    expect(history.stepBack()).toEqual(checkpoint(7))
  })

  it('não promete 20 segundos quando mudanças densas consomem o orçamento antes', () => {
    const history = new RewindHistory()
    for (let index = 0; index < 180; index += 1) {
      history.record(
        checkpoint(index, new Uint8Array(120_000).fill(index % 2 ? 255 : 0)),
        time(index),
      )
      expect(history.stats.usedBytes).toBeLessThanOrEqual(REWIND_MAX_BYTES)
    }
    expect(history.stats.entries).toBeLessThan(100)
    expect(history.stats.availableSeconds).toBeLessThan(10)
    expect(history.stepBack()).toEqual(checkpoint(178, new Uint8Array(120_000)))
  })

  it('rejeita orçamentos fora do contrato', () => {
    for (const maxBytes of [0, 512 * 1024 - 1, REWIND_MAX_BYTES + 1, Infinity])
      expect(() => new RewindHistory({ maxBytes })).toThrow('orçamento')
    for (const maxSeconds of [0, -1, 21, NaN])
      expect(() => new RewindHistory({ maxSeconds })).toThrow('duração')
  })
})
