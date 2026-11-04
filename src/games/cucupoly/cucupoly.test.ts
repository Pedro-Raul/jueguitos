import { describe, expect, it } from 'vitest'
import { isGameError, type Player } from '../../types'
import { BOARD, BUS_TILES, WATER_TILE } from './board'
import {
  CHANCE_EVENTS,
  init,
  nextSeed,
  reduce,
  rentFor,
  type CucupolyState,
  type Table31State,
} from './engine'
import {
  AUCTION_OPEN_IDLE_TICKS,
  EVENTS,
  EVENT_BANNER_MS,
  INITIAL_EVENT_POOL,
  MIN_RAISE,
  drawableEvents,
  freeAuctionTiles,
  purchasePriceFor,
} from './events'
import { RULES } from './rules.config'

const ANA: Player = { id: 'p1', name: 'Ana', emoji: '🐙', color: '#e11d48', connected: true }
const BETO: Player = { id: 'p2', name: 'Beto', emoji: '🦊', color: '#2563eb', connected: true }
const CARO: Player = { id: 'p3', name: 'Caro', emoji: '🐸', color: '#16a34a', connected: true }
const TWO = [ANA, BETO]
const THREE = [ANA, BETO, CARO]

/**
 * Estado limpio para aislar la regla bajo prueba. `init` arranca en el sorteo
 * de orden; este helper lo resuelve con valores descendentes para conservar el
 * orden de entrada que esperan los tests de ronda 1.
 */
function fresh(players: Player[] = TWO, seed = 7): CucupolyState {
  let state = init(players, seed)
  state.order.forEach((id, index) => {
    state = reduce(state, { type: 'request-order-roll' }, id) as CucupolyState
    state = reduce(
      state,
      { type: 'roll-for-order', payload: { playerId: id, value: 6 - index } },
      state.order[0],
    ) as CucupolyState
  })
  return reduce(state, { type: 'finish-turn-order' }, state.order[0]) as CucupolyState
}

/** Pide y aplica una tirada del sorteo de orden. */
function orderRoll(
  state: CucupolyState,
  playerId: string,
  value: number,
): CucupolyState {
  const requested = reduce(
    state,
    { type: 'request-order-roll' },
    playerId,
  ) as CucupolyState
  return reduce(
    requested,
    { type: 'roll-for-order', payload: { playerId, value } },
    requested.order[0],
  ) as CucupolyState
}

/** Cierra un turno sin tirar dados: declina una compra ficticia. */
function passTurn(state: CucupolyState, playerId: string): CucupolyState {
  const staged: CucupolyState = {
    ...state,
    phase: 'buy-decision',
    pendingBuy: 1,
    currentIndex: state.turnOrder.indexOf(playerId),
  }
  return reduce(staged, { type: 'decline' }, playerId) as CucupolyState
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
  state.currentIndex = state.turnOrder.indexOf(playerId)
  state.positions[playerId] = (target - total + 48) % 48
  return state
}

describe('tablero', () => {
  it('tiene 48 casillas con 4 busetas y 3 servicios', () => {
    expect(BOARD).toHaveLength(48)
    expect(BOARD.filter((tile) => tile.type === 'bus').map((tile) => tile.index)).toEqual([
      6, 18, 30, 42,
    ])
    expect(BOARD.filter((tile) => tile.type === 'service').map((tile) => tile.index)).toEqual([
      15, 19, 34,
    ])
    expect(BUS_TILES).toHaveLength(4)
  })
})

