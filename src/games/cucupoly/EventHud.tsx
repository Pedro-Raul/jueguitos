import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { eventRoundsLeft, type ActiveEvent } from './events'
import {
  bannerTypeLabel,
  diceCause,
  eventPresentation,
  eventRoundTotal,
  roundsLabel,
  type EventBannerData,
} from './eventUi'
import {
  EVENT_BANNER_EXIT_MS,
  EVENT_BANNER_MS,
  EVENT_CARD_EXIT_MS,
} from './timing'

function RoundDots({ left, total }: { left: number; total: number }) {
  return (
    <span className="cp2-round-dots" aria-hidden="true">
      {Array.from({ length: Math.max(total, left, 1) }, (_, index) => (
        <i key={index} className={index < left ? 'is-full' : ''} />
      ))}
    </span>
  )
}

type EventBannerProps = {
  banner: EventBannerData
  leaving: boolean
  onDismiss: () => void
}

export function EventBanner({ banner, leaving, onDismiss }: EventBannerProps) {
  const info = eventPresentation(banner.id)
  const style = {
    '--cp2-banner-ms': `${EVENT_BANNER_MS}ms`,
    '--cp2-exit-ms': `${EVENT_BANNER_EXIT_MS}ms`,
  } as CSSProperties

  return (
    <div
      className={`cp2-banner-overlay${leaving ? ' is-leaving' : ''}`}
      data-tone={info.tone}
      style={style}
      role="button"
      tabIndex={0}
      aria-label="Cerrar el anuncio del evento"
      onClick={onDismiss}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onDismiss()
        }
      }}
    >
      <div className="cp2-banner-card" role="status" aria-live="assertive">
        <span className="cp2-banner-type">{bannerTypeLabel(banner.kind)}</span>
        <span className="cp2-banner-medallion" aria-hidden="true">
          {info.icon}
        </span>
        <h2 className="cp2-banner-title">{info.name}</h2>
        <span className="cp2-banner-divider" aria-hidden="true" />
        <p className="cp2-banner-desc">{info.description}</p>
        <span className="cp2-banner-progress" aria-hidden="true">
          <i />
        </span>
        <span className="cp2-banner-hint">Toca para continuar</span>
      </div>
    </div>
  )
}

type DiceEventMenuProps = {
  event: ActiveEvent
  diceCount: number
  roundNumber: number
}

/** Tarjeta compacta que explica por qué esta tirada usa 1 o 3 dados. */
export function DiceEventMenu({ event, diceCount, roundNumber }: DiceEventMenuProps) {
  const info = eventPresentation(event.id)
  const left = eventRoundsLeft(event, roundNumber)
  const total = eventRoundTotal(event)

  return (
    <aside
      className="cp2-dice-menu"
      data-tone={info.tone}
      aria-label={`Evento ${info.name}: este turno lanzas ${diceCount} dados. ${roundsLabel(left)} restantes.`}
    >
      <div className="cp2-dice-inner">
        <div className="cp2-dice-head">
          <span className="cp2-dice-row" aria-hidden="true">
            {Array.from({ length: diceCount }, (_, index) => (
              <span
                key={index}
                className="cp2-die"
                style={{ '--die-index': index } as CSSProperties}
              >
                🎲
              </span>
            ))}
          </span>
          <span className="cp2-dice-badge">×{diceCount}</span>
        </div>
        <strong className="cp2-dice-name">{info.name}</strong>
        <span className="cp2-dice-cause">{diceCause(event.id)}</span>
        <span className="cp2-dice-effect">
          Este turno lanzas {diceCount} dados — evento {info.name}. Quedan {left}{' '}
          {left === 1 ? 'ronda' : 'rondas'}.
        </span>
        <span className="cp2-dice-dots">
          <RoundDots left={left} total={total} />
          <span>{roundsLabel(left)}</span>
        </span>
      </div>
    </aside>
  )
}

type ActiveEventPillProps = {
  event: ActiveEvent
  roundNumber: number
}

/** Etiqueta persistente del evento activo. Se despliega al tocarla. */
export function ActiveEventPill({ event, roundNumber }: ActiveEventPillProps) {
  const info = eventPresentation(event.id)
  const left = eventRoundsLeft(event, roundNumber)
  const total = eventRoundTotal(event)
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  const close = useCallback(() => {
    if (!open || leaving) return
    setLeaving(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
      setLeaving(false)
    }, EVENT_CARD_EXIT_MS)
  }, [open, leaving])

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) close()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, close])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  return (
    <div className="cp2-event-pill-wrap" ref={rootRef} data-tone={info.tone}>
      <button
        className="cp2-event-pill"
        type="button"
        aria-expanded={open}
        aria-label={`${info.name}, ${roundsLabel(left)} restantes. Ver descripción`}
        onClick={() => {
          if (open) {
            close()
          } else {
            setOpen(true)
            setLeaving(false)
          }
        }}
      >
        <span className="cp2-event-pill-icon" aria-hidden="true">
          {info.icon}
        </span>
        <span className="cp2-event-pill-name">{info.name}</span>
        <RoundDots left={left} total={total} />
      </button>

      {open ? (
        <div
          className={`cp2-event-card${leaving ? ' is-leaving' : ''}`}
          role="dialog"
          aria-label={`${info.name}, ${roundsLabel(left)} restantes`}
        >
          <header className="cp2-event-card-head">
            <span className="cp2-event-card-icon" aria-hidden="true">
              {info.icon}
            </span>
            <div>
              <span className="cp2-event-card-eyebrow">Evento activo</span>
              <strong>{info.name}</strong>
            </div>
            <button
              className="cp2-event-card-close"
              type="button"
              aria-label="Cerrar descripción del evento"
              onClick={close}
            >
              ×
            </button>
          </header>
          <p>{info.description}</p>
          <footer className="cp2-event-card-foot">
            <RoundDots left={left} total={total} />
            <span>{roundsLabel(left)} restantes</span>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
