import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowUpRight,
  CodeXml,
  Info,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import { loadCartridgeFile } from '../platform/files/load-cartridge'
import type { LoadedCartridge } from '../platform/files/load-cartridge'
import { CartridgeDetails } from '../ui/cartridge/CartridgeDetails'
import { CpuInspector } from '../ui/debug/CpuInspector'
import { createDiagnosticRom } from '../core/diagnostics/cartridge'
import { parseCartridgeHeader } from '../core/cartridge'
import { createVisualDiagnosticRom } from '../core/diagnostics/visual-cartridge'
import { GameBoy } from '../core/gameboy'
import { GameScreen } from '../ui/screen/GameScreen'
import { InputController } from '../platform/input/controller'
import { TouchControls } from '../ui/controls/TouchControls'
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

type PaletteId = (typeof palettes)[number]['id']

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
  const [paletteId, setPaletteId] = useState<PaletteId>('dmg')
  const [cartridge, setCartridge] = useState<LoadedCartridge | null>(null)
  const [cartridgeRevision, setCartridgeRevision] = useState(0)
  const [device, setDevice] = useState<GameBoy | null>(null)
  const [playing, setPlaying] = useState(false)
  const [viewRevision, setViewRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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

  const pausePlayback = useCallback(() => setPlaying(false), [])
  const playbackError = useCallback((cause: Error) => {
    setPlaying(false)
    setError(cause.message)
  }, [])
  const refreshScreen = useCallback(() => setViewRevision((value) => value + 1), [])

  useEffect(() => {
    if (!controller) return
    return controller.bindKeyboard(
      window,
      () => playing && !loading && !aboutDialog.current?.open && !cartridgeHelp.current?.open,
    )
  }, [controller, playing, loading])

  function showCartridgeHelp() {
    pausePlayback()
    cartridgeHelp.current?.showModal()
  }
  function showAbout() {
    pausePlayback()
    aboutDialog.current?.showModal()
  }

  function openCartridge(loaded: LoadedCartridge, autoplay = false) {
    const machine = loaded.metadata.isSupported ? new GameBoy(loaded.rom) : null
    setCartridge(loaded)
    setDevice(machine)
    setPlaying(Boolean(machine && autoplay))
    setCartridgeRevision((value) => value + 1)
    setError('')
  }

  function restart() {
    if (!cartridge?.metadata.isSupported) return
    setDevice(new GameBoy(cartridge.rom))
    setCartridgeRevision((value) => value + 1)
    setPlaying(false)
    setError('')
  }

  async function loadFiles(files: FileList | null) {
    const request = ++loadRequest.current
    setError('')
    setLoading(false)
    if (!files?.length) return
    if (files.length !== 1) {
      setError('Escolha um cartucho por vez.')
      return
    }
    setLoading(true)
    try {
      const loaded = await loadCartridgeFile(files[0]!)
      if (request === loadRequest.current) {
        openCartridge(loaded)
      }
    } catch (cause) {
      if (request === loadRequest.current)
        setError(cause instanceof Error ? cause.message : 'Não foi possível ler o cartucho.')
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  function useDiagnosticCartridge() {
    ++loadRequest.current
    const rom = createDiagnosticRom()
    openCartridge({ rom, metadata: parseCartridgeHeader(rom), fileName: 'pocket-test.gb' })
    setLoading(false)
  }

  function useVisualCartridge() {
    ++loadRequest.current
    const rom = createVisualDiagnosticRom()
    openCartridge({ rom, metadata: parseCartridgeHeader(rom), fileName: 'pocket-garden.gb' }, true)
    setLoading(false)
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
      <header className={styles.header}>
        <a className={styles.brand} href="#inicio" aria-label="Pocket Lab, início">
          <span className={styles.brandMark} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            pocket<span className={styles.brandLight}>lab</span>
          </span>
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
        <section className={styles.consoleSection} aria-label="Seu console">
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

            <TouchControls controller={controller} disabled={!playing || loading} />
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
                onClick={() => setPlaying((value) => !value)}
                disabled={Boolean(error)}
              >
                {playing ? (
                  <Pause size={15} aria-hidden="true" />
                ) : (
                  <Play size={15} aria-hidden="true" />
                )}
                {playing ? 'Pausar' : 'Iniciar'}
              </button>
              <button type="button" onClick={restart}>
                <RotateCcw size={15} aria-hidden="true" />
                Reiniciar
              </button>
              <span>Áudio em preparação</span>
            </div>
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
                  onClick={() => setPaletteId(item.id)}
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

          <div className={styles.cartridgePanel}>
            <div className={styles.panelHeading}>
              <span className={styles.stepNumber}>01</span>
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
              disabled={loading}
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
            <button className={styles.visualButton} type="button" onClick={useVisualCartridge}>
              Explorar jardim <Play size={14} aria-hidden="true" />
            </button>
            <button
              className={styles.diagnosticButton}
              type="button"
              onClick={useDiagnosticCartridge}
            >
              Experimentar cartucho de diagnóstico <ArrowUpRight size={13} aria-hidden="true" />
            </button>
            {cartridge && <CartridgeDetails cartridge={cartridge} />}
            <button className={styles.diagnosticButton} type="button" onClick={showCartridgeHelp}>
              Quais arquivos posso usar?
            </button>
            {device && (
              <CpuInspector
                key={cartridgeRevision}
                device={device}
                playing={playing}
                onAdvance={refreshScreen}
                onReset={restart}
              />
            )}
          </div>

          {device && (
            <p className={styles.controlHint}>
              Setas para mover · Z: botão A · X: botão B<br />
              Enter: Start · Shift: Select · ou use os botões do console
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
          experimentar as paletas e explorar nosso jardim de teste. O áudio e a demonstração de jogo
          completa chegam nas próximas etapas.
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
          Nesta etapa, a reprodução aceita cartuchos <strong>ROM Only de 32 KiB</strong>. Jogos que
          precisam de MBC1, MBC2, MBC3 ou MBC5 ainda podem ter seus dados consultados, mas o suporte
          de execução chega depois. O limite de leitura é 8 MiB.
        </p>
        <p>
          O arquivo fica no seu dispositivo e não é enviado para um servidor. Você não precisa
          fornecer BIOS nem boot ROM.
        </p>
        <p>
          Para experimentar sem arquivo, feche a ajuda e use <strong>Explorar jardim</strong>. Nosso
          jardim é um teste interativo próprio, ainda sem áudio ou saves.
        </p>
      </dialog>
    </div>
  )
}
