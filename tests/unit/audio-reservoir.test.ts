import { describe, expect, it } from 'vitest'
import { AUDIO_MAX_FRAMES } from '../../src/platform/audio/protocol'
import { AudioReservoir } from '../../src/runtime/audio-reservoir'

function pcm(...frames: number[]): Float32Array {
  return Float32Array.from(frames.flatMap((frame) => [frame, -frame]))
}

function expectBalance(reservoir: AudioReservoir): void {
  expect(reservoir.producedFrames).toBe(
    reservoir.sentFrames + reservoir.droppedFrames + reservoir.queuedFrames,
  )
  expect(reservoir.queuedFrames).toBeLessThanOrEqual(reservoir.capacityFrames)
}

describe('reservatório PCM entre o clock da máquina e o Worklet', () => {
  it('usa a capacidade fixa de transporte por padrão e começa vazio', () => {
    const reservoir = new AudioReservoir()
    expect(reservoir.capacityFrames).toBe(AUDIO_MAX_FRAMES)
    expect(reservoir.queuedFrames).toBe(0)
    expect(reservoir.take(128)).toEqual(new Float32Array())
    expectBalance(reservoir)
  })

  it('entrega somente as amostras disponíveis e conserva o restante para a próxima demanda', () => {
    const reservoir = new AudioReservoir(8)
    reservoir.push(pcm(1, 2, 3, 4))
    expect(reservoir.take(3)).toEqual(pcm(1, 2, 3))
    expect(reservoir.queuedFrames).toBe(1)
    expect(reservoir.take(8)).toEqual(pcm(4))
    expect(reservoir.take(8)).toHaveLength(0)
    expect(reservoir.sentFrames).toBe(4)
    expect(reservoir.droppedFrames).toBe(0)
    expectBalance(reservoir)
  })

  it('preserva a ordem estéreo ao escrever e ler através do fim da arena', () => {
    const reservoir = new AudioReservoir(5)
    reservoir.push(pcm(1, 2, 3, 4))
    expect(reservoir.take(3)).toEqual(pcm(1, 2, 3))
    reservoir.push(pcm(5, 6, 7, 8))
    expect(reservoir.take(2)).toEqual(pcm(4, 5))
    reservoir.push(pcm(9, 10))
    expect(reservoir.take(5)).toEqual(pcm(6, 7, 8, 9, 10))
    expect(reservoir.droppedFrames).toBe(0)
    expectBalance(reservoir)
  })

  it('descarta somente os frames mais antigos em overflow, inclusive após wrap', () => {
    const reservoir = new AudioReservoir(5)
    reservoir.push(pcm(1, 2, 3, 4))
    expect(reservoir.take(3)).toEqual(pcm(1, 2, 3))
    reservoir.push(pcm(5, 6, 7, 8))
    reservoir.push(pcm(9, 10))
    expect(reservoir.queuedFrames).toBe(5)
    expect(reservoir.droppedFrames).toBe(2)
    expect(reservoir.take(5)).toEqual(pcm(6, 7, 8, 9, 10))
    expectBalance(reservoir)
  })

  it('retém o fim de um bloco maior que a capacidade e contabiliza toda a perda', () => {
    const reservoir = new AudioReservoir(4)
    reservoir.push(pcm(1, 2, 3))
    reservoir.push(pcm(4, 5, 6, 7, 8, 9))
    expect(reservoir.queuedFrames).toBe(4)
    expect(reservoir.droppedFrames).toBe(5)
    expect(reservoir.producedFrames).toBe(9)
    expect(reservoir.take(4)).toEqual(pcm(6, 7, 8, 9))
    expectBalance(reservoir)
  })

  it('substitui a fila por um bloco do tamanho exato da capacidade sem perder o bloco novo', () => {
    const reservoir = new AudioReservoir(4)
    reservoir.push(pcm(1, 2))
    reservoir.push(pcm(3, 4, 5, 6))
    expect(reservoir.droppedFrames).toBe(2)
    expect(reservoir.take(4)).toEqual(pcm(3, 4, 5, 6))
    expectBalance(reservoir)
  })

  it('conserva valores Float32 originais, sem sanitizar, normalizar ou misturar canais', () => {
    const reservoir = new AudioReservoir(4)
    const samples = new Float32Array([0.123, -0, Number.NaN, Number.POSITIVE_INFINITY, -7, 9])
    reservoir.push(samples)
    const output = reservoir.take(4)
    expect(output).toEqual(samples)
    expect(Object.is(output[1], -0)).toBe(true)
    expectBalance(reservoir)
  })

  it('copia a produção para a arena e entrega pacotes transferíveis independentes', () => {
    const reservoir = new AudioReservoir(4)
    const source = pcm(1, 2, 3)
    reservoir.push(source)
    source.fill(99)
    const first = reservoir.take(2)
    expect(first).toEqual(pcm(1, 2))
    structuredClone(first, { transfer: [first.buffer] })
    expect(first.byteLength).toBe(0)
    expect(reservoir.take(4)).toEqual(pcm(3))
    const empty = reservoir.take(1)
    structuredClone(empty, { transfer: [empty.buffer] })
    const nextEmpty = reservoir.take(1)
    expect(() => structuredClone(nextEmpty, { transfer: [nextEmpty.buffer] })).not.toThrow()
    expectBalance(reservoir)
  })

  it.each(['clear', 'reset'] as const)(
    '%s descarta dados e contadores da geração anterior',
    (method) => {
      const reservoir = new AudioReservoir(4)
      reservoir.push(pcm(1, 2, 3, 4, 5))
      reservoir.take(2)
      reservoir[method]()
      expect(reservoir.queuedFrames).toBe(0)
      expect(reservoir.producedFrames).toBe(0)
      expect(reservoir.sentFrames).toBe(0)
      expect(reservoir.droppedFrames).toBe(0)
      reservoir.push(pcm(6, 7))
      expect(reservoir.take(4)).toEqual(pcm(6, 7))
      expectBalance(reservoir)
    },
  )

  it('aceita bloco vazio sem alterar a fila ou os contadores', () => {
    const reservoir = new AudioReservoir(4)
    reservoir.push(pcm(1))
    reservoir.push(new Float32Array())
    expect(reservoir.producedFrames).toBe(1)
    expect(reservoir.take(4)).toEqual(pcm(1))
    expectBalance(reservoir)
  })

  it('recusa amostras ímpares ou de outro tipo sem alterar o conteúdo válido', () => {
    const reservoir = new AudioReservoir(4)
    reservoir.push(pcm(1, 2))
    expect(() => reservoir.push(new Float32Array(3))).toThrow(RangeError)
    expect(() => reservoir.push(new Int16Array(4) as unknown as Float32Array)).toThrow(TypeError)
    expect(reservoir.producedFrames).toBe(2)
    expect(reservoir.take(4)).toEqual(pcm(1, 2))
    expectBalance(reservoir)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, AUDIO_MAX_FRAMES + 1])(
    'recusa capacidade inválida %s',
    (capacity) => {
      expect(() => new AudioReservoir(capacity)).toThrow(RangeError)
    },
  )

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, AUDIO_MAX_FRAMES + 1])(
    'recusa demanda inválida %s sem remover frames',
    (request) => {
      const reservoir = new AudioReservoir(4)
      reservoir.push(pcm(1, 2))
      expect(() => reservoir.take(request)).toThrow(RangeError)
      expect(reservoir.take(4)).toEqual(pcm(1, 2))
      expectBalance(reservoir)
    },
  )
})
