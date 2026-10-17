import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { History, Rewind } from 'lucide-react'
import styles from './RewindControls.module.css'

export interface RewindControlsProps {
  compact?: boolean
  enabled: boolean
  active: boolean
  availableSeconds: number
  disabled: boolean
  shortcutAvailable: boolean
  notice: string
  onToggle: () => void
  onBegin: () => void
  onEnd: (resume: boolean) => void
  onStep: () => void
}

function activationKey(event: KeyboardEvent<HTMLButtonElement>): string | null {
  if (event.key === 'Enter') return event.code || 'Enter'
  if (event.key === ' ' || event.code === 'Space') return 'Space'
  return null
}

export function RewindControls({
  compact = false,
  enabled,
  active,
  availableSeconds,
  disabled,
  shortcutAvailable,
  notice,
  onToggle,
  onBegin,
  onEnd,
  onStep,
}: RewindControlsProps) {
  const titleId = useId()
  const noteId = useId()
  const heldSources = useRef(new Set<string>())
  const callbacks = useRef({ onBegin, onEnd })
  const ignoreClick = useRef(false)
  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const seconds = Number.isFinite(availableSeconds)
    ? Math.max(0, Math.min(20, availableSeconds))
    : 0
  const holdDisabled = !active && !holding && (disabled || !enabled || seconds <= 0)

  useLayoutEffect(() => {
    callbacks.current = { onBegin, onEnd }
  }, [onBegin, onEnd])

  useEffect(() => {
    const sources = heldSources.current
    const cancel = (): void => {
      if (sources.size === 0) return
      sources.clear()
      setHolding(false)
      callbacks.current.onEnd(false)
    }
    const visibilitychange = (): void => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', visibilitychange)
    return () => {
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', visibilitychange)
      if (clickTimeout.current !== null) clearTimeout(clickTimeout.current)
      if (sources.size > 0) {
        sources.clear()
        callbacks.current.onEnd(false)
      }
    }
  }, [])

  function begin(source: string): void {
    if (disabled || !enabled || (!active && seconds <= 0)) return
    const sources = heldSources.current
    if (sources.has(source)) return
    const first = sources.size === 0
    sources.add(source)
    if (first) {
      setHolding(true)
      callbacks.current.onBegin()
    }
  }

  function release(source: string): void {
    const sources = heldSources.current
    if (!sources.delete(source) || sources.size > 0) return
    setHolding(false)
    callbacks.current.onEnd(true)
  }

  function cancel(): void {
    const sources = heldSources.current
    if (sources.size === 0) return
    sources.clear()
    setHolding(false)
    callbacks.current.onEnd(false)
  }

  function suppressKeyboardClick(): void {
    ignoreClick.current = true
    if (clickTimeout.current !== null) clearTimeout(clickTimeout.current)
    clickTimeout.current = setTimeout(() => {
      ignoreClick.current = false
      clickTimeout.current = null
    }, 0)
  }

  return (
    <section
      className={`${styles.panel} ${compact ? styles.compact : ''} ${compact && enabled ? styles.compactEnabled : ''}`}
      aria-labelledby={titleId}
    >
      <div className={styles.heading}>
        <History size={19} aria-hidden="true" />
        <div>
          <h2 id={titleId}>Um instante atrás.</h2>
          <p>
            {enabled
              ? 'Seu histórico fica só nesta aba.'
              : 'Ative para começar a guardar o histórico.'}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.toggle} ${enabled ? styles.enabled : ''}`}
          aria-pressed={enabled}
          disabled={disabled || active || holding}
          onClick={onToggle}
        >
          {enabled ? 'Desativar rewind' : 'Ativar rewind'}
        </button>
        <button
          type="button"
          className={`${styles.hold} ${active ? styles.active : ''}`}
          disabled={holdDisabled}
          aria-pressed={active}
          aria-describedby={noteId}
          onPointerDown={(event) => {
            if (event.button !== 0 || disabled || !enabled || (!active && seconds <= 0)) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            begin(`pointer:${event.pointerId}`)
          }}
          onPointerUp={(event) => release(`pointer:${event.pointerId}`)}
          onPointerCancel={cancel}
          onLostPointerCapture={(event) => {
            if (heldSources.current.has(`pointer:${event.pointerId}`)) cancel()
          }}
          onKeyDown={(event) => {
            const key = activationKey(event)
            if (key === null || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
              return
            event.preventDefault()
            suppressKeyboardClick()
            if (!event.repeat) begin(`keyboard:${key}`)
          }}
          onKeyUp={(event) => {
            const key = activationKey(event)
            if (key === null || !heldSources.current.has(`keyboard:${key}`)) return
            event.preventDefault()
            suppressKeyboardClick()
            release(`keyboard:${key}`)
          }}
          onBlur={cancel}
          onClick={(event) => {
            if (event.detail !== 0 || ignoreClick.current || holding || active) return
            if (disabled || !enabled || seconds <= 0) return
            onStep()
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Rewind size={15} aria-hidden="true" />
          Segure para voltar
        </button>
      </div>
      <div className={styles.history} aria-live="off">
        <output aria-label="Tempo disponível para rewind" aria-live="off">
          {seconds.toFixed(1).replace('.', ',')} s disponíveis
        </output>
        <span>{active ? 'Voltando no tempo' : enabled ? 'Histórico ativo' : 'Desligado'}</span>
        <div className={styles.track} aria-hidden="true">
          <span style={{ width: `${(seconds / 20) * 100}%` }} />
        </div>
      </div>
      <p className={styles.note} id={noteId}>
        Até 20 segundos, apenas nesta aba. Voltar também restaura a RAM e o progresso do jogo.
        Carregar um estado ou trocar o cartucho limpa o histórico.
      </p>
      <p className={styles.note}>
        {shortcutAvailable
          ? 'Com a tela em foco, você também pode segurar R para voltar.'
          : 'R está em uso no teclado. Use o botão para voltar.'}
      </p>
      {notice && (
        <p className={styles.notice} role="status" aria-label="Estado do rewind">
          {notice}
        </p>
      )}
    </section>
  )
}