describe('evento inicial: ronda 2', () => {
  it('se dispara exactamente una vez, solo al empezar la ronda 2', () => {
    let state = fresh(TWO, 99)
    expect(state.initialEvent).toBeNull()
    expect(state.eventSeq).toBe(0)
    expect(state.phase).toBe('waiting-roll')

    // Ronda 1: no hay evento.
    state = passTurn(state, 'p1')
    expect(state.roundNumber).toBe(1)
    expect(state.phase).toBe('waiting-roll')

    // Al cerrar la ronda 1 y empezar la 2 se abre la fase de evento.
    state = passTurn(state, 'p2')
    expect(state.roundNumber).toBe(2)
    expect(state.phase).toBe('event')
    expect(state.initialEvent).toBeNull()

    // Nadie puede tirar hasta que el anfitrión aplique el evento.
    expect(isGameError(reduce(state, { type: 'roll' }, 'p1'))).toBe(true)
    // Solo el anfitrión (primer asiento) puede sortearlo.
    expect(
      isGameError(
        reduce(state, { type: 'start-initial-event', payload: { eventId: 'impulso_economico' } }, 'p2'),
      ),
    ).toBe(true)
    // Un id fuera del catálogo se rechaza.
    expect(
      isGameError(
        reduce(state, { type: 'start-initial-event', payload: { eventId: 'evento_inventado' } }, 'p1'),
      ),
    ).toBe(true)

    state = reduce(
      state,
      { type: 'start-initial-event', payload: { eventId: 'impulso_economico' } },
      'p1',
    ) as CucupolyState
    expect(state.initialEvent).toBe('impulso_economico')
    expect(state.eventSeq).toBe(1)
    expect(state.phase).toBe('waiting-roll')

    // No se puede repetir ni cambiar el evento.
    expect(
      isGameError(
        reduce(state, { type: 'start-initial-event', payload: { eventId: 'semana_descuentos' } }, 'p1'),
      ),
    ).toBe(true)

    // Rondas 3 y 4: la fase de evento no vuelve a abrirse.
    state = passTurn(state, 'p1')
    state = passTurn(state, 'p2')
    expect(state.roundNumber).toBe(3)
    expect(state.phase).toBe('waiting-roll')
    expect(state.eventSeq).toBe(1)

    state = passTurn(state, 'p1')
    state = passTurn(state, 'p2')
    expect(state.roundNumber).toBe(4)
    expect(state.phase).toBe('waiting-roll')
    expect(state.eventSeq).toBe(1)
  })

  it('Impulso Económico: +$250 a cada jugador activo, una sola vez', () => {
    const base = fresh(THREE, 99)
    base.bankrupt.push('p3')
    base.money.p3 = 0

    let state = passTurn(base, 'p1')
    state = passTurn(state, 'p2')
    expect(state.roundNumber).toBe(2)
    expect(state.phase).toBe('event')

    const before = { ...state.money }
    state = reduce(
      state,
      { type: 'start-initial-event', payload: { eventId: 'impulso_economico' } },
      'p1',
    ) as CucupolyState

    expect(state.money.p1).toBe(before.p1 + RULES.initialEventBoost)
    expect(state.money.p2).toBe(before.p2 + RULES.initialEventBoost)
    expect(state.money.p3).toBe(0) // eliminado: no cobra
    expect(state.eventSeq).toBe(1)
    expect(state.log.some((entry) => entry.text.includes('Impulso Económico'))).toBe(true)

    // Un segundo intento no vuelve a repartir dinero.
    expect(
      isGameError(
        reduce(state, { type: 'start-initial-event', payload: { eventId: 'impulso_economico' } }, 'p1'),
      ),
    ).toBe(true)
    expect(state.money.p1).toBe(before.p1 + RULES.initialEventBoost)
  })

  it('Semana de descuentos: mitad de precio solo en las rondas 3, 4 y 5', () => {
    expect(purchasePriceFor(100, 'semana_descuentos', 2)).toBe(100)
    expect(purchasePriceFor(100, 'semana_descuentos', 3)).toBe(50)
    expect(purchasePriceFor(100, 'semana_descuentos', 4)).toBe(50)
    expect(purchasePriceFor(100, 'semana_descuentos', 5)).toBe(50)
    expect(purchasePriceFor(100, 'semana_descuentos', 6)).toBe(100)
    expect(purchasePriceFor(100, 'impulso_economico', 3)).toBe(100)
    expect(purchasePriceFor(100, null, 3)).toBe(100)
    // Redondeo a entero.
    expect(purchasePriceFor(75, 'semana_descuentos', 3)).toBe(38)
  })

  it('Semana de descuentos: el cobro coincide con el precio mostrado', () => {
    const basePrice = BOARD[1].price ?? 0
    const discounted = purchasePriceFor(basePrice, 'semana_descuentos', 3)

    const state = fresh(TWO, 99)
    state.initialEvent = 'semana_descuentos'
    state.roundNumber = 3
    state.phase = 'buy-decision'
    state.pendingBuy = 1
    state.currentIndex = 0

    const after = reduce(state, { type: 'buy' }, 'p1') as CucupolyState
    expect(after.owners[1]).toBe('p1')
    expect(after.money.p1).toBe(RULES.startingMoney - discounted)
    expect(after.money.p1).toBe(RULES.startingMoney - Math.round(basePrice / 2))
  })

  it('Semana de descuentos: en la ronda 6 vuelve a cobrar el precio completo', () => {
    const basePrice = BOARD[1].price ?? 0
    const state = fresh(TWO, 99)
    state.initialEvent = 'semana_descuentos'
    state.roundNumber = 6
    state.phase = 'buy-decision'
    state.pendingBuy = 1
    state.currentIndex = 0

    const after = reduce(state, { type: 'buy' }, 'p1') as CucupolyState
    expect(after.money.p1).toBe(RULES.startingMoney - basePrice)
  })
})

describe('catálogo de eventos', () => {
  it('incluye los cuatro eventos de la fase', () => {
    expect(INITIAL_EVENT_POOL).toEqual([
      'impulso_economico',
      'semana_descuentos',
      'oferta_secreta',
      'puja_abierta',
    ])
    expect(Object.keys(EVENTS).sort()).toEqual([...INITIAL_EVENT_POOL].sort())
    for (const id of INITIAL_EVENT_POOL) {
      expect(EVENTS[id].name.length).toBeGreaterThan(0)
      expect(EVENTS[id].description.length).toBeGreaterThan(0)
    }
    expect(EVENT_BANNER_MS).toBeGreaterThanOrEqual(5000)
  })
})

