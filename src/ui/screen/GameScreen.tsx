import { useEffect, useRef } from 'react'
import type { GameBoy } from '../../core/gameboy'
import { CanvasRenderer } from '../../platform/rendering/canvas-renderer'
import type { ScreenPalette } from '../../platform/rendering/canvas-renderer'
import { BrowserPlayback } from '../../runtime/playback'
import styles from './GameScreen.module.css'

interface GameScreenProps {
  device: GameBoy
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
    const canvas = canvasRef.current!
    const holder = holderRef.current!
    let renderer: CanvasRenderer
    try {
      renderer = new CanvasRenderer(canvas, palette)
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    const draw = () => renderer.draw(device.framebuffer, device.frameId)
    const playback = new BrowserPlayback(device, draw, onError)
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
        playback.pause()
        onVisibilityPause()
      }
    }
    document.addEventListener('visibilitychange', visibility)
    if (playing && !document.hidden) playback.start()
    return () => {
      playback.pause()
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [device, palette, playing, revision, onError, onVisibilityPause])

  return (
    <div className={styles.holder} ref={holderRef}>
      <canvas ref={canvasRef} width={160} height={144} aria-label="Tela do emulador">
        Tela do Game Boy. Use os comandos de reprodução para iniciar ou pausar.
      </canvas>
    </div>
  )
}
