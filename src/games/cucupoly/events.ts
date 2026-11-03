import { BOARD } from './board'

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

/** Tiempo mínimo que el anuncio permanece completo en pantalla. */
export const EVENT_BANNER_MS = 5000
/** Duración de la salida animada del anuncio. */
export const EVENT_BANNER_EXIT_MS = 400

/** Primera y última ronda en las que aplica la Semana de descuentos. */
export const DISCOUNT_FIRST_ROUND = 3
export const DISCOUNT_LAST_ROUND = 5

/**
 * SUPUESTO: constantes de las subastas de evento. Se ajustan juntas aquí.
 * - `AUCTION_SECRET_MS`: tiempo máximo de la Oferta Secreta.
 * - `AUCTION_OPEN_IDLE_MS`: cuenta regresiva de la Puja Abierta sin pujas.
 * - `MIN_RAISE`: puja mínima y mejora mínima sobre el líder.
 */
export const AUCTION_SECRET_MS = 20000
export const AUCTION_OPEN_IDLE_MS = 10000
export const MIN_RAISE = 10
/** Granularidad del reloj de la Puja Abierta. */
export const AUCTION_TICK_MS = 1000
export const AUCTION_OPEN_IDLE_TICKS = Math.max(
  1,
  Math.round(AUCTION_OPEN_IDLE_MS / AUCTION_TICK_MS),
)

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
): number {
  return isDiscountActive(eventId, round) ? Math.round(basePrice / 2) : basePrice
}

export function discountRoundsLeft(round: number): number {
  return Math.max(0, DISCOUNT_LAST_ROUND - round + 1)
}

const EVENT_SEEN_KEY = 'jueguitos.cucupoly.eventSeen'

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