describe('subastas de evento', () => {
  function reachRoundTwo(players: Player[] = TWO): CucupolyState {
    let state = fresh(players, 99)
    for (const player of players) state = passTurn(state, player.id)
    expect(state.phase).toBe('event')
    return state
  }

  function startAuction(
    state: CucupolyState,
    eventId: 'oferta_secreta' | 'puja_abierta',
    tileId = 1,
    host = 'p1',
  ): CucupolyState | { error: string } {
    return reduce(
      state,
      { type: 'start-initial-event', payload: { eventId, tileId } },
      host,
    )
  }

  function openAuction(state: CucupolyState, host = 'p1'): CucupolyState {
    return reduce(state, { type: 'open-initial-auction' }, host) as CucupolyState
  }

  it('elige una propiedad sin dueño y no subasta casillas ocupadas', () => {
    const free = freeAuctionTiles({})
    expect(free.length).toBeGreaterThan(1)
    expect(drawableEvents({})).toEqual([...INITIAL_EVENT_POOL])

    const allOwned: Record<number, string> = {}
    for (const tile of BOARD) {
      if (tile.price !== undefined) allOwned[tile.index] = 'p1'
    }
    expect(freeAuctionTiles(allOwned)).toEqual([])
    // Sin propiedades libres, las subastas salen del sorteo.
    expect(drawableEvents(allOwned)).toEqual(['impulso_economico', 'semana_descuentos'])

    const state = reachRoundTwo()
    state.owners[free[0]] = 'p2'
    expect(isGameError(startAuction(state, 'oferta_secreta', free[0]))).toBe(true)

    const started = startAuction(state, 'oferta_secreta', free[1]) as CucupolyState
    expect(started.initialEvent).toBe('oferta_secreta')
    // El anuncio sigue en pantalla: la subasta aún no está abierta.
    expect(started.phase).toBe('event')
    expect(started.auction).toMatchObject({ tileId: free[1], mode: 'sealed' })
    expect(started.auction?.pending).toEqual(['p1', 'p2'])

    // Solo el anfitrión abre la subasta, y solo después del anuncio.
    expect(isGameError(reduce(started, { type: 'open-initial-auction' }, 'p2'))).toBe(true)
    expect(isGameError(reduce(started, { type: 'roll' }, 'p1'))).toBe(true)

    const opened = openAuction(started)
    expect(opened.phase).toBe('auction')
    expect(opened.auction?.mode).toBe('sealed')
  })

  it('Oferta Secreta: no difunde importes y el empate lo gana quien llegó primero', () => {
    let state = openAuction(
      startAuction(reachRoundTwo(), 'oferta_secreta', 1) as CucupolyState,
    )
    const before = { ...state.money }

    state = reduce(
      state,
      { type: 'secret-bid', payload: { amount: 100 } },
      'p1',
    ) as CucupolyState
    state = reduce(
      state,
      { type: 'secret-bid', payload: { amount: 100 } },
      'p2',
    ) as CucupolyState

    expect(state.auction?.pending).toEqual([])
    expect(state.auction?.registered).toEqual(['p1', 'p2'])
    // El estado público solo dice quién respondió, nunca cuánto.
    expect(state.auction).not.toHaveProperty('bids')
    expect(Object.keys(state.auction ?? {}).sort()).toEqual([
      'countdown',
      'leader',
      'leaderBid',
      'mode',
      'pending',
      'registered',
      'tileId',
    ])
    expect(JSON.stringify(state.auction)).not.toContain('amount')

    // Solo el anfitrión cierra con las ofertas.
    expect(
      isGameError(
        reduce(
          state,
          { type: 'resolve-secret-auction', payload: { bids: [] } },
          'p2',
        ),
      ),
    ).toBe(true)

    // Orden de llegada: p1 primero, así que gana el empate.
    const resolved = reduce(
      state,
      {
        type: 'resolve-secret-auction',
        payload: {
          bids: [
            { playerId: 'p1', amount: 100 },
            { playerId: 'p2', amount: 100 },
          ],
        },
      },
      'p1',
    ) as CucupolyState

    expect(resolved.owners[1]).toBe('p1')
    expect(resolved.money.p1).toBe(before.p1 - 100)
    expect(resolved.money.p2).toBe(before.p2)
    expect(resolved.phase).toBe('waiting-roll')
    expect(resolved.auction).toBeNull()
  })

  it('Oferta Secreta: si el orden se invierte, gana el otro empatado', () => {
    let state = openAuction(
      startAuction(reachRoundTwo(), 'oferta_secreta', 1) as CucupolyState,
    )
    state = reduce(
      state,
      { type: 'secret-bid', payload: { amount: 80 } },
      'p2',
    ) as CucupolyState
    state = reduce(
      state,
      { type: 'secret-bid', payload: { amount: 80 } },
      'p1',
    ) as CucupolyState

    const resolved = reduce(
      state,
      {
        type: 'resolve-secret-auction',
        payload: {
          bids: [
            { playerId: 'p2', amount: 80 },
            { playerId: 'p1', amount: 80 },
          ],
        },
      },
      'p1',
    ) as CucupolyState

    expect(resolved.owners[1]).toBe('p2')
    expect(resolved.money.p2).toBe(RULES.startingMoney - 80)
  })

  it('Oferta Secreta: sin ofertas no cambia el dinero ni el dueño', () => {
    const state = openAuction(
      startAuction(reachRoundTwo(), 'oferta_secreta', 1) as CucupolyState,
    )
    const before = { ...state.money }
    const resolved = reduce(
      state,
      { type: 'resolve-secret-auction', payload: { bids: [] } },
      'p1',
    ) as CucupolyState

    expect(resolved.owners[1]).toBeUndefined()
    expect(resolved.money).toEqual(before)
    expect(resolved.phase).toBe('waiting-roll')
  })

  it('Oferta Secreta: rechaza ofertas por encima del efectivo o bajo el mínimo', () => {
    const state = openAuction(
      startAuction(reachRoundTwo(), 'oferta_secreta', 1) as CucupolyState,
    )
    expect(
      isGameError(
        reduce(
          state,
          { type: 'secret-bid', payload: { amount: (state.money.p1 ?? 0) + 1 } },
          'p1',
        ),
      ),
    ).toBe(true)
    expect(
      isGameError(
        reduce(state, { type: 'secret-bid', payload: { amount: MIN_RAISE - 1 } }, 'p1'),
      ),
    ).toBe(true)
    expect(
      isGameError(
        reduce(state, { type: 'secret-bid', payload: { amount: MIN_RAISE } }, 'p1'),
      ),
    ).toBe(false)
  })

  it('Puja Abierta: mínimo, mejora, líder único y reinicio del contador', () => {
    let state = openAuction(
      startAuction(reachRoundTwo(), 'puja_abierta', 1) as CucupolyState,
    )
    expect(state.auction?.countdown).toBe(AUCTION_OPEN_IDLE_TICKS)
    const before = { ...state.money }

    expect(
      isGameError(
        reduce(state, { type: 'open-bid', payload: { amount: MIN_RAISE - 1 } }, 'p1'),
      ),
    ).toBe(true)
    expect(
      isGameError(
        reduce(
          state,
          { type: 'open-bid', payload: { amount: (state.money.p1 ?? 0) + 1 } },
          'p1',
        ),
      ),
    ).toBe(true)

    state = reduce(
      state,
      { type: 'open-bid', payload: { amount: MIN_RAISE } },
      'p1',
    ) as CucupolyState
    expect(state.auction?.leader).toBe('p1')
    expect(state.auction?.leaderBid).toBe(MIN_RAISE)
    expect(state.auction?.countdown).toBe(AUCTION_OPEN_IDLE_TICKS)

    // El líder no puede pujar contra sí mismo.
    expect(
      isGameError(
        reduce(state, { type: 'open-bid', payload: { amount: MIN_RAISE + 5 } }, 'p1'),
      ),
    ).toBe(true)
    // Hay que superar al líder por al menos MIN_RAISE.
    expect(
      isGameError(
        reduce(
          state,
          { type: 'open-bid', payload: { amount: MIN_RAISE + MIN_RAISE - 1 } },
          'p2',
        ),
      ),
    ).toBe(true)

    // Un tic baja el contador y una puja válida lo reinicia.
    state = reduce(state, { type: 'auction-tick' }, 'p1') as CucupolyState
    expect(state.auction?.countdown).toBe(AUCTION_OPEN_IDLE_TICKS - 1)
    state = reduce(
      state,
      { type: 'open-bid', payload: { amount: MIN_RAISE + MIN_RAISE } },
      'p2',
    ) as CucupolyState
    expect(state.auction?.leader).toBe('p2')
    expect(state.auction?.countdown).toBe(AUCTION_OPEN_IDLE_TICKS)

    // Solo el anfitrión mueve el reloj.
    expect(isGameError(reduce(state, { type: 'auction-tick' }, 'p2'))).toBe(true)

    for (let i = 0; i < AUCTION_OPEN_IDLE_TICKS; i += 1) {
      state = reduce(state, { type: 'auction-tick' }, 'p1') as CucupolyState
    }

    expect(state.phase).toBe('waiting-roll')
    expect(state.owners[1]).toBe('p2')
    expect(state.money.p2).toBe(before.p2 - (MIN_RAISE + MIN_RAISE))
    expect(state.auction).toBeNull()
  })
})

