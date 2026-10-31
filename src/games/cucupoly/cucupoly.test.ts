import { describe, expect, it } from 'vitest'
import { isGameError, type Player } from '../../types'
import { BOARD, BUS_TILES } from './board'
import {
  CHANCE_EVENTS,
  init,
  nextSeed,
  reduce,
  rentFor,
  type CucupolyState,
} from './engine'
import { RULES } from './rules.config'

const ANA: Player = { id: 'p1', name: 'Ana', emoji: '🐙', color: '#e11d48', connected: true }
const BETO: Player = { id: 'p2', name: 'Beto', emoji: '🦊', color: '#2563eb', connected: true }
const CARO: Player = { id: 'p3', name: 'Caro', emoji: '🐸', color: '#16a34a', connected: true }
const TWO = [ANA, BETO]
const THREE = [ANA, BETO, CARO]

/** Estado limpio: resuelve la subasta inicial haciendo que todos pasen. */
function fresh(players: Player[] = TWO, seed = 7): CucupolyState {
  let state = init(players, seed)
  while (state.phase === 'auction' && state.auction) {
    const id = state.auction.pending[0]
    state = reduce(state, { type: 'bid', payload: { amount: 0 } }, id) as CucupolyState
  }
  return state
}

/** Primer seed cuyo dado (1..6) da `target`. */
function seedForDie(target: number): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    const next = nextSeed(seed)
    if (1 + Math.floor(next.value * 6) === target) return seed
  }
  throw new Error(`Sin seed para el dado ${target}`)
}

/** Simula los dados que saldrán de un seed. */
function rollOutcome(seed: number, dice: number): { total: number; seed: number } {
  let current = seed
  let total = 0
  for (let i = 0; i < dice; i += 1) {
    const next = nextSeed(current)
    current = next.seed
    total += 1 + Math.floor(next.value * 6)
  }
  return { total, seed: current }
}

/** Seed que, tras `dice` dados, saca el evento de sorpresa `eventIndex`. */
function seedForChance(dice: number, eventIndex: number): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    const { seed: afterDice } = rollOutcome(seed, dice)
    const event = nextSeed(afterDice).value
    if (Math.floor(event * CHANCE_EVENTS.length) === eventIndex) return seed
  }
  throw new Error(`Sin seed para el evento ${eventIndex}`)
}

/** Deja al jugador actual a punto de caer en la casilla `tileId` con 2 dados. */
function aimAtChance(state: CucupolyState, playerId: string, seed: number): CucupolyState {
  const { total } = rollOutcome(seed, 2)
  const target = 9 // Sorpresa
  state.seed = seed
  state.phase = 'waiting-roll'
  state.currentIndex = state.order.indexOf(playerId)
  state.positions[playerId] = (target - total + 48) % 48
  return state
}

describe('tablero', () => {
  it('tiene 48 casillas con 4 busetas y 3 servicios', () => {
    expect(BOARD).toHaveLength(48)
    expect(BOARD.filter((tile) => tile.type === 'bus').map((tile) => tile.index)).toEqual([
      5, 17, 30, 42,
    ])
    expect(BOARD.filter((tile) => tile.type === 'service').map((tile) => tile.index)).toEqual([
      6, 15, 34,
    ])
    expect(BUS_TILES).toHaveLength(4)
  })
})

