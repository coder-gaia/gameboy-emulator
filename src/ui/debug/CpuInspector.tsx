import { useState } from 'react'
import { Cpu } from '../../core/cpu'
import { RomOnlyCartridge } from '../../core/cartridge'
import { MemoryBus } from '../../core/memory'
import styles from './CpuInspector.module.css'

function createSession(rom: Uint8Array) {
  const bus = new MemoryBus(new RomOnlyCartridge(rom))
  return { bus, cpu: new Cpu(bus) }
}

function hex(value: number, length = 4) {
  return value.toString(16).padStart(length, '0').toUpperCase()
}

/** Execução manual limitada. A execução contínua em Worker chega com a APU. */
export function CpuInspector({ rom }: { rom: Uint8Array }) {
  const [session, setSession] = useState(() => createSession(rom))
  const [state, setState] = useState(() => session.cpu.snapshot())
  const [serial, setSerial] = useState('')
  const [error, setError] = useState('')

  function advance(count: number) {
    try {
      for (let instruction = 0; instruction < count; instruction += 1) {
        if (session.cpu.halted || session.cpu.stopped) break
        session.cpu.step()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A execução da CPU foi interrompida.')
    } finally {
      setState(session.cpu.snapshot())
      const output = session.bus.serial.drainOutput()
      setSerial((previous) => (previous + output.text).slice(-4096))
    }
  }

  function reset() {
    const next = createSession(rom)
    setSession(next)
    setState(next.cpu.snapshot())
    setSerial('')
    setError('')
  }

  const registers = {
    AF: (state.a << 8) | state.f,
    BC: (state.b << 8) | state.c,
    DE: (state.d << 8) | state.e,
    HL: (state.h << 8) | state.l,
    SP: state.sp,
    PC: state.pc,
  }
  const paused = state.halted || state.stopped || Boolean(error)

  return (
    <details className={styles.panel}>
      <summary>Inspecionar CPU</summary>
      <p className={styles.explanation}>
        Avance instruções e observe os registradores. Vídeo, timers e áudio ainda estão em
        preparação.
      </p>
      <dl className={styles.registers}>
        {Object.entries(registers).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              <output aria-label={`Registrador ${name}`}>{hex(value)}</output>
            </dd>
          </div>
        ))}
      </dl>
      <dl className={styles.metrics}>
        <div>
          <dt>Ciclos</dt>
          <dd>
            <output aria-label="T-cycles executados">{state.totalTCycles}</output> T
          </dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>
            <output aria-label="Estado da CPU">
              {error ? 'Interrompida' : state.halted ? 'HALT' : state.stopped ? 'STOP' : 'Pronta'}
            </output>
          </dd>
        </div>
      </dl>
      <p className={styles.bytes}>
        Próximos bytes:{' '}
        {[0, 1, 2].map((offset) => hex(session.bus.read8(state.pc + offset), 2)).join(' ')}
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={() => advance(1)} disabled={paused}>
          Uma instrução
        </button>
        <button type="button" onClick={() => advance(1000)} disabled={paused}>
          Até 1000 instruções
        </button>
        <button type="button" onClick={reset}>
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
