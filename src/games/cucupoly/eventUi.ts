import {
  DICE_EVENTS,
  EVENTS,
  FINAL_EVENTS,
  isDiceEventId,
  isFinalEventId,
  isInitialEventId,
  type ActiveEvent,
  type GameEventId,
} from './events'

/**
 * Presentación de eventos para el HUD. Es una tabla puramente visual: no
 * participa en el sorteo, en las reglas ni en el estado que viaja por PeerJS.
 */
export type EventTone = 'green' | 'purple' | 'blue' | 'red' | 'orange' | 'neutral'

export type EventStyle = {
  icon: string
  tone: EventTone
}

export const EVENT_STYLE: Record<GameEventId, EventStyle> = {
  impulso_economico: { icon: '💰', tone: 'green' },
  semana_descuentos: { icon: '🏷️', tone: 'green' },
  oferta_secreta: { icon: '🔒', tone: 'purple' },
  puja_abierta: { icon: '🔨', tone: 'blue' },
  dados_uno: { icon: '🎲', tone: 'orange' },
  dados_tres: { icon: '🎲', tone: 'blue' },
  inflacion_alta: { icon: '📈', tone: 'red' },
  impuestos_altos: { icon: '🧾', tone: 'orange' },
  caos: { icon: '🌀', tone: 'purple' },
}

/** Reserva para cualquier id futuro que todavía no tenga estilo propio. */
export const FALLBACK_EVENT_STYLE: EventStyle = {
  icon: '✨',
  tone: 'neutral',
}

export function styleForEvent(id: string): EventStyle {
  return (EVENT_STYLE as Record<string, EventStyle | undefined>)[id] ?? FALLBACK_EVENT_STYLE
}

export type EventPresentation = EventStyle & {
  id: string
  name: string
  description: string
}

function fallbackName(id: string): string {
  const words = id.split('_').filter(Boolean)
  if (words.length === 0) return 'Evento'
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Une catálogo + estilo. Los eventos desconocidos conservan la presentación
 * neutra para que el HUD nunca se quede sin icono ni color.
 */
export function eventPresentation(id: string): EventPresentation {
  const style = styleForEvent(id)

  if (isDiceEventId(id)) {
    const definition = DICE_EVENTS[id]
    return {
      id,
      name: definition.name,
      description: definition.description,
      ...style,
    }
  }

  if (isFinalEventId(id)) {
    const definition = FINAL_EVENTS[id]
    return {
      id,
      name: definition.name,
      description: definition.description,
      ...style,
    }
  }

  if (isInitialEventId(id)) {
    const definition = EVENTS[id]
    return {
      id,
      name: definition.name,
      description: definition.description,
      ...style,
    }
  }

  return {
    id,
    name: fallbackName(id),
    description: 'Evento activo.',
    ...style,
  }
}

export type BannerKind = 'initial' | 'final' | 'event'

export type EventBannerData = {
  id: string
  kind: BannerKind
  /** Clave del `activeEvent` al que pertenece el anuncio. */
  key: string | null
}

export function bannerTypeLabel(kind: BannerKind): string {
  if (kind === 'initial') return 'Evento inicial'
  if (kind === 'final') return 'Evento final'
  return 'Evento'
}

export function eventKey(event: ActiveEvent | null): string | null {
  if (!event) return null
  return `${event.id}:${event.startRound}:${event.endRound}`
}

export function eventRoundTotal(event: ActiveEvent): number {
  return Math.max(0, event.endRound - event.startRound + 1)
}

export function roundsLabel(left: number): string {
  return `${left} ${left === 1 ? 'ronda' : 'rondas'}`
}

/** Causa corta que se muestra en el mini menú antes de tirar. */
export function diceCause(id: string): string {
  if (id === 'dados_tres') return '3 dados en vez de 2 durante esta ronda.'
  if (id === 'dados_uno') return '1 dado en vez de 2 durante esta ronda.'
  return 'El evento cambia los dados de esta ronda.'
}
