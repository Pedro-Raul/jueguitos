import {
  FINAL_PHASE_START_ROUND,
  INITIAL_EVENT_ROUND,
  eventDurationRounds,
  isDiceEventId,
  isFinalEventId,
  isInitialEventId,
  isNormalEventId,
  type ActiveEvent,
  type GameEventId,
  type InitialEventId,
} from './events'

/**
 * Planificador único de eventos de Cucupoly.
 *
 * Reglas que centraliza:
 * - Solo un evento activo a la vez.
 * - Un evento empieza al inicio de una ronda y termina al final de otra.
 * - La duración se cuenta en rondas completas, nunca en turnos.
 * - Entre eventos hay una pausa de 4 a 8 rondas (`nextEventRound`).
 * - El evento inicial ocurre una única vez al inicio de la ronda 2.
 * - Desde `FINAL_PHASE_START_ROUND` el pool es solo de eventos finales.
 *
 * El módulo no sortea: el anfitrión elige el evento y la pausa fuera del
 * reducer. Aquí solo se valida y se aplica el ciclo de vida de forma pura.
 */

export const EVENT_GAP_MIN_ROUNDS = 4
export const EVENT_GAP_MAX_ROUNDS = 8

export type EventSchedulerState = {
  roundNumber: number
  activeEvent: ActiveEvent | null
  /** Ronda en la que puede empezar el próximo evento. */
  nextEventRound: number
  /** Último evento iniciado; evita repetir el final anterior. */
  lastEventId: GameEventId | null
  /** Evento de dados pedido por una Sorpresa para la próxima ventana. */
  scheduledEventId: GameEventId | null
  /** Ronda en la que ocurrió el evento inicial; null si aún no ocurrió. */
  initialEvent: InitialEventId | null
}

export function initialEventSchedule(): Pick<
  EventSchedulerState,
  'activeEvent' | 'nextEventRound' | 'lastEventId' | 'scheduledEventId'
> {
  return {
    activeEvent: null,
    nextEventRound: INITIAL_EVENT_ROUND,
    lastEventId: null,
    scheduledEventId: null,
  }
}

/** La pausa la sortea el anfitrión; aquí solo se acota a 4..8 rondas. */
export function normalizeGapRounds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return EVENT_GAP_MIN_ROUNDS
  return Math.min(EVENT_GAP_MAX_ROUNDS, Math.max(EVENT_GAP_MIN_ROUNDS, value))
}

/** ¿Toca abrir la fase de sorteo en esta ronda? */
export function isEventDue(state: EventSchedulerState): boolean {
  return state.activeEvent === null && state.roundNumber >= state.nextEventRound
}

/** Cierra el evento que terminó en la ronda anterior. */
export function closeFinishedEvent(state: EventSchedulerState): boolean {
  if (!state.activeEvent) return false
  if (state.roundNumber <= state.activeEvent.endRound) return false
  state.activeEvent = null
  return true
}

/**
 * Valida que un evento pueda empezar en la ronda actual. Devuelve el motivo
 * del rechazo, o null si es válido.
 */
export function eventStartError(
  state: EventSchedulerState,
  eventId: GameEventId,
): string | null {
  if (state.activeEvent) return 'Ya hay un evento activo.'
  if (state.roundNumber !== state.nextEventRound) {
    return 'Todavía no toca un evento.'
  }
  if (state.scheduledEventId && state.scheduledEventId !== eventId) {
    return 'La Sorpresa ya eligió el próximo evento.'
  }

  const initialRound =
    state.roundNumber === INITIAL_EVENT_ROUND && state.initialEvent === null

  if (initialRound) {
    if (!isInitialEventId(eventId)) {
      return 'En la ronda 2 solo puede ocurrir el evento inicial.'
    }
    return null
  }

  if (state.roundNumber >= FINAL_PHASE_START_ROUND) {
    if (!isFinalEventId(eventId)) {
      return 'En la fase final solo puede ocurrir un evento final.'
    }
    if (state.lastEventId === eventId) {
      return 'El evento final no puede repetirse dos veces seguidas.'
    }
    return null
  }

  if (!isNormalEventId(eventId)) {
    return 'Ese evento todavía no está disponible.'
  }
  return null
}

/**
 * Único punto de entrada para activar un evento. El motor llama a esta función
 * después de validar el efecto concreto (subasta, caos, impuestos, etc.).
 */
export function beginEvent(
  state: EventSchedulerState,
  eventId: GameEventId,
  gapRounds: number,
): { activeEvent: ActiveEvent } | { error: string } {
  const error = eventStartError(state, eventId)
  if (error) return { error }

  const endRound = state.roundNumber + eventDurationRounds(eventId) - 1
  const activeEvent: ActiveEvent = {
    id: eventId,
    startRound: state.roundNumber,
    endRound,
  }

  state.activeEvent = activeEvent
  state.lastEventId = eventId
  state.scheduledEventId = null
  state.nextEventRound = endRound + 1 + normalizeGapRounds(gapRounds)

  if (state.roundNumber === INITIAL_EVENT_ROUND && state.initialEvent === null) {
    state.initialEvent = eventId as InitialEventId
  }

  return { activeEvent }
}

/**
 * Una Sorpresa pide un evento de dados. No puede empezar a mitad de ronda:
 * - Si hay un evento activo, el intento se descarta.
 * - Si la fase final ya empezó, se descarta.
 * - Si el evento inicial aún no ocurrió, tiene prioridad.
 * - Si no, queda elegido para la próxima ventana de eventos.
 */
export function requestDiceEvent(
  state: EventSchedulerState,
  eventId: GameEventId,
): { ok: true; round: number } | { ok: false; reason: string } {
  if (!isDiceEventId(eventId)) {
    return { ok: false, reason: 'Ese evento no es de dados.' }
  }
  if (state.activeEvent) {
    return { ok: false, reason: 'Ya hay un evento activo.' }
  }
  if (state.roundNumber >= FINAL_PHASE_START_ROUND) {
    return { ok: false, reason: 'La fase final no admite eventos de dados.' }
  }
  if (state.nextEventRound >= FINAL_PHASE_START_ROUND) {
    return { ok: false, reason: 'La próxima ventana ya es de la fase final.' }
  }
  if (state.initialEvent === null && state.nextEventRound <= INITIAL_EVENT_ROUND) {
    return { ok: false, reason: 'El evento inicial todavía tiene prioridad.' }
  }
  if (state.scheduledEventId) {
    return { ok: false, reason: 'Ya hay un evento de dados programado.' }
  }

  state.scheduledEventId = eventId
  return { ok: true, round: state.nextEventRound }
}
