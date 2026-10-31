import type { GameAction, Player, Profile } from '../types'

/**
 * Wire protocol. The host is authoritative: guests only send intents
 * (hello / action) and receive full snapshots. Never trust guest payloads.
 */
export type RoomSnapshot = {
  code: string
  status: 'lobby' | 'playing'
  gameId: string | null
  players: Player[]
  state: unknown
  minPlayers: number
  maxPlayers: number
}

export type GuestMessage =
  | { kind: 'hello'; profile: Profile; seatId: string }
  | { kind: 'action'; action: GameAction }

export type HostMessage =
  | { kind: 'snapshot'; room: RoomSnapshot }
  | { kind: 'rejected'; message: string }
  | { kind: 'closed'; message: string }

const MAX_NAME_LENGTH = 24

/** Rebuilds a guest profile from untrusted data, clamping every field. */
export function sanitizeProfile(value: unknown): Profile | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null

  const id = raw.id.trim()
  const name = raw.name.trim().slice(0, MAX_NAME_LENGTH)
  if (!id || !name) return null

  const emoji = typeof raw.emoji === 'string' ? raw.emoji.slice(0, 8) : '🙂'
  const color =
    typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#457b9d'

  return { id, name, emoji, color }
}

export function isGuestMessage(value: unknown): value is GuestMessage {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'hello' || kind === 'action'
}

/**
 * Seat ids come from sessionStorage, so two tabs of the same browser are two
 * distinct players instead of fighting over the same localStorage profile id.
 */
export function sanitizeSeatId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const seatId = value.trim()
  if (!seatId || seatId.length > 64) return null
  return seatId
}
