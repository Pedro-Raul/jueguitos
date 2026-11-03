import type { GameDefinition } from '../../types'
import { CucupolyView } from './CucupolyView'
import { init, reduce, type CucupolyState } from './engine'

/**
 * Cucupoly: Monopoly de 48 casillas para 2–6 jugadores.
 * El anfitrión es autoritativo; todo el azar sale de `state.seed`.
 */
const cucupoly: GameDefinition<CucupolyState> = {
  id: 'cucupoly',
  name: 'Cucupoly',
  description:
    'Monopoly cucuteño de 48 casillas con eventos que cambian la partida, mesa de 31, busetas y habilidades de servicios.',
  minPlayers: 2,
  maxPlayers: 6,
  init,
  reduce,
  View: CucupolyView,
}

export default cucupoly
