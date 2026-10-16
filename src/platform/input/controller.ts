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

const KEYBOARD_BUTTONS: Readonly<Record<string, InputButton>> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyZ: 'a',
  KeyX: 'b',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
}

function keyboardCode(event: KeyboardEvent): string {
  if (event.code) return event.code
  if (event.key.toLowerCase() === 'z') return 'KeyZ'
  if (event.key.toLowerCase() === 'x') return 'KeyX'
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

  bindKeyboard(target: Window, enabled: () => boolean): () => void {
    const keydown = (event: KeyboardEvent): void => {
      const code = keyboardCode(event)
      const button = KEYBOARD_BUTTONS[code]
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
      // Enter continua ativando botões e links da interface pelo navegador.
      if (code === 'Enter' && element?.nodeType === 1 && element.closest('button, a[href]')) return
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
    const blur = (): void => this.releaseAll()
    const visibilitychange = (): void => {
      if (target.document.hidden) this.releaseAll()
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
      this.releaseAll()
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
