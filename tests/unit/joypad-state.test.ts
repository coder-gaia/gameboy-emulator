import { describe, expect, it } from 'vitest'
import { Joypad } from '../../src/core/joypad'

describe('estado completo do joypad', () => {
  it('restaura seletores e teclas sem gerar IRQ artificial, mantendo as próximas bordas', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(0)
    joypad.setButton('right', true)
    joypad.setButton('start', true)
    const state = joypad.snapshotState()
    joypad.releaseAll()
    interrupts.length = 0
    joypad.restoreState(state)
    expect(joypad.read()).toBe(0xc6)
    expect(interrupts).toEqual([])
    expect(joypad.setButton('right', true)).toBe(false)
    joypad.setButton('right', false)
    joypad.setButton('right', true)
    expect(interrupts).toEqual([0x10])
    state.pressedButtons = 0
    expect(joypad.read()).toBe(0xc6)
  })

  it('rejeita seletores não físicos e preserva o estado anterior', () => {
    const joypad = new Joypad()
    joypad.write(0x20)
    joypad.setButton('up', true)
    const before = joypad.snapshotState()
    for (const state of [
      null,
      { ...before, selection: 1 },
      { ...before, selection: 0x40 },
      { ...before, pressedButtons: 256 },
      { ...before, version: 2 },
    ]) {
      expect(() => joypad.restoreState(state)).toThrow()
      expect(joypad.snapshotState()).toEqual(before)
    }
  })
})
