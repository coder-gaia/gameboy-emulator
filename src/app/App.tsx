import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpRight, CodeXml, Info, LockKeyhole, Upload, X } from 'lucide-react'
import styles from './App.module.css'

const palettes = [
  { id: 'dmg', name: 'DMG', note: 'DMG', background: '#c1ce91', ink: '#3c4933' },
  { id: 'pocket', name: 'Pocket', note: 'GBP', background: '#d5d5c9', ink: '#42483e' },
  { id: 'light', name: 'Light', note: 'GBL', background: '#a7cfc4', ink: '#24564e' },
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
  const aboutDialog = useRef<HTMLDialogElement>(null)
  const palette = palettes.find((item) => item.id === paletteId) ?? palettes[0]
  const screenStyle = {
    '--lcd-background': palette.background,
    '--lcd-ink': palette.ink,
  } as CSSProperties

  return (
    <div className={styles.page}>
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
          <button
            className={styles.aboutButton}
            type="button"
            onClick={() => aboutDialog.current?.showModal()}
          >
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
                EM ESPERA
              </span>
            </div>

            <div className={styles.screenFrame}>
              <div className={styles.screenRimLabel} aria-hidden="true">
                <span />
                MATRIZ DE PONTOS, UM POUCO DE MAGIA
                <span />
              </div>
              <div className={styles.screen} style={screenStyle}>
                <div className={styles.screenContent}>
                  <span className={styles.screenEyebrow}>OLÁ, JOGADOR.</span>
                  <CartridgeDrawing />
                  <p>
                    Seu próximo mundo
                    <br />
                    começa aqui.
                  </p>
                  <span className={styles.screenPrompt}>AGUARDANDO CARTUCHO</span>
                </div>
              </div>
              <div className={styles.screenBottomLabel} aria-hidden="true">
                <span>160 × 144</span>
                <span>CONSOLE DE BOLSO</span>
              </div>
            </div>

            <div className={styles.consoleControls} aria-hidden="true">
              <div className={styles.dpad}>
                <span className={styles.dpadHorizontal} />
                <span className={styles.dpadVertical} />
                <span className={styles.dpadCenter} />
              </div>
              <div className={styles.menuButtons}>
                <span>
                  <i />
                  SELEC.
                </span>
                <span>
                  <i />
                  INÍCIO
                </span>
              </div>
              <div className={styles.actionButtons}>
                <span>
                  <i />B
                </span>
                <span>
                  <i />A
                </span>
              </div>
            </div>
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
            <button className={styles.loadButton} type="button" disabled>
              <Upload size={18} aria-hidden="true" />
              Carregar cartucho
              <span className={styles.buttonFileType}>.gb</span>
            </button>
            <p className={styles.preparationNote}>
              <span aria-hidden="true" />
              Carregamento em preparação
            </p>
          </div>

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
          O projeto está em desenvolvimento. Por enquanto, você pode conhecer a bancada e
          experimentar as paletas da tela. A reprodução de jogos chega nas próximas etapas.
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
    </div>
  )
}
