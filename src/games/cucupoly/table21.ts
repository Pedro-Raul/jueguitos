import { RULES } from './rules.config'

/**
 * Datos privados de la mesa de 21. El anfitrión los envía solo al asiento
 * dueño de la mano; nunca forman parte del snapshot público.
 */
export type Table21Private = {
  /** Identifica la mesa para descartar manos viejas tras una reconexión. */
  tableKey: string
  cards: number[]
}

export type Table21Payout = {
  to: string
  amount: number
}

export type Table21Transfer = {
  /** `null` = pozo común (devolución de apuestas). */
  from: string | null
  to: string
  amount: number
}

/**
 * Resultado calculado al revelar. `payouts` es lo que se aplica al dinero con
 * las reglas de siempre; `transfers` es solo una descomposición visual del
 * pozo en pagador → ganador y no altera ningún monto.
 */
export type Table21Settlement = {
  allBusted: boolean
  winnerIds: string[]
  best: number | null
  pot: number
  payouts: Table21Payout[]
  transfers: Table21Transfer[]
}

/** Carta aleatoria resuelta por el anfitrión fuera del reducer. */
export function drawTable21Card(): number {
  return 1 + Math.floor(Math.random() * RULES.table21CardMax)
}

export function table21Total(cards: readonly number[]): number {
  return cards.reduce((sum, card) => sum + card, 0)
}

/** Valida el payload privado recibido del anfitrión; nunca confía en él. */
export function parseTable21Private(value: unknown): Table21Private | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = (value as Record<string, unknown>).table21
  if (typeof raw !== 'object' || raw === null) return null
  const tableKey = (raw as Record<string, unknown>).tableKey
  const cards = (raw as Record<string, unknown>).cards
  if (typeof tableKey !== 'string' || !tableKey) return null
  if (!Array.isArray(cards) || cards.length > 100) return null

  const clean: number[] = []
  for (const card of cards) {
    if (typeof card !== 'number' || !Number.isInteger(card)) return null
    if (card < 1 || card > RULES.table21CardMax) return null
    clean.push(card)
  }
  return { tableKey, cards: clean }
}

/**
 * Reparte el pozo entre los ganadores para la animación: cada apuesta sale de
 * su pagador y llega a un ganador. La suma por fila/columna coincide con las
 * apuestas y con los pagos ya calculados.
 */
export function table21Transfers(
  participants: readonly string[],
  bets: Record<string, number>,
  winnerIds: readonly string[],
  won: Record<string, number>,
): Table21Transfer[] {
  const supply = participants.map((id) => ({ id, left: bets[id] ?? 0 }))
  const demand = winnerIds.map((id) => ({ id, left: won[id] ?? 0 }))
  const transfers: Table21Transfer[] = []

  for (const payer of supply) {
    for (const winner of demand) {
      if (payer.left <= 0) break
      if (winner.left <= 0) continue
      const amount = Math.min(payer.left, winner.left)
      if (amount <= 0) continue
      transfers.push({ from: payer.id, to: winner.id, amount })
      payer.left -= amount
      winner.left -= amount
    }
  }

  return transfers
}