describe('evento: subasta sorpresa inicial', () => {
  it('saca una propiedad al 75% y cobra la puja ganadora', () => {
    const state = init(TWO, 99)
    expect(state.phase).toBe('auction')
    const auction = state.auction
    expect(auction).not.toBeNull()
    const tile = BOARD[auction!.tileId]
    expect(tile.type).toBe('property')
    expect(auction!.minBid).toBe(Math.round((tile.price ?? 0) * RULES.auctionStartRate))

    let after = reduce(state, { type: 'bid', payload: { amount: auction!.minBid } }, 'p1')
    expect(isGameError(after)).toBe(false)
    after = reduce(after as CucupolyState, { type: 'bid', payload: { amount: 0 } }, 'p2')

    const resolved = after as CucupolyState
    expect(resolved.phase).toBe('waiting-roll')
    expect(resolved.owners[auction!.tileId]).toBe('p1')
    expect(resolved.money.p1).toBe(RULES.startingMoney - auction!.minBid)
  })

  it('deja la propiedad sin dueño si todos pasan', () => {
    const state = init(TWO, 99)
    const tileId = state.auction!.tileId
    let after = reduce(state, { type: 'bid', payload: { amount: 0 } }, 'p1') as CucupolyState
    after = reduce(after, { type: 'bid', payload: { amount: 0 } }, 'p2') as CucupolyState

    expect(after.phase).toBe('waiting-roll')
    expect(after.owners[tileId]).toBeUndefined()
    expect(after.money.p1).toBe(RULES.startingMoney)
  })

  it('rechaza pujas por debajo del mínimo', () => {
    const state = init(TWO, 99)
    const result = reduce(
      state,
      { type: 'bid', payload: { amount: state.auction!.minBid - 1 } },
      'p1',
    )
    expect(isGameError(result)).toBe(true)
  })
})

describe('habilidad Ser. Agua: Abastecimiento', () => {
  it('sube un 15% las rentas del dueño durante una ronda', () => {
    const state = fresh()
    state.owners[1] = 'p1' // Fortaleza $60 => renta base 6
    state.owners[6] = 'p1' // Ser. Agua
    state.abilities[6] = { from: 1, until: 3, readyAt: 15 }

    state.turnNumber = 1
    expect(rentFor(state, 1, 7)).toBe(7) // round(6 * 1.15)

    state.turnNumber = 3 // la ventana ya terminó
    expect(rentFor(state, 1, 7)).toBe(6)
  })

  it('solo la puede activar el dueño en su turno', () => {
    const state = fresh()
    state.owners[6] = 'p1'
    state.phase = 'waiting-roll'
    state.currentIndex = 0

    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: 6 } }, 'p2')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: 15 } }, 'p1')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: 6 } }, 'p1')),
    ).toBe(false)
  })
})

describe('habilidad Ser. Luz: Apagón', () => {
  it('impide comprar mientras está activa', () => {
    const state = fresh()
    state.owners[15] = 'p1'
    state.abilities[15] = { from: 0, until: 3, readyAt: 15 }
    state.turnNumber = 1
    state.currentIndex = 1
    state.phase = 'buy-decision'
    state.pendingBuy = 1

    const result = reduce(state, { type: 'buy' }, 'p2')
    expect(isGameError(result)).toBe(true)
  })

  it('salta la decisión de compra al caer en una casilla libre', () => {
    const state = fresh()
    state.owners[15] = 'p1'
    state.abilities[15] = { from: 0, until: 10, readyAt: 0 }
    state.turnNumber = 1
    state.currentIndex = 1
    state.seed = seedForDie(1)
    state.diceModifier = { from: 0, until: 2, dice: 1 }
    state.positions.p2 = 0 // con un dado de 1 cae en Fortaleza ($60)

    const after = reduce(state, { type: 'roll' }, 'p2') as CucupolyState
    expect(after.phase).toBe('waiting-roll')
    expect(after.owners[1]).toBeUndefined()
    expect(after.log.some((entry) => entry.text.includes('Apagón'))).toBe(true)
  })
})

