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
 * Eventos de Cucupoly. El sorteo y el orden de llegada de las ofertas los
 * resuelve el anfitrión fuera del reducer; este módulo solo define el catálogo
 * y las reglas puras que comparten el motor y el HUD.
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
    description: '3 rondas con propiedades a mitad de precio.',
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

/** Primera y última ronda en las que aplica la Semana de descuentos. */
export const DISCOUNT_FIRST_ROUND = 3
export const DISCOUNT_LAST_ROUND = 5

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

export function isAuctionEvent(id: InitialEventId): id is AuctionEventId {
  return auctionModeFor(id) !== null
}

/** Casillas comprables que siguen sin dueño, para elegir la de la subasta. */
export function freeAuctionTiles(owners: Record<number, string | null>): number[] {
  return BOARD.filter((tile) => tile.price !== undefined && !owners[tile.index]).map(
    (tile) => tile.index,
  )
}

/**
 * Eventos elegibles para el sorteo. Las subastas se excluyen si no queda
 * ninguna propiedad sin dueño.
 */
export function drawableEvents(
  owners: Record<number, string | null>,
): InitialEventId[] {
  const free = freeAuctionTiles(owners)
  return INITIAL_EVENT_POOL.filter(
    (eventId) => !isAuctionEvent(eventId) || free.length > 0,
  )
}

export function isDiscountActive(
  eventId: InitialEventId | null,
  round: number,
): boolean {
  return (
    eventId === 'semana_descuentos' &&
    round >= DISCOUNT_FIRST_ROUND &&
    round <= DISCOUNT_LAST_ROUND
  )
}

/**
 * Única fuente del precio de compra. La usan `handleBuy` y el HUD para que el
 * importe mostrado y el cobrado no puedan divergir.
 */
export function purchasePriceFor(
  basePrice: number,
  eventId: InitialEventId | null,
  round: number,
  finalEvent: FinalEventState | null = null,
): number {
  const discounted = isDiscountActive(eventId, round)
    ? Math.round(basePrice / 2)
    : basePrice
  return Math.round(discounted * finalPriceMultiplier(finalEvent, round))
}

export function discountRoundsLeft(round: number): number {
  return Math.max(0, DISCOUNT_LAST_ROUND - round + 1)
}

/* ------------------------------------------------------------------ *
 * Fase final de caos
 * ------------------------------------------------------------------ */

/** Primera ronda en la que se sortea un evento final. */
export const FINAL_PHASE_START_ROUND = 12
/** Cada cuántas rondas se reemplaza el evento final. */
export const FINAL_EVENT_EVERY_ROUNDS = 3
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

/** ¿Esta ronda es una de las que abren un evento final? */
export function isFinalEventRound(round: number): boolean {
  return (
    round >= FINAL_PHASE_START_ROUND &&
    (round - FINAL_PHASE_START_ROUND) % FINAL_EVENT_EVERY_ROUNDS === 0
  )
}

/** El evento dura exactamente `FINAL_EVENT_EVERY_ROUNDS` rondas. */
export function isFinalEventActive(
  event: FinalEventState | null,
  round: number,
): boolean {
  return (
    event !== null &&
    round >= event.startRound &&
    round < event.startRound + FINAL_EVENT_EVERY_ROUNDS
  )
}

export function finalEventRoundsLeft(
  event: FinalEventState | null,
  round: number,
): number {
  if (!event || !isFinalEventActive(event, round)) return 0
  return event.startRound + FINAL_EVENT_EVERY_ROUNDS - round
}

/** Único multiplicador de precios, alquileres y costos de la fase final. */
export function finalPriceMultiplier(
  event: FinalEventState | null,
  round: number,
): number {
  return isFinalEventActive(event, round) && event?.id === 'inflacion_alta' ? 2 : 1
}

/** Impuesto alto de una ronda: 15% del efectivo, redondeado hacia abajo. */
export function finalTaxFor(cash: number): number {
  return Math.floor(Math.max(0, cash) * TAX_RATE)
}

/** Eventos elegibles: nunca el mismo que acaba de terminar. */
export function drawableFinalEvents(previous: FinalEventId | null): FinalEventId[] {
  return FINAL_EVENT_POOL.filter((eventId) => eventId !== previous)
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
