import { describe, expect, it, vi } from 'vitest'
import { InputController } from '../../src/platform/input/controller'
import { bindRewindShortcut } from '../../src/platform/input/rewind-shortcut'

function setup() {
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    focused: true,
    modalOpen: false,
    hasFocus: () => document.focused,
    querySelector: () => (document.modalOpen ? {} : null),
  })
  const target = Object.assign(new EventTarget(), { document })
  const onBegin = vi.fn()
  const onEnd = vi.fn<(resume: boolean) => void>()
  let enabled = true
  let reserved = false
  return {
    target,
    document,
    onBegin,
    onEnd,
    setEnabled: (value: boolean) => (enabled = value),
    setReserved: (value: boolean) => (reserved = value),
    bind: () =>
      bindRewindShortcut(
        target as unknown as Window,
        () => enabled,
        onBegin,
        onEnd,
        () => reserved,
      ),
  }
}

function keyEvent(type: 'keydown' | 'keyup', options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return Object.assign(new Event(type, { cancelable: true }), {
    code: 'KeyR',
    key: 'r',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...options,
  }) as KeyboardEvent
}

function withTarget<T extends Event>(event: T, target: object): T {
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('atalho físico R para rewind', () => {
  it('inicia uma vez por pressão e encerra normalmente ao soltar', () => {
    const fake = setup()
    const cleanup = fake.bind()
    const press = keyEvent('keydown')
    fake.target.dispatchEvent(press)
    fake.target.dispatchEvent(keyEvent('keydown', { repeat: true }))
    fake.target.dispatchEvent(keyEvent('keydown'))
    expect(fake.onBegin).toHaveBeenCalledOnce()
    expect(press.defaultPrevented).toBe(true)
    const release = keyEvent('keyup')
    fake.target.dispatchEvent(release)
    fake.target.dispatchEvent(keyEvent('keyup'))
    expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(true)
    expect(release.defaultPrevented).toBe(true)
    cleanup()
    expect(fake.onEnd).toHaveBeenCalledOnce()
  })

  it('usa KeyR físico mesmo em outro layout, sem aceitar apenas a letra r', () => {
    const fake = setup()
    const cleanup = fake.bind()
    const otherCode = keyEvent('keydown', { code: 'KeyQ', key: 'r' })
    const withoutCode = keyEvent('keydown', { code: '', key: 'r' })
    fake.target.dispatchEvent(otherCode)
    fake.target.dispatchEvent(withoutCode)
    expect(fake.onBegin).not.toHaveBeenCalled()
    expect(otherCode.defaultPrevented).toBe(false)
    fake.target.dispatchEvent(keyEvent('keydown', { key: 'я' }))
    expect(fake.onBegin).toHaveBeenCalledOnce()
    fake.target.dispatchEvent(keyEvent('keyup', { key: 'я' }))
    expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(true)
    cleanup()
  })

  it.each(['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const)(
    'não intercepta combinação com %s',
    (modifier) => {
      const fake = setup()
      const cleanup = fake.bind()
      const event = keyEvent('keydown', { [modifier]: true })
      fake.target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(fake.onBegin).not.toHaveBeenCalled()
      cleanup()
    },
  )

  it('ignora repetição iniciada fora da página e eventos já tratados', () => {
    const fake = setup()
    const cleanup = fake.bind()
    const prevented = keyEvent('keydown')
    prevented.preventDefault()
    fake.target.dispatchEvent(prevented)
    fake.target.dispatchEvent(keyEvent('keydown', { repeat: true }))
    expect(fake.onBegin).not.toHaveBeenCalled()
    cleanup()
  })

  it('não inicia quando desativado ou reservado pelo mapa do teclado', () => {
    const fake = setup()
    const cleanup = fake.bind()
    fake.setEnabled(false)
    const disabled = keyEvent('keydown')
    fake.target.dispatchEvent(disabled)
    fake.setEnabled(true)
    fake.setReserved(true)
    const reserved = keyEvent('keydown')
    fake.target.dispatchEvent(reserved)
    expect(fake.onBegin).not.toHaveBeenCalled()
    expect(disabled.defaultPrevented).toBe(false)
    expect(reserved.defaultPrevented).toBe(false)
    fake.setReserved(false)
    fake.target.dispatchEvent(keyEvent('keydown'))
    expect(fake.onBegin).toHaveBeenCalledOnce()
    cleanup()
  })

  it.each([
    'input',
    'textarea',
    'select',
    'button',
    'a[href]',
    'summary',
    'details',
    'dialog',
    '[contenteditable]',
    '[role="textbox"]',
    '[role="button"]',
    '[role="dialog"]',
    '[role="menu"]',
    '[role="menuitem"]',
    '[role="listbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[data-rewind-shortcut-blocked]',
  ])('preserva R quando o alvo está em %s', (selector) => {
    const fake = setup()
    const cleanup = fake.bind()
    const event = withTarget(keyEvent('keydown'), {
      nodeType: 1,
      isContentEditable: false,
      closest: (query: string) => (query.split(', ').includes(selector) ? {} : null),
    })
    fake.target.dispatchEvent(event)
    expect(fake.onBegin).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    cleanup()
  })

  it('preserva texto editável herdado e ignora qualquer diálogo aberto', () => {
    const fake = setup()
    const cleanup = fake.bind()
    fake.target.dispatchEvent(
      withTarget(keyEvent('keydown'), {
        nodeType: 1,
        isContentEditable: true,
        closest: () => null,
      }),
    )
    fake.document.modalOpen = true
    const event = keyEvent('keydown')
    fake.target.dispatchEvent(event)
    expect(fake.onBegin).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    cleanup()
  })

  it('não inicia em aba oculta ou janela sem foco', () => {
    const fake = setup()
    const cleanup = fake.bind()
    fake.document.hidden = true
    fake.target.dispatchEvent(keyEvent('keydown'))
    fake.document.hidden = false
    fake.document.focused = false
    fake.target.dispatchEvent(keyEvent('keydown'))
    expect(fake.onBegin).not.toHaveBeenCalled()
    cleanup()
  })

  it('libera R mesmo depois de mudar enabled, reserva, alvo e modificadores', () => {
    const fake = setup()
    const cleanup = fake.bind()
    fake.target.dispatchEvent(keyEvent('keydown'))
    fake.setEnabled(false)
    fake.setReserved(true)
    const event = withTarget(keyEvent('keyup', { ctrlKey: true, altKey: true }), {
      nodeType: 1,
      isContentEditable: true,
      closest: () => ({}),
    })
    fake.target.dispatchEvent(event)
    expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(true)
    expect(event.defaultPrevented).toBe(true)
    cleanup()
  })

  it('soltar outra tecla não encerra a fonte R', () => {
    const fake = setup()
    const cleanup = fake.bind()
    fake.target.dispatchEvent(keyEvent('keydown'))
    const other = keyEvent('keyup', { code: 'KeyZ', key: 'z' })
    fake.target.dispatchEvent(other)
    expect(fake.onEnd).not.toHaveBeenCalled()
    expect(other.defaultPrevented).toBe(false)
    fake.target.dispatchEvent(keyEvent('keyup'))
    expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(true)
    cleanup()
  })

  it.each(['blur', 'hidden', 'escape', 'focusin', 'cleanup'])(
    'cancela sem retomar ao ocorrer %s e não duplica o término',
    (reason) => {
      const fake = setup()
      const cleanup = fake.bind()
      fake.target.dispatchEvent(keyEvent('keydown'))
      if (reason === 'blur') fake.target.dispatchEvent(new Event('blur'))
      else if (reason === 'hidden') {
        fake.document.hidden = true
        fake.document.dispatchEvent(new Event('visibilitychange'))
      } else if (reason === 'escape') {
        const escape = keyEvent('keydown', { code: 'Escape', key: 'Escape' })
        fake.target.dispatchEvent(escape)
        expect(escape.defaultPrevented).toBe(false)
      } else if (reason === 'focusin') {
        fake.target.dispatchEvent(
          withTarget(new Event('focusin'), {
            nodeType: 1,
            isContentEditable: false,
            closest: () => ({}),
          }),
        )
      } else cleanup()
      fake.target.dispatchEvent(keyEvent('keyup'))
      expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(false)
      cleanup()
      expect(fake.onEnd).toHaveBeenCalledOnce()
    },
  )

  it('não cancela por foco em uma tela que aceita o atalho', () => {
    const fake = setup()
    const cleanup = fake.bind()
    fake.target.dispatchEvent(keyEvent('keydown'))
    fake.target.dispatchEvent(
      withTarget(new Event('focusin'), {
        nodeType: 1,
        isContentEditable: false,
        closest: () => null,
      }),
    )
    expect(fake.onEnd).not.toHaveBeenCalled()
    fake.target.dispatchEvent(keyEvent('keyup'))
    expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(true)
    cleanup()
  })

  it('não toca nas fontes de teclado, toque ou gamepad ao cancelar sua fonte', () => {
    const controller = new InputController(() => {})
    const fake = setup()
    const cleanupKeyboard = controller.bindKeyboard(fake.target as unknown as Window, () => true)
    fake.target.dispatchEvent(keyEvent('keydown', { code: 'KeyZ', key: 'z' }))
    controller.press('right', 'pointer:1')
    controller.press('down', 'gamepad:0:button:13')
    const cleanup = fake.bind()
    fake.target.dispatchEvent(keyEvent('keydown'))
    fake.target.dispatchEvent(keyEvent('keydown', { code: 'Escape', key: 'Escape' }))
    cleanup()
    expect(controller.getSnapshot()).toBe(25)
    expect(fake.onEnd).toHaveBeenCalledExactlyOnceWith(false)
    fake.target.dispatchEvent(keyEvent('keydown', { code: 'KeyX', key: 'x' }))
    expect(controller.getSnapshot()).toBe(57)
    fake.target.dispatchEvent(keyEvent('keyup', { code: 'KeyX', key: 'x' }))
    expect(controller.getSnapshot()).toBe(25)
    cleanupKeyboard()
    expect(controller.getSnapshot()).toBe(9)
  })

  it('cleanup sem gesto não encerra outra fonte e remove todos os listeners', () => {
    const fake = setup()
    const cleanup = fake.bind()
    cleanup()
    cleanup()
    fake.target.dispatchEvent(keyEvent('keydown'))
    fake.target.dispatchEvent(keyEvent('keyup'))
    fake.target.dispatchEvent(new Event('blur'))
    fake.document.hidden = true
    fake.document.dispatchEvent(new Event('visibilitychange'))
    expect(fake.onBegin).not.toHaveBeenCalled()
    expect(fake.onEnd).not.toHaveBeenCalled()
  })
})
