import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowUpRight,
  CodeXml,
  Info,
  Maximize,
  Minimize,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { loadCartridgeFile } from '../platform/files/load-cartridge'
import type { LoadedCartridge } from '../platform/files/load-cartridge'
import { CartridgeDetails } from '../ui/cartridge/CartridgeDetails'
import { CpuInspector } from '../ui/debug/CpuInspector'
import { createDiagnosticRom } from '../core/diagnostics/cartridge'
import { parseCartridgeHeader } from '../core/cartridge'
import { createVisualDiagnosticRom } from '../core/diagnostics/visual-cartridge'
import { EmulatorClient } from '../runtime/emulator-client'
import { GameScreen } from '../ui/screen/GameScreen'
import { InputController } from '../platform/input/controller'
import type { KeyboardBindings } from '../platform/input/controller'
import { bindGamepads } from '../platform/input/gamepad'
import type { GamepadStatus } from '../platform/input/gamepad'
import { loadPreferences, savePreferences } from '../platform/settings/preferences'
import type { PaletteId, Preferences } from '../platform/settings/preferences'
import { TouchControls } from '../ui/controls/TouchControls'
import { GameLibrary } from '../ui/library/GameLibrary'
import type { DemoGame } from '../platform/games/catalog'
import { loadDemo } from '../platform/games/load-demo'
import { BatteryRepository, hashRom } from '../platform/storage'
import { BatterySession } from '../runtime/battery-session'
import { AudioOutput } from '../platform/audio'
import { SaveStates } from '../ui/states/SaveStates'
import { PreferencesPanel } from '../ui/settings/PreferencesPanel'
import { keyLabel } from '../platform/input/key-label'
import styles from './App.module.css'

const palettes = [
  {
    id: 'dmg',
    name: 'DMG',
    background: '#c1ce91',
    ink: '#3c4933',
    colors: [
      [193, 206, 145],
      [149, 166, 99],
      [96, 112, 64],
      [60, 73, 51],
    ],
  },
  {
    id: 'pocket',
    name: 'Pocket',
    background: '#d5d5c9',
    ink: '#42483e',
    colors: [
      [213, 213, 201],
      [166, 170, 156],
      [108, 115, 100],
      [66, 72, 62],
    ],
  },
  {
    id: 'light',
    name: 'Light',
    background: '#a7cfc4',
    ink: '#24564e',
    colors: [
      [167, 207, 196],
      [111, 167, 153],
      [66, 122, 108],
      [36, 86, 78],
    ],
  },
] as const

function CartridgeDrawing() {
  return (
    <svg
      className={styles.cartridgeDrawing}
      width="80"
      height="72"
      viewBox="0 0 80 72"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d="M22 12H54V16H58V60H22V12Z" fill="currentColor" opacity="0.13" />
      <path d="M22 12H54V16H58V60H22V12ZM26 16V56H54V20H50V16H26Z" fill="currentColor" />
      <path d="M30 24H50V40H30V24ZM34 28V36H46V28H34Z" fill="currentColor" />
      <path d="M30 46H50V49H30V46ZM30 51H50V54H30V51Z" fill="currentColor" />
      <path d="M8 28H12V32H16V36H12V40H8V36H4V32H8V28Z" fill="currentColor" />
      <path d="M66 10H70V14H74V18H70V22H66V18H62V14H66V10Z" fill="currentColor" />
      <path d="M66 48H70V52H66V48ZM14 56H18V60H14V56Z" fill="currentColor" />
    </svg>
  )
}