describe('contador de rondas', () => {
  it('sube cuando el turno vuelve a empezar', () => {
    let state = fresh(TWO, 99)
    expect(state.roundNumber).toBe(1)

    state = passTurn(state, 'p1')
    expect(state.roundNumber).toBe(1)

    state = passTurn(state, 'p2')
    expect(state.roundNumber).toBe(2)
  })
})

describe('habilidad Ser. Agua: Abastecimiento', () => {
  it('sube un 15% las rentas del dueño durante una ronda', () => {
    const state = fresh()
    state.owners[1] = 'p1' // Fortaleza $60 => renta base 6
    state.owners[WATER_TILE] = 'p1' // Ser. Agua
    state.abilities[WATER_TILE] = { from: 1, until: 3, readyAt: 15 }

    state.turnNumber = 1
    expect(rentFor(state, 1, 7)).toBe(7) // round(6 * 1.15)

    state.turnNumber = 3 // la ventana ya terminó
    expect(rentFor(state, 1, 7)).toBe(6)
  })

  it('solo la puede activar el dueño en su turno', () => {
    const state = fresh()
    state.owners[WATER_TILE] = 'p1'
    state.phase = 'waiting-roll'
    state.currentIndex = 0

    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p2')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: 15 } }, 'p1')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p1')),
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
    // El evento inicial ya ocurrió: aquí solo se prueba la habilidad.
    state.initialEvent = 'impulso_economico'

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
    state.positions.p1 = BUS_TILES[0]
    state.phase = 'bus-move'
    state.pendingBus = BUS_TILES[0]
    state.dice = { values: [2], total: 2 }
    state.currentIndex = 0

    const after = reduce(state, { type: 'bus-move' }, 'p1') as CucupolyState
    expect(after.positions.p1).toBe(BUS_TILES[1])
    expect(after.phase).toBe('waiting-roll')
    expect(after.log.some((entry) => entry.text.includes('usa la ruta'))).toBe(true)
  })

  it('no ofrece el salto si falta alguna buseta', () => {
    const state = fresh()
    state.owners[BUS_TILES[0]] = 'p1'
    state.owners[BUS_TILES[1]] = 'p1'
    state.owners[BUS_TILES[2]] = 'p1'
    state.turnNumber = 0
    state.currentIndex = 0
    state.seed = seedForDie(1)
    state.positions.p1 = BUS_TILES[0] - 1 // con un dado de 1 cae en la buseta 6
    state.diceModifier = { from: 0, until: 1, dice: 1 }

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.positions.p1).toBe(BUS_TILES[0])
    expect(after.phase).toBe('waiting-roll')
    expect(after.pendingBus).toBeNull()
  })
})

