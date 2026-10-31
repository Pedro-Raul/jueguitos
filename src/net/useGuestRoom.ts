import Peer, { type DataConnection } from 'peerjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { randomId } from '../profile'
import { peerIdFor } from '../roomCode'
import type { GameAction, Profile } from '../types'
import type { GuestMessage, HostMessage, RoomSnapshot } from './protocol'

export type GuestStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export type GuestRoom = {
  snapshot: RoomSnapshot | null
  seatId: string
  status: GuestStatus
  message: string | null
  dispatch: (action: GameAction) => void
}

const MAX_RETRIES = 3

/**
 * Seat identity is per tab (sessionStorage), not the localStorage profile id.
 * Otherwise two tabs of the same browser would share one profile id and the
 * second tab would take over the host's seat. Reloading the tab keeps the seat.
 */
function readSeatId(code: string): string {
  const key = `jueguitos.seat.${code}`
  try {
    const stored = sessionStorage.getItem(key)
    if (stored) return stored
    const id = randomId()
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return randomId()
  }
}

/**
 * Guest side: connects to `jueguitos-<CODE>` and receives full snapshots.
 * On a dropped connection it retries a few times with the same seat id;
 * the host keeps the seat, so a successful retry resumes the same game.
 */
export function useGuestRoom(code: string, profile: Profile): GuestRoom {
  const [seatId] = useState(() => readSeatId(code))
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [status, setStatus] = useState<GuestStatus>('connecting')
  const [message, setMessage] = useState<string | null>(null)

  const connRef = useRef<DataConnection | null>(null)
  const statusRef = useRef<GuestStatus>('connecting')
  statusRef.current = status

  const dispatch = useCallback((action: GameAction) => {
    const conn = connRef.current
    if (conn?.open) {
      const message: GuestMessage = { kind: 'action', action }
      conn.send(message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let retryTimer: number | undefined
    let retryScheduled = false
    let everConnected = false
    let lastRejection: string | null = null

    const peer = new Peer()

    const closeWith = (text: string) => {
      if (cancelled) return
      setStatus('closed')
      setMessage(text)
    }

    const scheduleRetry = () => {
      if (cancelled || retryScheduled) return
      if (statusRef.current === 'closed') return
      retryScheduled = true
      attempts += 1

      if (attempts > MAX_RETRIES) {
        closeWith(
          lastRejection ??
            (everConnected
              ? 'El anfitrión cerró la sala o se perdió la conexión.'
              : 'No se encontró la sala. Revisa el código y que el anfitrión siga conectado.'),
        )
        return
      }

      setStatus('reconnecting')
      retryTimer = window.setTimeout(() => {
        retryScheduled = false
        if (cancelled) return
        if (peer.destroyed) return
        if (peer.disconnected) peer.reconnect()
        connect()
      }, 1500 * attempts)
    }

    const connect = () => {
      if (cancelled) return
      const conn = peer.connect(peerIdFor(code), { reliable: true })
      connRef.current = conn

      conn.on('open', () => {
        if (cancelled) return
        everConnected = true
        attempts = 0
        retryScheduled = false
        setStatus('connected')
        setMessage(null)
        const hello: GuestMessage = { kind: 'hello', profile, seatId }
        conn.send(hello)
      })

      conn.on('data', (raw: unknown) => {
        if (cancelled || typeof raw !== 'object' || raw === null) return
        const incoming = raw as HostMessage
        if (incoming.kind === 'snapshot') {
          setSnapshot(incoming.room)
          setStatus('connected')
          setMessage(null)
        } else if (incoming.kind === 'rejected') {
          lastRejection = incoming.message
          setMessage(incoming.message)
        } else if (incoming.kind === 'closed') {
          closeWith(incoming.message)
        }
      })

      conn.on('close', () => {
        if (cancelled || statusRef.current === 'closed') return
        scheduleRetry()
      })
    }

    peer.on('open', () => {
      if (!cancelled) connect()
    })

    peer.on('error', (err) => {
      if (cancelled) return
      if (
        err.type === 'peer-unavailable' ||
        err.type === 'network' ||
        err.type === 'server-error' ||
        err.type === 'socket-error' ||
        err.type === 'socket-closed'
      ) {
        scheduleRetry()
      } else {
        closeWith(`No se pudo conectar: ${err.message}`)
      }
    })

    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      connRef.current?.close()
      connRef.current = null
      peer.destroy()
    }
  }, [code, profile, seatId])

  return { snapshot, seatId, status, message, dispatch }
}
