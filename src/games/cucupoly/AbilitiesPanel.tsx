import type { GameAction } from '../../types'
import { abilityLabel, abilityView, ownedServices } from './abilities'
import type { CucupolyState } from './engine'

type Props = {
  state: CucupolyState
  meId: string
  dispatch: (action: GameAction) => void
}

/**
 * Habilidades de los servicios en propiedad. Solo se puede activar una en el
 * propio turno, antes de tirar; el motor valida la regla otra vez.
 */
export function AbilitiesPanel({ state, meId, dispatch }: Props) {
  const services = ownedServices(state.owners, meId)
  const activePlayers = state.turnOrder.filter(
    (id) => !state.bankrupt.includes(id),
  ).length
  const canActivate =
    state.phase === 'waiting-roll' &&
    !state.endTurnPending &&
    state.dice === null &&
    state.turnOrder[state.currentIndex] === meId &&
    !state.bankrupt.includes(meId)
  const readyCount = services.filter(
    (tile) => abilityView(state, tile.index, activePlayers).ready,
  ).length

  if (services.length === 0) {
    return (
      <details className="cp-trade cp-abilities">
        <summary>Habilidades</summary>
        <p className="muted small">Necesitas un servicio para usar habilidades.</p>
      </details>
    )
  }

  return (
    <details className="cp-trade cp-abilities">
      <summary>
        Habilidades
        {readyCount > 0 ? (
          <span className="cp-ability-badge">
            {readyCount} {readyCount === 1 ? 'lista' : 'listas'}
          </span>
        ) : null}
      </summary>
      <p className="muted small">
        Solo puedes activar una habilidad en tu turno, antes de tirar.
      </p>
      <ul className="cp-ability-list">
        {services.map((tile) => {
          const view = abilityView(state, tile.index, activePlayers)
          const status = view.active
            ? 'activa'
            : view.ready
              ? 'lista'
              : `espera ${view.cooldownRounds} r.`
          return (
            <li
              key={tile.index}
              className={`cp-ability${view.active ? ' is-active' : ''}`}
            >
              <div className="cp-ability-info">
                <strong>{tile.name}</strong>
                <span className="muted small">{abilityLabel(tile)}</span>
              </div>
              <span className="cp-ability-state">{status}</span>
              <button
                className="ghost small-btn"
                type="button"
                disabled={!view.ready || !canActivate}
                onClick={() =>
                  dispatch({
                    type: 'activate-ability',
                    payload: { tileId: tile.index },
                  })
                }
              >
                Activar
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