describe('rondas de espera de las habilidades', () => {
  it('descansa 6 rondas tras una ronda de efecto', () => {
    const state = fresh()
    state.owners[WATER_TILE] = 'p1'
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.turnNumber = 0

    const activated = reduce(
      state,
      { type: 'activate-ability', payload: { tileId: WATER_TILE } },
      'p1',
    ) as CucupolyState

    // 2 jugadores: efecto en los turnos 1-2, espera hasta el 15.
    expect(activated.abilities[WATER_TILE]).toEqual({ from: 1, until: 3, readyAt: 15 })

    activated.turnNumber = 14
    expect(
      isGameError(reduce(activated, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p1')),
    ).toBe(true)

    activated.turnNumber = 15
    const again = reduce(
      activated,
      { type: 'activate-ability', payload: { tileId: WATER_TILE } },
      'p1',
    ) as CucupolyState
    expect(again.abilities[WATER_TILE].from).toBe(16)
    expect(again.abilities[WATER_TILE].readyAt).toBe(30)
  })

  it('no se puede reactivar mientras está activa', () => {
    const state = fresh()
    state.owners[WATER_TILE] = 'p1'
    state.abilities[WATER_TILE] = { from: 1, until: 3, readyAt: 15 }
    state.turnNumber = 2
    state.currentIndex = 0
    state.phase = 'waiting-roll'

    expect(
      isGameError(reduce(state, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p1')),
    ).toBe(true)
  })
})

/** Mesa de 31 en fase de cartas, con las apuestas ya cobradas. */
function table31State(overrides: Partial<Table31State> = {}): CucupolyState {
  const state = fresh()
  state.phase = 'thirty-one'
  state.currentIndex = 0
  state.money.p1 = RULES.startingMoney - 50
  state.money.p2 = RULES.startingMoney - 50
  state.table31 = {
    stage: 'draw',
    pendingBets: [],
    participants: ['p1', 'p2'],
    bets: { p1: 50, p2: 50 },
    cardCounts: { p1: 0, p2: 0 },
    ready: [],
    pendingDraws: [],
    pot: 100,
    reveal: null,
    settlement: null,
    ...overrides,
  }
  return state
}

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

  it('cobra las apuestas al sentarse y arma el pozo al cerrar las decisiones', () => {
    const state = fresh()
    const seed = seedForChance(2, 0)
    aimAtChance(state, 'p1', seed)
    let after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    after = reduce(after, { type: 'join-table', payload: { bet: 50 } }, 'p1') as CucupolyState
    expect(after.money.p1).toBe(RULES.startingMoney - 50)
    expect(after.table31!.stage).toBe('bets')
    expect(after.table31!.pot).toBe(0)

    after = reduce(after, { type: 'pass-table' }, 'p2') as CucupolyState
    expect(after.table31!.stage).toBe('draw')
    expect(after.table31!.pot).toBe(50)
    expect(after.table31!.cardCounts).toEqual({ p1: 0 })
  })

  it('no difunde cartas ni totales ajenos antes de la revelación', () => {
    let after = reduce(table31State(), { type: 'draw-card' }, 'p1') as CucupolyState
    // Pedir carta solo deja una solicitud pública: el valor aún no existe.
    expect(after.table31!.pendingDraws).toEqual(['p1'])

    after = reduce(
      after,
      { type: 'deal-card', payload: { playerId: 'p1', card: 10, total: 10 } },
      'p1',
    ) as CucupolyState

    const table = after.table31!
    expect(table.cardCounts).toEqual({ p1: 1, p2: 0 })
    expect(table.reveal).toBeNull()
    expect(table.settlement).toBeNull()
    expect('hands' in table).toBe(false)
    expect('cards' in table).toBe(false)
    expect(JSON.stringify(table)).not.toContain('"hands"')
    expect(JSON.stringify(table)).not.toContain('"cards"')
  })

  it('marca "Listo" igual al plantarse y al pasarse, sin delatar a nadie', () => {
    const stood = reduce(
      table31State({ cardCounts: { p1: 2, p2: 1 } }),
      { type: 'stand' },
      'p1',
    ) as CucupolyState
    const busted = reduce(
      table31State({ pendingDraws: ['p2'] }),
      { type: 'deal-card', payload: { playerId: 'p2', card: 11, total: 32 } },
      'p1',
    ) as CucupolyState

    expect(stood.table31!.ready).toEqual(['p1'])
    expect(busted.table31!.ready).toEqual(['p2'])
    // El estado público solo conoce "ready": ni plantado ni pasado.
    expect('busted' in stood.table31!).toBe(false)
    expect('standing' in stood.table31!).toBe(false)
    expect(JSON.stringify(busted.table31)).not.toContain('busted')
  })

  it('solo el anfitrión reparte cartas y el invitado solo puede pedirlas', () => {
    const state = table31State()
    expect(
      isGameError(
        reduce(state, { type: 'deal-card', payload: { playerId: 'p1', card: 5, total: 5 } }, 'p2'),
      ),
    ).toBe(true)

    const requested = reduce(state, { type: 'draw-card' }, 'p2') as CucupolyState
    expect(requested.table31!.pendingDraws).toEqual(['p2'])
    expect(
      isGameError(
        reduce(
          requested,
          { type: 'deal-card', payload: { playerId: 'p2', card: 5, total: 5 } },
          'p2',
        ),
      ),
    ).toBe(true)
  })

  it('al revelar voltea todas las manos y calcula los pagos con las reglas del pozo', () => {
    const state = table31State({ ready: ['p1', 'p2'], cardCounts: { p1: 2, p2: 2 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 20, p2: 22 }, cards: { p1: [10, 10], p2: [11, 11] } },
      },
      'p1',
    ) as CucupolyState

    expect(revealed.table31!.stage).toBe('reveal')
    expect(revealed.table31!.reveal).toEqual({
      hands: { p1: 20, p2: 22 },
      cards: { p1: [10, 10], p2: [11, 11] },
      busted: [],
    })
    expect(revealed.table31!.settlement).toMatchObject({
      allBusted: false,
      winnerIds: ['p2'],
      best: 22,
      pot: 100,
    })
    expect(revealed.table31!.settlement!.payouts).toEqual([{ to: 'p2', amount: 100 }])
    // El dinero no se mueve hasta que termina la animación.
    expect(revealed.money.p2).toBe(RULES.startingMoney - 50)

    const settled = reduce(revealed, { type: 'settle-table' }, 'p1') as CucupolyState
    expect(settled.money.p2).toBe(RULES.startingMoney + 50)
    expect(settled.table31).toBeNull()
    const notice = settled.notices.find((entry) => entry.kind === 'money')
    expect(notice).toMatchObject({ to: 'p2', amount: 100 })
    expect(notice?.text).toContain('pozo de la mesa de 31')
  })

  it('reparte el pozo entre los empatados', () => {
    const state = table31State({ ready: ['p1', 'p2'], cardCounts: { p1: 2, p2: 2 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 21, p2: 21 }, cards: { p1: [11, 10], p2: [10, 11] } },
      },
      'p1',
    ) as CucupolyState
    expect(revealed.table31!.settlement!.payouts).toEqual([
      { to: 'p1', amount: 50 },
      { to: 'p2', amount: 50 },
    ])

    const settled = reduce(revealed, { type: 'settle-table' }, 'p1') as CucupolyState
    expect(settled.money.p1).toBe(RULES.startingMoney)
    expect(settled.money.p2).toBe(RULES.startingMoney)
  })

  it('devuelve las apuestas si todos se pasan de 31', () => {
    const state = table31State({ ready: ['p1', 'p2'], cardCounts: { p1: 3, p2: 4 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 32, p2: 35 }, cards: { p1: [11, 11, 10], p2: [11, 11, 11, 2] } },
      },
      'p1',
    ) as CucupolyState
    expect(revealed.table31!.settlement).toMatchObject({
      allBusted: true,
      winnerIds: [],
      best: null,
    })
    expect(revealed.table31!.settlement!.payouts).toEqual([
      { to: 'p1', amount: 50 },
      { to: 'p2', amount: 50 },
    ])

    const settled = reduce(revealed, { type: 'settle-table' }, 'p1') as CucupolyState
    expect(settled.money.p1).toBe(RULES.startingMoney)
    expect(settled.money.p2).toBe(RULES.startingMoney)
    expect(settled.notices.some((entry) => entry.kind === 'money')).toBe(false)
    expect(
      settled.notices.some(
        (entry) => entry.kind === 'event' && entry.text.includes('todos se pasaron'),
      ),
    ).toBe(true)
  })

  it('rechaza revelar sin todos listos o con cartas que no cuadran', () => {
    const notReady = table31State({ ready: ['p1'], cardCounts: { p1: 1, p2: 1 } })
    expect(
      isGameError(
        reduce(
          notReady,
          {
            type: 'reveal-table',
            payload: { hands: { p1: 10, p2: 10 }, cards: { p1: [10], p2: [10] } },
          },
          'p1',
        ),
      ),
    ).toBe(true)

    const ready = table31State({ ready: ['p1', 'p2'], cardCounts: { p1: 1, p2: 1 } })
    expect(
      isGameError(
        reduce(
          ready,
          {
            type: 'reveal-table',
            payload: { hands: { p1: 11, p2: 10 }, cards: { p1: [10], p2: [10] } },
          },
          'p1',
        ),
      ),
    ).toBe(true)
  })

  it('solo el anfitrión puede revelar y liquidar', () => {
    const state = table31State({ ready: ['p1', 'p2'], cardCounts: { p1: 1, p2: 1 } })
    expect(
      isGameError(
        reduce(
          state,
          {
            type: 'reveal-table',
            payload: { hands: { p1: 10, p2: 10 }, cards: { p1: [10], p2: [10] } },
          },
          'p2',
        ),
      ),
    ).toBe(true)

    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 10, p2: 10 }, cards: { p1: [10], p2: [10] } },
      },
      'p1',
    ) as CucupolyState
    expect(isGameError(reduce(revealed, { type: 'settle-table' }, 'p2'))).toBe(true)
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
    // Cae en Fortaleza (sin dueño) para conservar los dados en la decisión.
    const { total } = rollOutcome(state.seed, 3)
    state.positions.p1 = (1 - total + 48) % 48

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.dice!.values).toHaveLength(3)
    expect(after.dice!.total).toBeGreaterThanOrEqual(3)
    expect(after.dice!.total).toBeLessThanOrEqual(18)
    expect(after.positions.p1).toBe(1)
  })
})

