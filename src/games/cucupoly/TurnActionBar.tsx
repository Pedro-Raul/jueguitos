import { useCallback, useEffect, useRef, useState } from 'react'
import type { CucupolyState } from './engine'

/** Fases que piden una decisión y bloquean intercambio/construcción. */
const BLOCKING_PHASES: ReadonlySet<CucupolyState['phase']> = new Set([
  'event',
  'final-event',
  'buy-decision',
  'auction',
  'twenty-one',
  'slots',
  'trade',
  'bus-move',
])

type Gate = {
  enabled: boolean
  reason: string | null
}

function baseGate(
  state: CucupolyState,
  meId: string,
  animating: boolean,
  turnPause: boolean,
  bannerOpen: boolean,
): Gate {
  if (state.phase === 'finished') {
    return { enabled: false, reason: 'La partida ya terminó' }
  }
  if (state.phase === 'turn-order-roll' || state.phase === 'turn-order-reveal') {
    return { enabled: false, reason: 'La partida aún no ha empezado' }
  }
  if (state.turnOrder[state.currentIndex] !== meId) {
    return { enabled: false, reason: 'No es tu turno' }
  }
  if (BLOCKING_PHASES.has(state.phase)) {
    return { enabled: false, reason: 'Resuelve la decisión pendiente' }
  }
  if (bannerOpen) {
    return { enabled: false, reason: 'Cierra el anuncio del evento' }
  }
  if (animating) {
    return { enabled: false, reason: 'Espera a que termine la animación' }
  }
  if (turnPause) {
    return { enabled: false, reason: 'Esperando el cambio de turno' }
  }
  if (state.inJail[meId]) {
    return { enabled: false, reason: 'Resuelve tu turno en la cárcel' }
  }
  if (state.dice === null) {
    return { enabled: false, reason: 'Tira los dados primero' }
  }
  return { enabled: true, reason: null }
}

export type TurnActionBarProps = {
  state: CucupolyState
  meId: string
  /** Dados o ficha en movimiento. */
  animating: boolean
  /** Pausa de fin de turno antes de habilitar al siguiente jugador. */
  turnPause: boolean
  /** Anuncio grande de evento abierto. */
  bannerOpen: boolean
  /**
   * Marcador temporal de construcción. Otro paso lo conectará a las reglas
   * reales; aquí no se consulta el reducer ni se despacha nada.
   */
  canBuildNow: boolean
  onOpenProperties: () => void
  onTrade?: () => void
  onBuild?: () => void
}

type ActionButtonProps = {
  label: string
  icon: string
  enabled: boolean
  reason: string | null
  onActivate?: () => void
  onHint: (reason: string | null) => void
}

function ActionButton({
  label,
  icon,
  enabled,
  reason,
  onActivate,
  onHint,
}: ActionButtonProps) {
  const blocked = !enabled
  const message = reason ?? 'Acción no disponible'

  return (
    <button
      className={`cp2-act${blocked ? ' is-disabled' : ''}`}
      type="button"
      aria-disabled={blocked}
      aria-label={blocked ? `${label}. ${message}` : label}
      aria-describedby={blocked ? 'cp2-act-hint' : undefined}
      title={blocked ? message : undefined}
      onMouseEnter={() => onHint(blocked ? message : null)}
      onFocus={() => onHint(blocked ? message : null)}
      onClick={() => {
        if (blocked) {
          onHint(message)
          return
        }
        onHint(null)
        onActivate?.()
      }}
    >
      <span className="cp2-act-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="cp2-act-label">{label}</span>
      {blocked ? (
        <span className="cp2-act-lock" aria-hidden="true">
          🔒
        </span>
      ) : null}
    </button>
  )
}

/**
 * Barra de acciones del turno. "Propiedades" está siempre disponible; las otras
 * dos esperan al turno propio, a la tirada y al fin de la resolución.
 */
export function TurnActionBar({
  state,
  meId,
  animating,
  turnPause,
  bannerOpen,
  canBuildNow,
  onOpenProperties,
  onTrade,
  onBuild,
}: TurnActionBarProps) {
  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef<number | null>(null)

  const showHint = useCallback((message: string | null) => {
    if (hintTimer.current !== null) {
      window.clearTimeout(hintTimer.current)
      hintTimer.current = null
    }
    setHint(message)
    if (message) {
      hintTimer.current = window.setTimeout(() => {
        hintTimer.current = null
        setHint(null)
      }, 3600)
    }
  }, [])

  useEffect(
    () => () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    },
    [],
  )

  const base = baseGate(state, meId, animating, turnPause, bannerOpen)
  const trade: Gate = base
  const build: Gate =
    base.enabled && !canBuildNow
      ? { enabled: false, reason: 'No puedes construir ahora' }
      : base

  return (
    <div className="cp2-turn-actions" role="toolbar" aria-label="Acciones del turno">
      <div className="cp2-turn-actions-row">
        <ActionButton
          label="Propiedades"
          icon="🏠"
          enabled
          reason={null}
          onActivate={onOpenProperties}
          onHint={showHint}
        />
        <ActionButton
          label="Intercambio"
          icon="🤝"
          enabled={trade.enabled}
          reason={trade.reason}
          onActivate={onTrade}
          onHint={showHint}
        />
        <ActionButton
          label="Construir"
          icon="🏗️"
          enabled={build.enabled}
          reason={build.reason}
          onActivate={onBuild}
          onHint={showHint}
        />
      </div>
      <p
        id="cp2-act-hint"
        className={`cp2-act-hint${hint ? ' is-visible' : ''}`}
        role="status"
        aria-live="polite"
      >
        {hint ?? ''}
      </p>
    </div>
  )
}
