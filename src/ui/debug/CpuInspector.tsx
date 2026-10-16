import { useEffect, useState } from 'react'
import type { EmulatorClient } from '../../runtime/emulator-client'
import styles from './CpuInspector.module.css'

function hex(value: number, length = 4) {
  return value.toString(16).padStart(length, '0').toUpperCase()
}

/** Inspeção da mesma máquina que executa fora da interface. */
export function CpuInspector({
  device,
  playing,
  disabled = false,
  onAdvance,
  onReset,
}: {
  device: EmulatorClient
  playing: boolean
  disabled?: boolean
  onAdvance: () => void
  onReset: () => void
}) {
  const [state, setState] = useState(() => device.inspection.cpu)
  const [open, setOpen] = useState(false)
  const [serial, setSerial] = useState(device.inspection.serial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const interval = window.setInterval(() => {
      setState(device.inspection.cpu)
      setSerial(device.inspection.serial)
    }, 150)
    return () => window.clearInterval(interval)
  }, [device, open])

  async function advance(count: number) {
    setBusy(true)
    try {
      await device.advance(count)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A execução da CPU foi interrompida.')
    } finally {
      setState(device.inspection.cpu)
      setSerial(device.inspection.serial)
      setBusy(false)
      onAdvance()
    }
  }

  function reset() {
    onReset()
  }

  const registers = {
    AF: (state.a << 8) | state.f,
    BC: (state.b << 8) | state.c,
    DE: (state.d << 8) | state.e,
    HL: (state.h << 8) | state.l,
    SP: state.sp,
    PC: state.pc,
  }
  const paused = playing || disabled || busy || state.stopped || Boolean(error)

  return (
    <details className={styles.panel} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Inspecionar CPU</summary>
      <p className={styles.explanation}>
        Pause a execução para avançar instruções. Os registradores pertencem à máquina exibida na
        tela.
      </p>
      <dl className={styles.registers}>
        {Object.entries(registers).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              <output aria-label={`Registrador ${name}`} aria-live="off">
                {hex(value)}
              </output>
            </dd>
          </div>
        ))}
      </dl>
      <dl className={styles.metrics}>
        <div>
          <dt>Ciclos</dt>
          <dd>
            <output aria-label="T-cycles executados" aria-live="off">
              {state.totalTCycles}
            </output>{' '}
            T
          </dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>
            <output aria-label="Estado da CPU" aria-live="off">
              {error ? 'Interrompida' : state.halted ? 'HALT' : state.stopped ? 'STOP' : 'Pronta'}
            </output>
          </dd>
        </div>
      </dl>
      <p className={styles.bytes}>
        Próximos bytes: {device.inspection.nextBytes.map((value) => hex(value, 2)).join(' ')}
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void advance(1)} disabled={paused}>
          Uma instrução
        </button>
        <button type="button" onClick={() => void advance(1000)} disabled={paused}>
          Até 1000 instruções
        </button>
        <button type="button" onClick={reset} disabled={disabled || busy}>
          Reiniciar CPU
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.serial}>
        <span>SAÍDA SERIAL</span>
        <pre aria-label="Saída serial">{serial || 'Aguardando saída...'}</pre>
      </div>
    </details>
  )
}
