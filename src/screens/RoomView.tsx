import { useState } from 'react'
import { getGame } from '../games'
import type { GameAction, Player } from '../types'
import type { RoomSnapshot } from '../net/protocol'

type Props = {
  room: RoomSnapshot
  me: Player
  isHost: boolean
  error: string | null
  notice: string | null
  onStart?: () => void
  onLeave: () => void
  dispatch: (action: GameAction) => void
  privateData?: unknown
  sendPrivate?: (targetId: string, data: unknown) => void
}

export function RoomView({
  room,
  me,
  isHost,
  error,
  notice,
  onStart,
  onLeave,
  dispatch,
  privateData,
  sendPrivate,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const connectedCount = room.players.filter((player) => player.connected).length
  const game = getGame(room.gameId)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setCopyError(null)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyError('No se pudo copiar automáticamente. Anota el código.')
    }
  }

  if (room.status === 'playing') {
    return (
      <main className="game-full">
        {error ? <p className="alert game-alert">{error}</p> : null}
        {notice ? <p className="alert game-alert">{notice}</p> : null}
        {game ? (
          <game.View
            state={room.state}
            me={me}
            players={room.players}
            dispatch={dispatch}
            privateData={privateData}
            sendPrivate={sendPrivate}
          />
        ) : (
          <p className="alert game-alert">El juego de esta sala ya no está disponible.</p>
        )}
        <button className="ghost game-exit" type="button" onClick={onLeave}>
          Salir
        </button>
      </main>
    )
  }

  return (
    <main className="screen">
      <header className="topbar">
        <div>
          <span className="muted small">Sala</span>{' '}
          <strong className="room-code">{room.code}</strong>
        </div>
        <button className="ghost" type="button" onClick={onLeave}>
          Salir
        </button>
      </header>

      {error ? <p className="alert">{error}</p> : null}
      {notice ? <p className="alert">{notice}</p> : null}

      <section className="card room-ticket">
        <span className="muted small">Comparte este código</span>
        <strong>{room.code}</strong>
        <button className="primary" type="button" onClick={copyCode}>
          {copied ? '¡Copiado!' : 'Copiar código'}
        </button>
        {copyError ? <p className="muted small">{copyError}</p> : null}
      </section>

      <section className="card">
        <h2>
          Jugadores ({room.players.length}/{room.maxPlayers})
        </h2>
        <ul className="player-list">
          {room.players.map((player) => (
            <li key={player.id} className={`player-row${player.connected ? '' : ' is-offline'}`}>
              <span className="avatar" style={{ backgroundColor: player.color }}>
                {player.emoji}
              </span>
              <span className="player-name">
                {player.name}
                {player.id === me.id ? ' (tú)' : ''}
              </span>
              <span className="player-tag">
                {!player.connected ? 'desconectado' : player.id === room.players[0]?.id ? 'anfitrión' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        {isHost ? (
          <>
            <button
              className="primary"
              type="button"
              onClick={onStart}
              disabled={connectedCount < room.minPlayers}
            >
              Iniciar partida
            </button>
            {connectedCount < room.minPlayers ? (
              <p className="muted small">
                Hacen falta al menos {room.minPlayers} jugador(es) conectado(s).
              </p>
            ) : (
              <p className="muted small">Empieza cuando estéis todos. La sala se puede unir por código.</p>
            )}
          </>
        ) : (
          <p className="muted">Esperando a que el anfitrión inicie la partida…</p>
        )}
      </section>
    </main>
  )
}
