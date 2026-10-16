export type InputButton = 'right' | 'left' | 'up' | 'down' | 'a' | 'b' | 'start' | 'select'

export const INPUT_BUTTON_BITS: Readonly<Record<InputButton, number>> = {
  right: 1,
  left: 2,
  up: 4,
  down: 8,
  a: 16,
  b: 32,
  select: 64,
  start: 128,
}

export type KeyboardBindings = Record<InputButton, string[]>

export const DEFAULT_KEYBOARD_BINDINGS: KeyboardBindings = {
  right: ['ArrowRight'],
  left: ['ArrowLeft'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  a: ['KeyZ'],
  b: ['KeyX'],
  start: ['Enter'],
  select: ['ShiftLeft', 'ShiftRight'],
}

const INPUT_BUTTONS = Object.keys(INPUT_BUTTON_BITS) as InputButton[]
const ALLOWED_KEYBOARD_CODES = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'Enter',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'IntlBackslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
  ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
  ...Array.from({ length: 10 }, (_, index) => `Numpad${index}`),
])

export function validateKeyboardBindings(value: unknown): KeyboardBindings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('O mapa do teclado precisa conter as oito ações do Game Boy.')
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== INPUT_BUTTONS.length ||
    !INPUT_BUTTONS.every((button) => Object.hasOwn(record, button))
  ) {
    throw new Error('O mapa do teclado precisa conter as oito ações do Game Boy.')
  }
  const bindings = {} as KeyboardBindings
  const usedCodes = new Set<string>()
  for (const button of INPUT_BUTTONS) {
    const codes = record[button]
    if (!Array.isArray(codes) || codes.length === 0) {
      throw new Error('Cada ação precisa de pelo menos uma tecla.')
    }
    const copy: string[] = []
    for (const code of codes) {
      if (typeof code !== 'string' || !ALLOWED_KEYBOARD_CODES.has(code)) {
        throw new Error(
          'Escolha uma tecla de letra, número, direção ou pontuação. Atalhos do navegador ficam reservados.',
        )
      }
      if (usedCodes.has(code)) {
        throw new Error('A mesma tecla não pode ser usada em duas ações ou repetida no mapa.')
      }
      usedCodes.add(code)
      copy.push(code)
    }
    bindings[button] = copy
  }
  return bindings
}

function keyboardCode(event: KeyboardEvent): string {
  if (event.code) return event.code
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`
  if (/^[0-9]$/.test(event.key)) return `Digit${event.key}`
  if (event.key === ' ') return 'Space'
  if (event.key === 'Shift') return 'ShiftLeft'
  return event.key
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const element = event.target as HTMLElement | null
  return (
    element?.nodeType === 1 &&
    (element.isContentEditable ||
      element.closest('input, textarea, select, [role="textbox"]') !== null)
  )
}

/** Fontes independentes evitam soltar um botão ainda pressionado por outro dispositivo. */
export class InputController {
  private readonly sources = new Map<string, InputButton>()
  private readonly counts = new Map<InputButton, number>()
  private readonly listeners = new Set<() => void>()
  private pressedMask = 0

  constructor(private readonly setButton: (button: InputButton, pressed: boolean) => void) {}

  readonly getSnapshot = (): number => this.pressedMask

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  press(button: InputButton, source: string): void {
    const previous = this.sources.get(source)
    if (previous === button) return
    if (previous !== undefined) this.release(source)
    this.sources.set(source, button)
    const count = this.counts.get(button) ?? 0
    this.counts.set(button, count + 1)
    if (count === 0) {
      this.pressedMask |= INPUT_BUTTON_BITS[button]
      this.setButton(button, true)
      this.notify()
    }
  }

  release(source: string): void {
    const button = this.sources.get(source)
    if (button === undefined) return
    this.sources.delete(source)
    const count = (this.counts.get(button) ?? 1) - 1
    if (count > 0) this.counts.set(button, count)
    else {
      this.counts.delete(button)
      this.pressedMask &= ~INPUT_BUTTON_BITS[button]
      this.setButton(button, false)
      this.notify()
    }
  }

  releaseAll(): void {
    if (this.sources.size === 0) return
    this.sources.clear()
    const pressed = [...this.counts.keys()]
    this.counts.clear()
    this.pressedMask = 0
    for (const button of pressed) this.setButton(button, false)
    this.notify()
  }

  releaseSources(prefix: string): void {
    for (const source of this.sources.keys()) {
      if (source.startsWith(prefix)) this.release(source)
    }
  }

  bindKeyboard(
    target: Window,
    enabled: () => boolean,
    getBindings: () => KeyboardBindings = () => DEFAULT_KEYBOARD_BINDINGS,
  ): () => void {
    const keydown = (event: KeyboardEvent): void => {
      const code = keyboardCode(event)
      const bindings = getBindings()
      const button = INPUT_BUTTONS.find((candidate) => bindings[candidate].includes(code))
      if (
        button === undefined ||
        !enabled() ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event)
      ) {
        return
      }
      const element = event.target as HTMLElement | null
      // Preserva a ativação nativa dos controles da interface.
      if (
        element?.nodeType === 1 &&
        ((code === 'Enter' && element.closest('button, a[href], summary')) ||
          (code === 'Space' && element.closest('button, summary')))
      ) {
        return
      }
      event.preventDefault()
      this.press(button, `keyboard:${code}`)
    }
    const keyup = (event: KeyboardEvent): void => {
      const code = keyboardCode(event)
      const source = `keyboard:${code}`
      // A liberação não depende do foco atual nem de a emulação ainda estar ativa.
      const wasPressed = this.sources.has(source)
      this.release(source)
      if (wasPressed && enabled()) event.preventDefault()
    }
    const blur = (): void => this.releaseSources('keyboard:')
    const visibilitychange = (): void => {
      if (target.document.hidden) this.releaseSources('keyboard:')
    }
    target.addEventListener('keydown', keydown)
    target.addEventListener('keyup', keyup)
    target.addEventListener('blur', blur)
    target.document.addEventListener('visibilitychange', visibilitychange)
    return () => {
      target.removeEventListener('keydown', keydown)
      target.removeEventListener('keyup', keyup)
      target.removeEventListener('blur', blur)
      target.document.removeEventListener('visibilitychange', visibilitychange)
      this.releaseSources('keyboard:')
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
