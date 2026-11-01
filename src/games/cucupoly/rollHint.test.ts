import { describe, expect, it } from 'vitest'
import type { CucupolyState } from './engine'
import type { LogEntry } from './engine'
import { latestRoll, rollKey } from './rollHint'

function withLog(turnNumber: number, log: LogEntry[]): CucupolyState {
  return { turnNumber, names: { p1: 'Ana', p2: 'Beto' }, log } as unknown as CucupolyState
}

describe('lectura de la última tirada', () => {
  it('encuentra la tirada del turno recién cerrado (dice ya está null)', () => {
    const state = withLog(3, [
      { turn: 2, text: 'Ana tira 4+3 = 7 y cae en Impuesto.' },
      { turn: 2, text: 'Ana paga $50 de Impuesto.' },
    ])
    expect(latestRoll(state)).toEqual({ turn: 2, player: 'p1', values: [4, 3], total: 7 })
  })

  it('también la encuentra si el turno sigue abierto (fase de compra)', () => {
    const state = withLog(5, [
      { turn: 4, text: 'Beto tira 2+5 = 7 y cae en Fortaleza.' },
    ])
    expect(latestRoll(state)).toEqual({ turn: 4, player: 'p2', values: [2, 5], total: 7 })
  })

  it('lee tiradas de un solo dado y de tres dados', () => {
    expect(
      latestRoll(withLog(6, [{ turn: 5, text: 'Ana tira 6 = 6 y cae en GO.' }]))?.values,
    ).toEqual([6])
    expect(
      latestRoll(withLog(6, [{ turn: 5, text: 'Ana tira 2+5+1 = 8 y cae en GO.' }]))?.values,
    ).toEqual([2, 5, 1])
  })

  it('ignora entradas sin tirada, como pasar turno en la cárcel', () => {
    const state = withLog(4, [
      { turn: 3, text: 'Ana sigue en la cárcel (1/3).' },
      { turn: 3, text: 'Ana paga $50 de fianza.' },
    ])
    expect(latestRoll(state)).toBeNull()
  })

  it('no rescata tiradas de turnos muy antiguos', () => {
    const state = withLog(9, [
      { turn: 3, text: 'Ana tira 1+1 = 2 y cae en Fortaleza.' },
    ])
    expect(latestRoll(state)).toBeNull()
  })

  it('no asigna la tirada a un nombre que no está en la sala', () => {
    const state = withLog(5, [{ turn: 4, text: 'Fantasma tira 3+2 = 5 y cae en GO.' }])
    expect(latestRoll(state)).toBeNull()
  })

  it('queda con el registro vacío', () => {
    expect(latestRoll(withLog(1, []))).toBeNull()
  })

  it('la clave de tirada es estable por turno y jugador', () => {
    const hint = { turn: 7, player: 'p1', values: [3, 4], total: 7 }
    expect(rollKey(hint)).toBe('7:p1')
  })
})
