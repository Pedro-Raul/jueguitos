import type { CSSProperties, KeyboardEvent } from 'react'
import type { Tile } from './board'
import {
  levelIcons,
  levelLabel,
  propertyBandIcon,
  propertyBuildCost,
  propertyGroupLabel,
  rentRowsFor,
} from './propertyView'
import { tileColor, tileTextColor } from './visual'

export type PropertyCardProps = {
  /** Casilla comprable del tablero. */
  propiedad: Tile
  /** Nivel de construcción actual: 0 casas, 1..4 casas o 5 = hotel. */
  nivel?: number
  /** La carta responde a clic/teclado (intercambio y construcción). */
  selectable?: boolean
  /** Marca visual de selección; solo tiene efecto con `selectable`. */
  selected?: boolean
  /** Bloquea la interacción y muestra el motivo. */
  disabled?: boolean
  disabledReason?: string
  /** Versión reducida para listas y menús compactos. */
  compact?: boolean
  /** Hipotecada. El juego actual no tiene hipotecas; queda para el futuro. */
  mortgaged?: boolean
  onClick?: (tile: Tile) => void
}

const TYPE_LABELS: Record<Tile['type'], string> = {
  go: 'Salida',
  property: 'Propiedad',
  bus: 'Buseta',
  service: 'Servicio',
  treasury: 'Tesorería',
  tax: 'Impuesto',
  chance: 'Sorpresa',
  jail: 'Cárcel',
  parking: 'Estacionamiento',
  'go-to-jail': 'Ir a la cárcel',
  park: 'Parque',
  betting: 'Tragamonedas',
}

/**
 * Carta de propiedad estilo Monopoly. No conoce el estado global ni despacha
 * acciones: el visor, el intercambio y la construcción la reutilizan igual.
 */
export function PropertyCard({
  propiedad,
  nivel = 0,
  selectable = false,
  selected = false,
  disabled = false,
  disabledReason,
  compact = false,
  mortgaged = false,
  onClick,
}: PropertyCardProps) {
  const groupLabel = propertyGroupLabel(propiedad)
  const bandIcon = propertyBandIcon(propiedad)
  const groupColor = propiedad.type === 'property' ? tileColor(propiedad) : null
  const bandStyle = groupColor
    ? ({ '--prop-band': groupColor, '--prop-band-ink': tileTextColor(propiedad) } as CSSProperties)
    : undefined
  const buildCost = propertyBuildCost(propiedad)
  const rentRows = rentRowsFor(propiedad)
  const interactive = selectable && Boolean(onClick)
  const blocked = disabled
  const canActivate = interactive && !disabled

  const activate = () => {
    if (!canActivate) return
    onClick?.(propiedad)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  const className = [
    'cp-prop-card',
    selectable ? 'is-selectable' : '',
    selected ? 'is-selected' : '',
    disabled ? 'is-disabled' : '',
    compact ? 'is-compact' : '',
    groupColor ? 'has-color' : 'is-neutral',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      className={className}
      style={bandStyle}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-disabled={blocked ? true : undefined}
      aria-label={
        interactive
          ? `${propiedad.name}${disabled && disabledReason ? `. ${disabledReason}` : ''}`
          : undefined
      }
      title={disabled && disabledReason ? disabledReason : undefined}
      onClick={interactive ? activate : undefined}
      onKeyDown={handleKeyDown}
    >
      <span className="cp-prop-band" aria-hidden="true">
        {bandIcon ? <span className="cp-prop-band-icon">{bandIcon}</span> : null}
        <span className="cp-prop-band-label">{groupLabel}</span>
      </span>

      <div className="cp-prop-content">
        <header className="cp-prop-title-row">
          <span className="cp-prop-type">{TYPE_LABELS[propiedad.type]}</span>
          <h3 className="cp-prop-name">{propiedad.name}</h3>
          {propiedad.price !== undefined ? (
            <strong className="cp-prop-price">${propiedad.price}</strong>
          ) : null}
        </header>

        {rentRows.length > 0 ? (
          <table className="cp-prop-rent">
            <caption>Alquiler</caption>
            <tbody>
              {rentRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <dl className="cp-prop-facts">
          {propiedad.type === 'property' ? (
            <>
              <dt>Nivel</dt>
              <dd className="cp-prop-level">
                <span aria-hidden="true">{levelIcons(nivel) || '—'}</span>
                <span>{levelLabel(nivel)}</span>
              </dd>
              {buildCost !== null ? (
                <>
                  <dt>Casa</dt>
                  <dd>${buildCost}</dd>
                  <dt>Hotel</dt>
                  <dd>${buildCost}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>

        {mortgaged ? <span className="cp-prop-mortgaged">Hipotecada</span> : null}
        {blocked && disabledReason ? (
          <span className="cp-prop-blocked" role="note">
            🔒 {disabledReason}
          </span>
        ) : null}
      </div>
    </article>
  )
}
