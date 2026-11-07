import { BOARD } from './board'
import {
  AUCTION_OPEN_IDLE_TICKS,
  AUCTION_OPEN_IDLE_MS,
  AUCTION_SECRET_MS,
  AUCTION_TICK_MS,
  EVENT_BANNER_EXIT_MS,
  EVENT_BANNER_MS,
} from './timing'

// Los tiempos viven en `timing.ts`; se reexportan aquí para no romper imports.
export {
  AUCTION_OPEN_IDLE_TICKS,
  AUCTION_OPEN_IDLE_MS,
  AUCTION_SECRET_MS,
  AUCTION_TICK_MS,
  EVENT_BANNER_EXIT_MS,
  EVENT_BANNER_MS,
}

/**
 * Eventos de Cucupoly. El sorteo lo hace el anfitrión fuera del reducer; este
 * módulo define el catálogo, las duraciones y las reglas puras que comparten el
 * motor, el planificador y el HUD.
 */

export const INITIAL_EVENT_ROUND = 2

export type AuctionMode = 'sealed' | 'open'
export type AuctionEventId = 'oferta_secreta' | 'puja_abierta'

export const INITIAL_EVENT_POOL = [
  'impulso_economico',
  'semana_descuentos',
  'oferta_secreta',
  'puja_abierta',
] as const

export type InitialEventId = (typeof INITIAL_EVENT_POOL)[number]

export type EventDefinition = {
  id: InitialEventId
  name: string
  description: string
  icon: string
}

export const EVENTS: Record<InitialEventId, EventDefinition> = {
  impulso_economico: {
    id: 'impulso_economico',
    name: 'Impulso Económico',
    description: 'Todos reciben $250 para arrancar.',
    icon: '💸',
  },
  semana_descuentos: {
    id: 'semana_descuentos',
    name: 'Semana de descuentos',
    description: '3 rondas completas con propiedades a mitad de precio.',
    icon: '🏷️',
  },
  oferta_secreta: {
    id: 'oferta_secreta',
    name: 'Oferta Secreta',
    description: 'Todos ofertan a ciegas por una propiedad.',
    icon: '🕵️',
  },
  puja_abierta: {
    id: 'puja_abierta',
    name: 'Puja Abierta',
    description: 'Subasta relámpago: gana la última puja.',
    icon: '⚡',
  },
}

/**
 * SUPUESTO: valores de las subastas de evento.
 * - `MIN_RAISE`: puja mínima y mejora mínima sobre el líder.
 * Los tiempos (Oferta Secreta, Puja Abierta y tics) viven en `timing.ts`.
 */
export const MIN_RAISE = 10

export function isInitialEventId(value: unknown): value is InitialEventId {
  return typeof value === 'string' && (INITIAL_EVENT_POOL as readonly string[]).includes(value)
}

export function auctionModeFor(id: InitialEventId): AuctionMode | null {
  if (id === 'oferta_secreta') return 'sealed'
  if (id === 'puja_abierta') return 'open'
  return null
}

export function isAuctionEvent(id: string): id is AuctionEventId {
  return id === 'oferta_secreta' || id === 'puja_abierta'
}

/* ------------------------------------------------------------------ *
 * Eventos de dados (Sorpresa)
 * ------------------------------------------------------------------ */

export const DICE_EVENT_IDS = ['dados_uno', 'dados_tres'] as const
export type DiceEventId = (typeof DICE_EVENT_IDS)[number]

export type DiceEventDefinition = {
  id: DiceEventId
  name: string
  description: string
  icon: string
  dice: 1 | 3
}

export const DICE_EVENTS: Record<DiceEventId, DiceEventDefinition> = {
  dados_uno: {
    id: 'dados_uno',
    name: 'Vamos despacio',
    description: 'Durante una ronda completa se lanza 1 dado en vez de 2.',
    icon: '🎲',
    dice: 1,
  },
  dados_tres: {
    id: 'dados_tres',
    name: 'Vamos rápido',
    description: 'Durante una ronda completa se lanzan 3 dados en vez de 2.',
    icon: '🎲',
    dice: 3,
  },
}

