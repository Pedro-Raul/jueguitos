import { MessageScreen } from '../components/MessageScreen'
import { useGuestRoom } from '../net/useGuestRoom'
import type { Profile } from '../types'
import { RoomView } from './RoomView'

type Props = {
  code: string
  me: Profile
  onLeave: () => void
}

export function GuestRoomScreen({ code, me, onLeave }: Props) {
  const { snapshot, seatId, status, message, dispatch, privateData } = useGuestRoom(code, me)

  if (status === 'closed') {
    return (
      <MessageScreen
        title="Sala cerrada"
        message={message ?? 'El anfitrión cerró la sala.'}
        actionLabel="Volver al catálogo"
        onAction={onLeave}
      />
    )
  }

  if (!snapshot) {
    return (
      <main className="screen">
        <section className="card card-narrow connecting-card" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h2>{status === 'reconnecting' ? 'Reconectando…' : 'Conectando…'}</h2>
          <p className="muted">
            Sala <strong>{code}</strong>
          </p>
          <p className="muted small">
            {status === 'reconnecting'
              ? 'Se perdió la conexión; lo intentamos de nuevo.'
              : 'Esto puede tardar unos segundos.'}
          </p>
          {message ? (
            <p className="alert" role="status">
              {message}
            </p>
          ) : null}
          <div className="actions">
            <button className="ghost" type="button" onClick={onLeave}>
              Cancelar
            </button>
          </div>
        </section>
      </main>
    )
  }

  const guest = snapshot.players.find((player) => player.id === seatId) ?? {
    ...me,
    id: seatId,
    connected: true,
  }

  return (
    <RoomView
      room={snapshot}
      me={guest}
      isHost={false}
      error={null}
      notice={status === 'reconnecting' ? 'Conexión perdida. Reintentando…' : message}
      onLeave={onLeave}
      dispatch={dispatch}
      privateData={privateData}
    />
  )
}
