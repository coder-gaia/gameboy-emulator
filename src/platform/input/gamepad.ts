import type { InputButton, InputController } from './controller'

export interface GamepadStatus {
  supported: boolean
  connectedCount: number
  message: string
}

export type AxisDirection = -1 | 0 | 1

const AXIS_PRESS_THRESHOLD = 0.55
const AXIS_RELEASE_THRESHOLD = 0.35
const STANDARD_BUTTONS: readonly (readonly [number, InputButton])[] = [
  [0, 'a'],
  [1, 'b'],
  [8, 'select'],
  [9, 'start'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
]

interface PadState {
  id: string
  horizontal: AxisDirection
  vertical: AxisDirection
}

/** A margem entre pressionar e soltar evita oscilações perto da zona neutra. */
export function readAxisDirection(
  value: number | undefined,
  previous: AxisDirection,
): AxisDirection {
  if (value === undefined || !Number.isFinite(value)) return 0
  if (value >= AXIS_PRESS_THRESHOLD) return 1
  if (value <= -AXIS_PRESS_THRESHOLD) return -1
  if (previous === 1 && value > AXIS_RELEASE_THRESHOLD) return 1
  if (previous === -1 && value < -AXIS_RELEASE_THRESHOLD) return -1
  return 0
}

export function bindGamepads(
  controller: InputController,
  target: Window,
  enabled: () => boolean,
  onStatus?: (status: GamepadStatus) => void,
): () => void {
  const states = new Map<number, PadState>()
  // Alguns navegadores ainda expõem a última leitura durante o evento de desconexão.
  const disconnected = new Map<number, string>()
  let lastStatus: GamepadStatus | null = null
  let focused = target.document.hasFocus()
  let frame: number | null = null
  let disposed = false

  const report = (status: GamepadStatus): void => {
    if (
      lastStatus?.supported === status.supported &&
      lastStatus.connectedCount === status.connectedCount &&
      lastStatus.message === status.message
    ) {
      return
    }
    lastStatus = status
    onStatus?.(status)
  }
  const releasePad = (index: number): void => {
    controller.releaseSources(`gamepad:${index}:`)
    states.delete(index)
  }
  const releaseAll = (): void => {
    controller.releaseSources('gamepad:')
    for (const state of states.values()) {
      state.horizontal = 0
      state.vertical = 0
    }
  }
  const sync = (button: InputButton, source: string, pressed: boolean): void => {
    if (pressed) controller.press(button, source)
    else controller.release(source)
  }
  const readPad = (pad: Gamepad, state: PadState): void => {
    const prefix = `gamepad:${pad.index}:`
    for (const [index, button] of STANDARD_BUTTONS) {
      const value = pad.buttons[index]
      sync(
        button,
        `${prefix}button:${index}`,
        value?.pressed === true || (value?.value ?? 0) >= 0.5,
      )
    }
    state.horizontal = readAxisDirection(pad.axes[0], state.horizontal)
    state.vertical = readAxisDirection(pad.axes[1], state.vertical)
    sync('left', `${prefix}axis:0:negative`, state.horizontal === -1)
    sync('right', `${prefix}axis:0:positive`, state.horizontal === 1)
    sync('up', `${prefix}axis:1:negative`, state.vertical === -1)
    sync('down', `${prefix}axis:1:positive`, state.vertical === 1)
  }
  const poll = (): void => {
    if (disposed) return
    let pads: (Gamepad | null)[]
    if (typeof target.navigator.getGamepads !== 'function') {
      releaseAll()
      states.clear()
      report({
        supported: false,
        connectedCount: 0,
        message: 'Este navegador não oferece suporte a controles USB ou Bluetooth.',
      })
      return
    }
    try {
      pads = target.navigator.getGamepads()
    } catch {
      releaseAll()
      states.clear()
      report({
        supported: false,
        connectedCount: 0,
        message: 'O navegador não permitiu acessar os controles. Use o teclado ou o toque.',
      })
      return
    }
    const active = enabled() && focused && target.document.hasFocus() && !target.document.hidden
    if (!active) releaseAll()
    const seen = new Set<number>()
    let hasUnsupportedMapping = false
    for (const pad of pads) {
      if (!pad?.connected) continue
      if (disconnected.get(pad.index) === pad.id) continue
      disconnected.delete(pad.index)
      if (pad.mapping !== 'standard') {
        hasUnsupportedMapping = true
        continue
      }
      seen.add(pad.index)
      let state = states.get(pad.index)
      if (state !== undefined && state.id !== pad.id) {
        releasePad(pad.index)
        state = undefined
      }
      if (state === undefined) {
        state = { id: pad.id, horizontal: 0, vertical: 0 }
        states.set(pad.index, state)
      }
      if (active) readPad(pad, state)
    }
    for (const index of states.keys()) {
      if (!seen.has(index)) releasePad(index)
    }
    for (const index of disconnected.keys()) {
      if (!pads.some((pad) => pad?.connected && pad.index === index)) disconnected.delete(index)
    }
    report({
      supported: true,
      connectedCount: seen.size,
      message:
        seen.size > 0
          ? seen.size === 1
            ? '1 controle conectado. Direcional, A, B, Start e Select disponíveis.'
            : `${seen.size} controles conectados. Direcional, A, B, Start e Select disponíveis.`
          : hasUnsupportedMapping
            ? 'Este controle não tem mapeamento padrão. Use o teclado ou o toque.'
            : 'Conecte um controle USB ou Bluetooth e pressione um botão para reconhecê-lo.',
    })
  }
  const animate = (): void => {
    if (disposed) return
    poll()
    frame = target.requestAnimationFrame(animate)
  }
  const blur = (): void => {
    focused = false
    releaseAll()
  }
  const focus = (): void => {
    focused = true
    poll()
  }
  const visibilitychange = (): void => {
    if (target.document.hidden) releaseAll()
    else poll()
  }
  const connected = (event: GamepadEvent): void => {
    disconnected.delete(event.gamepad.index)
    poll()
  }
  const disconnect = (event: GamepadEvent): void => {
    disconnected.set(event.gamepad.index, event.gamepad.id)
    releasePad(event.gamepad.index)
    poll()
  }

  target.addEventListener('blur', blur)
  target.addEventListener('focus', focus)
  target.addEventListener('gamepadconnected', connected)
  target.addEventListener('gamepaddisconnected', disconnect)
  target.document.addEventListener('visibilitychange', visibilitychange)
  poll()
  if (typeof target.navigator.getGamepads === 'function') {
    frame = target.requestAnimationFrame(animate)
  }
  return () => {
    if (disposed) return
    disposed = true
    if (frame !== null) target.cancelAnimationFrame(frame)
    target.removeEventListener('blur', blur)
    target.removeEventListener('focus', focus)
    target.removeEventListener('gamepadconnected', connected)
    target.removeEventListener('gamepaddisconnected', disconnect)
    target.document.removeEventListener('visibilitychange', visibilitychange)
    releaseAll()
    states.clear()
    disconnected.clear()
  }
}
