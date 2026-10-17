import { describe, expect, it } from 'vitest'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import type { AudioDiagnostics } from '../../src/platform/audio/audio-output'
import { measurePerformance } from '../../src/runtime/performance-sampler'
import type { PerformancePoint } from '../../src/runtime/performance-sampler'

function audio(overrides: Partial<AudioDiagnostics> = {}): AudioDiagnostics {
  return {
    epoch: 1,
    active: true,
    primed: true,
    pendingFrames: 1024,
    targetFrames: 3072,
    roundTripFrames: 1536,
    peakRoundTripFrames: 2048,
    renderQuantumFrames: 128,
    queuedFrames: 2048,
    renderedFrames: 48_000,
    underrunFrames: 128,
    underruns: 1,
    droppedFrames: 16,
    peakLevel: 0.2,
    energy: 12,
    sampleRate: 48_000,
    baseLatencySeconds: null,
    outputLatencySeconds: null,
    contextState: 'running',
    connected: true,
    volume: 0.7,
    muted: false,
    error: null,
    ...overrides,
  }
}

function point(overrides: Partial<PerformancePoint> = {}): PerformancePoint {
  return {
    at: 1000,
    tCycles: DMG_CLOCK_HZ,
    frameId: 60,
    drawnFrames: 30,
    machineEpoch: 1,
    playing: true,
    rewinding: false,
    audio: null,
    ...overrides,
  }
}

function after(overrides: Partial<PerformancePoint> = {}): PerformancePoint {
  return point({
    at: 61_000,
    tCycles: DMG_CLOCK_HZ * 61,
    frameId: 3660,
    drawnFrames: 1830,
    ...overrides,
  })
}

function expectInterrupted(before: PerformancePoint, current: PerformancePoint): void {
  const result = measurePerformance(before, current)
  expect(result.interrupted).toBe(true)
  expect(result.speedPercent).toBeNull()
  expect(result.drawnFramesPerSecond).toBeNull()
}

describe('amostragem de desempenho por contadores locais', () => {
  it('mede 60 segundos de clock DMG e conta Canvas separado de quadros emulados', () => {
    expect(measurePerformance(point(), after())).toEqual({
      elapsedSeconds: 60,
      speedPercent: 100,
      drawnFramesPerSecond: 30,
      underrunFrames: null,
      droppedFrames: null,
      interrupted: false,
    })
  })

  it('admite velocidade parcial sem confundir crescimento de frameId com FPS de Canvas', () => {
    const result = measurePerformance(
      point(),
      after({
        tCycles: DMG_CLOCK_HZ * 31,
        frameId: 1860,
        drawnFrames: 930,
      }),
    )
    expect(result.speedPercent).toBe(50)
    expect(result.drawnFramesPerSecond).toBe(15)
    expect(result.interrupted).toBe(false)
  })

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])('interrompe intervalo com pausa entre playing=%s e playing=%s', (first, last) => {
    expectInterrupted(point({ playing: first }), after({ playing: last }))
  })

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])('interrompe intervalo com rewind entre %s e %s', (first, last) => {
    expectInterrupted(point({ rewinding: first }), after({ rewinding: last }))
  })

  it.each([{ tCycles: 0 }, { frameId: 1 }, { drawnFrames: 0 }])(
    'descarta regressão de contador ao carregar estado ou reiniciar: %j',
    (regression) => {
      expectInterrupted(point(), after(regression))
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1000, 999])(
    'não produz velocidade a partir de relógio final inválido %s',
    (at) => expectInterrupted(point(), after({ at })),
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'não produz velocidade a partir de relógio inicial inválido %s',
    (at) => expectInterrupted(point({ at }), after()),
  )

  it.each(['tCycles', 'frameId', 'drawnFrames', 'machineEpoch'] as const)(
    'não publica NaN ou infinito quando %s contém valor inválido',
    (counter) => {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER + 1]) {
        expectInterrupted(point(), after({ [counter]: value }))
        expectInterrupted(point({ [counter]: value }), after())
      }
    },
  )

  it('trocar a geração do áudio interrompe CPU e Canvas e não subtrai contadores de épocas diferentes', () => {
    const result = measurePerformance(
      point({ audio: audio() }),
      after({ audio: audio({ epoch: 2 }) }),
    )
    expect(result).toMatchObject({
      interrupted: true,
      speedPercent: null,
      drawnFramesPerSecond: null,
      underrunFrames: null,
      droppedFrames: null,
    })
  })

  it('carregar estado futuro interrompe a janela pela geração da máquina mesmo sem áudio', () => {
    expectInterrupted(point(), after({ machineEpoch: 2, tCycles: DMG_CLOCK_HZ * 600 }))
  })

  it('reset de PCM na mesma época não mistura o contador antigo com os novos', () => {
    const result = measurePerformance(
      point({ audio: audio() }),
      after({
        audio: audio({ renderedFrames: 10, underrunFrames: 256, droppedFrames: 32 }),
      }),
    )
    expect(result).toMatchObject({
      interrupted: true,
      speedPercent: null,
      drawnFramesPerSecond: null,
      underrunFrames: null,
      droppedFrames: null,
    })
  })

  it('desconectar áudio invalida a transição e não calcula delta ausente de saída desligada', () => {
    const result = measurePerformance(
      point({ audio: audio() }),
      after({ audio: audio({ connected: false }) }),
    )
    expect(result).toMatchObject({ interrupted: true, underrunFrames: null, droppedFrames: null })
    expect(
      measurePerformance(
        point({ audio: audio({ connected: false }) }),
        after({ audio: audio({ connected: false, underrunFrames: 999, droppedFrames: 999 }) }),
      ),
    ).toMatchObject({ interrupted: false, underrunFrames: null, droppedFrames: null })
  })

  it('informa deltas reais com latências indisponíveis e áudio silenciado', () => {
    const result = measurePerformance(
      point({ audio: audio() }),
      after({
        audio: audio({ muted: true, underrunFrames: 384, droppedFrames: 48 }),
      }),
    )
    expect(result).toEqual({
      elapsedSeconds: 60,
      speedPercent: 100,
      drawnFramesPerSecond: 30,
      underrunFrames: 256,
      droppedFrames: 32,
      interrupted: false,
    })
  })

  it.each([
    { underrunFrames: 0 },
    { droppedFrames: 0 },
    { underrunFrames: Number.NaN },
    { droppedFrames: Number.POSITIVE_INFINITY },
    { underrunFrames: -1 },
    { droppedFrames: Number.MAX_SAFE_INTEGER + 1 },
  ])('não confunde reset ou dado inválido com deltas de áudio válidos: %j', (invalid) => {
    const result = measurePerformance(point({ audio: audio() }), after({ audio: audio(invalid) }))
    expect(result.underrunFrames).toBeNull()
    expect(result.droppedFrames).toBeNull()
  })
})
