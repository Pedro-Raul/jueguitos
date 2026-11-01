import type { CucupolyState } from './engine'

/**
 * Lector de la última tirada, solo lectura sobre el estado del reducer.
 * El engine deja `dice` en null al cerrar el turno, así que la veguela de
 * visualización usa el registro (mismo snapshot autoritativo en cada cliente).
 */
export type RollHint = { turn: number; player: string; values: number[]; total: number }

const ROLL_RE = / tira ([1-6](?:\+[1-6])*) = (\d+) y /

/** Última tirada de la ventana actual (turno presente o recién cerrado). */
export function latestRoll(state: CucupolyState): RollHint | null {
  const oldestAllowed = state.turnNumber - 1
  for (let i = state.log.length - 1; i >= 0; i -= 1) {
    const entry = state.log[i]
    if (entry.turn < oldestAllowed) break

    const match = ROLL_RE.exec(entry.text)
    if (!match) continue

    const name = entry.text.slice(0, entry.text.indexOf(' tira '))
    if (!name) continue
    const player = Object.keys(state.names).find((id) => state.names[id] === name)
    if (!player) continue

    const values = match[1].split('+').map(Number)
    const total = Number(match[2])
    if (values.length < 1 || values.length > 3) continue
    return { turn: entry.turn, player, values, total }
  }
  return null
}

/** Clave estable de una tirada: cada turno tiene una sola tirada. */
export function rollKey(hint: RollHint): string {
  return `${hint.turn}:${hint.player}`
}
