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
        <button className="profile-chip" type="button" onClick={onEditProfile}>
          <span className="avatar" style={{ backgroundColor: profile.color }}>
            <Ficha emoji={profile.emoji} />
          </span>
          <span>{profile.name}</span>
        </button>
      </header>

      <section className="hero">
        <h1>Elige un juego</h1>
        <p>Crea una sala y comparte el código. El anfitrión hace de servidor.</p>
      </section>

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
