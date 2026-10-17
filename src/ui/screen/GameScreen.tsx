import { useEffect, useRef } from 'react'
import type { EmulatorClient } from '../../runtime/emulator-client'
import { CanvasRenderer } from '../../platform/rendering/canvas-renderer'
import type { ScreenPalette } from '../../platform/rendering/canvas-renderer'
import styles from './GameScreen.module.css'

interface GameScreenProps {
  device: EmulatorClient
  palette: ScreenPalette
  playing: boolean
  revision: number
  onError: (error: Error) => void
  onVisibilityPause: () => void
}

export function GameScreen({
  device,
  palette,
  playing,
  revision,
  onError,
  onVisibilityPause,
}: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (playing) canvasRef.current?.focus({ preventScroll: true })
  }, [device, playing])

  useEffect(() => {
    const canvas = canvasRef.current!
    const holder = holderRef.current!
    let renderer: CanvasRenderer
    try {
      renderer = new CanvasRenderer(canvas, palette)
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    const draw = () => {
      renderer.draw(device.framebuffer, device.frameId)
      device.noteFrameDrawn(device.frameId)
    }
    const unsubscribe = device.subscribe(draw)
    const unsubscribeError = device.subscribeError(onError)
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const scale = Math.max(
        1,
        Math.floor(
          Math.min((holder.clientWidth * ratio) / 160, (holder.clientHeight * ratio) / 144),
        ),
      )
      canvas.style.width = `${(160 * scale) / ratio}px`
      canvas.style.height = `${(144 * scale) / ratio}px`
    }
    const observer = new ResizeObserver(resize)
    observer.observe(holder)
    resize()
    draw()
    const visibility = () => {
      if (document.hidden) {
        void device.pause().catch(onError)
        onVisibilityPause()
      }
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      unsubscribe()
      unsubscribeError()
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [device, palette, playing, revision, onError, onVisibilityPause])

  useEffect(() => {
    let cancelled = false
    void (playing && !document.hidden ? device.resume() : device.pause()).catch((cause: Error) => {
      if (!cancelled) onError(cause)
    })
    return () => {
      cancelled = true
    }
  }, [device, playing, onError])

  return (
    <div className={styles.holder} ref={holderRef}>
      <canvas ref={canvasRef} width={160} height={144} aria-label="Tela do emulador" tabIndex={0}>
        Tela do Game Boy. Use os comandos de reprodução para iniciar ou pausar.
      </canvas>
    </div>
  )
}
