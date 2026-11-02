import type { CucupolyState } from './engine'
import { latestRoll } from './rollHint'
import { pathBetween } from './visual'

/**
 * Lo último que este cliente ya pintó: número de tirada y posición de cada
 * ficha. Se actualiza con cada snapshot/estado, no solo con las tiradas, para
 * absorber los movimientos que no son paseos (cárcel, salto de ruta, entrada).
 */
export type SeenRoll = {
  seq: number
  positions: Record<string, number>
  inJail: Record<string, boolean>
}

export type RollPlan = {
  /** `state.rollSeq` de la tirada que se va a animar. */
  seq: number
  playerId: string
  values: number[]
  total: number
  from: number
  to: number
  /** Casillas del recorrido, incluido el destino. */
  steps: number[]
  /** Colocar sin caminar (solo cárcel; el salto de ruta no es una tirada). */
  direct: boolean
}

export type AnimationPlan = { kind: 'idle' } | { kind: 'roll'; roll: RollPlan }

/**
 * Decide qué animar a partir del estado autoritativo. Es pura y no sabe si
 * quien mira es anfitrión o invitado: con el mismo estado y el mismo `seen`
 * produce exactamente el mismo plan en todos los clientes.
 *
 * - `seen === null` (primera instantánea, entrada o reconexión): no anima.
 * - `state.rollSeq <= seen.seq` (tirada ya reproducida o cambio sin dados): no anima.
 * - `state.rollSeq > seen.seq`: anima la tirada una sola vez.
 */
export function planAnimations(
  state: CucupolyState,
  seen: SeenRoll | null,
): AnimationPlan {
  const seq = state.rollSeq ?? 0
  if (!seen || seq <= seen.seq) return { kind: 'idle' }

  const hint = latestRoll(state)
  if (!hint) return { kind: 'idle' }

  // El jugador que tiró es el que cambió de casilla; el log solo aporta los
  // valores de los dados. Así no dependemos de que los nombres no se repitan.
  const moved = state.order.find(
    (id) => (state.positions[id] ?? 0) !== (seen.positions[id] ?? 0),
  )
  const playerId = moved ?? hint.player
  const from = seen.positions[playerId] ?? state.positions[playerId] ?? 0
  const to = state.positions[playerId] ?? from
  const jailed = state.inJail[playerId] === true && seen.inJail[playerId] !== true
  const steps = jailed ? [to] : pathBetween(from, to)

  return {
    kind: 'roll',
    roll: {
      seq,
      playerId,
      values: hint.values,
      total: hint.total,
      from,
      to,
      steps,
      direct: jailed,
    },
  }
}

/** Foto del estado para guardar como `seen` después de pintar. */
export function snapshotSeen(state: CucupolyState): SeenRoll {
  return {
    seq: state.rollSeq ?? 0,
    positions: { ...state.positions },
    inJail: { ...state.inJail },
  }
}
