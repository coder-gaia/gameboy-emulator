import { describe, expect, it } from 'vitest'
import { InputController } from '../../src/platform/input/controller'
import type { InputButton } from '../../src/platform/input/controller'

function setup() {
  const calls: [InputButton, boolean][] = []
  const controller = new InputController((button, pressed) => calls.push([button, pressed]))
  return { controller, calls }
}

describe('fontes simultâneas de entrada', () => {
  it('soltar o toque não solta uma direção ainda pressionada no teclado', () => {
    const { controller, calls } = setup()
    controller.press('right', 'keyboard:ArrowRight')
    controller.press('right', 'pointer:1')
    controller.release('pointer:1')
    expect(calls).toEqual([['right', true]])
    expect(controller.getSnapshot()).toBe(1)
    controller.release('keyboard:ArrowRight')
    expect(calls).toEqual([
      ['right', true],
      ['right', false],
    ])
    expect(controller.getSnapshot()).toBe(0)
  })

  it('preserva direção e ação de dois dedos independentes', () => {
    const { controller, calls } = setup()
    controller.press('right', 'pointer:1')
    controller.press('a', 'pointer:2')
    expect(controller.getSnapshot()).toBe(17)
    controller.release('pointer:1')
    expect(controller.getSnapshot()).toBe(16)
    expect(calls).toEqual([
      ['right', true],
      ['a', true],
      ['right', false],
    ])
  })

  it('repetição da tecla não exige liberações extras', () => {
    const { controller, calls } = setup()
    for (let repeat = 0; repeat < 10; repeat += 1) controller.press('a', 'keyboard:KeyZ')
    controller.release('keyboard:KeyZ')
    expect(calls).toEqual([
      ['a', true],
      ['a', false],
    ])
  })

  it('libera todas as fontes e informa o estado uma vez por alteração', () => {
    const { controller, calls } = setup()
    let notifications = 0
    const unsubscribe = controller.subscribe(() => (notifications += 1))
    controller.press('up', 'keyboard:ArrowUp')
    controller.press('a', 'pointer:2')
    controller.releaseAll()
    controller.releaseAll()
    expect(controller.getSnapshot()).toBe(0)
    expect(calls).toEqual([
      ['up', true],
      ['a', true],
      ['up', false],
      ['a', false],
    ])
    expect(notifications).toBe(3)
    unsubscribe()
    controller.press('b', 'keyboard:KeyX')
    expect(notifications).toBe(3)
  })
})
