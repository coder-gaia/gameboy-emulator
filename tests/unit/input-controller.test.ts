import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYBOARD_BINDINGS,
  InputController,
  validateKeyboardBindings,
} from '../../src/platform/input/controller'
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

  it('libera apenas o prefixo solicitado, sem soltar outras fontes do mesmo botão', () => {
    const { controller, calls } = setup()
    controller.press('a', 'keyboard:KeyZ')
    controller.press('a', 'gamepad:0:button:0')
    controller.press('right', 'pointer:1')
    controller.releaseSources('gamepad:')
    expect(controller.getSnapshot()).toBe(17)
    expect(calls).toEqual([
      ['a', true],
      ['right', true],
    ])
    controller.releaseSources('keyboard:')
    expect(controller.getSnapshot()).toBe(1)
    expect(calls.at(-1)).toEqual(['a', false])
  })
})

function keyboardWindow() {
  const document = Object.assign(new EventTarget(), { hidden: false })
  const target = Object.assign(new EventTarget(), { document })
  return { target: target as unknown as Window, document }
}

function keyEvent(
  type: 'keydown' | 'keyup',
  code: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return Object.assign(new Event(type, { cancelable: true }), {
    code,
    key: code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...options,
  }) as KeyboardEvent
}

describe('validação de teclas físicas', () => {
  it('copia o mapa e cada lista, preservando o padrão e as duas teclas Shift', () => {
    const bindings = validateKeyboardBindings(DEFAULT_KEYBOARD_BINDINGS)
    expect(bindings).toEqual(DEFAULT_KEYBOARD_BINDINGS)
    expect(bindings).not.toBe(DEFAULT_KEYBOARD_BINDINGS)
    expect(bindings.select).not.toBe(DEFAULT_KEYBOARD_BINDINGS.select)
    bindings.a[0] = 'KeyQ'
    expect(DEFAULT_KEYBOARD_BINDINGS.a).toEqual(['KeyZ'])
  })

  it.each([null, undefined, [], 'keyboard', 42, {}])('rejeita estrutura inválida: %s', (value) => {
    expect(() => validateKeyboardBindings(value)).toThrow('oito ações')
  })

  it('exige exatamente oito ações próprias, sem ações extras ou herdadas', () => {
    const { a: omitted, ...missing } = DEFAULT_KEYBOARD_BINDINGS
    expect(omitted).toEqual(['KeyZ'])
    expect(() => validateKeyboardBindings(missing)).toThrow('oito ações')
    expect(() =>
      validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, turbo: ['KeyT'] }),
    ).toThrow('oito ações')
    expect(() => validateKeyboardBindings(Object.create(DEFAULT_KEYBOARD_BINDINGS))).toThrow(
      'oito ações',
    )
  })

  it.each([[], 'KeyA', null, [1]])('rejeita ação sem lista de códigos válidos: %s', (a) => {
    expect(() => validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, a })).toThrow()
  })

  it.each([
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
    'Tab',
    'Escape',
    'F5',
    'Unidentified',
    'z',
    'KeyZZ',
    'Keyz',
    '',
  ])('reserva atalhos e rejeita código físico inválido: %s', (code) => {
    expect(() => validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, a: [code] })).toThrow(
      'Atalhos do navegador',
    )
  })

  it('aceita letras, números, espaço, pontuação e teclado numérico', () => {
    expect(
      validateKeyboardBindings({
        right: ['KeyD'],
        left: ['KeyA'],
        up: ['KeyW'],
        down: ['KeyS'],
        a: ['Space', 'Numpad0'],
        b: ['Digit1'],
        start: ['NumpadEnter'],
        select: ['Semicolon'],
      }).a,
    ).toEqual(['Space', 'Numpad0'])
  })

  it('rejeita conflitos entre ações e repetição dentro de uma ação', () => {
    expect(() => validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, a: ['KeyX'] })).toThrow(
      'mesma tecla',
    )
    expect(() =>
      validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, a: ['KeyZ', 'KeyZ'] }),
    ).toThrow('mesma tecla')
  })
})