describe('habilidad Ser. Tel: Caída de red', () => {
  it('permite al dueño vetar tratos entre otros jugadores', () => {
    const state = fresh(THREE)
    state.owners[34] = 'p1'
    state.abilities[34] = { from: 0, until: 10, readyAt: 0 }
    state.turnNumber = 1
    state.currentIndex = 1 // turno de Beto
    state.phase = 'waiting-roll'
    state.money.p2 = 1500
    state.money.p3 = 1500

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: { to: 'p3', giveTiles: [], getTiles: [], giveMoney: 100, getMoney: 0 },
      },
      'p2',
    ) as CucupolyState

    expect(proposed.phase).toBe('trade')
    expect(proposed.trade!.stage).toBe('veto')
    expect(proposed.trade!.vetoer).toBe('p1')
    expect(isGameError(reduce(proposed, { type: 'accept-trade' }, 'p3'))).toBe(true)

    const vetoed = reduce(proposed, { type: 'veto-trade' }, 'p1') as CucupolyState
    expect(vetoed.trade).toBeNull()
    expect(vetoed.phase).toBe('waiting-roll')
    expect(vetoed.money.p2).toBe(1500)
    expect(vetoed.money.p3).toBe(1500)
  })

  it('deja pasar el trato y permite aceptarlo', () => {
    const state = fresh(THREE)
    state.owners[34] = 'p1'
    state.abilities[34] = { from: 0, until: 10, readyAt: 0 }
    state.currentIndex = 1
    state.phase = 'waiting-roll'

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: { to: 'p3', giveTiles: [], getTiles: [], giveMoney: 100, getMoney: 0 },
      },
      'p2',
    ) as CucupolyState
    const allowed = reduce(proposed, { type: 'allow-trade' }, 'p1') as CucupolyState
    expect(allowed.trade!.stage).toBe('pending')

    const accepted = reduce(allowed, { type: 'accept-trade' }, 'p3') as CucupolyState
    expect(accepted.trade).toBeNull()
    expect(accepted.money.p2).toBe(RULES.startingMoney - 100)
    expect(accepted.money.p3).toBe(RULES.startingMoney + 100)
  })

  it('no interviene si el dueño es una de las partes', () => {
    const state = fresh(THREE)
    state.owners[34] = 'p1'
    state.abilities[34] = { from: 0, until: 10, readyAt: 0 }
    state.currentIndex = 1
    state.phase = 'waiting-roll'

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: { to: 'p1', giveTiles: [], getTiles: [], giveMoney: 50, getMoney: 0 },
      },
      'p2',
    ) as CucupolyState
    expect(proposed.trade!.stage).toBe('pending')
  })
})

describe('habilidad de ruta de busetas', () => {
  it('salta gratis a la siguiente buseta con las 4 en propiedad', () => {
    const state = fresh()
    for (const tile of BUS_TILES) state.owners[tile] = 'p1'
    state.positions.p1 = 5
    state.phase = 'bus-move'
    state.pendingBus = 5
    state.dice = { values: [2], total: 2 }
    state.currentIndex = 0

    const after = reduce(state, { type: 'bus-move' }, 'p1') as CucupolyState
    expect(after.positions.p1).toBe(17)
    expect(after.phase).toBe('waiting-roll')
    expect(after.log.some((entry) => entry.text.includes('usa la ruta'))).toBe(true)
  })

  it('no ofrece el salto si falta alguna buseta', () => {
    const state = fresh()
    state.owners[5] = 'p1'
    state.owners[17] = 'p1'
    state.owners[30] = 'p1'
    state.turnNumber = 0
    state.currentIndex = 0
    state.seed = seedForDie(1)
    state.positions.p1 = 4 // con un dado de 1 cae en la buseta 5
    state.diceModifier = { from: 0, until: 1, dice: 1 }

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.positions.p1).toBe(5)
    expect(after.phase).toBe('waiting-roll')
    expect(after.pendingBus).toBeNull()
  })
})

describe('rondas de espera de las habilidades', () => {
  it('descansa 6 rondas tras una ronda de efecto', () => {
    const state = fresh()
    state.owners[6] = 'p1'
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.turnNumber = 0

    const activated = reduce(
      state,
      { type: 'activate-ability', payload: { tileId: 6 } },
      'p1',
    ) as CucupolyState

    // 2 jugadores: efecto en los turnos 1-2, espera hasta el 15.
    expect(activated.abilities[6]).toEqual({ from: 1, until: 3, readyAt: 15 })

    activated.turnNumber = 14
    expect(
      isGameError(reduce(activated, { type: 'activate-ability', payload: { tileId: 6 } }, 'p1')),
    ).toBe(true)

    activated.turnNumber = 15
    const again = reduce(
      activated,
      { type: 'activate-ability', payload: { tileId: 6 } },
      'p1',
    ) as CucupolyState
    expect(again.abilities[6].from).toBe(16)
    expect(again.abilities[6].readyAt).toBe(30)
  })

  it('no se puede reactivar mientras está activa', () => {
    const state = fresh()
    state.owners[6] = 'p1'
    state.abilities[6] = { from: 1, until: 3, readyAt: 15 }
    state.turnNumber = 2
    state.currentIndex = 0
    state.phase = 'waiting-roll'

    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: 6 } }, 'p1')),
    ).toBe(true)
  })
})

