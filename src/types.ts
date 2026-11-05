import type { ComponentType } from 'react'

/** Local profile. Persisted only in localStorage, never sent anywhere else. */
export type Profile = {
  id: string
  name: string
  emoji: string
  color: string
}

/** A profile seated in a room. `connected` is host-side presence, not identity. */
export type Player = Profile & { connected: boolean }

export type GameAction = { type: string; payload?: unknown }

export type GameViewProps<S> = {
  state: S
  me: Player
  players: Player[]
  dispatch: (action: GameAction) => void
  /** Datos privados enviados solo a este asiento (por ejemplo, una mano del 21). */
  privateData?: unknown
  /** Solo anfitrión: envía datos privados a un asiento concreto. */
  sendPrivate?: (targetId: string, data: unknown) => void
}

/**
 * Game plug-in contract. Every game lives in src/games/<id>/ and is registered
 * in src/games/index.ts. Deleting the folder + its registry line removes it.
 *
 * - `init` must be pure and derive everything from `players` + `seed`.
 * - `reduce` must be pure and deterministic: no Date.now, no Math.random.
 *   Any randomness must come from the seed stored inside the state.
 * - `reduce` returns the next state, or `{ error: string }` to reject the action.
 *   Game state must NOT have a top-level `error` string, or rejection and state
 *   become indistinguishable.
 */
export type GameDefinition<S = unknown> = {
  id: string
  name: string
  description: string
  minPlayers: number
  maxPlayers: number
  init: (players: Player[], seed: number) => S
  reduce: (state: S, action: GameAction, playerId: string) => S | { error: string }
  View: ComponentType<GameViewProps<S>>
}

export function isGameError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  )
}
