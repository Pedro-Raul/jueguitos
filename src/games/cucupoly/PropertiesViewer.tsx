import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Player } from '../../types'
import type { CucupolyState } from './engine'
import { PropertyCard } from './PropertyCard'
import { groupProperties, ownedProperties } from './propertyView'

type PropertiesViewerProps = {
  state: CucupolyState
  players: Player[]
  meId: string
  onClose: () => void
}

function nameOf(state: CucupolyState, players: Player[], id: string): string {
  return state.names[id] ?? players.find((player) => player.id === id)?.name ?? 'Jugador'
}

/**
 * Visor de solo lectura de las propiedades de cualquier jugador. Vive en estado
 * local de React: no despacha acciones ni envía mensajes por PeerJS.
 */
export function PropertiesViewer({
  state,
  players,
  meId,
  onClose,
}: PropertiesViewerProps) {
  const [selectedId, setSelectedId] = useState(meId)
  const closeRef = useRef<HTMLButtonElement>(null)

  // El jugador local siempre queda preseleccionado al abrir el visor.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Si el jugador elegido deja la sala, vuelve al jugador local.
  useEffect(() => {
    if (state.order.includes(selectedId)) return
    setSelectedId(meId)
  }, [state.order, selectedId, meId])

  const selectedPlayer = players.find((player) => player.id === selectedId)
  const selectedName = nameOf(state, players, selectedId)
  const eliminated = state.bankrupt.includes(selectedId)
  const tiles = ownedProperties(state.owners, selectedId)
  const groups = groupProperties(tiles)

  const closeFromBackdrop = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose()
    },
    [onClose],
  )

  return (
    <div className="cp-prop-overlay" onClick={closeFromBackdrop}>
      <section
        className="cp-prop-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-properties-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cp-prop-head">
          <div className="cp-prop-head-text">
            <span className="cp-prop-eyebrow">Escrituras</span>
            <h2 id="cp-properties-title">Propiedades</h2>
          </div>
          <button
            ref={closeRef}
            className="cp-prop-close"
            type="button"
            aria-label="Cerrar propiedades"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="cp-prop-players" role="tablist" aria-label="Elegir jugador">
          {state.order.map((id) => {
            const player = players.find((candidate) => candidate.id === id)
            const active = id === selectedId
            const out = state.bankrupt.includes(id)
            return (
              <button
                key={id}
                className={`cp-prop-player${active ? ' is-active' : ''}${out ? ' is-out' : ''}`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(id)}
              >
                <span
                  className="avatar cp-prop-avatar"
                  style={{ backgroundColor: player?.color ?? '#999' }}
                  aria-hidden="true"
                >
                  {player?.emoji ?? '🙂'}
                </span>
                <span className="cp-prop-player-name">
                  {nameOf(state, players, id)}
                  {id === meId ? ' (tú)' : ''}
                </span>
                {out ? <span className="cp-prop-player-out">Eliminado</span> : null}
              </button>
            )
          })}
        </div>

        <div className="cp-prop-body">
          <div className="cp-prop-summary" aria-live="polite">
            <span className="cp-prop-summary-name">
              <span
                className="cp-prop-summary-dot"
                style={{ backgroundColor: selectedPlayer?.color ?? '#999' }}
                aria-hidden="true"
              />
              {selectedName}
            </span>
            <span className="cp-prop-summary-count">
              {tiles.length === 0
                ? 'Sin propiedades'
                : `${tiles.length} ${tiles.length === 1 ? 'propiedad' : 'propiedades'}`}
            </span>
          </div>

          {groups.length === 0 ? (
            <div className="cp-prop-empty">
              <span className="cp-prop-empty-icon" aria-hidden="true">
                {eliminated ? '💤' : '🏚️'}
              </span>
              <strong>
                {eliminated ? `${selectedName} está eliminado` : 'Todavía no hay propiedades'}
              </strong>
              <p>
                {eliminated
                  ? 'No conserva ninguna propiedad en la partida.'
                  : `${selectedName} aún no ha comprado ninguna casilla.`}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section className="cp-prop-group" key={group.key}>
                <header className="cp-prop-group-head">
                  <span
                    className={`cp-prop-group-dot${group.color ? '' : ' is-neutral'}`}
                    style={group.color ? { backgroundColor: group.color } : undefined}
                    aria-hidden="true"
                  />
                  <h3>{group.label}</h3>
                  <span className="cp-prop-group-count">
                    {group.tiles.length} {group.tiles.length === 1 ? 'carta' : 'cartas'}
                  </span>
                </header>
                <div className="cp-prop-grid">
                  {group.tiles.map((tile) => (
                    <PropertyCard
                      key={tile.index}
                      propiedad={tile}
                      nivel={state.buildings[tile.index] ?? 0}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