describe('rentas', () => {
  it('las busetas suben según cuántas tenga el dueño', () => {
    const state = fresh()
    state.owners[BUS_TILES[0]] = 'p1'
    expect(rentFor(state, BUS_TILES[0], 7)).toBe(RULES.busRents[0])

    state.owners[BUS_TILES[1]] = 'p1'
    expect(rentFor(state, BUS_TILES[0], 7)).toBe(RULES.busRents[1])

    state.owners[BUS_TILES[2]] = 'p1'
    state.owners[BUS_TILES[3]] = 'p1'
    expect(rentFor(state, BUS_TILES[0], 7)).toBe(RULES.busRents[3])
  })

  it('los servicios multiplican los dados según cuántos tenga el dueño', () => {
    const state = fresh()
    state.owners[WATER_TILE] = 'p1'
    expect(rentFor(state, WATER_TILE, 7)).toBe(4 * 7)

    state.owners[15] = 'p1'
    expect(rentFor(state, WATER_TILE, 7)).toBe(10 * 7)

    state.owners[34] = 'p1'
    expect(rentFor(state, WATER_TILE, 7)).toBe(15 * 7)
  })
})

describe('avisos de pagos entre jugadores', () => {
  it('muestra quién paga a quién, cuánto y el motivo del alquiler', () => {
    const state = fresh()
    state.owners[1] = 'p2' // Fortaleza: renta 6
    state.positions.p1 = 0
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1)
    state.diceModifier = { from: 0, until: 1, dice: 1 }

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    const notice = after.notices.find((entry) => entry.kind === 'money')

    expect(notice).toMatchObject({ kind: 'money', from: 'p1', to: 'p2', amount: 6 })
    expect(notice?.text).toContain('Ana le pagó $6 a Beto')
    expect(notice?.text).toContain('alquiler en Fortaleza')
    expect(after.noticeSeq).toBeGreaterThanOrEqual(1)
  })

  it('avisa el pago neto de un intercambio', () => {
    const state = fresh(THREE)
    state.phase = 'waiting-roll'
    state.currentIndex = 0

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: { to: 'p2', giveTiles: [], getTiles: [], giveMoney: 120, getMoney: 20 },
      },
      'p1',
    ) as CucupolyState
    const accepted = reduce(proposed, { type: 'accept-trade' }, 'p2') as CucupolyState
    const notice = accepted.notices.find((entry) => entry.kind === 'money')

    expect(notice).toMatchObject({ kind: 'money', from: 'p1', to: 'p2', amount: 100 })
    expect(notice?.text).toContain('Ana le pagó $100 a Beto')
    expect(notice?.text).toContain('intercambio')
  })

  it('avisa el modificador de dados con causa y efecto', () => {
    const state = fresh()
    const seed = seedForChance(2, 1) // Vamos despacio: 1 dado
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(
      after.notices.some(
        (entry) =>
          entry.kind === 'rule' &&
          entry.text.includes('1 dado') &&
          entry.text.includes('Vamos despacio'),
      ),
    ).toBe(true)
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
    state.owners[WATER_TILE] = 'p1'
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    const snapshot = JSON.stringify(state)

    reduce(state, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p1')
    reduce(state, { type: 'roll' }, 'p1')

    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe('sorteo de orden de turnos', () => {
  it('arranca antes de la ronda 1 y ordena de mayor a menor', () => {
    let state = init(THREE, 7)

    expect(state.phase).toBe('turn-order-roll')
    expect(state.roundNumber).toBe(1)
    expect(state.turnOrder).toEqual(['p1', 'p2', 'p3'])
    expect(state.turnOrderState?.queue).toEqual(['p1', 'p2', 'p3'])
    expect(state.turnOrderState?.rolls).toEqual({})

    // Solo el primero de la cola puede pedir su tirada.
    expect(isGameError(reduce(state, { type: 'request-order-roll' }, 'p2'))).toBe(true)
    // El valor solo lo puede aplicar el anfitrión.
    state = reduce(state, { type: 'request-order-roll' }, 'p1') as CucupolyState
    expect(
      isGameError(
        reduce(state, { type: 'roll-for-order', payload: { playerId: 'p1', value: 3 } }, 'p2'),
      ),
    ).toBe(true)
    // Una tirada sin petición previa no se puede resolver.
    expect(
      isGameError(
        reduce(
          init(THREE, 7),
          { type: 'roll-for-order', payload: { playerId: 'p2', value: 6 } },
          'p1',
        ),
      ),
    ).toBe(true)

    state = orderRoll(init(THREE, 7), 'p1', 3)
    state = orderRoll(state, 'p2', 6)
    state = orderRoll(state, 'p3', 1)

    expect(state.turnOrderState?.rolls).toEqual({ p1: 3, p2: 6, p3: 1 })
    expect(state.turnOrder).toEqual(['p2', 'p1', 'p3'])
    expect(state.phase).toBe('turn-order-reveal')
    // El sorteo no consume el seed ni cuenta como ronda.
    expect(state.seed).toBe(7)
    expect(state.roundNumber).toBe(1)

    // Solo el anfitrión cierra el sorteo y arranca la ronda 1.
    expect(isGameError(reduce(state, { type: 'finish-turn-order' }, 'p2'))).toBe(true)
    state = reduce(state, { type: 'finish-turn-order' }, 'p1') as CucupolyState
    expect(state.phase).toBe('waiting-roll')
    expect(state.turnOrderState).toBeNull()
    expect(state.turnOrder).toEqual(['p2', 'p1', 'p3'])
    expect(state.turnOrder[state.currentIndex]).toBe('p2')
  })

  it('en empate solo relanzan los empatados y los demás conservan su posición', () => {
    let state = orderRoll(init(THREE, 7), 'p1', 6)
    state = orderRoll(state, 'p2', 6)
    state = orderRoll(state, 'p3', 3)

    // p1 y p2 empatan arriba; p3 ya tiene su puesto fijo.
    expect(state.phase).toBe('turn-order-roll')
    expect(state.turnOrderState?.queue).toEqual(['p1', 'p2'])
    expect(state.turnOrderState?.groups).toEqual([['p1', 'p2'], ['p3']])
    expect(isGameError(reduce(state, { type: 'request-order-roll' }, 'p3'))).toBe(true)

    state = orderRoll(state, 'p1', 2)
    state = orderRoll(state, 'p2', 5)

    expect(state.phase).toBe('turn-order-reveal')
    expect(state.turnOrder).toEqual(['p2', 'p1', 'p3'])
    expect(state.turnOrderState?.rolls).toEqual({ p1: 2, p2: 5, p3: 3 })
    expect(state.turnOrderState?.queue).toEqual([])
  })

  it('el avance de turno y el evento de la ronda 2 usan el orden sorteado', () => {
    let state = orderRoll(init(THREE, 99), 'p1', 3)
    state = orderRoll(state, 'p2', 6)
    state = orderRoll(state, 'p3', 1)
    state = reduce(state, { type: 'finish-turn-order' }, 'p1') as CucupolyState

    expect(state.turnOrder).toEqual(['p2', 'p1', 'p3'])
    expect(state.turnOrder[state.currentIndex]).toBe('p2')

    state = passTurn(state, 'p2')
    expect(state.turnOrder[state.currentIndex]).toBe('p1')
    expect(state.roundNumber).toBe(1)

    state = passTurn(state, 'p1')
    expect(state.turnOrder[state.currentIndex]).toBe('p3')
    expect(state.roundNumber).toBe(1)

    // Al cerrar el último turno vuelve al primero y arranca la ronda 2.
    state = passTurn(state, 'p3')
    expect(state.turnOrder[state.currentIndex]).toBe('p2')
    expect(state.roundNumber).toBe(2)
    expect(state.phase).toBe('event')

    state = reduce(
      state,
      { type: 'start-initial-event', payload: { eventId: 'impulso_economico' } },
      'p1',
    ) as CucupolyState
    expect(state.phase).toBe('waiting-roll')
    expect(state.turnOrder[state.currentIndex]).toBe('p2')
  })
})