export function isDiceEventId(value: unknown): value is DiceEventId {
  return typeof value === 'string' && (DICE_EVENT_IDS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * Fase final de caos
 * ------------------------------------------------------------------ */

/** Primera ronda en la que el pool pasa a ser solo de eventos finales. */
export const FINAL_PHASE_START_ROUND = 40
/** Duración de los eventos finales que no son instantáneos. */
export const FINAL_EVENT_DURATION_ROUNDS = 3
/** Tasa de impuestos altos sobre el efectivo de cada jugador. */
export const TAX_RATE = 0.15

export type FinalEventKind = 'inflation' | 'taxes' | 'chaos'

export type FinalEventDefinition = {
  name: string
  description: string
  icon: string
  kind: FinalEventKind
}

/**
 * Única tabla de la fase final: añadir un evento aquí (con un `kind` ya
 * soportado) basta para que entre en el pool y en el HUD.
 */
export const FINAL_EVENTS = {
  inflacion_alta: {
    name: 'Inflación alta',
    description: 'Compras, construcción y alquileres al doble durante 3 rondas.',
    icon: '🔥',
    kind: 'inflation',
  },
  impuestos_altos: {
    name: 'Impuestos altos',
    description: `Cada ronda del evento, el ${Math.round(TAX_RATE * 100)}% del efectivo va al banco.`,
    icon: '🏛️',
    kind: 'taxes',
  },
  caos: {
    name: 'Caos',
    description: 'Todos intercambian posiciones en el tablero.',
    icon: '🌀',
    kind: 'chaos',
  },
} as const satisfies Record<string, FinalEventDefinition>

export type FinalEventId = keyof typeof FINAL_EVENTS

export const FINAL_EVENT_POOL = Object.keys(FINAL_EVENTS) as FinalEventId[]

/** Evento final vigente; `startRound` marca la ronda en que se sorteó. */
export type FinalEventState = {
  id: FinalEventId
  startRound: number
}

export function isFinalEventId(value: unknown): value is FinalEventId {
  return typeof value === 'string' && (FINAL_EVENT_POOL as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * Catálogo unificado y ciclo de vida
 * ------------------------------------------------------------------ */

export type NormalEventId = InitialEventId | DiceEventId
export type GameEventId = NormalEventId | FinalEventId

/** Evento activo. `endRound` es inclusivo: dura rondas completas. */
export type ActiveEvent = {
  id: GameEventId
  startRound: number
  endRound: number
}

export const NORMAL_EVENT_POOL: NormalEventId[] = [
  ...INITIAL_EVENT_POOL,
  ...DICE_EVENT_IDS,
]

export const EVENT_DURATION_ROUNDS: Record<GameEventId, number> = {
  impulso_economico: 1,
  semana_descuentos: 3,
  oferta_secreta: 1,
  puja_abierta: 1,
  dados_uno: 1,
  dados_tres: 1,
  inflacion_alta: FINAL_EVENT_DURATION_ROUNDS,
  impuestos_altos: FINAL_EVENT_DURATION_ROUNDS,
  caos: 1,
}

export function isNormalEventId(value: unknown): value is NormalEventId {
  return typeof value === 'string' && (NORMAL_EVENT_POOL as readonly string[]).includes(value)
}

export function isGameEventId(value: unknown): value is GameEventId {
  return isNormalEventId(value) || isFinalEventId(value)
}

export function eventDurationRounds(id: GameEventId): number {
  return EVENT_DURATION_ROUNDS[id]
}

export function isEventActive(event: ActiveEvent | null, round: number): boolean {
  return event !== null && round >= event.startRound && round <= event.endRound
}

export function eventRoundsLeft(event: ActiveEvent | null, round: number): number {
  if (!event || round < event.startRound || round > event.endRound) return 0
  return event.endRound - round + 1
}

/** Única fuente del número de dados de una tirada. */
export function diceCountForEvent(event: ActiveEvent | null): number {
  if (event?.id === 'dados_uno') return 1
  if (event?.id === 'dados_tres') return 3
  return 2
}

/* ------------------------------------------------------------------ *
 * Pools
 * ------------------------------------------------------------------ */

/** Casillas comprables que siguen sin dueño, para elegir la de la subasta. */
export function freeAuctionTiles(owners: Record<number, string | null>): number[] {
  return BOARD.filter((tile) => tile.price !== undefined && !owners[tile.index]).map(
    (tile) => tile.index,
  )
}

/**
 * Eventos normales elegibles. Las subastas se excluyen si no queda ninguna
 * propiedad sin dueño y se evita repetir el evento inmediatamente anterior.
 */
export function drawableEvents(
  owners: Record<number, string | null>,
  previous: GameEventId | null = null,
): NormalEventId[] {
  const free = freeAuctionTiles(owners)
  return NORMAL_EVENT_POOL.filter(
    (eventId) =>
      eventId !== previous && (!isAuctionEvent(eventId) || free.length > 0),
  )
}

/** Eventos finales elegibles: nunca el mismo que acaba de terminar. */
export function drawableFinalEvents(previous: FinalEventId | null): FinalEventId[] {
  return FINAL_EVENT_POOL.filter((eventId) => eventId !== previous)
}

/** Pool que corresponde a una ronda según la fase de la partida. */
export function eventPoolForRound(
  round: number,
  owners: Record<number, string | null>,
  previous: GameEventId | null = null,
): GameEventId[] {
  if (round >= FINAL_PHASE_START_ROUND) {
    return drawableFinalEvents(isFinalEventId(previous) ? previous : null)
  }
  return drawableEvents(owners, isNormalEventId(previous) ? previous : null)
}

/* ------------------------------------------------------------------ *
 * Precios
 * ------------------------------------------------------------------ */

export function isDiscountActive(event: ActiveEvent | null, round: number): boolean {
  return event?.id === 'semana_descuentos' && isEventActive(event, round)
}

/** Multiplicador de precios, alquileres y costos de un evento activo. */
export function eventPriceMultiplier(event: ActiveEvent | null, round: number): number {
  return isEventActive(event, round) && event?.id === 'inflacion_alta' ? 2 : 1
}

/**
 * Única fuente del precio de compra. La usan `handleBuy` y el HUD para que el
 * importe mostrado y el cobrado no puedan divergir.
 */
export function purchasePriceFor(
  basePrice: number,
  event: ActiveEvent | null,
  round: number,
): number {
  const discounted = isDiscountActive(event, round)
    ? Math.round(basePrice / 2)
    : basePrice
  return Math.round(discounted * eventPriceMultiplier(event, round))
}

/* ------------------------------------------------------------------ *
 * Impuestos de la fase final
 * ------------------------------------------------------------------ */

/** Impuesto alto de una ronda: 15% del efectivo, redondeado hacia abajo. */
export function finalTaxFor(cash: number): number {
  return Math.floor(Math.max(0, cash) * TAX_RATE)
}

const EVENT_SEEN_KEY = 'jueguitos.cucupoly.eventSeen'
const FINAL_EVENT_SEEN_KEY = 'jueguitos.cucupoly.finalEventSeen'

/**
 * Evita repetir el anuncio al reconectar o recargar la pestaña. Se guarda por
 * semilla de partida y número de evento.
 */
export function hasSeenEvent(seed: number, seq: number): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.sessionStorage.getItem(EVENT_SEEN_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { seed?: number; seq?: number }
    return parsed.seed === seed && (parsed.seq ?? 0) >= seq
  } catch {
    return false
  }
}

export function markEventSeen(seed: number, seq: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(EVENT_SEEN_KEY, JSON.stringify({ seed, seq }))
  } catch {
    // Sin sessionStorage (modo privado) el aviso puede repetirse; no es crítico.
  }
}

/** Misma protección que el evento inicial, pero con su propia clave. */
export function hasSeenFinalEvent(seed: number, seq: number): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.sessionStorage.getItem(FINAL_EVENT_SEEN_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { seed?: number; seq?: number }
    return parsed.seed === seed && (parsed.seq ?? 0) >= seq
  } catch {
    return false
  }
}

export function markFinalEventSeen(seed: number, seq: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(FINAL_EVENT_SEEN_KEY, JSON.stringify({ seed, seq }))
  } catch {
    // Sin sessionStorage (modo privado) el aviso puede repetirse; no es crítico.
  }
}
