import { describe, expect, it } from 'vitest'
import { analyzePresentationGaps } from '../production/probe'
import type { CanvasDrawObservation, CapturedVideoObservation } from '../production/probe'

const WINDOW = {
  epoch: 2,
  sampleRate: 48_000,
  measuredFrom: 10_000,
  measuredUntil: 12_000,
  capturePaddingMs: 700,
} as const

function capture(
  sequence: number,
  frameId: number,
  pcmFrame: number,
  receivedAt: number,
  epoch = 2,
): CapturedVideoObservation {
  return { sequence, frameId, pcmFrame, receivedAt, epoch }
}

function draw(at: number, frameId: number | null): CanvasDrawObservation {
  return { at, frameId }
}

function evaluate(
  draws: readonly CanvasDrawObservation[],
  captures: readonly CapturedVideoObservation[],
) {
  return analyzePresentationGaps(draws, captures, WINDOW)
}

function continuousCaptures(): CapturedVideoObservation[] {
  return Array.from({ length: 19 }, (_, index) =>
    capture(index, 100 + index, 48_000 + index * 804, 10_300 + index * 2),
  )
}

describe('oráculo de intervalos entre desenhos e capturas programadas', () => {
  it('aceita lacuna legítima do LCD com somente dois RAFs de tolerância', () => {
    const result = evaluate(
      [draw(10_500, 100), draw(10_600.3, 101)],
      [capture(1, 100, 48_000, 10_300), capture(2, 101, 52_263, 10_350)],
    )
    const gap = result.gaps[0]!
    expect(gap.maximumScheduledGapMs).toBeCloseTo(88.8125)
    expect(gap.allowanceMs).toBeCloseTo(88.8125 + (2 * 1000) / 60)
    expect(gap.durationMs).toBeLessThan(gap.allowanceMs)
    expect(gap.allowanceMs).toBeLessThan(123)
  })

  it('recusa congelamento de 300 ms quando havia capturas intermediárias disponíveis', () => {
    const result = evaluate([draw(10_500, 100), draw(10_800, 118)], continuousCaptures())
    const gap = result.gaps[0]!
    expect(gap.maximumScheduledGapMs).toBeCloseTo(16.75)
    expect(gap.allowanceMs).toBe(100)
    expect(gap.durationMs).toBe(300)
    expect(gap.durationMs).toBeGreaterThan(gap.allowanceMs)
  })

  it('não usa uma abertura antiga fora da janela para justificar um congelamento atual', () => {
    const frames = [
      capture(0, 100, 0, 7000),
      capture(1, 118, 64_000, 8400),
      ...continuousCaptures().map((frame) => ({ ...frame, sequence: frame.sequence + 2 })),
    ]
    const result = evaluate([draw(10_500, 100), draw(10_800, 118)], frames)
    expect(result.captures).toHaveLength(19)
    expect(result.gaps[0]!.allowanceMs).toBe(100)
  })

  it('mantém o limite original quando não há observações de capturas', () => {
    const result = evaluate([draw(10_500, 100), draw(10_800, 118)], [])
    expect(result.gaps[0]!.maximumScheduledGapMs).toBe(0)
    expect(result.gaps[0]!.allowanceMs).toBe(100)
  })

  it('não interpreta perda de observações como intervalo programado pela ROM', () => {
    const result = evaluate(
      [draw(10_500, 100), draw(10_800, 118)],
      [capture(1, 100, 0, 10_300), capture(3, 118, 64_000, 10_350)],
    )
    expect(result.scheduledGaps).toEqual([])
    expect(result.gaps[0]!.allowanceMs).toBe(100)
  })

  it('não mistura capturas de outra geração de áudio', () => {
    const result = evaluate(
      [draw(10_500, 100), draw(10_800, 118)],
      [capture(1, 100, 0, 10_300, 1), capture(2, 118, 64_000, 10_350, 1)],
    )
    expect(result.captures).toEqual([])
    expect(result.gaps[0]!.allowanceMs).toBe(100)
  })

  it('não empresta uma lacuna de capturas recebidas depois dos desenhos', () => {
    const result = evaluate(
      [draw(10_500, 100), draw(10_800, 118)],
      [capture(1, 100, 0, 11_000), capture(2, 118, 64_000, 11_050)],
    )
    expect(result.captures).toHaveLength(2)
    expect(result.gaps[0]!.allowanceMs).toBe(100)
  })

  it('não amplia a tolerância quando não identifica as imagens desenhadas', () => {
    const result = evaluate(
      [draw(10_500, null), draw(10_800, null)],
      [capture(1, 100, 0, 10_300), capture(2, 118, 64_000, 10_350)],
    )
    expect(result.gaps[0]!.allowanceMs).toBe(100)
  })
})
