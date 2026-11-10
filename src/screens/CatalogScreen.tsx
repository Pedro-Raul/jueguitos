import { Ficha } from '../components/Ficha'
import { games } from '../games'
import type { Profile } from '../types'

type Props = {
  profile: Profile
  onHost: (gameId: string) => void
  onJoin: () => void
  onEditProfile: () => void
}

export function CatalogScreen({ profile, onHost, onJoin, onEditProfile }: Props) {
  return (
    <main className="screen">
      <header className="topbar">
        <span className="brand">Jueguitos</span>
        <button
          className="profile-chip"
          type="button"
          aria-label={`Editar el perfil de ${profile.name}`}
          onClick={onEditProfile}
        >
          <span className="avatar" style={{ backgroundColor: profile.color }}>
            <Ficha emoji={profile.emoji} />
          </span>
          <span className="profile-chip-name">{profile.name}</span>
        </button>
      </header>

      <section className="hero hero-catalog">
        <span className="eyebrow">Hola, {profile.name}</span>
        <h1>Elige un juego</h1>
        <p>Crea una sala y comparte el código. El anfitrión hace de servidor.</p>
      </section>

      <ol className="quick-start" aria-label="Cómo empezar">
        <li className="quick-step">
          <span className="quick-step-number" aria-hidden="true">1</span>
          <span>
            <strong>Crea una sala</strong>
            <span className="muted small">Elige un juego del catálogo.</span>
          </span>
        </li>
        <li className="quick-step">
          <span className="quick-step-number" aria-hidden="true">2</span>
          <span>
            <strong>Comparte el código</strong>
            <span className="muted small">Tus amigos entran con 5 caracteres.</span>
          </span>
        </li>
        <li className="quick-step">
          <span className="quick-step-number" aria-hidden="true">3</span>
          <span>
            <strong>Juega con tus amigos</strong>
            <span className="muted small">El anfitrión inicia la partida.</span>
          </span>
        </li>
      </ol>

      <div className="actions actions-center">
        <button className="primary" type="button" onClick={onJoin}>
          Unirse con código
        </button>
      </div>

      <ul className="game-grid">
        {games.map((game) => (
          <li key={game.id} className="card game-card">
            <div className="game-cover" aria-hidden="true" />
            <h2>{game.name}</h2>
            <p className="muted">{game.description}</p>
            <p className="badge">
              {game.minPlayers}–{game.maxPlayers} jugadores
            </p>
            <button className="primary" type="button" onClick={() => onHost(game.id)}>
              Crear sala
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
