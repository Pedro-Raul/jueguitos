import { describe, expect, it } from 'vitest'
import { DICE_EVENTS, EVENTS, FINAL_EVENTS } from './events'
import {
  EVENT_STYLE,
  FALLBACK_EVENT_STYLE,
  bannerTypeLabel,
  diceCause,
  eventKey,
  eventPresentation,
  eventRoundTotal,
  roundsLabel,
  styleForEvent,
} from './eventUi'

describe('presentación visual de eventos', () => {
  it('asigna el icono y tono pedidos a cada evento conocido', () => {
    expect(EVENT_STYLE.impulso_economico).toEqual({ icon: '💰', tone: 'green' })
    expect(EVENT_STYLE.semana_descuentos).toEqual({ icon: '🏷️', tone: 'green' })
    expect(EVENT_STYLE.oferta_secreta).toEqual({ icon: '🔒', tone: 'purple' })
    expect(EVENT_STYLE.puja_abierta).toEqual({ icon: '🔨', tone: 'blue' })
    expect(EVENT_STYLE.inflacion_alta).toEqual({ icon: '📈', tone: 'red' })
    expect(EVENT_STYLE.impuestos_altos).toEqual({ icon: '🧾', tone: 'orange' })
    expect(EVENT_STYLE.caos).toEqual({ icon: '🌀', tone: 'purple' })
  })

  it('usa azul para más dados y naranja para menos dados', () => {
    expect(EVENT_STYLE.dados_tres).toEqual({ icon: '🎲', tone: 'blue' })
    expect(EVENT_STYLE.dados_uno).toEqual({ icon: '🎲', tone: 'orange' })
    expect(diceCause('dados_tres')).toContain('3 dados')
    expect(diceCause('dados_uno')).toContain('1 dado')
  })

  it('cae en el estilo neutro para ids desconocidos', () => {
    expect(styleForEvent('evento_futuro')).toEqual(FALLBACK_EVENT_STYLE)
    const presentation = eventPresentation('evento_futuro')
    expect(presentation.tone).toBe('neutral')
    expect(presentation.icon).toBe(FALLBACK_EVENT_STYLE.icon)
    expect(presentation.name).toBe('Evento futuro')
    expect(presentation.description).toBe('Evento activo.')
  })

  it('toma nombre y descripción de los catálogos reales', () => {
    expect(eventPresentation('impulso_economico').name).toBe(EVENTS.impulso_economico.name)
    expect(eventPresentation('dados_tres').description).toBe(DICE_EVENTS.dados_tres.description)
    expect(eventPresentation('caos').name).toBe(FINAL_EVENTS.caos.name)
  })

  it('etiqueta los anuncios y calcula rondas con una única clave', () => {
    expect(bannerTypeLabel('initial')).toBe('Evento inicial')
    expect(bannerTypeLabel('final')).toBe('Evento final')
    expect(bannerTypeLabel('event')).toBe('Evento')

    const event = { id: 'semana_descuentos', startRound: 4, endRound: 6 } as const
    expect(eventKey(event)).toBe('semana_descuentos:4:6')
    expect(eventKey(null)).toBeNull()
    expect(eventRoundTotal(event)).toBe(3)
    expect(roundsLabel(1)).toBe('1 ronda')
    expect(roundsLabel(3)).toBe('3 rondas')
  })
})
