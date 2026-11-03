/**
 * Eventos de Cucupoly. El sorteo lo hace el anfitrión fuera del reducer; este
 * módulo solo define el catálogo y las reglas puras que comparten el motor y
 * el HUD.
 */

export const INITIAL_EVENT_ROUND = 2

export const INITIAL_EVENT_POOL = ['impulso_economico', 'semana_descuentos'] as const

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
}

/** Tiempo mínimo que el anuncio permanece completo en pantalla. */
export const EVENT_BANNER_MS = 5000
/** Duración de la salida animada del anuncio. */
export const EVENT_BANNER_EXIT_MS = 400

/** Primera y última ronda en las que aplica la Semana de descuentos. */
export const DISCOUNT_FIRST_ROUND = 3
export const DISCOUNT_LAST_ROUND = 5

export function isInitialEventId(value: unknown): value is InitialEventId {
  return typeof value === 'string' && (INITIAL_EVENT_POOL as readonly string[]).includes(value)
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
