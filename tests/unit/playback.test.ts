import { describe, expect, it } from 'vitest'
import { BrowserPlayback } from '../../src/runtime/playback'
import { DMG_CLOCK_HZ, DMG_FRAME_T_CYCLES } from '../../src/core/model'
import type { AnimationClock } from '../../src/runtime/playback'

function createClock() {
  let callback: ((timestamp: number) => void) | null = null
  const clock: AnimationClock = {
    request: (next) => {
      callback = next
      return 1
    },
    cancel: () => {
      callback = null
    },
  }
  return { clock, frame: (timestamp: number) => callback?.(timestamp) }
}

describe('cadência monotônica sem áudio', () => {
  it.each([30, 60, 120])('mantém a velocidade em apresentação a %i Hz', (hz) => {
    const clock = createClock()
    let cycles = 0
    const playback = new BrowserPlayback(
      {
        runCycles: (budget) => {
          cycles += budget
          return budget
        },
      },
      () => {},
      () => {},
      clock.clock,
    )
    playback.start()
    for (let index = 0; index <= hz; index += 1) clock.frame((index * 1000) / hz)
    expect(Math.abs(cycles - DMG_CLOCK_HZ)).toBeLessThanOrEqual(1)
  })

  it('pausa e retoma sem recuperar tempo acumulado da aba oculta', () => {
    const clock = createClock()
    let cycles = 0
    const playback = new BrowserPlayback(
      {
        runCycles: (budget) => {
          cycles += budget
          return budget
        },
      },
      () => {},
      () => {},
      clock.clock,
    )
    playback.start()
    clock.frame(0)
    clock.frame(16)
    const before = cycles
    playback.pause()
    clock.frame(30000)
    expect(cycles).toBe(before)
    playback.start()
    clock.frame(30001)
    expect(cycles).toBe(before)
    clock.frame(30017)
    expect(cycles - before).toBe(Math.floor(DMG_CLOCK_HZ * 0.016))
  })

  it('limita recuperação após um bloqueio da thread', () => {
    const clock = createClock()
    let budget = 0
    const playback = new BrowserPlayback(
      {
        runCycles: (value) => {
          budget = value
          return value
        },
      },
      () => {},
      () => {},
      clock.clock,
    )
    playback.start()
    clock.frame(0)
    clock.frame(5000)
    expect(budget).toBe(DMG_FRAME_T_CYCLES * 4)
  })
})