describe('evento: mesa de 31', () => {
  it('una sorpresa abre la mesa para todos los activos', () => {
    const state = fresh()
    const seed = seedForChance(2, 0)
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.phase).toBe('thirty-one')
    expect(after.table31).not.toBeNull()
    expect(after.table31!.stage).toBe('bets')
    expect(after.table31!.pendingBets).toEqual(['p1', 'p2'])
  })

  it('cobra las apuestas, reparte el pozo y devuelve la apuesta al ganador', () => {
    const state = fresh()
    const seed = seedForChance(2, 0)
    aimAtChance(state, 'p1', seed)
    let after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    after = reduce(after, { type: 'join-table', payload: { bet: 50 } }, 'p1') as CucupolyState
    after = reduce(after, { type: 'pass-table' }, 'p2') as CucupolyState
    expect(after.table31!.stage).toBe('draw')
    expect(after.money.p1).toBe(RULES.startingMoney - 50)

    after = reduce(after, { type: 'draw-card' }, 'p1') as CucupolyState
    expect(after.table31!.hands.p1).toBeGreaterThan(0)
    after = reduce(after, { type: 'stand' }, 'p1') as CucupolyState

    expect(after.phase).toBe('waiting-roll')
    expect(after.table31).toBeNull()
    expect(after.money.p1).toBe(RULES.startingMoney)
  })

  it('reparte el pozo entre los empatados', () => {
    const state = fresh()
    state.phase = 'thirty-one'
    state.currentIndex = 0
    state.money.p1 = 1450
    state.money.p2 = 1450
    state.table31 = {
      stage: 'draw',
      pendingBets: [],
      participants: ['p1', 'p2'],
      bets: { p1: 50, p2: 50 },
      hands: { p1: 20, p2: 20 },
      busted: [],
      standing: [],
      drawOrder: ['p1', 'p2'],
      drawIndex: 0,
      pot: 100,
    }

    let after = reduce(state, { type: 'stand' }, 'p1') as CucupolyState
    after = reduce(after, { type: 'stand' }, 'p2') as CucupolyState

    expect(after.money.p1).toBe(1500)
    expect(after.money.p2).toBe(1500)
    expect(after.phase).toBe('waiting-roll')
  })

  it('devuelve las apuestas si todos se pasan de 31', () => {
    const state = fresh()
    state.phase = 'thirty-one'
    state.currentIndex = 0
    state.money.p1 = 1450
    state.money.p2 = 1450
    state.table31 = {
      stage: 'draw',
      pendingBets: [],
      participants: ['p1', 'p2'],
      bets: { p1: 50, p2: 50 },
      hands: { p1: 32, p2: 35 },
      busted: ['p1', 'p2'],
      standing: [],
      drawOrder: ['p1', 'p2'],
      drawIndex: 0,
      pot: 100,
    }

    // p1 se planta y el turno pasa directo a p2, que ya está pasado.
    const after = reduce(state, { type: 'stand' }, 'p1') as CucupolyState

    expect(after.money.p1).toBe(1500)
    expect(after.money.p2).toBe(1500)
    expect(after.table31).toBeNull()
  })
})

describe('evento: vamos despacio (1 dado)', () => {
  it('la siguiente ronda se tira con un solo dado', () => {
    const state = fresh()
    const seed = seedForChance(2, 1)
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.diceModifier).toEqual({ from: 1, until: 3, dice: 1 })

    // Coloca a p2 para que caiga en Fortaleza (sin dueño) y no se cierre el turno.
    const total = rollOutcome(after.seed, 1).total
    after.positions.p2 = (1 - total + 48) % 48
    const next = reduce(after, { type: 'roll' }, 'p2') as CucupolyState
    expect(next.dice!.values).toHaveLength(1)
    expect(next.dice!.total).toBe(next.dice!.values[0])
  })
})

