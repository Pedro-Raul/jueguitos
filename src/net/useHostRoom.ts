import Peer, { type DataConnection } from 'peerjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { peerIdFor } from '../roomCode'
import {
  isGameError,
  type GameAction,
  type GameDefinition,
  type Player,
  type Profile,
} from '../types'
import {
  isGuestMessage,
  sanitizeProfile,
  sanitizeSeatId,
  type GuestMessage,
  type HostMessage,
  type RoomSnapshot,
} from './protocol'
import { publishHostAction } from './hostActions'

export type HostRoom = {
  snapshot: RoomSnapshot
  error: string | null
  start: () => void
  dispatch: (action: GameAction) => void
  /** Envía datos privados a un asiento concreto; nunca pasan por el snapshot. */
  sendPrivate: (targetId: string, data: unknown) => void
}

function initialSnapshot(
  code: string,
  me: Profile,
  game: GameDefinition<any>,
): RoomSnapshot {
  return {
    code,
    status: 'lobby',
    gameId: game.id,
    players: [{ ...me, connected: true }],
    state: null,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
  }
}

/**
 * Authoritative host. The whole room lives in this browser: guests send
 * actions, this hook validates them with the game reducer and broadcasts
 * the full snapshot. Seats are kept (connected=false) when a guest drops.
 */
export function useHostRoom(code: string, game: GameDefinition<any>, me: Profile): HostRoom {
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(() => initialSnapshot(code, me, game))
  const [error, setError] = useState<string | null>(null)

  const roomRef = useRef<RoomSnapshot>(snapshot)
  const connsRef = useRef(new Map<string, DataConnection>())
  const connPlayersRef = useRef(new Map<DataConnection, string>())
  const gameRef = useRef(game)
  const meRef = useRef(me)
  gameRef.current = game
  meRef.current = me

  const commit = useCallback((room: RoomSnapshot) => {
    roomRef.current = room
    setSnapshot(room)
    setError(null)
    const message: HostMessage = { kind: 'snapshot', room }
    for (const conn of connsRef.current.values()) {
      if (conn.open) conn.send(message)
    }
  }, [])

  useEffect(() => {
    const peer = new Peer(peerIdFor(code))

    const send = (conn: DataConnection, message: HostMessage) => {
      if (conn.open) conn.send(message)
    }

    const handleHello = (conn: DataConnection, rawProfile: unknown, rawSeatId: unknown) => {
      const room = roomRef.current
      const profile = sanitizeProfile(rawProfile)
      const seatId = sanitizeSeatId(rawSeatId)
      if (!profile || !seatId || seatId === meRef.current.id) {
        send(conn, { kind: 'rejected', message: 'No se pudo identificar tu asiento.' })
        conn.close()
        return
      }

      const existing = room.players.find((player) => player.id === seatId)
      let players: Player[]

      if (existing) {
        // Same seat id => same seat, even mid-game (reconnection).
        const previous = connsRef.current.get(seatId)
        if (previous && previous !== conn) previous.close()
        players = room.players.map((player) =>
          player.id === seatId
            ? {
                ...player,
                name: profile.name,
                emoji: profile.emoji,
                color: profile.color,
                connected: true,
              }
            : player,
        )
      } else {
        if (room.status !== 'lobby') {
          send(conn, { kind: 'rejected', message: 'La partida ya empezó.' })
          conn.close()
          return
        }
        if (room.players.length >= room.maxPlayers) {
          send(conn, { kind: 'rejected', message: 'La sala está llena.' })
          conn.close()
          return
        }
        players = [
          ...room.players,
          {
            id: seatId,
            name: profile.name,
            emoji: profile.emoji,
            color: profile.color,
            connected: true,
          },
        ]
      }

      connsRef.current.set(seatId, conn)
      connPlayersRef.current.set(conn, seatId)
      commit({ ...room, players })
    }

    const handleClose = (conn: DataConnection) => {
      const playerId = connPlayersRef.current.get(conn)
      connPlayersRef.current.delete(conn)
      if (!playerId) return
      // Ignore stale connections that were already replaced by a reconnect.
      if (connsRef.current.get(playerId) !== conn) return

      connsRef.current.delete(playerId)
      const room = roomRef.current
      // Keep the seat so the guest can come back with the same profile.
      commit({
        ...room,
        players: room.players.map((player) =>
          player.id === playerId ? { ...player, connected: false } : player,
        ),
      })
    }

    const handleAction = (conn: DataConnection, action: unknown) => {
      const playerId = connPlayersRef.current.get(conn)
      const room = roomRef.current
      if (!playerId) return

      if (room.status !== 'playing' || room.state === null) {
        send(conn, { kind: 'rejected', message: 'La partida no ha empezado.' })
        return
      }
      if (
        typeof action !== 'object' ||
        action === null ||
        typeof (action as GameAction).type !== 'string'
      ) {
        send(conn, { kind: 'rejected', message: 'Acción no válida.' })
        return
      }

      const result = gameRef.current.reduce(room.state, action as GameAction, playerId)
      if (isGameError(result)) {
        publishHostAction({ action: action as GameAction, playerId, ok: false })
        send(conn, { kind: 'rejected', message: result.error })
        return
      }
      publishHostAction({ action: action as GameAction, playerId, ok: true })
      commit({ ...room, state: result })
    }

    peer.on('connection', (conn) => {
      conn.on('data', (raw: unknown) => {
        if (!isGuestMessage(raw)) return
        const message = raw as GuestMessage
        if (message.kind === 'hello') handleHello(conn, message.profile, message.seatId)
        else handleAction(conn, message.action)
      })
      conn.on('close', () => handleClose(conn))
      conn.on('error', () => handleClose(conn))
    })

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        setError('Ese código de sala ya está en uso. Inténtalo otra vez.')
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        setError('No se pudo conectar al servicio de emparejamiento. Revisa tu conexión.')
      }
    })

    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect()
    })

    return () => {
      const closing: HostMessage = { kind: 'closed', message: 'El anfitrión cerró la sala.' }
      for (const conn of connsRef.current.values()) {
        if (conn.open) conn.send(closing)
        conn.close()
      }
      connsRef.current.clear()
      connPlayersRef.current.clear()
      peer.destroy()
    }
  }, [code, commit])

  const start = useCallback(() => {
    const room = roomRef.current
    if (room.status !== 'lobby') return

    const connected = room.players.filter((player) => player.connected)
    if (connected.length < room.minPlayers) {
      setError(`Hacen falta al menos ${room.minPlayers} jugador(es) conectado(s).`)
      return
    }

    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    // Init with every seat (not only connected) so a reconnect mid-game keeps a score slot.
    commit({ ...room, status: 'playing', state: gameRef.current.init(room.players, seed) })
  }, [commit])

  const dispatch = useCallback(
    (action: GameAction) => {
      const room = roomRef.current
      if (room.status !== 'playing' || room.state === null) return

      const result = gameRef.current.reduce(room.state, action, meRef.current.id)
      if (isGameError(result)) {
        publishHostAction({ action, playerId: meRef.current.id, ok: false })
        setError(result.error)
        return
      }
      publishHostAction({ action, playerId: meRef.current.id, ok: true })
      commit({ ...room, state: result })
    },
    [commit],
  )

  const sendPrivate = useCallback((targetId: string, data: unknown) => {
    const conn = connsRef.current.get(targetId)
    if (!conn?.open) return
    const message: HostMessage = { kind: 'private', gameId: gameRef.current.id, data }
    conn.send(message)
  }, [])

  return { snapshot, error, start, dispatch, sendPrivate }
}
