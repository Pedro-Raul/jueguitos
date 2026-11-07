/**
 * Única fuente de duraciones y pausas de Cucupoly.
 *
 * `PACE` frena toda la partida sin tocar las reglas: cualquier tiempo nuevo
 * debe declararse aquí y multiplicarse con `paced()` (o `pacedSeconds()`).
 */
export const PACE = 1.5

/** Aplica el ritmo global a una duración en milisegundos. */
export function paced(ms: number): number {
  return Math.round(ms * PACE)
}

/** Aplica el ritmo global a una duración en segundos. */
export function pacedSeconds(seconds: number): number {
  return seconds * PACE
}

/** Duración de cada salto de ficha (casilla a casilla). */
export const HOP_SECONDS = paced(180) / 1000
/** Duración de la animación de dados (escena y HUD). */
export const DICE_SECONDS = paced(1200) / 1000
/** Tiempo que el resultado de los dados queda en el centro. */
export const DICE_BANNER_MS = paced(2000)
/** Pausa entre el final de una acción y el turno del siguiente jugador. */
export const END_OF_TURN_PAUSE_MS = paced(1200)

/**
 * Ventana de decisiones al cerrar el turno. El jugador puede intercambiar o
 * pulsar Continuar; al agotarse los tics, el anfitrión cierra el turno solo.
 */
export const END_TURN_WINDOW_MS = paced(20000)
export const END_TURN_TICK_MS = paced(1000)
export const END_TURN_TICKS = Math.max(
  1,
  Math.round(END_TURN_WINDOW_MS / END_TURN_TICK_MS),
)

/** Tiempo mínimo que un aviso permanece visible. */
export const NOTICE_MIN_MS = 2500
/** Tiempo real de cada aviso (nunca por debajo del mínimo). */
export const NOTICE_VISIBLE_MS = Math.max(NOTICE_MIN_MS, paced(2500))
/** Aire entre dos avisos para que la cola no parezca un salto brusco. */
export const NOTICE_GAP_MS = paced(300)

/** La revelación de la mesa de 21 se mantiene visible al menos este tiempo. */
export const REVEAL_HOLD_MS = 4000
/** Vuelo de monedas del reparto de la mesa de 21. */
export const TABLE21_PAYOUT_MS = paced(1600)
/** Entrada de cada carta repartida en la mesa de 21. */
export const TABLE21_DEAL_MS = paced(420)
/** Conteo ascendente de la suma al revelar la mesa de 21. */
export const TABLE21_COUNT_MS = paced(600)

/** Tiempo que se muestra el orden final antes de empezar la ronda 1. */
export const TURN_ORDER_REVEAL_MS = paced(4000)
/** Anuncio del evento inicial: tiempo completo y salida animada. */
export const EVENT_BANNER_MS = paced(5000)
export const EVENT_BANNER_EXIT_MS = paced(400)
/** Salida breve de la tarjeta desplegable de la etiqueta de evento. */
export const EVENT_CARD_EXIT_MS = 160

/** Subastas de evento. */
export const AUCTION_SECRET_MS = paced(20000)
export const AUCTION_OPEN_IDLE_MS = paced(10000)
export const AUCTION_TICK_MS = paced(1000)
export const AUCTION_OPEN_IDLE_TICKS = Math.max(
  1,
  Math.round(AUCTION_OPEN_IDLE_MS / AUCTION_TICK_MS),
)