describe('teclado configurável', () => {
  it('mantém teclas padrão, repetição sem borda extra e liberação por código físico', () => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    const cleanup = controller.bindKeyboard(target, () => true)
    const press = keyEvent('keydown', 'KeyZ')
    target.dispatchEvent(press)
    target.dispatchEvent(keyEvent('keydown', 'KeyZ'))
    expect(press.defaultPrevented).toBe(true)
    target.dispatchEvent(keyEvent('keyup', 'KeyZ'))
    expect(calls).toEqual([
      ['a', true],
      ['a', false],
    ])
    cleanup()
  })

  it('consulta o mapa atual e solta uma tecla mesmo depois de ela ter sido remapeada', () => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    let bindings = validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, a: ['KeyQ'] })
    const cleanup = controller.bindKeyboard(
      target,
      () => true,
      () => bindings,
    )
    const oldDefault = keyEvent('keydown', 'KeyZ')
    target.dispatchEvent(oldDefault)
    expect(oldDefault.defaultPrevented).toBe(false)
    target.dispatchEvent(keyEvent('keydown', 'KeyQ'))
    bindings = validateKeyboardBindings({ ...bindings, a: ['KeyE'] })
    target.dispatchEvent(keyEvent('keyup', 'KeyQ'))
    target.dispatchEvent(keyEvent('keydown', 'KeyE'))
    expect(calls).toEqual([
      ['a', true],
      ['a', false],
      ['a', true],
    ])
    cleanup()
    expect(calls.at(-1)).toEqual(['a', false])
  })

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)('preserva o atalho com %s', (modifier) => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    const cleanup = controller.bindKeyboard(target, () => true)
    const event = keyEvent('keydown', 'KeyZ', { [modifier]: true })
    target.dispatchEvent(event)
    expect(calls).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    cleanup()
  })

  it('ignora entrada pausada e libera a tecla pressionada antes da pausa', () => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    let enabled = true
    const cleanup = controller.bindKeyboard(target, () => enabled)
    target.dispatchEvent(keyEvent('keydown', 'KeyZ'))
    enabled = false
    const release = keyEvent('keyup', 'KeyZ')
    target.dispatchEvent(release)
    target.dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    expect(release.defaultPrevented).toBe(false)
    expect(calls).toEqual([
      ['a', true],
      ['a', false],
    ])
    cleanup()
  })

  it('não intercepta eventos já tratados ou campos editáveis', () => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    const cleanup = controller.bindKeyboard(target, () => true)
    const prevented = keyEvent('keydown', 'KeyZ')
    prevented.preventDefault()
    target.dispatchEvent(prevented)
    const editable = keyEvent('keydown', 'KeyZ')
    Object.defineProperty(editable, 'target', {
      value: { nodeType: 1, isContentEditable: false, closest: () => ({}) },
    })
    target.dispatchEvent(editable)
    const richText = keyEvent('keydown', 'KeyZ')
    Object.defineProperty(richText, 'target', {
      value: { nodeType: 1, isContentEditable: true, closest: () => null },
    })
    target.dispatchEvent(richText)
    expect(calls).toEqual([])
    expect(editable.defaultPrevented).toBe(false)
    expect(richText.defaultPrevented).toBe(false)
    cleanup()
  })

  it.each([
    ['Enter', 'button'],
    ['Enter', 'a[href]'],
    ['Enter', 'summary'],
    ['Space', 'button'],
    ['Space', 'summary'],
  ])('preserva a ativação nativa de %s em %s', (code, selector) => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    const bindings = validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, start: [code] })
    const cleanup = controller.bindKeyboard(
      target,
      () => true,
      () => bindings,
    )
    const event = keyEvent('keydown', code)
    Object.defineProperty(event, 'target', {
      value: {
        nodeType: 1,
        isContentEditable: false,
        closest: (query: string) => (query.split(', ').includes(selector!) ? {} : null),
      },
    })
    target.dispatchEvent(event)
    expect(calls).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    cleanup()
  })

  it('solta tecla remapeada para Espaço mesmo quando o foco passa para summary', () => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    const bindings = validateKeyboardBindings({ ...DEFAULT_KEYBOARD_BINDINGS, a: ['Space'] })
    const cleanup = controller.bindKeyboard(
      target,
      () => true,
      () => bindings,
    )
    target.dispatchEvent(keyEvent('keydown', 'Space'))
    const release = keyEvent('keyup', 'Space')
    Object.defineProperty(release, 'target', {
      value: { nodeType: 1, closest: () => ({}) },
    })
    target.dispatchEvent(release)
    expect(calls).toEqual([
      ['a', true],
      ['a', false],
    ])
    cleanup()
  })

  it('usa letras, números, espaço e Shift como fallback sem KeyboardEvent.code', () => {
    const { controller, calls } = setup()
    const { target } = keyboardWindow()
    const bindings = validateKeyboardBindings({
      ...DEFAULT_KEYBOARD_BINDINGS,
      a: ['KeyQ'],
      b: ['Digit1'],
      start: ['Space'],
    })
    const cleanup = controller.bindKeyboard(
      target,
      () => true,
      () => bindings,
    )
    for (const key of ['q', '1', ' ', 'Shift']) {
      target.dispatchEvent(keyEvent('keydown', '', { key }))
      target.dispatchEvent(keyEvent('keyup', '', { key }))
    }
    expect(calls).toEqual([
      ['a', true],
      ['a', false],
      ['b', true],
      ['b', false],
      ['start', true],
      ['start', false],
      ['select', true],
      ['select', false],
    ])
    cleanup()
  })

  it.each(['blur', 'hidden', 'cleanup'])('solta somente teclado ao receber %s', (reason) => {
    const { controller } = setup()
    const { target, document } = keyboardWindow()
    const cleanup = controller.bindKeyboard(target, () => true)
    target.dispatchEvent(keyEvent('keydown', 'KeyZ'))
    controller.press('a', 'pointer:1')
    controller.press('right', 'gamepad:0:button:15')
    if (reason === 'blur') target.dispatchEvent(new Event('blur'))
    else if (reason === 'hidden') {
      document.hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    } else cleanup()
    expect(controller.getSnapshot()).toBe(17)
    controller.release('pointer:1')
    expect(controller.getSnapshot()).toBe(1)
    cleanup()
    target.dispatchEvent(keyEvent('keydown', 'KeyZ'))
    expect(controller.getSnapshot()).toBe(1)
  })
})