export function App() {
  const [initialPreferences] = useState(() => loadPreferences())
  const [paletteId, setPaletteId] = useState<PaletteId>(initialPreferences.preferences.paletteId)
  const [keyboardBindings, setKeyboardBindings] = useState<KeyboardBindings>(
    initialPreferences.preferences.keyboardBindings,
  )
  const [preferencesNotice, setPreferencesNotice] = useState(initialPreferences.notice)
  const preferencesRef = useRef(initialPreferences.preferences)
  const updatePreferences = useCallback((update: Partial<Preferences>) => {
    const preferences = { ...preferencesRef.current, ...update }
    preferencesRef.current = preferences
    setPreferencesNotice(savePreferences(preferences))
  }, [])
  const [gamepadStatus, setGamepadStatus] = useState<GamepadStatus>({
    supported: typeof navigator.getGamepads === 'function',
    connectedCount: 0,
    message: 'Conecte um controle padrão e pressione um botão para jogar.',
  })
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenNotice, setFullscreenNotice] = useState('')
  const consoleSection = useRef<HTMLElement>(null)
  const [cartridge, setCartridge] = useState<LoadedCartridge | null>(null)
  const [cartridgeRevision, setCartridgeRevision] = useState(0)
  const [device, setDevice] = useState<EmulatorClient | null>(null)
  const [playing, setPlaying] = useState(false)
  const [viewRevision, setViewRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [stateBusy, setStateBusy] = useState(false)
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [batteryNotice, setBatteryNotice] = useState('')
  const [saveBlocked, setSaveBlocked] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioBusy, setAudioBusy] = useState(false)
  const [muted, setMuted] = useState(initialPreferences.preferences.muted)
  const [volume, setVolume] = useState(initialPreferences.preferences.volume)
  const [audioNotice, setAudioNotice] = useState('')
  const audioOutput = useRef<AudioOutput | null>(null)
  const liveDevice = useRef<EmulatorClient | null>(null)
  const batterySession = useRef<BatterySession | null>(null)
  const batteryRepository = useMemo(() => new BatteryRepository(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const loadRequest = useRef(0)
  const aboutDialog = useRef<HTMLDialogElement>(null)
  const cartridgeHelp = useRef<HTMLDialogElement>(null)
  const controller = useMemo(
    () =>
      device ? new InputController((button, pressed) => device.setButton(button, pressed)) : null,
    [device],
  )
  const palette = palettes.find((item) => item.id === paletteId) ?? palettes[0]
  const screenStyle = {
    '--lcd-background': palette.background,
    '--lcd-ink': palette.ink,
  } as CSSProperties

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === consoleSection.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  async function toggleFullscreen() {
    setFullscreenNotice('')
    try {
      if (document.fullscreenElement === consoleSection.current) await document.exitFullscreen()
      else if (document.fullscreenEnabled && consoleSection.current?.requestFullscreen)
        await consoleSection.current.requestFullscreen()
      else
        setFullscreenNotice(
          'Tela cheia não está disponível neste navegador. Você pode continuar jogando nesta página.',
        )
    } catch {
      setFullscreenNotice(
        'O navegador não permitiu abrir a tela cheia. Você pode continuar jogando nesta página.',
      )
    }
  }

  const pausePlayback = useCallback(() => {
    setPlaying(false)
    const session = batterySession.current
    void device
      ?.pause()
      .then(() => {
        if (session === batterySession.current) return session?.flush()
      })
      .catch((cause: unknown) => {
        if (session === batterySession.current)
          setBatteryNotice(
            cause instanceof Error ? cause.message : 'Não foi possível salvar o progresso.',
          )
      })
  }, [device])
  const playbackError = useCallback((cause: Error) => {
    setPlaying(false)
    setError(cause.message)
  }, [])
  const refreshScreen = useCallback(() => setViewRevision((value) => value + 1), [])

  useLayoutEffect(() => {
    liveDevice.current = device
  }, [device])

  useEffect(() => () => device?.dispose(), [device])

  const stateBusyChanged = useCallback(
    (busy: boolean) => {
      if (liveDevice.current === device) setStateBusy(busy)
    },
    [device],
  )

  useEffect(
    () => () => {
      void audioOutput.current?.dispose()
      audioOutput.current = null
    },
    [],
  )

  useEffect(() => {
    const output = audioOutput.current
    if (!audioReady || !output) return
    let cancelled = false
    const attach = device
      ? device.attachAudio(output)
      : output.pause(output.getDiagnostics().epoch + 1)
    void attach.catch((cause: unknown) => {
      if (cancelled) return
      setAudioNotice(
        cause instanceof Error
          ? cause.message
          : 'O som ficou indisponível. O jogo continua sem som.',
      )
      setAudioReady(false)
      if (audioOutput.current === output) audioOutput.current = null
      void output.dispose()
    })
    return () => {
      cancelled = true
    }
  }, [device, audioReady])

  async function toggleAudio() {
    if (audioReady && audioOutput.current) {
      audioOutput.current.setMuted(!muted)
      setMuted(!muted)
      updatePreferences({ muted: !muted })
      return
    }
    setAudioBusy(true)
    setAudioNotice('')
    const output = new AudioOutput({
      onError: (cause) => {
        if (audioOutput.current !== output) return
        setAudioNotice(`${cause.message} O jogo continua sem som.`)
        setAudioReady(false)
        audioOutput.current = null
        void (liveDevice.current?.disableAudio() ?? Promise.resolve())
          .catch(() => {})
          .finally(() => output.dispose())
      },
    })
    audioOutput.current = output
    output.setVolume(volume)
    try {
      await output.prepare()
      setMuted(false)
      updatePreferences({ muted: false })
      setAudioReady(true)
    } catch (cause) {
      setAudioNotice(
        `${cause instanceof Error ? cause.message : 'O som não está disponível neste navegador.'} O jogo continua sem som.`,
      )
      if (audioOutput.current === output) audioOutput.current = null
      await output.dispose()
    } finally {
      setAudioBusy(false)
    }
  }

  useEffect(() => {
    if (!controller) return
    return controller.bindKeyboard(
      window,
      () =>
        playing &&
        !loading &&
        !stateBusy &&
        !aboutDialog.current?.open &&
        !cartridgeHelp.current?.open,
      () => keyboardBindings,
    )
  }, [controller, playing, loading, stateBusy, keyboardBindings])

  useEffect(() => {
    if (!controller) return
    return bindGamepads(
      controller,
      window,
      () =>
        playing &&
        !loading &&
        !stateBusy &&
        !aboutDialog.current?.open &&
        !cartridgeHelp.current?.open,
      setGamepadStatus,
    )
  }, [controller, playing, loading, stateBusy])

  useEffect(() => {
    const session = batterySession.current
    if (!session || !device) return
    const flush = () => {
      if (batterySession.current !== session) return
      void session.flush().catch((cause: unknown) => {
        if (batterySession.current === session)
          setBatteryNotice(
            cause instanceof Error ? cause.message : 'Não foi possível salvar o progresso.',
          )
      })
    }
    const visibility = () => {
      if (document.hidden) flush()
    }
    const interval = window.setInterval(flush, 2000)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
      flush()
    }
  }, [device])

  useEffect(() => {
    const session = batterySession.current
    if (!playing)
      void session?.flush().catch((cause: unknown) => {
        if (batterySession.current === session)
          setBatteryNotice(
            cause instanceof Error ? cause.message : 'Não foi possível salvar o progresso.',
          )
      })
  }, [playing])

  useEffect(() => {
    if (device && activeGameId)
      document.querySelector('canvas')?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
  }, [device, activeGameId])

  function showCartridgeHelp() {
    pausePlayback()
    cartridgeHelp.current?.showModal()
  }
  function showAbout() {
    pausePlayback()
    aboutDialog.current?.showModal()
  }

  async function openCartridge(
    loaded: LoadedCartridge,
    autoplay = false,
    request = loadRequest.current,
    gameId: string | null = null,
  ) {
    setPlaying(false)
    try {
      await device?.pause().catch(() => {})
      await batterySession.current?.flush()
    } catch (cause) {
      if (request !== loadRequest.current) return
      setSaveBlocked(true)
      throw new Error(
        `${cause instanceof Error ? cause.message : 'Não foi possível salvar o progresso.'} Seu cartucho foi mantido. Tente novamente ou escolha Continuar sem salvar antes de trocar.`,
        { cause },
      )
    }
    if (request !== loadRequest.current) return
    const machine = loaded.metadata.isSupported ? await EmulatorClient.create(loaded.rom) : null
    let session: BatterySession | null = null
    let notice = ''
    if (machine && machine.exportBatteryRam() !== null) {
      try {
        session = new BatterySession(batteryRepository, await hashRom(loaded.rom), machine)
        const restored = await session.restore()
        notice = restored
          ? 'Progresso recuperado. Ele continua sendo salvo neste navegador.'
          : 'O progresso será salvo automaticamente neste navegador.'
      } catch (cause) {
        session = null
        notice = `${cause instanceof Error ? cause.message : 'Não foi possível abrir o save.'} O progresso desta sessão não será salvo automaticamente.`
      }
    }
    if (request !== loadRequest.current) {
      machine?.dispose()
      return
    }
    batterySession.current = session
    setSaveBlocked(false)
    setBatteryNotice(notice)
    setActiveGameId(gameId)
    setCartridge(loaded)
    device?.dispose()
    setDevice(machine)
    setStateBusy(false)
    setPlaying(Boolean(machine && autoplay))
    setCartridgeRevision((value) => value + 1)
    setError('')
  }

  async function restart() {
    if (stateBusy || !cartridge?.metadata.isSupported) return
    const request = ++loadRequest.current
    setPlaying(false)
    setLoading(true)
    try {
      await openCartridge(cartridge, false, request, activeGameId)
    } catch (cause) {
      if (request === loadRequest.current)
        setError(cause instanceof Error ? cause.message : 'Não foi possível reiniciar o cartucho.')
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  async function loadFiles(files: FileList | null) {
    if (stateBusy) return
    const request = ++loadRequest.current
    setError('')
    setLoading(false)
    if (!files?.length) return
    if (files.length !== 1) {
      setError('Escolha um cartucho por vez.')
      return
    }
    setLoading(true)
    setPlaying(false)
    try {
      const loaded = await loadCartridgeFile(files[0]!)
      if (request === loadRequest.current) {
        await openCartridge(loaded, false, request)
      }
    } catch (cause) {
      if (request === loadRequest.current)
        setError(cause instanceof Error ? cause.message : 'Não foi possível ler o cartucho.')
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  async function openFixture(rom: Uint8Array, fileName: string, autoplay: boolean) {
    if (stateBusy || loading) return
    const request = ++loadRequest.current
    setPlaying(false)
    setLoading(true)
    try {
      await openCartridge({ rom, metadata: parseCartridgeHeader(rom), fileName }, autoplay, request)
    } catch (cause) {
      if (request === loadRequest.current)
        setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o cartucho.')
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  function openDiagnosticCartridge() {
    void openFixture(createDiagnosticRom(), 'pocket-test.gb', false)
  }
  function openVisualCartridge() {
    void openFixture(createVisualDiagnosticRom(), 'pocket-garden.gb', true)
  }

  async function openDemo(game: DemoGame) {
    if (stateBusy || loading) return
    const request = ++loadRequest.current
    setPlaying(false)
    setLoading(true)
    setError('')
    try {
      await openCartridge(await loadDemo(game), true, request, game.id)
    } catch (cause) {
      if (request === loadRequest.current)
        setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o jogo.')
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  return (
    <div
      className={styles.page}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        void loadFiles(event.dataTransfer.files)
      }}
    >
      <a className={styles.skipLink} href="#jogar">
        Ir para o console
      </a>
      <header className={styles.header}>
        <a
          className={styles.brand}
          href="#inicio"
          aria-label="pocketlab, um projeto de bolso, início"
        >
          <span className={styles.brandMark} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            pocket<span className={styles.brandLight}>lab</span>
          </span>{' '}
          <span className={styles.brandBadge}>um projeto de bolso</span>
        </a>
        <nav className={styles.navigation} aria-label="Navegação principal">
          <button className={styles.aboutButton} type="button" onClick={showAbout}>
            <Info size={15} aria-hidden="true" />
            Sobre
          </button>
          <a
            className={styles.githubLink}
            href="https://github.com/coder-gaia/gameboy-emulator"
            target="_blank"
            rel="noreferrer"
            aria-label="Ver projeto no GitHub, abre em nova aba"
          >
            <CodeXml size={18} aria-hidden="true" />
            <span>GitHub</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </nav>
      </header>

      <main className={styles.main} id="inicio">
        <section
          className={styles.consoleSection}
          aria-label="Seu console"
          id="jogar"
          ref={consoleSection}
          tabIndex={-1}
        >
          <div className={styles.benchLabel}>
            <span>POCKET LAB / 001</span>
            <span className={styles.benchLine} />
            <span>ESTAÇÃO DE JOGO</span>
          </div>

          <div className={styles.console}>
            <div className={styles.consoleTop}>
              <span className={styles.deviceLabel}>POCKET LAB</span>
              <span className={styles.powerLabel}>
                <span className={styles.powerLight} />
                {device
                  ? playing
                    ? 'EM EXECUÇÃO'
                    : 'PAUSADO'
                  : cartridge
                    ? 'CARTUCHO LIDO'
                    : 'EM ESPERA'}
              </span>
            </div>

            <div className={styles.screenFrame}>
              <div className={styles.screenRimLabel} aria-hidden="true">
                <span />
                MATRIZ DE PONTOS, UM POUCO DE MAGIA
                <span />
              </div>
              <div
                className={`${styles.screen} ${device ? styles.screenActive : ''}`}
                style={screenStyle}
              >
                {device ? (
                  <GameScreen
                    device={device}
                    palette={palette.colors}
                    playing={playing}
                    revision={viewRevision}
                    onError={playbackError}
                    onVisibilityPause={pausePlayback}
                  />
                ) : (
                  <div className={styles.screenContent}>
                    <span className={styles.screenEyebrow}>
                      {cartridge ? 'BOM TE VER POR AQUI.' : 'OLÁ, JOGADOR.'}
                    </span>
                    <CartridgeDrawing />
                    <p>
                      {cartridge ? (
                        cartridge.metadata.title
                      ) : (
                        <>
                          Seu próximo mundo
                          <br />
                          começa aqui.
                        </>
                      )}
                    </p>
                    <span className={styles.screenPrompt}>
                      {cartridge ? 'REPRODUÇÃO EM PREPARAÇÃO' : 'AGUARDANDO CARTUCHO'}
                    </span>
                  </div>
                )}
              </div>
              <div className={styles.screenBottomLabel} aria-hidden="true">
                <span>160 × 144</span>
                <span>CONSOLE DE BOLSO</span>
              </div>
            </div>

            <TouchControls controller={controller} disabled={!playing || loading || stateBusy} />
            <div className={styles.consoleBottom} aria-hidden="true">
              <span>BOAS HISTÓRIAS CABEM NO BOLSO.</span>
              <div className={styles.speaker}>
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>

          {device && (
            <div className={styles.transport} role="group" aria-label="Reprodução">
              <button
                type="button"
                onClick={() => (playing ? pausePlayback() : setPlaying(true))}
                disabled={Boolean(error) || loading || stateBusy}
              >
                {playing ? (
                  <Pause size={15} aria-hidden="true" />
                ) : (
                  <Play size={15} aria-hidden="true" />
                )}
                {playing ? 'Pausar' : 'Iniciar'}
              </button>
              <button type="button" onClick={() => void restart()} disabled={loading || stateBusy}>
                <RotateCcw size={15} aria-hidden="true" />
                Reiniciar
              </button>
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                disabled={loading || stateBusy}
              >
                {fullscreen ? (
                  <Minimize size={15} aria-hidden="true" />
                ) : (
                  <Maximize size={15} aria-hidden="true" />
                )}
                {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              </button>
              <div className={styles.soundControls}>
                <button
                  type="button"
                  onClick={() => void toggleAudio()}
                  disabled={audioBusy || stateBusy}
                  aria-pressed={audioReady && !muted}
                >
                  {audioReady && !muted ? (
                    <Volume2 size={15} aria-hidden="true" />
                  ) : (
                    <VolumeX size={15} aria-hidden="true" />
                  )}
                  {audioBusy ? 'Abrindo som...' : audioReady && !muted ? 'Silenciar' : 'Ativar som'}
                </button>
                <label className={styles.volumeControl}>
                  <span className="sr-only">Volume</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume * 100}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value) / 100
                      setVolume(next)
                      updatePreferences({ volume: next })
                      audioOutput.current?.setVolume(next)
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {audioNotice && (
            <p className={styles.controlHint} role="status" aria-label="Estado do áudio">
              {audioNotice}
            </p>
          )}
          {fullscreenNotice && (
            <p className={styles.controlHint} role="status" aria-label="Estado da tela cheia">
              {fullscreenNotice}
            </p>
          )}

          <div className={styles.paletteBar}>
            <div className={styles.paletteLabel}>
              <span className={styles.tinyLabel}>UM OUTRO TOM</span>
              <span>Escolha sua tela</span>
            </div>
            <div className={styles.paletteOptions} role="group" aria-label="Paleta da tela">
              {palettes.map((item) => (
                <button
                  key={item.id}
                  className={`${styles.paletteButton} ${item.id === paletteId ? styles.paletteSelected : ''}`}
                  type="button"
                  aria-pressed={item.id === paletteId}
                  onClick={() => {
                    setPaletteId(item.id)
                    updatePreferences({ paletteId: item.id })
                  }}
                >
                  <span
                    className={styles.paletteSwatch}
                    style={{ backgroundColor: item.background, color: item.ink }}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.introduction} aria-labelledby="welcome-title">
          <p className={styles.eyebrow}>
            <span />
            GAME BOY, DE NOVO POR AQUI.
          </p>
          <h1 id="welcome-title">
            Uma pequena
            <br />
            pausa. Um <br />
            mundo inteiro.
          </h1>
          <p className={styles.description}>
            O encanto de um console de bolso, em um cantinho do seu navegador. Escolha um cartucho e
            siga a sua curiosidade.
          </p>

          <GameLibrary
            loading={loading || stateBusy}
            activeGameId={activeGameId}
            onSelect={(game) => void openDemo(game)}
          />
          <div className={styles.cartridgePanel}>
            <div className={styles.panelHeading}>
              <span className={styles.stepNumber}>02</span>
              <div>
                <h2>Todo mundo começa com um cartucho.</h2>
                <p>Seu arquivo. Sua próxima aventura.</p>
              </div>
            </div>
            <input
              className="sr-only"
              ref={fileInput}
              type="file"
              accept=".gb,.gbc"
              aria-label="Arquivo do cartucho"
              tabIndex={-1}
              onChange={(event) => {
                void loadFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
            <button
              className={styles.loadButton}
              type="button"
              disabled={loading || stateBusy}
              onClick={() => fileInput.current?.click()}
              aria-describedby="cartridge-help"
            >
              <Upload size={18} aria-hidden="true" />
              {loading ? 'Lendo cartucho...' : cartridge ? 'Trocar cartucho' : 'Carregar cartucho'}
              <span className={styles.buttonFileType}>.gb</span>
            </button>
            <p className={styles.preparationNote} id="cartridge-help">
              <span aria-hidden="true" />
              ou arraste um arquivo .gb para a página
            </p>
            {error && (
              <p className={styles.loadError} role="alert">
                {error}
              </p>
            )}
            {saveBlocked && (
              <button
                className={styles.diagnosticButton}
                type="button"
                onClick={() => {
                  batterySession.current = null
                  setSaveBlocked(false)
                  setError('')
                  setBatteryNotice(
                    'Salvamento desativado nesta sessão. O progresso atual será perdido ao trocar ou fechar o cartucho.',
                  )
                }}
              >
                Continuar sem salvar
              </button>
            )}
            <button
              className={styles.visualButton}
              type="button"
              onClick={openVisualCartridge}
              disabled={loading || stateBusy}
            >
              Explorar jardim <Play size={14} aria-hidden="true" />
            </button>
            <button
              className={styles.diagnosticButton}
              type="button"
              onClick={openDiagnosticCartridge}
              disabled={loading || stateBusy}
            >
              Experimentar cartucho de diagnóstico <ArrowUpRight size={13} aria-hidden="true" />
            </button>
            {cartridge && <CartridgeDetails cartridge={cartridge} />}
            {batteryNotice && (
              <p className={styles.controlHint} role="status" aria-label="Estado do progresso">
                {batteryNotice}
              </p>
            )}
            <button className={styles.diagnosticButton} type="button" onClick={showCartridgeHelp}>
              Quais arquivos posso usar?
            </button>
            {device && (
              <CpuInspector
                key={cartridgeRevision}
                device={device}
                playing={playing}
                disabled={loading || stateBusy}
                onAdvance={refreshScreen}
                onReset={() => void restart()}
              />
            )}
          </div>

          {device && (
            <SaveStates
              key={device.instanceId}
              device={device}
              title={cartridge?.metadata.title ?? 'cartucho'}
              disabled={loading || audioBusy}
              onBusyChange={stateBusyChanged}
              onPause={async () => {
                if (liveDevice.current !== device) throw new Error('O cartucho foi trocado.')
                setPlaying(false)
                controller?.releaseAll()
                await device.pause()
              }}
              onLoaded={() => {
                if (liveDevice.current !== device) return
                controller?.releaseAll()
                setCartridgeRevision((value) => value + 1)
                const session = batterySession.current
                void session?.flush().catch((cause: unknown) => {
                  if (session === batterySession.current)
                    setBatteryNotice(
                      cause instanceof Error
                        ? cause.message
                        : 'Não foi possível salvar o progresso.',
                    )
                })
              }}
            />
          )}

          <PreferencesPanel
            bindings={keyboardBindings}
            onBindingsChange={(bindings) => {
              controller?.releaseAll()
              setKeyboardBindings(bindings)
              updatePreferences({ keyboardBindings: bindings })
            }}
            onOpen={pausePlayback}
            gamepad={gamepadStatus}
            notice={preferencesNotice}
          />

          {device && (
            <p className={styles.controlHint}>
              {keyboardBindings.up.map(keyLabel).join('/')}{' '}
              {keyboardBindings.down.map(keyLabel).join('/')}{' '}
              {keyboardBindings.left.map(keyLabel).join('/')}{' '}
              {keyboardBindings.right.map(keyLabel).join('/')}: mover ·{' '}
              {keyboardBindings.a.map(keyLabel).join('/')}: botão A ·{' '}
              {keyboardBindings.b.map(keyLabel).join('/')}: botão B<br />
              {keyboardBindings.start.map(keyLabel).join('/')}: Start ·{' '}
              {keyboardBindings.select.map(keyLabel).join('/')}: Select · ou use os botões do
              console
            </p>
          )}

          <p className={styles.privacyNote}>
            <LockKeyhole size={16} aria-hidden="true" />
            <span>
              Feito para jogar localmente.
              <br />
              Seus cartuchos ficam com você.
            </span>
          </p>
          <div className={styles.marginNote} aria-hidden="true">
            <span className={styles.noteStar}>✳</span>
            <span>
              Quatro tons de nostalgia.
              <br />
              Uma nova forma de voltar.
            </span>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>
          <span className={styles.footerDot} aria-hidden="true" />
          Tudo acontece no seu navegador
        </p>
        <span className={styles.footerMiddle}>PEQUENO NA TELA. GRANDE NA MEMÓRIA.</span>
        <a href="https://github.com/coder-gaia/gameboy-emulator" target="_blank" rel="noreferrer">
          Feito com curiosidade <ArrowUpRight size={13} aria-hidden="true" />
          <span className="sr-only">, veja o GitHub em uma nova aba</span>
        </a>
      </footer>

      <dialog ref={aboutDialog} className={styles.dialog} aria-labelledby="about-title">
        <button
          className={styles.closeButton}
          type="button"
          aria-label="Fechar sobre o projeto"
          onClick={() => aboutDialog.current?.close()}
        >
          <X size={20} aria-hidden="true" />
        </button>
        <p className={styles.tinyLabel}>PRAZER, POCKET LAB.</p>
        <h2 id="about-title">Uma ideia que cabe no bolso.</h2>
        <p>
          Um emulador de Game Boy feito para explorar a tecnologia por trás de um pequeno console e
          trazer suas histórias para o navegador.
        </p>
        <p>
          O projeto está em desenvolvimento. Você já pode ler cartuchos, consultar seus dados e
          experimentar as paletas, jogar nossa seleção de homebrews e explorar o jardim de teste.
          Ative o som pelos controles do console e ajuste o volume como preferir.
        </p>
        <p>Nenhum jogo comercial ou boot ROM original faz parte do projeto.</p>
        <a
          className={styles.dialogLink}
          href="https://github.com/coder-gaia/gameboy-emulator"
          target="_blank"
          rel="noreferrer"
        >
          Acompanhar no GitHub <ArrowUpRight size={16} aria-hidden="true" />
          <span className="sr-only">, abre em nova aba</span>
        </a>
      </dialog>
      <dialog ref={cartridgeHelp} className={styles.dialog} aria-labelledby="cartridge-help-title">
        <button
          className={styles.closeButton}
          type="button"
          aria-label="Fechar ajuda de cartuchos"
          onClick={() => cartridgeHelp.current?.close()}
        >
          <X size={20} aria-hidden="true" />
        </button>
        <p className={styles.tinyLabel}>SEU PRÓPRIO CARTUCHO</p>
        <h2 id="cartridge-help-title">Um arquivo. Um novo mundo.</h2>
        <p>
          Escolha um jogo do Game Boy original em arquivo <strong>.gb</strong>. Arquivos{' '}
          <strong>.gbc</strong> só funcionam quando o jogo também é compatível com o Game Boy
          original.
        </p>
        <p>
          Se estiver em <strong>.zip</strong>, extraia o arquivo antes. Trocar a extensão de outro
          arquivo não o transforma em um jogo.
        </p>
        <p>
          A reprodução aceita <strong>ROM Only de 32 KiB</strong> e{' '}
          <strong>MBC1 de até 2 MiB</strong>, com até 32 KiB de RAM conforme a configuração do
          cartucho. MBC2, MBC3 e MBC5 ainda podem ter seus dados consultados, mas o suporte de
          execução chega depois. O limite de leitura é 8 MiB.
        </p>
        <p>
          O arquivo fica no seu dispositivo e não é enviado para um servidor. Você não precisa
          fornecer BIOS nem boot ROM.
        </p>
        <p>
          Para experimentar sem arquivo, escolha <strong>Tobu Tobu Girl</strong> ou{' '}
          <strong>2048</strong>
          na seleção de jogos. Cartuchos com bateria salvam o progresso neste navegador. O jardim é
          um teste interativo próprio e não tem trilha sonora. Use os slots para guardar um ponto
          exato da partida ou exporte um arquivo .pocketstate como cópia.
        </p>
      </dialog>
    </div>
  )
}
