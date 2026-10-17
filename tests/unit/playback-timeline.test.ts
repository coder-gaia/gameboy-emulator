import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_TIMELINE_CAPACITY,
  PlaybackTimeline,
} from '../../src/platform/audio/playback-timeline'

describe('histórico limitado do relógio PCM', () => {
  it('coalesce avanço contínuo sem apagar a origem ainda não ouvida', () => {
    const timeline = new PlaybackTimeline()
    for (let index = 0; index <= 10_000; index += 1)
      timeline.record((index * 128) / 48_000, index * 128, true)
    expect(timeline.size).toBe(1)
    expect(timeline.frameAt(0.312)).toBeCloseTo(14_976)
    expect(timeline.frameAt(20)).toBeCloseTo(960_000)
  })

  it('preserva avanço e silêncio futuros até o relógio alcançar cada trecho', () => {
    const timeline = new PlaybackTimeline()
    timeline.record(0, 0, true)
    timeline.record(1, 48_000, false)
    timeline.record(1.2, 48_000, true)
    expect(timeline.frameAt(0.688)).toBeCloseTo(33_024)
    expect(timeline.frameAt(0.9)).toBeCloseTo(43_200)
    expect(timeline.frameAt(1)).toBeCloseTo(48_000)
    expect(timeline.frameAt(1.1)).toBeCloseTo(48_000)
    expect(timeline.frameAt(1.22)).toBeCloseTo(48_960)
    expect(timeline.size).toBe(1)
  })

  it('não distribui as últimas amostras pelo silêncio de um quantum incompleto', () => {
    const timeline = new PlaybackTimeline()
    timeline.record(0, 0, true)
    timeline.record(128 / 48_000, 3, false)
    expect(timeline.frameAt(1 / 48_000)).toBeCloseTo(1)
    expect(timeline.frameAt(3 / 48_000)).toBeCloseTo(3)
    expect(timeline.frameAt(127 / 48_000)).toBeCloseTo(3)
  })

  it('reposição sem silêncio conserva a reta do PCM', () => {
    const timeline = new PlaybackTimeline()
    timeline.record(0, 0, true)
    timeline.record(1, 48_000, false)
    timeline.record(1, 48_000, true)
    expect(timeline.frameAt(0.688)).toBeCloseTo(33_024)
    expect(timeline.frameAt(1.01)).toBeCloseTo(48_480)
  })

  it('reset descarta todos os trechos e aplica a nova taxa do dispositivo', () => {
    const timeline = new PlaybackTimeline()
    timeline.record(0, 0, true)
    timeline.record(1, 48_000, false)
    timeline.reset(44_100)
    expect(timeline.size).toBe(0)
    expect(timeline.frameAt(100)).toBe(0)
    timeline.record(2, 0, true)
    expect(timeline.frameAt(2.1)).toBeCloseTo(4410)
  })

  it('retém somente os trechos futuros durante muitos ciclos de reserva', () => {
    const timeline = new PlaybackTimeline()
    const rate = 48_000
    const delay = 0.312
    let previous = 0
    for (let cycle = 0; cycle < 10_000; cycle += 1) {
      const start = cycle * 0.256
      const frame = cycle * 6144
      timeline.record(start, frame, true)
      timeline.record(start + 0.128, frame + 6144, false)
      const position = timeline.frameAt(start + 0.128 - delay)
      expect(position).toBeGreaterThanOrEqual(previous)
      expect(timeline.size).toBeLessThanOrEqual(8)
      previous = position
    }
    expect(timeline.frameAt(2560)).toBeCloseTo(10_000 * 0.128 * rate)
  })

  it('possui arena fixa mesmo sem consultas durante uma aba congestionada', () => {
    const timeline = new PlaybackTimeline()
    for (let index = 0; index < 10_000; index += 1)
      timeline.record(index / 100, index * 240, index % 2 === 0)
    expect(timeline.size).toBeLessThanOrEqual(PLAYBACK_TIMELINE_CAPACITY)
    expect(timeline.frameAt(100)).toBeGreaterThanOrEqual(0)
  })
})
