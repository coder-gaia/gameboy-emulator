import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { INPUT_BUTTON_BITS, InputController } from '../../platform/input/controller'
import type { InputButton } from '../../platform/input/controller'
import styles from './TouchControls.module.css'

interface TouchControlsProps {
  controller: InputController | null
  disabled: boolean
}

interface ControlButtonProps extends TouchControlsProps {
  button: InputButton
  label: string
  className: string
  pressed: boolean
  children: ReactNode
}

const emptySnapshot = (): number => 0
const emptySubscribe = (): (() => void) => () => {}
const MINIMUM_POINTER_PRESS_MS = 40

interface PointerGesture {
  startedAt: number
  released: boolean
  timeout: ReturnType<typeof setTimeout> | null
}

function activationKey(event: KeyboardEvent<HTMLButtonElement>): string | null {
  if (event.key === 'Enter') return 'Enter'
  if (event.key === ' ') return 'Space'
  return null
}

function ControlButton({
  controller,
  disabled,
  button,
  label,
  className,
  pressed,
  children,
}: ControlButtonProps) {
  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerGestures = useRef(new Map<number, PointerGesture>())

  useEffect(() => {
    const gestures = pointerGestures.current
    const releaseControls = (): void => {
      for (const [pointerId, gesture] of gestures) {
        if (gesture.timeout !== null) clearTimeout(gesture.timeout)
        controller?.release(`pointer:${pointerId}:${button}`)
      }
      gestures.clear()
      if (clickTimeout.current !== null) {
        clearTimeout(clickTimeout.current)
        clickTimeout.current = null
      }
      controller?.release(`activation:${button}`)
      controller?.release(`control:${button}:Enter`)
      controller?.release(`control:${button}:Space`)
    }
    const visibilitychange = (): void => {
      if (document.hidden) releaseControls()
    }
    if (disabled) releaseControls()
    window.addEventListener('blur', releaseControls)
    document.addEventListener('visibilitychange', visibilitychange)
    return () => {
      window.removeEventListener('blur', releaseControls)
      document.removeEventListener('visibilitychange', visibilitychange)
      releaseControls()
    }
  }, [controller, button, disabled])

  function cancelPointer(pointerId: number): void {
    const gesture = pointerGestures.current.get(pointerId)
    if (gesture?.timeout !== null && gesture?.timeout !== undefined) clearTimeout(gesture.timeout)
    pointerGestures.current.delete(pointerId)
    controller?.release(`pointer:${pointerId}:${button}`)
  }

  function releasePointer(pointerId: number): void {
    const gesture = pointerGestures.current.get(pointerId)
    if (!gesture || gesture.released) return
    const remaining = MINIMUM_POINTER_PRESS_MS - (performance.now() - gesture.startedAt)
    if (remaining <= 0) cancelPointer(pointerId)
    else {
      // Um tap pode começar e terminar entre dois frames. Mantemos a mesma
      // pressão até o prazo mínimo, sem gerar uma segunda borda de entrada.
      gesture.released = true
      gesture.timeout = setTimeout(() => cancelPointer(pointerId), remaining)
    }
  }

  return (
    <button
      type="button"
      className={`${styles.button} ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled || controller === null}
      onPointerDown={(event) => {
        if (!controller || disabled || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const previous = pointerGestures.current.get(event.pointerId)
        if (previous?.timeout !== null && previous?.timeout !== undefined)
          clearTimeout(previous.timeout)
        pointerGestures.current.set(event.pointerId, {
          startedAt: performance.now(),
          released: false,
          timeout: null,
        })
        controller.press(button, `pointer:${event.pointerId}:${button}`)
      }}
      onPointerUp={(event) => releasePointer(event.pointerId)}
      onPointerCancel={(event) => cancelPointer(event.pointerId)}
      onLostPointerCapture={(event) => {
        // pointerup solta a captura automaticamente. Somente perdas durante
        // uma pressão ainda em curso cancelam o gesto e seu timer.
        if (!pointerGestures.current.get(event.pointerId)?.released) cancelPointer(event.pointerId)
      }}
      onKeyDown={(event) => {
        const key = activationKey(event)
        if (key === null || !controller || disabled) return
        event.preventDefault()
        controller.press(button, `control:${button}:${key}`)
      }}
      onKeyUp={(event) => {
        const key = activationKey(event)
        if (key === null) return
        event.preventDefault()
        controller?.release(`control:${button}:${key}`)
      }}
      onBlur={() => {
        for (const pointerId of pointerGestures.current.keys()) cancelPointer(pointerId)
        controller?.release(`control:${button}:Enter`)
        controller?.release(`control:${button}:Space`)
      }}
      onClick={(event) => {
        // Ativação por tecnologia assistiva pode chegar como click sem ponteiro.
        if (event.detail !== 0 || !controller || disabled) return
        const source = `activation:${button}`
        if (clickTimeout.current !== null) clearTimeout(clickTimeout.current)
        controller.press(button, source)
        clickTimeout.current = setTimeout(() => {
          controller.release(source)
          clickTimeout.current = null
        }, 100)
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  )
}

export function TouchControls({ controller, disabled }: TouchControlsProps) {
  useEffect(() => {
    if (disabled) controller?.releaseAll()
    return () => controller?.releaseAll()
  }, [controller, disabled])
  const pressedMask = useSyncExternalStore(
    controller?.subscribe ?? emptySubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  )
  const props = (button: InputButton, label: string, className: string): ControlButtonProps => ({
    controller,
    disabled,
    button,
    label,
    className,
    pressed: (pressedMask & INPUT_BUTTON_BITS[button]) !== 0,
    children: null,
  })

  return (
    <div className={styles.controls} role="group" aria-label="Controles do Game Boy">
      <div className={styles.dpad}>
        <ControlButton {...props('up', 'Cima', styles.up!)}>
          <ArrowUp size={18} aria-hidden="true" />
        </ControlButton>
        <ControlButton {...props('left', 'Esquerda', styles.left!)}>
          <ArrowLeft size={18} aria-hidden="true" />
        </ControlButton>
        <span className={styles.center} aria-hidden="true" />
        <ControlButton {...props('right', 'Direita', styles.right!)}>
          <ArrowRight size={18} aria-hidden="true" />
        </ControlButton>
        <ControlButton {...props('down', 'Baixo', styles.down!)}>
          <ArrowDown size={18} aria-hidden="true" />
        </ControlButton>
      </div>
      <div className={styles.rightSide}>
        <div className={styles.actionButtons}>
          <ControlButton {...props('b', 'Botão B', styles.action!)}>B</ControlButton>
          <ControlButton {...props('a', 'Botão A', `${styles.action} ${styles.actionA}`)}>
            A
          </ControlButton>
        </div>
        <div className={styles.menuButtons}>
          <ControlButton {...props('select', 'Select', styles.menu!)}>
            <span aria-hidden="true" />
            SELECT
          </ControlButton>
          <ControlButton {...props('start', 'Start', styles.menu!)}>
            <span aria-hidden="true" />
            START
          </ControlButton>
        </div>
      </div>
    </div>
  )
}
