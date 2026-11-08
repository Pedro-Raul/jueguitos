import { BOARD, type Tile } from './board'
import type { CucupolyState } from './engine'

export type AbilityView = {
  /** La habilidad está surtiendo efecto ahora mismo. */
  active: boolean
  /** Puede activarse en este momento (sin contar turno ni fase). */
  ready: boolean
  /** Rondas que faltan para volver a activarla; 0 si está lista o activa. */
  cooldownRounds: number
}

/** Servicios cuyo dueño es el jugador, en el orden del tablero. */
export function ownedServices(
  owners: Record<number, string | null>,
  playerId: string,
): Tile[] {
  return BOARD.filter(
    (tile) => tile.type === 'service' && owners[tile.index] === playerId,
  )
}

/** Texto corto con el efecto de un servicio. */
export function abilityLabel(tile: Tile): string {
  switch (tile.service) {
    case 'water':
      return 'Abastecimiento: +15% a tus rentas'
    case 'electricity':
      return 'Apagón: nadie puede comprar'
    case 'telephone':
      return 'Caída de red: puedes vetar tratos'
    default:
      return 'Efecto especial'
  }
}

/**
 * Estado visible de una habilidad. El motor guarda turnos absolutos; la espera
 * se muestra en rondas dividiendo por los jugadores activos, igual que hacía el
 * panel original.
 */
export function abilityView(
  state: CucupolyState,
  tileId: number,
  activePlayers: number,
): AbilityView {
  const ability = state.abilities[tileId]
  if (!ability) return { active: false, ready: true, cooldownRounds: 0 }

  const active =
    state.turnNumber >= ability.from && state.turnNumber < ability.until
  const turnsLeft = Math.max(0, ability.readyAt - state.turnNumber)
  const perRound = Math.max(1, activePlayers)

  return {
    active,
    ready: !active && turnsLeft === 0,
    cooldownRounds:
      active || turnsLeft === 0 ? 0 : Math.ceil(turnsLeft / perRound),
  }
}
