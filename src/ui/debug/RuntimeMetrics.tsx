import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmulatorClient } from '../../runtime/emulator-client'
import { measurePerformance } from '../../runtime/performance-sampler'
import type { PerformanceInterval, PerformancePoint } from '../../runtime/performance-sampler'
import type { AudioDiagnostics } from '../../platform/audio'
import styles from './RuntimeMetrics.module.css'
import { APP_VERSION } from '../../app/version'

interface Measurement {
  started: PerformancePoint
  samples: { point: PerformancePoint; interval: PerformanceInterval }[]
}

interface DiagnosticReport {
  version: 1
  appVersion: string
  generatedAt: string
  browser: string
  viewport: { width: number; height: number; pixelRatio: number }
  romId: string
  outcome: string
  limitation: string
  summary: PerformanceInterval
  measurement: Measurement
}

function number(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Indisponível'
    : value.toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function milliseconds(frames: number | undefined, rate: number | undefined): string {
  return rate && frames !== undefined ? `${number((frames / rate) * 1000)} ms` : 'Indisponível'
}

export function RuntimeMetrics({
  device,
  active,
  disabled,
  getAudio,
}: {
  device: EmulatorClient
  active: boolean
  disabled: boolean
  getAudio: () => AudioDiagnostics | null
}) {
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<{
    point: PerformancePoint
    interval: PerformanceInterval | null
  } | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [status, setStatus] = useState('')
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const measurement = useRef<Measurement | null>(null)

  const read = useCallback(
    (): PerformancePoint => ({
      at: performance.now(),
      tCycles: device.inspection.cpu.totalTCycles,
      frameId: device.inspection.frameId,
      drawnFrames: device.drawnFrames,
      machineEpoch: device.inspection.audioEpoch,
      playing: device.inspection.playing,
      rewinding: device.rewind.active,
      audio: getAudio(),
      presentation: device.getPresentationDiagnostics(),
      audioProducer: device.inspection.audioProducer,
    }),
    [device, getAudio],
  )

  const finish = useCallback(
    (outcome: string) => {
      const current = measurement.current
      if (!current) return
      measurement.current = null
      const last = current.samples.at(-1)?.point ?? current.started
      setRecording(false)
      setStatus(outcome)
      setReport({
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
        romId: device.romId,
        outcome,
        limitation:
          'Velocidade usa T-cycles e tempo da página. Quadros desenhados contam imagens distintas enviadas ao Canvas, sem comprovar FPS físico. Amostras de áudio são periódicas e podem perder picos. O relatório não contém ROM, memória ou progresso do jogo.',
        summary: measurePerformance(current.started, last),
        measurement: current,
      })
    },
    [device],
  )

  useEffect(() => {
    if (!active || !open || disabled) return
    let previous = read()
    const sample = () => {
      if (document.hidden) return
      const point = read()
      const interval = measurePerformance(previous, point)
      previous = point
      setLive({ point, interval })
      const current = measurement.current
      if (!current) return
      const measuredInterval = measurePerformance(
        current.samples.at(-1)?.point ?? current.started,
        point,
      )
      current.samples.push({ point, interval: measuredInterval })
      const elapsed = Math.max(0, (point.at - current.started.at) / 1000)
      setSeconds(Math.min(60, elapsed))
      if (measuredInterval.interrupted)
        finish('Medição interrompida por pausa ou mudança da sessão.')
      else if (elapsed >= 60) finish('Medição de 60 segundos concluída.')
    }
    const interval = window.setInterval(sample, 1000)
    const visibility = () => {
      if (document.hidden) finish('Medição interrompida ao ocultar a página.')
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visibility)
      finish('Medição interrompida ao fechar ou indisponibilizar o painel.')
    }
  }, [active, open, disabled, read, finish])

  function start() {
    const point = read()
    measurement.current = { started: point, samples: [] }
    setRecording(true)
    setSeconds(0)
    setReport(null)
    setLive({ point, interval: null })
    setStatus('Medindo. Continue jogando com a página visível e sem pausar.')
  }

  function exportReport() {
    if (!report) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'pocket-lab-diagnostico.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const audio = live?.point.audio
  const interval = live?.interval
  const metrics = {
    'Velocidade emulada':
      interval?.speedPercent == null
        ? 'Em pausa ou aguardando'
        : `${number(interval.speedPercent)}%`,
    'Quadros desenhados/s': number(interval?.drawnFramesPerSecond),
    'T-cycles observados': number(live?.point.tCycles, 0),
    'Taxa de áudio': audio?.sampleRate ? `${number(audio.sampleRate, 0)} Hz` : 'Som não ativado',
    'Estado do áudio': audio?.contextState ?? 'Som não ativado',
    'Fila PCM': audio?.connected
      ? `${number(audio.queuedFrames, 0)} frames (${milliseconds(audio.queuedFrames, audio.sampleRate)})`
      : 'Indisponível',
    'Alvo PCM': milliseconds(audio?.targetFrames, audio?.sampleRate),
    'Ida e volta PCM': milliseconds(audio?.roundTripFrames, audio?.sampleRate),
    'Maior ida e volta PCM': milliseconds(audio?.peakRoundTripFrames, audio?.sampleRate),
    'Frames ausentes na geração': audio?.connected
      ? number(audio.underrunFrames, 0)
      : 'Indisponível',
    'Frames descartados na geração': audio?.connected
      ? number(audio.droppedFrames, 0)
      : 'Indisponível',
    'Latência base informada':
      audio?.baseLatencySeconds == null
        ? 'Indisponível'
        : `${number(audio.baseLatencySeconds * 1000)} ms`,
    'Latência de saída informada':
      audio?.outputLatencySeconds == null
        ? 'Indisponível'
        : `${number(audio.outputLatencySeconds * 1000)} ms`,
  }

  return (
    <details className={styles.panel} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Desempenho e áudio</summary>
      <p className={styles.hint}>
        Velocidade e quadros desenhados são medidas diferentes. Aguarde dez segundos depois de
        ativar o som antes de medir. Os contadores de áudio reiniciam ao pausar ou reconectar.
      </p>
      <dl className={styles.metrics}>
        {Object.entries(metrics).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <output aria-label={label} aria-live="off">
                {value}
              </output>
            </dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        <button
          type="button"
          onClick={start}
          disabled={recording || disabled || !live?.point.playing || live.point.rewinding}
        >
          Medir por 60 segundos
        </button>
        <button
          type="button"
          onClick={() => finish('Medição encerrada pelo usuário.')}
          disabled={!recording}
        >
          Encerrar medição
        </button>
        <button type="button" onClick={exportReport} disabled={!report}>
          Exportar diagnóstico
        </button>
      </div>
      {recording && <progress aria-label="Progresso da medição" value={seconds} max={60} />}
      {status && (
        <p role="status" className={styles.hint}>
          {status}
        </p>
      )}
      {report && (
        <p className={styles.hint}>
          Janela: {number(report.summary.elapsedSeconds)} s. Velocidade média:{' '}
          {number(report.summary.speedPercent)}%. Quadros desenhados/s:{' '}
          {number(report.summary.drawnFramesPerSecond)}. Frames ausentes:{' '}
          {number(report.summary.underrunFrames, 0)}. Descartados:{' '}
          {number(report.summary.droppedFrames, 0)}.
        </p>
      )}
      <p className={styles.hint}>
        O relatório JSON fica no seu dispositivo e não contém ROM, memória ou progresso. A fila pode
        superar o alvo ao absorver variações de atraso, com maior latência de saída.
      </p>
    </details>
  )
}
