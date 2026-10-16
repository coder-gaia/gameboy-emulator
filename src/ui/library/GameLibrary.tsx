import { Play } from 'lucide-react'
import { DEMO_GAMES } from '../../platform/games/catalog'
import type { DemoGame } from '../../platform/games/catalog'
import styles from './GameLibrary.module.css'

export function GameLibrary({
  loading,
  activeGameId,
  onSelect,
}: {
  loading: boolean
  activeGameId: string | null
  onSelect: (game: DemoGame) => void
}) {
  return (
    <section className={styles.library} aria-labelledby="library-title">
      <div className={styles.heading}>
        <span className={styles.number}>01</span>
        <div>
          <h2 id="library-title">Uma aventura já está à sua espera.</h2>
          <p>Escolha um jogo. Sem precisar de arquivo.</p>
        </div>
      </div>
      <ul className={styles.games}>
        {DEMO_GAMES.map((game, index) => (
          <li key={game.id}>
            <button
              className={styles.game}
              type="button"
              aria-label={`Jogar ${game.title}`}
              aria-pressed={activeGameId === game.id}
              disabled={loading}
              onClick={() => onSelect(game)}
            >
              <span className={styles.stamp} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={styles.title}>
                <strong>{game.title}</strong>
                <span>{game.subtitle}</span>
              </span>
              <Play size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <details className={styles.credits}>
        <summary>Controles e créditos dos jogos</summary>
        {DEMO_GAMES.map((game) => (
          <div key={game.id}>
            <h3>{game.title}</h3>
            <p>{game.description}</p>
            <p>{game.controls.join(' · ')}</p>
            <p>
              <a href={game.sourceUrl} target="_blank" rel="noreferrer">
                {game.author}
                <span className="sr-only">, abre em nova aba</span>
              </a>
              {' · '}
              <a href={game.creditsUrl} target="_blank" rel="noreferrer">
                {game.license}
                <span className="sr-only">, abre em nova aba</span>
              </a>
            </p>
            <p>{game.attribution}</p>
          </div>
        ))}
      </details>
    </section>
  )
}
