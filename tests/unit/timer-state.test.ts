import { describe, expect, it } from 'vitest'
import { Timer, type TimerState } from '../../src/core/timer'

function overflowTimer(): Timer {
  const timer = new Timer()
  timer.write8(0xff05, 0xff)
  timer.write8(0xff06, 0x42)
  timer.write8(0xff07, 5)
  timer.tick(16)
  return timer
}

describe('Snapshot completo do timer', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    'retoma reload, janela de escrita e IRQ no T-cycle %i após overflow',
    (elapsed) => {
      const original = overflowTimer()
      original.tick(elapsed)
      const restored = new Timer()
      restored.restoreState(original.snapshotState())
      expect(restored.snapshotState()).toEqual(original.snapshotState())
      // As escritas têm efeitos diferentes durante o atraso e durante a carga de TMA.
      for (const timer of [original, restored]) {
        timer.write8(0xff06, 0x69)
        timer.write8(0xff05, 0x73)
      }
      for (const tCycles of [1, 2, 1, 15, 8, 4096]) {
        expect(restored.tick(tCycles)).toBe(original.tick(tCycles))
        expect(restored.snapshotState()).toEqual(original.snapshotState())
      }
    },
  )

  it('preserva a IRQ ainda pendente sem dispará-la ao restaurar', () => {
    const original = overflowTimer()
    original.tick(3)
    const restored = new Timer()
    restored.restoreState(original.snapshotState())
    expect(restored.tick(0)).toBe(false)
    expect(restored.tick(1)).toBe(true)
    expect(restored.read8(0xff05)).toBe(0x42)
    expect(restored.tick(3)).toBe(false)
  })

  it('preserva a fase do divisor para o pulso causado por DIV ou TAC', () => {
    const original = new Timer()
    original.write8(0xff07, 5)
    original.tick(11)
    const restored = new Timer()
    restored.restoreState(original.snapshotState())
    for (const timer of [original, restored]) timer.write8(0xff04, 0)
    expect(restored.read8(0xff05)).toBe(1)
    expect(restored.snapshotState()).toEqual(original.snapshotState())
    original.tick(8)
    restored.tick(8)
    for (const timer of [original, restored]) timer.write8(0xff07, 1)
    expect(restored.read8(0xff05)).toBe(2)
    expect(restored.snapshotState()).toEqual(original.snapshotState())
  })

  const invalidFields: [keyof TimerState, unknown][] = [
    ['version', 2],
    ['divider', 0x10000],
    ['counter', -1],
    ['modulo', 256],
    ['control', 8],
    ['reloadDelay', 5],
    ['reloadWindow', 0.5],
  ]

  it.each(invalidFields)('rejeita %s inválido sem alterar nenhum contador', (field, value) => {
    const timer = overflowTimer()
    const before = timer.snapshotState()
    expect(() => timer.restoreState({ ...before, divider: 2345, [field]: value })).toThrow()
    expect(timer.snapshotState()).toEqual(before)
  })

  it('rejeita campos ausentes e relações impossíveis entre TIMA e reload de forma atômica', () => {
    const timer = overflowTimer()
    const before = timer.snapshotState()
    for (const state of [
      null,
      {},
      { ...before, counter: 1 },
      { ...before, reloadWindow: 1 },
      { ...before, reloadDelay: 0, reloadWindow: 4, counter: 0x41 },
    ]) {
      expect(() => timer.restoreState(state)).toThrow()
      expect(timer.snapshotState()).toEqual(before)
    }
  })
})
