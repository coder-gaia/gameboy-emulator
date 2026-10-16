import { describe, expect, it } from 'vitest'
import { Joypad } from '../../src/core/joypad'
import type { JoypadButton } from '../../src/core/joypad'

const BUTTON_CASES: readonly [JoypadButton, number, number][] = [
  ['right', 0x20, 0x01],
  ['left', 0x20, 0x02],
  ['up', 0x20, 0x04],
  ['down', 0x20, 0x08],
  ['a', 0x10, 0x01],
  ['b', 0x10, 0x02],
  ['select', 0x10, 0x04],
  ['start', 0x10, 0x08],
]

describe('Joypad DMG', () => {
  it('inicia sem grupos selecionados, com todas as linhas altas', () => {
    const joypad = new Joypad()
    expect(joypad.read()).toBe(0xff)
    joypad.write(0x20)
    expect(joypad.read()).toBe(0xef)
    joypad.write(0x10)
    expect(joypad.read()).toBe(0xdf)
    joypad.write(0x00)
    expect(joypad.read()).toBe(0xcf)
  })

  it.each(BUTTON_CASES)('mapeia %s em sua linha ativa em zero', (button, selection, line) => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(selection)
    expect(joypad.setButton(button, true)).toBe(true)
    expect(joypad.read()).toBe(0xc0 | selection | (0x0f ^ line))
    expect(interrupts).toEqual([0x10])
    expect(joypad.setButton(button, false)).toBe(false)
    expect(joypad.read()).toBe(0xc0 | selection | 0x0f)
    expect(interrupts).toEqual([0x10])
  })

  it.each(BUTTON_CASES)(
    'mantém %s pressionado mesmo quando o grupo ainda não está selecionado',
    (button, selection, line) => {
      const interrupts: number[] = []
      const joypad = new Joypad((mask) => interrupts.push(mask))
      expect(joypad.setButton(button, true)).toBe(true)
      expect(joypad.read()).toBe(0xff)
      expect(interrupts).toEqual([])
      joypad.write(selection)
      expect(joypad.read()).toBe(0xc0 | selection | (0x0f ^ line))
      expect(interrupts).toEqual([0x10])
    },
  )

  it('grava apenas os seletores, mantendo bits altos e linhas somente de leitura', () => {
    const joypad = new Joypad()
    joypad.setButton('a', true)
    joypad.write(0xff)
    expect(joypad.read()).toBe(0xff)
    joypad.write(0x8f)
    expect(joypad.read()).toBe(0xce)
    joypad.write(0x5f)
    expect(joypad.read()).toBe(0xde)
    joypad.write(0x6f)
    expect(joypad.read()).toBe(0xef)
  })

  it('combina grupos selecionados e permite várias teclas simultâneas', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(0)
    joypad.setButton('right', true)
    joypad.setButton('b', true)
    joypad.setButton('select', true)
    joypad.setButton('down', true)
    expect(joypad.read()).toBe(0xc0)
    expect(interrupts).toEqual([0x10, 0x10, 0x10, 0x10])

    joypad.write(0x20)
    expect(joypad.read()).toBe(0xe6)
    joypad.write(0x10)
    expect(joypad.read()).toBe(0xd9)
    expect(interrupts).toEqual([0x10, 0x10, 0x10, 0x10, 0x10])
  })

  it('gera uma IRQ por mudança com borda, mesmo se várias linhas caírem juntas', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.setButton('right', true)
    joypad.setButton('up', true)
    joypad.setButton('start', true)
    joypad.write(0)
    expect(joypad.read()).toBe(0xc2)
    expect(interrupts).toEqual([0x10])
    joypad.write(0)
    expect(interrupts).toEqual([0x10])
  })

  it('não gera outra IRQ se um segundo grupo já mantiver a mesma linha baixa', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(0)
    joypad.setButton('a', true)
    expect(joypad.setButton('right', true)).toBe(true)
    expect(joypad.read()).toBe(0xce)
    expect(interrupts).toEqual([0x10])
    joypad.setButton('a', false)
    expect(joypad.read()).toBe(0xce)
    expect(interrupts).toEqual([0x10])
    joypad.setButton('right', false)
    expect(joypad.read()).toBe(0xcf)
    expect(interrupts).toEqual([0x10])
  })

  it('pressionar o grupo não selecionado não solicita IRQ', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(0x20)
    expect(joypad.setButton('a', true)).toBe(true)
    expect(joypad.read()).toBe(0xef)
    expect(interrupts).toEqual([])
    joypad.setButton('right', true)
    expect(joypad.read()).toBe(0xee)
    expect(interrupts).toEqual([0x10])
  })

  it('não solicita IRQ por repetição, leitura, liberação ou desseleção', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(0x20)
    expect(joypad.setButton('left', false)).toBe(false)
    expect(joypad.setButton('left', true)).toBe(true)
    expect(joypad.setButton('left', true)).toBe(false)
    expect(joypad.read()).toBe(0xed)
    expect(joypad.read()).toBe(0xed)
    joypad.write(0x30)
    expect(joypad.setButton('left', false)).toBe(false)
    expect(interrupts).toEqual([0x10])
    expect(joypad.read()).toBe(0xff)
  })

  it('selecionar e desselecionar um botão mantido gera uma nova borda por seleção', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.setButton('start', true)
    joypad.write(0x10)
    joypad.write(0x10)
    joypad.write(0x30)
    joypad.write(0x10)
    expect(interrupts).toEqual([0x10, 0x10])
  })

  it('releaseAll libera todos os botões, conserva a seleção e permite novas pressões', () => {
    const interrupts: number[] = []
    const joypad = new Joypad((mask) => interrupts.push(mask))
    joypad.write(0)
    for (const [button] of BUTTON_CASES) joypad.setButton(button, true)
    expect(joypad.read()).toBe(0xc0)
    expect(interrupts).toHaveLength(4)
    joypad.releaseAll()
    expect(joypad.read()).toBe(0xcf)
    expect(interrupts).toHaveLength(4)
    joypad.releaseAll()
    expect(joypad.setButton('a', true)).toBe(true)
    expect(joypad.read()).toBe(0xce)
    expect(interrupts).toHaveLength(5)
  })

  it.each(['A', 'ArrowRight', 'enter', 'constructor', '__proto__'])(
    'rejeita o identificador %s em vez de tratá-lo como outro botão',
    (invalid) => {
      const joypad = new Joypad()
      // @ts-expect-error A API aceita apenas os oito nomes canônicos.
      expect(() => joypad.setButton(invalid, true)).toThrow('Botão de Game Boy inválido')
      expect(joypad.read()).toBe(0xff)
    },
  )
})