describe('evento: vamos rápido (3 dados)', () => {
  it('la siguiente ronda se tira con tres dados', () => {
    const state = fresh()
    const seed = seedForChance(2, 2)
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.diceModifier).toEqual({ from: 1, until: 3, dice: 3 })

    // Coloca a p2 para que caiga en Fortaleza (sin dueño) y no se cierre el turno.
    const total = rollOutcome(after.seed, 3).total
    after.positions.p2 = (1 - total + 48) % 48
    const next = reduce(after, { type: 'roll' }, 'p2') as CucupolyState
    expect(next.dice!.values).toHaveLength(3)
    expect(next.dice!.total).toBe(
      next.dice!.values.reduce((sum, value) => sum + value, 0),
    )
  })
})

describe('movimiento con 1 y 3 dados', () => {
  it('avanza la ficha la suma exacta de los dados', () => {
    const state = fresh()
    state.diceModifier = { from: 0, until: 1, dice: 1 }
    state.seed = seedForDie(4)
    state.currentIndex = 0
    state.positions.p1 = 10

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.dice!.total).toBe(4)
    expect(after.positions.p1).toBe(14)
  })

  it('con 3 dados avanza entre 3 y 18 casillas', () => {
    const state = fresh()
    state.diceModifier = { from: 0, until: 1, dice: 3 }
    state.currentIndex = 0
    state.positions.p1 = 10

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.dice!.values).toHaveLength(3)
    expect(after.dice!.total).toBeGreaterThanOrEqual(3)
    expect(after.dice!.total).toBeLessThanOrEqual(18)
    expect(after.positions.p1).toBe((10 + after.dice!.total) % 48)
  })
})

describe('rentas', () => {
  it('las busetas suben según cuántas tenga el dueño', () => {
    const state = fresh()
    state.owners[5] = 'p1'
    expect(rentFor(state, 5, 7)).toBe(RULES.busRents[0])

    state.owners[17] = 'p1'
    expect(rentFor(state, 5, 7)).toBe(RULES.busRents[1])

    state.owners[30] = 'p1'
    state.owners[42] = 'p1'
    expect(rentFor(state, 5, 7)).toBe(RULES.busRents[3])
  })

  it('los servicios multiplican los dados según cuántos tenga el dueño', () => {
    const state = fresh()
    state.owners[6] = 'p1'
    expect(rentFor(state, 6, 7)).toBe(4 * 7)

    state.owners[15] = 'p1'
    expect(rentFor(state, 6, 7)).toBe(10 * 7)

    state.owners[34] = 'p1'
    expect(rentFor(state, 6, 7)).toBe(15 * 7)
  })
})

describe('bancarrota', () => {
  it('elimina al jugador, transfiere sus propiedades al acreedor y gana el último', () => {
    const state = fresh()
    state.owners[1] = 'p2' // Fortaleza: renta 6
    state.owners[3] = 'p1' // Los Estoraques: pasa al acreedor
    state.money.p1 = 5
    state.positions.p1 = 0
    state.positions.p2 = 20
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1) // cae en Fortaleza (1)
    state.diceModifier = { from: 0, until: 1, dice: 1 }

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    expect(after.bankrupt).toContain('p1')
    expect(after.money.p1).toBe(0)
    expect(after.owners[3]).toBe('p2')
    expect(after.money.p2).toBe(RULES.startingMoney + 5)
    expect(after.phase).toBe('finished')
    expect(after.winner).toBe('p2')
  })
})

describe('pureza', () => {
  it('reduce no muta el estado de entrada', () => {
    const state = fresh()
    state.owners[6] = 'p1'
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    const snapshot = JSON.stringify(state)

    reduce(state, { type: 'activate-ability', payload: { tileId: 6 } }, 'p1')
    reduce(state, { type: 'roll' }, 'p1')

    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
