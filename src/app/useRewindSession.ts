import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EmulatorClient } from '../runtime/emulator-client'

interface Options {
  device: EmulatorClient | null
  playing: boolean
  disabled: boolean
  releaseInputs: () => void
  setPlaying: (playing: boolean) => void
  flushBattery: () => Promise<void>
  canResume: () => boolean
}
interface Session {
  device: EmulatorClient
  sources: Set<string>
  wasPlaying: boolean
  allowResume: boolean
  finishing: boolean
  beginning: Promise<void>
}

export function useRewindSession(options: Options) {
  const latest = useRef(options)
  const mounted = useRef(true)
  const session = useRef<Session | null>(null)
  const configuring = useRef<EmulatorClient | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [configuringDevice, setConfiguringDevice] = useState<EmulatorClient | null>(null)
  const [message, setMessage] = useState<{ device: EmulatorClient; text: string } | null>(null)

  useLayoutEffect(() => {
    latest.current = options
  }, [options])
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const finish = useCallback((current: Session, resume: boolean) => {
    if (!resume) current.allowResume = false
    if (current.finishing) return
    current.finishing = true
    void (async () => {
      let restored = false
      let failure = ''
      try {
        await current.beginning
      } catch (cause) {
        current.allowResume = false
        failure = cause instanceof Error ? cause.message : 'Não foi possível iniciar o rewind.'
      }
      try {
        await current.device.endRewind()
        restored = true
      } catch (cause) {
        current.allowResume = false
        failure = cause instanceof Error ? cause.message : 'Não foi possível concluir o rewind.'
      }
      if (session.current !== current) return
      const context = latest.current
      if (mounted.current && context.device === current.device) context.releaseInputs()
      if (restored && mounted.current && context.device === current.device) {
        try {
          await context.flushBattery()
        } catch (cause) {
          failure = `O ponto foi recuperado, mas o progresso não pôde ser gravado. ${cause instanceof Error ? cause.message : ''}`
        }
      }
      if (session.current !== current) return
      session.current = null
      if (!mounted.current) return
      setActiveSession(null)
      if (latest.current.device !== current.device) return
      const canResume =
        restored &&
        current.wasPlaying &&
        current.allowResume &&
        !latest.current.disabled &&
        latest.current.canResume() &&
        !document.hidden &&
        document.hasFocus()
      setMessage({
        device: current.device,
        text:
          failure ||
          (canResume
            ? 'Voltamos no tempo. A partida continua desse ponto.'
            : 'Rewind encerrado em pausa. Use Iniciar para continuar desse ponto.'),
      })
      if (canResume) latest.current.setPlaying(true)
    })()
  }, [])

  const canBegin = useCallback(() => {
    const context = latest.current
    if (session.current?.device === context.device && session.current)
      return !session.current.finishing
    return Boolean(
      context.device &&
      !context.disabled &&
      configuring.current !== context.device &&
      context.device.rewind.enabled &&
      context.device.rewind.availableSeconds > 0,
    )
  }, [])

  const begin = useCallback(
    (source: string) => {
      const context = latest.current
      const device = context.device
      if (!device || !canBegin()) return
      const existing = session.current
      if (existing?.device === device) {
        existing.sources.add(source)
        return
      }
      if (existing) existing.allowResume = false
      const current: Session = {
        device,
        sources: new Set([source]),
        wasPlaying: context.playing,
        allowResume: true,
        finishing: false,
        beginning: Promise.resolve(),
      }
      session.current = current
      setActiveSession(current)
      setMessage({ device, text: 'Voltando no tempo. Solte para escolher este ponto.' })
      context.releaseInputs()
      context.setPlaying(false)
      current.beginning = (async () => {
        await device.pause()
        if (session.current !== current || latest.current.device !== device)
          throw new Error('O cartucho foi trocado.')
        await device.beginRewind()
      })()
      void current.beginning.catch(() => finish(current, false))
    },
    [canBegin, finish],
  )

  const end = useCallback(
    (source: string, resume: boolean) => {
      const current = session.current
      if (!current || !current.sources.has(source)) return
      current.sources.delete(source)
      if (!resume) current.sources.clear()
      if (current.sources.size === 0) finish(current, resume)
    },
    [finish],
  )

  const cancel = useCallback(() => {
    const current = session.current
    if (!current) return
    current.sources.clear()
    finish(current, false)
  }, [finish])

  const toggle = useCallback(() => {
    const context = latest.current
    const device = context.device
    if (!device || context.disabled || session.current || configuring.current === device) return
    configuring.current = device
    setConfiguringDevice(device)
    const enabled = !device.rewind.enabled
    void device
      .setRewindEnabled(enabled)
      .then(() => {
        if (!mounted.current || latest.current.device !== device) return
        setMessage({
          device,
          text: enabled
            ? 'Rewind ativado. Jogue para guardar os próximos segundos.'
            : 'Rewind desativado. O histórico desta aba foi descartado.',
        })
        if (latest.current.playing)
          document
            .querySelector<HTMLCanvasElement>('canvas[aria-label="Tela do emulador"]')
            ?.focus({ preventScroll: true })
      })
      .catch((cause: unknown) => {
        if (mounted.current && latest.current.device === device)
          setMessage({
            device,
            text: cause instanceof Error ? cause.message : 'Não foi possível alterar o rewind.',
          })
      })
      .finally(() => {
        if (configuring.current === device) configuring.current = null
        if (mounted.current)
          setConfiguringDevice((current) => (current === device ? null : current))
      })
  }, [])

  const step = useCallback(() => {
    begin('activation')
    end('activation', true)
  }, [begin, end])
  const isActive = useCallback(() => session.current !== null, [])

  useEffect(() => {
    const blur = () => cancel()
    const visibility = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
      cancel()
    }
  }, [cancel])

  useEffect(() => {
    const device = options.device
    if (!device) return
    const unsubscribe = device.subscribeError(cancel)
    return () => {
      unsubscribe()
      if (session.current?.device === device) cancel()
    }
  }, [options.device, cancel])

  return {
    active: activeSession !== null && activeSession.device === options.device,
    configuring: configuringDevice !== null && configuringDevice === options.device,
    notice: message?.device === options.device ? message.text : '',
    begin,
    end,
    cancel,
    toggle,
    step,
    canBegin,
    isActive,
  }
}
