/**
 * Tragamonedas del «Sitio de apuestas» (casilla 41).
 *
 * Todo lo que decide un premio vive aquí y es puro: el motor genera los
 * rodillos con el RNG sembrado del estado y esta tabla solo interpreta el
 * resultado. Así el reducer sigue siendo determinista y se puede probar sin
 * navegador.
 */

export const SLOT_MIN_BET = 5
export const SLOT_MAX_BET = 50
export const SLOT_BETS = [5, 10, 25, 50] as const

export const SLOT_SYMBOLS = {
  cherry: { emoji: '🍒', label: 'Cereza' },
  lemon: { emoji: '🍋', label: 'Limón' },
  bell: { emoji: '🔔', label: 'Campana' },
  star: { emoji: '⭐', label: 'Estrella' },
  seven: { emoji: '7️⃣', label: 'Siete' },
  diamond: { emoji: '💎', label: 'Diamante' },
} as const

export type SlotSymbolId = keyof typeof SLOT_SYMBOLS

/**
 * Bolsa ponderada del rodillo: las frutas salen mucho más que el siete o el
 * diamante. El orden no importa; sí las repeticiones.
 */
export const SLOT_REEL: readonly SlotSymbolId[] = [
  'cherry',
  'cherry',
  'cherry',
  'cherry',
  'lemon',
  'lemon',
  'lemon',
  'bell',
  'bell',
  'star',
  'star',
  'seven',
  'diamond',
]

export type SlotReels = [SlotSymbolId, SlotSymbolId, SlotSymbolId]

export type SlotState = {
  /** Jugador que llegó a la casilla y controla la máquina. */
  playerId: string
  stage: 'bet' | 'spinning' | 'result'
  /** Apuesta del giro en curso o del último giro. */
  bet: number
  /** Solo existe al terminar el giro. */
  reels: SlotReels | null
  /** Dinero que volvió al jugador en el último giro. */
  payout: number
  /** Multiplicador del último giro; 0 = sin premio. */
  multiplier: number
  /** Sube en cada giro; la interfaz reinicia la animación con este valor. */
  spinSeq: number
}

export type SlotOutcome = {
  multiplier: number
  /** Apuesta × multiplicador (la apuesta ya se descontó antes). */
  payout: number
  label: string
}

/** Tres iguales: multiplicador sobre la apuesta. */
export const SLOT_TRIPLE_MULTIPLIERS: Record<SlotSymbolId, number> = {
  diamond: 50,
  seven: 25,
  star: 12,
  bell: 8,
  lemon: 5,
  cherry: 4,
}

const TRIPLE_LABELS: Record<SlotSymbolId, string> = {
  diamond: 'Tres diamantes',
  seven: 'Tres sietes',
  star: 'Tres estrellas',
  bell: 'Tres campanas',
  lemon: 'Tres limones',
  cherry: 'Tres cerezas',
}

const PAIR_LABELS: Record<SlotSymbolId, string> = {
  diamond: 'Pareja de diamantes',
  seven: 'Pareja de sietes',
  star: 'Pareja de estrellas',
  bell: 'Pareja de campanas',
  lemon: 'Pareja de limones',
  cherry: 'Dos cerezas',
}

/** Filas de la tabla de premios que ve el jugador. */
export const SLOT_PRIZES: ReadonlyArray<{
  emoji: string
  label: string
  multiplier: number
}> = [
  { emoji: '💎💎💎', label: 'Tres diamantes', multiplier: 50 },
  { emoji: '7️⃣7️⃣7️⃣', label: 'Tres sietes', multiplier: 25 },
  { emoji: '⭐⭐⭐', label: 'Tres estrellas', multiplier: 12 },
  { emoji: '🔔🔔🔔', label: 'Tres campanas', multiplier: 8 },
  { emoji: '🍋🍋🍋', label: 'Tres limones', multiplier: 5 },
  { emoji: '🍒🍒🍒', label: 'Tres cerezas', multiplier: 4 },
  { emoji: '🍒🍒', label: 'Dos cerezas', multiplier: 2 },
  { emoji: '🍋🍋', label: 'Cualquier pareja', multiplier: 1 },
]

export function slotEmoji(symbol: SlotSymbolId): string {
  return SLOT_SYMBOLS[symbol].emoji
}

export function slotLabel(symbol: SlotSymbolId): string {
  return SLOT_SYMBOLS[symbol].label
}

/** Tres símbolos decididos por el RNG que le pase el motor. */
export function spinSlotReels(
  randomInt: (min: number, max: number) => number,
): SlotReels {
  const pick = () => SLOT_REEL[randomInt(0, SLOT_REEL.length - 1)]
  return [pick(), pick(), pick()]
}

/** Premio de una tirada. La apuesta ya se descontó antes de llamar aquí. */
export function slotPayout(
  reels: readonly SlotSymbolId[],
  bet: number,
): SlotOutcome {
  const safeBet = Number.isFinite(bet) && bet > 0 ? Math.floor(bet) : 0
  const [a, b, c] = reels

  if (a === b && b === c) {
    return {
      multiplier: SLOT_TRIPLE_MULTIPLIERS[a],
      payout: safeBet * SLOT_TRIPLE_MULTIPLIERS[a],
      label: TRIPLE_LABELS[a],
    }
  }

  const pair = a === b ? a : b === c ? b : a === c ? a : null
  if (pair === 'cherry') {
    return { multiplier: 2, payout: safeBet * 2, label: PAIR_LABELS.cherry }
  }
  if (pair) {
    return { multiplier: 1, payout: safeBet, label: PAIR_LABELS[pair] }
  }
  return { multiplier: 0, payout: 0, label: 'Sin premio' }
}
