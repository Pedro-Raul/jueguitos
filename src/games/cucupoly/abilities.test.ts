import { describe, expect, it } from 'vitest'
import type { Player } from '../../types'
import { abilityLabel, abilityView, ownedServices } from './abilities'
import { BOARD } from './board'
import { init, type CucupolyState } from './engine'

const ANA: Player = {
  id: 'p1',
  name: 'Ana',
  emoji: '🐙',
  color: '#e11d48',
  connected: true,
}
const BETO: Player = {
  id: 'p2',
  name: 'Beto',
  emoji: '🦊',
  color: '#2563eb',
  connected: true,
}

const WATER = BOARD.find((tile) => tile.service === 'water')!
const ELECTRICITY = BOARD.find((tile) => tile.service === 'electricity')!
const TELEPHONE = BOARD.find((tile) => tile.service === 'telephone')!

function fresh(players: Player[] = [ANA, BETO]): CucupolyState {
  return init(players, 7)
}

describe('habilidades de servicios', () => {
  it('solo lista los servicios que pertenecen al jugador', () => {
    const state = fresh()
    state.owners[WATER.index] = 'p1'
    state.owners[TELEPHONE.index] = 'p2'
    state.owners[1] = 'p1' // una propiedad normal no cuenta

    const mine = ownedServices(state.owners, 'p1')
    expect(mine.map((tile) => tile.index)).toEqual([WATER.index])
    expect(ownedServices(state.owners, 'p2').map((tile) => tile.index)).toEqual([
      TELEPHONE.index,
    ])
    expect(ownedServices(state.owners, 'p3')).toEqual([])
  })

  it('describe el efecto de cada servicio', () => {
    expect(abilityLabel(WATER)).toContain('Abastecimiento')
    expect(abilityLabel(ELECTRICITY)).toContain('Apagón')
    expect(abilityLabel(TELEPHONE)).toContain('Caída de red')
    expect(abilityLabel(BOARD[1])).toBe('Efecto especial')
  })

  it('distingue lista, activa y en espera, con la espera en rondas', () => {
    const state = fresh()
    state.abilities[WATER.index] = { from: 3, until: 7, readyAt: 20 }

    state.turnNumber = 2
    expect(abilityView(state, WATER.index, 2)).toEqual({
      active: false,
      ready: false,
      cooldownRounds: 9,
    })

    state.turnNumber = 3
    expect(abilityView(state, WATER.index, 2)).toEqual({
      active: true,
      ready: false,
      cooldownRounds: 0,
    })

    state.turnNumber = 7
    expect(abilityView(state, WATER.index, 2)).toEqual({
      active: false,
      ready: false,
      cooldownRounds: 7,
    })

    state.turnNumber = 20
    expect(abilityView(state, WATER.index, 2)).toEqual({
      active: false,
      ready: true,
      cooldownRounds: 0,
    })
  })

  it('cuenta la espera con una ronda más corta cuantos más jugadores haya', () => {
    const state = fresh()
    state.abilities[TELEPHONE.index] = { from: 0, until: 0, readyAt: 9 }
    state.turnNumber = 1

    expect(abilityView(state, TELEPHONE.index, 2).cooldownRounds).toBe(4)
    expect(abilityView(state, TELEPHONE.index, 4).cooldownRounds).toBe(2)
    // Sin jugadores activos nunca se divide por cero.
    expect(abilityView(state, TELEPHONE.index, 0).cooldownRounds).toBe(8)
  })
})
