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
  /** Último dato privado que el anfitrión envió a este asiento. */
  privateData: unknown
}

const MAX_RETRIES = 3
/** Si un intento no abre la DataConnection en este plazo, se reintenta. */
const CONNECT_TIMEOUT_MS = 10000

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
  const [privateData, setPrivateData] = useState<unknown>(null)

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
    let connTimer: number | undefined
    let retryScheduled = false
    let everConnected = false
    /** Último fallo visto: 'unavailable' (sala no encontrada) o 'network' (WebRTC/red). */
    let lastFailure: 'unavailable' | 'network' | null = null

    // STUN público (sin claves) para atravesar NATs de redes distintas.
    const peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    })

    const clearConnTimer = () => {
      if (connTimer !== undefined) {
        window.clearTimeout(connTimer)
        connTimer = undefined
      }
    }

    const closeWith = (text: string) => {
      if (cancelled) return
      clearConnTimer()
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
          lastFailure === 'unavailable'
            ? 'No se encontró la sala. Revisa el código y que el anfitrión siga conectado.'
            : everConnected
              ? 'El anfitrión cerró la sala o se perdió la conexión.'
              : 'No se pudo iniciar la conexión con el anfitrión. Revisa tu red (los datos móviles a veces bloquean el juego); probar con la misma Wi-Fi ayuda.',
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
      clearConnTimer()
      const conn = peer.connect(peerIdFor(code), { reliable: true })
      connRef.current = conn

      conn.on('open', () => {
        if (cancelled) return
        clearConnTimer()
        everConnected = true
        attempts = 0
        retryScheduled = false
        lastFailure = null
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
        } else if (incoming.kind === 'private') {
          setPrivateData(incoming.data)
        } else if (incoming.kind === 'rejected') {
          setMessage(incoming.message)
        } else if (incoming.kind === 'closed') {
          closeWith(incoming.message)
        }
      })

      conn.on('close', () => {
        clearConnTimer()
        if (cancelled || statusRef.current === 'closed') return
        scheduleRetry()
      })

      conn.on('error', () => {
        clearConnTimer()
        if (cancelled || statusRef.current === 'closed') return
        lastFailure = 'network'
        scheduleRetry()
      })

      // Sin este plazo, un ICE atascado (NAT de datos móviles) cuelga el intento para siempre.
      connTimer = window.setTimeout(() => {
        connTimer = undefined
        if (cancelled || conn.open) return
        lastFailure = 'network'
        try {
          conn.close()
        } catch {
          /* la conexión ya estaba muerta */
        }
        scheduleRetry()
      }, CONNECT_TIMEOUT_MS)
    }

    peer.on('open', () => {
      if (!cancelled) connect()
    })

    // Si el socket de señalización se cae antes de hablar con el anfitrión, se rearma.
    peer.on('disconnected', () => {
      if (cancelled || peer.destroyed) return
      if (connRef.current?.open) return
      peer.reconnect()
    })

    peer.on('error', (err) => {
      if (cancelled) return
      if (err.type === 'peer-unavailable') {
        lastFailure = 'unavailable'
        scheduleRetry()
      } else if (
        err.type === 'network' ||
        err.type === 'server-error' ||
        err.type === 'socket-error' ||
        err.type === 'socket-closed'
      ) {
        lastFailure = 'network'
        scheduleRetry()
      } else {
        closeWith(`No se pudo conectar: ${err.message}`)
      }
    })

    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      clearConnTimer()
      connRef.current?.close()
      connRef.current = null
      peer.destroy()
    }
  }, [code, profile, seatId])

  return { snapshot, seatId, status, message, dispatch, privateData }
}
