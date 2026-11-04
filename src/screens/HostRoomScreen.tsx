import { useState } from 'react'
import { MessageScreen } from '../components/MessageScreen'
import { getGame } from '../games'
import { useHostRoom } from '../net/useHostRoom'
import { generateRoomCode } from '../roomCode'
import type { GameDefinition, Profile } from '../types'
import { RoomView } from './RoomView'

type Props = {
  gameId: string
  me: Profile
  onLeave: () => void
}

export function HostRoomScreen({ gameId, me, onLeave }: Props) {
  const game = getGame(gameId)

  if (!game) {
    return (
      <MessageScreen
        title="Juego no disponible"
        message="Ese juego ya no está en el catálogo."
        actionLabel="Volver al catálogo"
        onAction={onLeave}
      />
    )
  }

  return <HostSession game={game} me={me} onLeave={onLeave} />
}

type SessionProps = {
  game: GameDefinition<any>
  me: Profile
  onLeave: () => void
}

function HostSession({ game, me, onLeave }: SessionProps) {
  // The code is generated once per room and never changes.
  const [code] = useState(generateRoomCode)
  const { snapshot, error, start, dispatch, sendPrivate } = useHostRoom(code, game, me)

  const hostPlayer = snapshot.players.find((player) => player.id === me.id) ?? {
    ...me,
    connected: true,
  }

  return (
    <RoomView
      room={snapshot}
      me={hostPlayer}
      isHost
      error={error}
      notice={null}
      onStart={start}
      onLeave={onLeave}
      dispatch={dispatch}
      sendPrivate={sendPrivate}
    />
  )
}
