export type JoypadButton = 'right' | 'left' | 'up' | 'down' | 'a' | 'b' | 'select' | 'start'

const BUTTON_MASKS: Readonly<Record<JoypadButton, number>> = {
  right: 0x01,
  left: 0x02,
  up: 0x04,
  down: 0x08,
  a: 0x10,
  b: 0x20,
  select: 0x40,
  start: 0x80,
}

/** Matriz P1 ativa em zero. Fonte: https://gbdev.io/pandocs/Joypad_Input.html */
export class Joypad {
  private selection = 0x30
  private pressedButtons = 0

  constructor(private readonly requestInterrupt: (mask: number) => void = () => {}) {}

  read(): number {
    let lines = 0x0f
    if ((this.selection & 0x10) === 0) lines &= ~this.pressedButtons
    if ((this.selection & 0x20) === 0) lines &= ~(this.pressedButtons >>> 4)
    return 0xc0 | this.selection | lines
  }

  write(value: number): void {
    const previous = this.read()
    this.selection = value & 0x30
    this.detectFallingEdge(previous)
  }

  /** Informa uma nova pressão física, independentemente do grupo selecionado. */
  setButton(button: JoypadButton, pressed: boolean): boolean {
    const mask = BUTTON_MASKS[button]
    if (typeof mask !== 'number') throw new Error(`Botão de Game Boy inválido: ${button}.`)
    const alreadyPressed = (this.pressedButtons & mask) !== 0
    if (alreadyPressed === pressed) return false

    const previous = this.read()
    if (pressed) this.pressedButtons |= mask
    else this.pressedButtons &= ~mask
    this.detectFallingEdge(previous)
    return pressed
  }

  releaseAll(): void {
    this.pressedButtons = 0
  }

  private detectFallingEdge(previous: number): void {
    if ((previous & ~this.read() & 0x0f) !== 0) this.requestInterrupt(0x10)
  }
}
