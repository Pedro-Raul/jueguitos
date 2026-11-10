import { describe, expect, it } from 'vitest'
import { isGameError, type Player } from '../../types'
import { BOARD, BUS_TILES, WATER_TILE } from './board'
import { HOTEL_LEVEL, MAX_HOUSES, buildCostFor } from './buildings'
import {
  CHANCE_EVENTS,
  getDiceCount,
  init,
  nextSeed,
  reduce,
  rentFor,
  type CucupolyState,
  type Table21State,
} from './engine'
import {
  AUCTION_OPEN_IDLE_TICKS,
  EVENTS,
  EVENT_BANNER_MS,
  FINAL_EVENT_POOL,
  FINAL_PHASE_START_ROUND,
  INITIAL_EVENT_POOL,
  MIN_RAISE,
  NORMAL_EVENT_POOL,
  TAX_RATE,
  drawableEvents,
  eventDurationRounds,
  eventPoolForRound,
  eventRoundsLeft,
  eventPriceMultiplier,
  finalTaxFor,
  freeAuctionTiles,
  isAuctionEvent,
  isFinalEventId,
  purchasePriceFor,
  type ActiveEvent,
  type GameEventId,
} from './events'
import {
  EVENT_GAP_MAX_ROUNDS,
  EVENT_GAP_MIN_ROUNDS,
  requestDiceEvent,
} from './eventScheduler'
import { RULES } from './rules.config'
import {
  SLOT_BETS,
  SLOT_MIN_BET,
  SLOT_REEL,
  slotPayout,
  type SlotSymbolId,
} from './slot'

const ANA: Player = { id: 'p1', name: 'Ana', emoji: '🐙', color: '#e11d48', connected: true }
const BETO: Player = { id: 'p2', name: 'Beto', emoji: '🦊', color: '#2563eb', connected: true }
const CARO: Player = { id: 'p3', name: 'Caro', emoji: '🐸', color: '#16a34a', connected: true }
const DORA: Player = { id: 'p4', name: 'Dora', emoji: '🐼', color: '#9333ea', connected: true }
const TWO = [ANA, BETO]
const THREE = [ANA, BETO, CARO]
const FOUR = [ANA, BETO, CARO, DORA]

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
    dice: null,
    endTurnPending: false,
    endTurnTicks: 0,
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

/** Primer seed cuya tirada de `dice` dados suma exactamente `target`. */
function seedForTotal(dice: number, target: number): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    if (rollOutcome(seed, dice).total === target) return seed
  }
  throw new Error(`Sin seed para ${dice} dados que sumen ${target}`)
}

/** Valores de la última tirada del jugador, aunque el turno ya haya cerrado. */
function lastRollValues(state: CucupolyState, name: string): number[] {
  const entry = [...state.log].reverse().find((item) => item.text.includes(`${name} tira `))
  const match = entry?.text.match(/tira ([0-9+]+) =/)
  return match ? match[1].split('+').map(Number) : []
}

/** Evento activo con la duración real del catálogo. */
function activeEventFor(id: GameEventId, startRound: number): ActiveEvent {
  return { id, startRound, endRound: startRound + eventDurationRounds(id) - 1 }
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

  it('Semana de descuentos: mitad de precio solo en las rondas 2, 3 y 4', () => {
    const discount = activeEventFor('semana_descuentos', 2)
    expect(purchasePriceFor(100, discount, 1)).toBe(100)
    expect(purchasePriceFor(100, discount, 2)).toBe(50)
    expect(purchasePriceFor(100, discount, 3)).toBe(50)
    expect(purchasePriceFor(100, discount, 4)).toBe(50)
    expect(purchasePriceFor(100, discount, 5)).toBe(100)
    expect(purchasePriceFor(100, activeEventFor('impulso_economico', 2), 2)).toBe(100)
    expect(purchasePriceFor(100, null, 2)).toBe(100)
    // Redondeo a entero.
    expect(purchasePriceFor(75, discount, 2)).toBe(38)
  })

  it('Semana de descuentos: el cobro coincide con el precio mostrado', () => {
    const basePrice = BOARD[1].price ?? 0
    const discount = activeEventFor('semana_descuentos', 2)
    const discounted = purchasePriceFor(basePrice, discount, 3)

    const state = fresh(TWO, 99)
    state.activeEvent = discount
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

  it('Semana de descuentos: fuera de su ventana vuelve a cobrar el precio completo', () => {
    const basePrice = BOARD[1].price ?? 0
    const state = fresh(TWO, 99)
    state.activeEvent = activeEventFor('semana_descuentos', 2)
    state.initialEvent = 'semana_descuentos'
    state.roundNumber = 6
    state.phase = 'buy-decision'
    state.pendingBuy = 1
    state.currentIndex = 0

    const after = reduce(state, { type: 'buy' }, 'p1') as CucupolyState
    expect(after.money.p1).toBe(RULES.startingMoney - basePrice)
  })
})

describe('planificador de eventos', () => {
  /** Avanza `rounds` rondas completas cerrando turnos sin tirar. */
  function advanceRounds(state: CucupolyState, rounds: number): CucupolyState {
    let next = state
    const size = state.turnOrder.length
    for (let i = 0; i < rounds * size; i += 1) {
      next = passTurn(next, next.turnOrder[next.currentIndex])
    }
    return next
  }

  function startEvent(
    state: CucupolyState,
    payload: Record<string, unknown>,
    host = state.order[0],
  ): CucupolyState | { error: string } {
    return reduce(state, { type: 'start-event', payload }, host)
  }

  it('no hay eventos finales antes de la ronda 40 y desde ahí solo hay finales', () => {
    const owners: Record<number, string> = {}
    for (const tile of BOARD) {
      if (tile.price !== undefined) owners[tile.index] = 'p1'
    }

    const before = eventPoolForRound(FINAL_PHASE_START_ROUND - 1, owners, null)
    expect(before.some((id) => isFinalEventId(id))).toBe(false)
    expect(before.every((id) => NORMAL_EVENT_POOL.includes(id as never))).toBe(true)

    const final = eventPoolForRound(FINAL_PHASE_START_ROUND, owners, null)
    expect(final).toEqual([...FINAL_EVENT_POOL])
    expect(final.every((id) => isFinalEventId(id))).toBe(true)
    expect(
      eventPoolForRound(FINAL_PHASE_START_ROUND + 3, owners, 'caos'),
    ).not.toContain('caos')

    const state = fresh(TWO, 99)
    state.roundNumber = FINAL_PHASE_START_ROUND - 1
    state.nextEventRound = state.roundNumber
    state.phase = 'event'
    expect(isGameError(startEvent(state, { eventId: 'inflacion_alta' }))).toBe(true)
  })

  it('un evento final dura rondas completas y deja una pausa de 4 a 8', () => {
    let state = fresh(TWO, 99)
    state.roundNumber = FINAL_PHASE_START_ROUND
    state.nextEventRound = FINAL_PHASE_START_ROUND
    state.phase = 'event'

    state = startEvent(state, {
      eventId: 'inflacion_alta',
      gapRounds: 4,
    }) as CucupolyState
    expect(state.activeEvent).toEqual({
      id: 'inflacion_alta',
      startRound: FINAL_PHASE_START_ROUND,
      endRound: FINAL_PHASE_START_ROUND + 2,
    })
    expect(state.nextEventRound).toBe(FINAL_PHASE_START_ROUND + 3 + 4)
    expect(state.finalEvent).toEqual({
      id: 'inflacion_alta',
      startRound: FINAL_PHASE_START_ROUND,
    })
    expect(state.finalEventSeq).toBe(1)

    // Rondas 41 y 42 siguen dentro del evento.
    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(FINAL_PHASE_START_ROUND + 1)
    expect(state.activeEvent?.id).toBe('inflacion_alta')
    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(FINAL_PHASE_START_ROUND + 2)
    expect(state.activeEvent?.endRound).toBe(FINAL_PHASE_START_ROUND + 2)

    // Tras el último turno de la ronda 42 el evento se cierra y empieza la pausa.
    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(FINAL_PHASE_START_ROUND + 3)
    expect(state.activeEvent).toBeNull()
    expect(state.phase).toBe('waiting-roll')
    state = advanceRounds(state, 3)
    expect(state.roundNumber).toBe(state.nextEventRound - 1)
    expect(state.phase).toBe('waiting-roll')
    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(state.nextEventRound)
    expect(state.phase).toBe('event')

    // No puede repetirse el mismo final dos veces seguidas.
    expect(isGameError(startEvent(state, { eventId: 'inflacion_alta' }))).toBe(true)
    const next = startEvent(state, {
      eventId: 'impuestos_altos',
      gapRounds: 8,
    }) as CucupolyState
    expect(next.activeEvent?.id).toBe('impuestos_altos')
    expect(next.nextEventRound).toBe(FINAL_PHASE_START_ROUND + 3 + 4 + 3 + 8)
  })

  it('inflación: duplica compra, construcción y alquiler solo mientras dura', () => {
    const inflation = activeEventFor('inflacion_alta', 12)
    expect(eventPriceMultiplier(inflation, 11)).toBe(1)
    expect(eventPriceMultiplier(inflation, 12)).toBe(2)
    expect(eventPriceMultiplier(inflation, 14)).toBe(2)
    expect(eventPriceMultiplier(inflation, 15)).toBe(1)
    expect(eventRoundsLeft(inflation, 12)).toBe(3)
    expect(eventRoundsLeft(inflation, 14)).toBe(1)

    const basePrice = BOARD[1].price ?? 0
    expect(purchasePriceFor(basePrice, inflation, 12)).toBe(basePrice * 2)
    expect(purchasePriceFor(basePrice, inflation, 15)).toBe(basePrice)

    // Cobro de compra: coincide con el precio efectivo mostrado.
    const purchase = fresh(TWO, 99)
    purchase.activeEvent = inflation
    purchase.roundNumber = 12
    purchase.phase = 'buy-decision'
    purchase.pendingBuy = 1
    purchase.currentIndex = 0
    const afterBuy = reduce(purchase, { type: 'buy' }, 'p1') as CucupolyState
    expect(afterBuy.money.p1).toBe(RULES.startingMoney - basePrice * 2)
    expect(afterBuy.owners[1]).toBe('p1')

    // Construcción: el grupo marrón cuesta el doble.
    const build = fresh(TWO, 99)
    build.activeEvent = inflation
    build.roundNumber = 12
    build.phase = 'waiting-roll'
    build.currentIndex = 0
    build.owners[1] = 'p1'
    build.owners[3] = 'p1'
    build.money.p1 = RULES.startingMoney
    const afterBuild = reduce(
      build,
      { type: 'build-house', payload: { propertyId: 1 } },
      'p1',
    ) as CucupolyState
    expect(afterBuild.money.p1).toBe(RULES.startingMoney - (buildCostFor(1) ?? 0) * 2)

    // Alquiler: Fortaleza rinde 6 y con inflación 12.
    const rent = fresh(TWO, 99)
    rent.activeEvent = inflation
    rent.roundNumber = 12
    rent.owners[1] = 'p2'
    rent.positions.p1 = 47
    rent.currentIndex = 0
    rent.phase = 'waiting-roll'
    rent.seed = seedForTotal(2, 2) // 47 + 2 = 1 (Fortaleza)
    expect(rentFor(rent, 1, 7)).toBe(12)
    const afterRent = reduce(rent, { type: 'roll' }, 'p1') as CucupolyState
    expect(afterRent.money.p1).toBe(RULES.startingMoney + RULES.goSalary - 12)
    expect(afterRent.money.p2).toBe(RULES.startingMoney + 12)
  })

  it('impuestos altos: 15% al inicio de cada ronda del evento', () => {
    expect(finalTaxFor(100)).toBe(15)
    expect(finalTaxFor(99)).toBe(14)
    expect(finalTaxFor(0)).toBe(0)

    let state = fresh(TWO, 99)
    state.roundNumber = FINAL_PHASE_START_ROUND
    state.nextEventRound = FINAL_PHASE_START_ROUND
    state.phase = 'event'
    state.currentIndex = 0
    state.money.p1 = 100
    state.money.p2 = 55

    state = startEvent(state, {
      eventId: 'impuestos_altos',
      gapRounds: 4,
    }) as CucupolyState
    expect(state.activeEvent).toEqual({
      id: 'impuestos_altos',
      startRound: FINAL_PHASE_START_ROUND,
      endRound: FINAL_PHASE_START_ROUND + 2,
    })
    expect(state.money.p1).toBe(100 - 15)
    expect(state.money.p2).toBe(55 - 8) // floor(55 * 0.15)

    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(FINAL_PHASE_START_ROUND + 1)
    expect(state.money.p1).toBe(85 - Math.floor(85 * TAX_RATE))
    expect(state.money.p2).toBe(47 - Math.floor(47 * TAX_RATE))

    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(FINAL_PHASE_START_ROUND + 2)
    expect(state.money.p1).toBe(73 - Math.floor(73 * TAX_RATE))
    expect(state.money.p2).toBe(40 - Math.floor(40 * TAX_RATE))

    // La ronda siguiente: el evento terminó y empieza la pausa, sin otro cobro.
    const before = { ...state.money }
    state = advanceRounds(state, 1)
    expect(state.roundNumber).toBe(FINAL_PHASE_START_ROUND + 3)
    expect(state.phase).toBe('waiting-roll')
    expect(state.activeEvent).toBeNull()
    expect(state.money).toEqual(before)
  })

  it('caos: permutación válida, sin cobrar Salida ni activar casillas', () => {
    const state = fresh(THREE, 99)
    state.roundNumber = FINAL_PHASE_START_ROUND
    state.nextEventRound = FINAL_PHASE_START_ROUND
    state.phase = 'event'
    state.currentIndex = 0
    state.positions.p1 = 47
    state.positions.p2 = 0
    state.positions.p3 = 4 // Impuesto: si se activara, p1 pagaría $50
    const money = { ...state.money }

    // Permutación incompleta o con duplicados: se rechaza.
    expect(
      isGameError(startEvent(state, { eventId: 'caos', order: ['p1', 'p2'] })),
    ).toBe(true)
    expect(
      isGameError(
        startEvent(state, { eventId: 'caos', order: ['p1', 'p1', 'p3'] }),
      ),
    ).toBe(true)

    const after = startEvent(state, {
      eventId: 'caos',
      order: ['p3', 'p1', 'p2'],
    }) as CucupolyState

    // p1 recibe la posición de p3 (Impuesto), p2 la de p1 y p3 la de p2.
    expect(after.positions.p1).toBe(4)
    expect(after.positions.p2).toBe(47)
    expect(after.positions.p3).toBe(0)
    expect(after.money).toEqual(money)
    expect(after.phase).toBe('waiting-roll')
    expect(after.activeEvent).toEqual({
      id: 'caos',
      startRound: FINAL_PHASE_START_ROUND,
      endRound: FINAL_PHASE_START_ROUND,
    })
    expect(after.finalEvent).toEqual({ id: 'caos', startRound: FINAL_PHASE_START_ROUND })
    expect(after.notices.some((notice) => notice.text.includes('Caos:'))).toBe(true)
  })
})

describe('planificador: partida de 4 jugadores y 200 rondas', () => {
  it('nunca solapa eventos, los alinea por ronda y respeta pausas de 4 a 8', () => {
    const players = FOUR
    let state = fresh(players, 99)
    // Todas las propiedades tienen dueño: las subastas quedan fuera del sorteo
    // y la simulación no necesita resolver ofertas.
    for (const tile of BOARD) {
      if (tile.price !== undefined) state.owners[tile.index] = 'p1'
    }

    const started: Array<{
      id: GameEventId
      startRound: number
      endRound: number
      gapRounds: number
    }> = []
    const issues: string[] = []
    let initialTransitions = 0
    let seenRound = 0
    const turnBase = players.length
    const maxSteps = 200 * turnBase + 120

    for (let step = 0; step < maxSteps && state.roundNumber <= 200; step += 1) {
      if (state.phase === 'event') {
        if (state.activeEvent !== null) {
          issues.push(`evento activo al abrir el sorteo de la ronda ${state.roundNumber}`)
          break
        }
        if (state.turnNumber !== (state.roundNumber - 1) * turnBase) {
          issues.push(`evento fuera del primer turno de la ronda ${state.roundNumber}`)
        }

        const initialRound =
          state.initialEvent === null && state.roundNumber === 2
        let pool = eventPoolForRound(state.roundNumber, state.owners, state.lastEventId)
        if (initialRound) {
          pool = pool.filter((id) => INITIAL_EVENT_POOL.includes(id as never))
        }
        if (pool.length === 0) {
          issues.push(`pool vacío en la ronda ${state.roundNumber}`)
          break
        }

        const eventId = pool[0]
        const gapRounds =
          EVENT_GAP_MIN_ROUNDS +
          (started.length % (EVENT_GAP_MAX_ROUNDS - EVENT_GAP_MIN_ROUNDS + 1))
        const payload: Record<string, unknown> = { eventId, gapRounds }
        if (isAuctionEvent(eventId)) {
          payload.tileId = freeAuctionTiles(state.owners)[0]
        }
        if (eventId === 'caos') {
          payload.order = state.order.filter((id) => !state.bankrupt.includes(id))
        }

        const beforeInitial = state.initialEvent
        const result = reduce(state, { type: 'start-event', payload }, state.order[0])
        if (isGameError(result)) {
          issues.push(result.error)
          break
        }
        state = result
        if (beforeInitial === null && state.initialEvent !== null) {
          initialTransitions += 1
          if (state.roundNumber !== 2) issues.push('evento inicial fuera de la ronda 2')
        }

        const active = state.activeEvent
        if (!active || active.id !== eventId) {
          issues.push('el evento no quedó activo')
          break
        }
        if (active.startRound !== state.roundNumber) {
          issues.push(`inicio incorrecto en la ronda ${state.roundNumber}`)
        }
        const duration = eventDurationRounds(eventId)
        if (active.endRound !== state.roundNumber + duration - 1) {
          issues.push(`duración incorrecta para ${eventId}`)
        }
        if (state.nextEventRound !== active.endRound + 1 + gapRounds) {
          issues.push(`pausa incorrecta tras ${eventId}`)
        }
        started.push({
          id: eventId,
          startRound: state.roundNumber,
          endRound: active.endRound,
          gapRounds,
        })
        continue
      }

      if (state.phase === 'auction') {
        issues.push(`subasta inesperada en la ronda ${state.roundNumber}`)
        break
      }

      if (state.roundNumber !== seenRound) {
        seenRound = state.roundNumber
        const current = started[started.length - 1]
        if (current) {
          if (
            state.roundNumber > current.startRound &&
            state.roundNumber <= current.endRound &&
            state.activeEvent?.id !== current.id
          ) {
            issues.push(`el evento ${current.id} no cubre la ronda ${state.roundNumber}`)
          }
          if (state.roundNumber === current.endRound + 1 && state.activeEvent !== null) {
            issues.push(
              `el evento ${current.id} no terminó tras la ronda ${current.endRound}`,
            )
          }
        }
      }

      state = passTurn(state, state.turnOrder[state.currentIndex])
    }

    expect(issues).toEqual([])
    expect(started.length).toBeGreaterThan(20)
    expect(started[0]?.startRound).toBe(2)
    expect(INITIAL_EVENT_POOL.includes(started[0]?.id as never)).toBe(true)
    expect(initialTransitions).toBe(1)
    expect(state.initialEvent).toBe(started[0]?.id)

    // Un solo evento activo cada vez y duración exacta del catálogo.
    for (const event of started) {
      expect(event.endRound - event.startRound + 1).toBe(eventDurationRounds(event.id))
    }

    // Entre eventos hay entre 4 y 8 rondas libres.
    for (let i = 1; i < started.length; i += 1) {
      const freeRounds = started[i].startRound - (started[i - 1].endRound + 1)
      expect(freeRounds).toBeGreaterThanOrEqual(EVENT_GAP_MIN_ROUNDS)
      expect(freeRounds).toBeLessThanOrEqual(EVENT_GAP_MAX_ROUNDS)
    }

    // Nada final antes de la ronda 40; desde ahí, solo finales.
    expect(
      started.filter((event) => event.startRound < FINAL_PHASE_START_ROUND).some((event) =>
        isFinalEventId(event.id),
      ),
    ).toBe(false)
    expect(
      started
        .filter((event) => event.startRound >= FINAL_PHASE_START_ROUND)
        .every((event) => isFinalEventId(event.id)),
    ).toBe(true)
    expect(
      started.some(
        (event) =>
          event.startRound >= FINAL_PHASE_START_ROUND && isFinalEventId(event.id),
      ),
    ).toBe(true)
  })
})

describe('evento de dados y Sorpresa en la misma ronda', () => {
  it('todos los jugadores de una ronda tiran 3 dados', () => {
    const state = fresh(FOUR, 99)
    state.activeEvent = activeEventFor('dados_tres', 1)

    for (const id of state.turnOrder) {
      const turn: CucupolyState = {
        ...state,
        phase: 'waiting-roll',
        currentIndex: state.turnOrder.indexOf(id),
        seed: seedForDie(2),
      }
      const after = reduce(turn, { type: 'roll' }, id) as CucupolyState
      expect(getDiceCount(turn)).toBe(3)
      expect(lastRollValues(after, state.names[id])).toHaveLength(3)
    }
  })

  it('una Sorpresa de dados no puede empezar otro evento dentro de la ronda', () => {
    const state = fresh(TWO, 99)
    state.activeEvent = activeEventFor('dados_tres', 1)
    const seed = seedForChance(3, 2) // Vamos rápido
    const { total } = rollOutcome(seed, 3)
    state.seed = seed
    state.phase = 'waiting-roll'
    state.currentIndex = 0
    state.positions.p1 = (9 - total + 48) % 48

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.roundNumber).toBe(1)
    expect(after.activeEvent?.id).toBe('dados_tres')
    expect(after.scheduledEventId).toBeNull()
    expect(after.log.some((entry) => entry.text.includes('descartado'))).toBe(true)
    expect(getDiceCount(after)).toBe(3)

    // El siguiente jugador de la misma ronda también tira 3 dados.
    const p2Turn: CucupolyState = {
      ...after,
      phase: 'waiting-roll',
      currentIndex: 1,
      dice: null,
      endTurnPending: false,
      endTurnTicks: 0,
      seed: seedForDie(2),
    }
    expect(getDiceCount(p2Turn)).toBe(3)
    const next = reduce(p2Turn, { type: 'roll' }, 'p2') as CucupolyState
    expect(lastRollValues(next, 'Beto')).toHaveLength(3)
  })

  it('descarta un evento de dados si la próxima ventana ya es final', () => {
    const state = fresh(TWO, 99)
    state.initialEvent = 'impulso_economico'
    state.roundNumber = FINAL_PHASE_START_ROUND - 2
    state.nextEventRound = FINAL_PHASE_START_ROUND
    state.phase = 'waiting-roll'

    const result = requestDiceEvent(state, 'dados_tres')
    expect(result.ok).toBe(false)
    expect(state.scheduledEventId).toBeNull()
  })

  it('sin evento activo la Sorpresa queda programada para la próxima ventana', () => {
    const state = fresh(TWO, 99)
    // El inicial ya ocurrió; la próxima ventana será la ronda 5.
    state.initialEvent = 'impulso_economico'
    state.nextEventRound = 5
    const seed = seedForChance(2, 2) // Vamos rápido con 2 dados
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.activeEvent).toBeNull()
    expect(after.scheduledEventId).toBe('dados_tres')

    // No empieza a mitad de ronda: espera a la ventana programada.
    let next = after
    while (next.roundNumber < 5) {
      next = passTurn(next, next.turnOrder[next.currentIndex])
    }
    expect(next.roundNumber).toBe(5)
    expect(next.phase).toBe('event')
    expect(isGameError(reduce(next, { type: 'roll' }, 'p1'))).toBe(true)

    const started = reduce(
      next,
      { type: 'start-event', payload: { eventId: 'dados_tres', gapRounds: 4 } },
      'p1',
    ) as CucupolyState
    expect(started.activeEvent).toMatchObject({
      id: 'dados_tres',
      startRound: 5,
      endRound: 5,
    })
    expect(started.scheduledEventId).toBeNull()
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
    expect(drawableEvents({})).toEqual([...NORMAL_EVENT_POOL])

    const allOwned: Record<number, string> = {}
    for (const tile of BOARD) {
      if (tile.price !== undefined) allOwned[tile.index] = 'p1'
    }
    expect(freeAuctionTiles(allOwned)).toEqual([])
    // Sin propiedades libres, las subastas salen del sorteo.
    expect(drawableEvents(allOwned)).toEqual([
      'impulso_economico',
      'semana_descuentos',
      'dados_uno',
      'dados_tres',
    ])

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
    state.activeEvent = activeEventFor('dados_uno', 1)
    state.positions.p2 = 0 // con un dado de 1 cae en Fortaleza ($60)
    // El evento inicial ya ocurrió: aquí solo se prueba la habilidad.
    state.initialEvent = 'impulso_economico'
    state.nextEventRound = 9

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

describe('intercambio estilo Monopoly', () => {
  it('abre la ventana tras tirar y no cambia de turno hasta Continuar', () => {
    const state = fresh(TWO, 99)
    state.owners[1] = 'p2'
    state.positions.p1 = 0
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1)
    state.activeEvent = activeEventFor('dados_uno', 1)

    const rolled = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(rolled.endTurnPending).toBe(true)
    expect(rolled.phase).toBe('waiting-roll')
    expect(rolled.turnOrder[rolled.currentIndex]).toBe('p1')
    expect(rolled.dice?.total).toBe(1)
    // No se puede volver a tirar mientras la ventana sigue abierta.
    expect(isGameError(reduce(rolled, { type: 'roll' }, 'p1'))).toBe(true)

    const continued = reduce(rolled, { type: 'continue-turn' }, 'p1') as CucupolyState
    expect(continued.endTurnPending).toBe(false)
    expect(continued.phase).toBe('waiting-roll')
    expect(continued.turnOrder[continued.currentIndex]).toBe('p2')
    expect(continued.dice).toBeNull()
  })

  it('acepta fuera de turno, transfiere propiedades y dinero y aplica una sola vez', () => {
    const state = fresh(TWO, 99)
    state.owners[1] = 'p1'
    state.owners[3] = 'p2'
    state.currentIndex = 0
    state.phase = 'waiting-roll'

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: {
          to: 'p2',
          giveTiles: [1],
          getTiles: [3],
          giveMoney: 50,
          getMoney: 0,
        },
      },
      'p1',
    ) as CucupolyState

    expect(proposed.phase).toBe('trade')
    expect(proposed.trade?.stage).toBe('pending')
    // Beto acepta aunque el turno siga siendo de Ana.
    const accepted = reduce(proposed, { type: 'accept-trade' }, 'p2') as CucupolyState

    expect(accepted.trade).toBeNull()
    expect(accepted.owners[1]).toBe('p2')
    expect(accepted.owners[3]).toBe('p1')
    expect(accepted.money.p1).toBe(RULES.startingMoney - 50)
    expect(accepted.money.p2).toBe(RULES.startingMoney + 50)
    expect(
      accepted.notices.some((notice) =>
        notice.text.includes('intercambiaron propiedades y dinero'),
      ),
    ).toBe(true)
    // Segunda aceptación: el trato ya no existe y no se vuelve a aplicar.
    expect(isGameError(reduce(accepted, { type: 'accept-trade' }, 'p2'))).toBe(true)
  })

  it('cancela y avisa si una propiedad ya no pertenece a quien la ofrece', () => {
    const state = fresh(THREE, 99)
    state.owners[1] = 'p1'
    state.currentIndex = 0
    state.phase = 'waiting-roll'

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: { to: 'p2', giveTiles: [1], getTiles: [], giveMoney: 0, getMoney: 0 },
      },
      'p1',
    ) as CucupolyState

    // Simula un cambio de dueño entre la propuesta y la aceptación.
    const stale: CucupolyState = {
      ...proposed,
      owners: { ...proposed.owners, 1: 'p3' },
    }
    const result = reduce(stale, { type: 'accept-trade' }, 'p2') as CucupolyState

    expect(result.trade).toBeNull()
    expect(result.phase).toBe('waiting-roll')
    expect(result.owners[1]).toBe('p3')
    expect(result.owners[3]).toBeUndefined()
    expect(result.money.p1).toBe(RULES.startingMoney)
    expect(result.notices.some((notice) => notice.text.includes('Trato cancelado'))).toBe(true)
    expect(result.notices.some((notice) => notice.text.includes('ya no pertenece'))).toBe(true)
  })

  it('cancela y avisa si el dinero ya no alcanza', () => {
    const state = fresh(TWO, 99)
    state.currentIndex = 0
    state.phase = 'waiting-roll'

    const proposed = reduce(
      state,
      {
        type: 'propose-trade',
        payload: { to: 'p2', giveTiles: [], getTiles: [], giveMoney: 100, getMoney: 0 },
      },
      'p1',
    ) as CucupolyState
    const stale: CucupolyState = {
      ...proposed,
      money: { ...proposed.money, p1: 30 },
    }
    const result = reduce(stale, { type: 'accept-trade' }, 'p2') as CucupolyState

    expect(result.trade).toBeNull()
    expect(result.money.p1).toBe(30)
    expect(result.money.p2).toBe(RULES.startingMoney)
    expect(result.notices.some((notice) => notice.text.includes('dinero ofrecido'))).toBe(true)
  })

  it('el anfitrión cierra la ventana cuando se agota el tiempo', () => {
    const state = fresh(TWO, 99)
    const windowed: CucupolyState = {
      ...state,
      phase: 'waiting-roll',
      currentIndex: 0,
      dice: { values: [1], total: 1 },
      endTurnPending: true,
      endTurnTicks: 1,
    }

    const next = reduce(windowed, { type: 'end-turn-tick' }, 'p1') as CucupolyState
    expect(next.endTurnPending).toBe(false)
    expect(next.endTurnTicks).toBe(0)
    expect(next.turnOrder[next.currentIndex]).toBe('p2')
    expect(next.dice).toBeNull()
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
    state.activeEvent = activeEventFor('dados_uno', 1)

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

  it('solo se activa antes de tirar, no en la ventana de fin de turno', () => {
    const pending = fresh()
    pending.owners[WATER_TILE] = 'p1'
    pending.currentIndex = 0
    pending.phase = 'waiting-roll'
    pending.dice = { values: [1], total: 1 }
    pending.endTurnPending = true
    pending.endTurnTicks = 5

    expect(
      isGameError(
        reduce(pending, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p1'),
      ),
    ).toBe(true)

    const rolled = { ...pending, endTurnPending: false, endTurnTicks: 0 }
    expect(
      isGameError(
        reduce(rolled, { type: 'activate-ability', payload: { tileId: WATER_TILE } }, 'p1'),
      ),
    ).toBe(true)
  })
})

/** Mesa de 21 en fase de cartas, con las apuestas ya cobradas. */
function table21State(overrides: Partial<Table21State> = {}): CucupolyState {
  const state = fresh()
  state.phase = 'twenty-one'
  state.currentIndex = 0
  state.money.p1 = RULES.startingMoney - 50
  state.money.p2 = RULES.startingMoney - 50
  state.table21 = {
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

describe('evento: mesa de 21', () => {
  it('una sorpresa abre la mesa para todos los activos', () => {
    const state = fresh()
    const seed = seedForChance(2, 0)
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.phase).toBe('twenty-one')
    expect(after.table21).not.toBeNull()
    expect(after.table21!.stage).toBe('bets')
    expect(after.table21!.pendingBets).toEqual(['p1', 'p2'])
  })

  it('cobra las apuestas al sentarse y arma el pozo al cerrar las decisiones', () => {
    const state = fresh()
    const seed = seedForChance(2, 0)
    aimAtChance(state, 'p1', seed)
    let after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    after = reduce(after, { type: 'join-table', payload: { bet: 50 } }, 'p1') as CucupolyState
    expect(after.money.p1).toBe(RULES.startingMoney - 50)
    expect(after.table21!.stage).toBe('bets')
    expect(after.table21!.pot).toBe(0)

    after = reduce(after, { type: 'pass-table' }, 'p2') as CucupolyState
    expect(after.table21!.stage).toBe('draw')
    expect(after.table21!.pot).toBe(50)
    expect(after.table21!.cardCounts).toEqual({ p1: 0 })
  })

  it('no difunde cartas ni totales ajenos antes de la revelación', () => {
    let after = reduce(table21State(), { type: 'draw-card' }, 'p1') as CucupolyState
    // Pedir carta solo deja una solicitud pública: el valor aún no existe.
    expect(after.table21!.pendingDraws).toEqual(['p1'])

    after = reduce(
      after,
      { type: 'deal-card', payload: { playerId: 'p1', card: 10, total: 10 } },
      'p1',
    ) as CucupolyState

    const table = after.table21!
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
      table21State({ cardCounts: { p1: 2, p2: 1 } }),
      { type: 'stand' },
      'p1',
    ) as CucupolyState
    const busted = reduce(
      table21State({ pendingDraws: ['p2'] }),
      { type: 'deal-card', payload: { playerId: 'p2', card: 11, total: 32 } },
      'p1',
    ) as CucupolyState

    expect(stood.table21!.ready).toEqual(['p1'])
    expect(busted.table21!.ready).toEqual(['p2'])
    // El estado público solo conoce "ready": ni plantado ni pasado.
    expect('busted' in stood.table21!).toBe(false)
    expect('standing' in stood.table21!).toBe(false)
    expect(JSON.stringify(busted.table21)).not.toContain('busted')
  })

  it('solo el anfitrión reparte cartas y el invitado solo puede pedirlas', () => {
    const state = table21State()
    expect(
      isGameError(
        reduce(state, { type: 'deal-card', payload: { playerId: 'p1', card: 5, total: 5 } }, 'p2'),
      ),
    ).toBe(true)

    const requested = reduce(state, { type: 'draw-card' }, 'p2') as CucupolyState
    expect(requested.table21!.pendingDraws).toEqual(['p2'])
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
    const state = table21State({ ready: ['p1', 'p2'], cardCounts: { p1: 2, p2: 2 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 18, p2: 20 }, cards: { p1: [9, 9], p2: [10, 10] } },
      },
      'p1',
    ) as CucupolyState

    expect(revealed.table21!.stage).toBe('reveal')
    expect(revealed.table21!.reveal).toEqual({
      hands: { p1: 18, p2: 20 },
      cards: { p1: [9, 9], p2: [10, 10] },
      busted: [],
    })
    expect(revealed.table21!.settlement).toMatchObject({
      allBusted: false,
      winnerIds: ['p2'],
      best: 20,
      pot: 100,
    })
    expect(revealed.table21!.settlement!.payouts).toEqual([{ to: 'p2', amount: 100 }])
    // El dinero no se mueve hasta que termina la animación.
    expect(revealed.money.p2).toBe(RULES.startingMoney - 50)

    const settled = reduce(revealed, { type: 'settle-table' }, 'p1') as CucupolyState
    expect(settled.money.p2).toBe(RULES.startingMoney + 50)
    expect(settled.table21).toBeNull()
    const notice = settled.notices.find((entry) => entry.kind === 'money')
    expect(notice).toMatchObject({ to: 'p2', amount: 100 })
    expect(notice?.text).toContain('pozo de la mesa de 21')
  })

  it('el objetivo es 21: 21 vale y 22 se pasa', () => {
    const state = table21State({ ready: ['p1', 'p2'], cardCounts: { p1: 2, p2: 2 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 21, p2: 22 }, cards: { p1: [10, 11], p2: [11, 11] } },
      },
      'p1',
    ) as CucupolyState

    expect(revealed.table21!.reveal!.busted).toEqual(['p2'])
    expect(revealed.table21!.settlement).toMatchObject({
      allBusted: false,
      winnerIds: ['p1'],
      best: 21,
    })
  })

  it('reparte el pozo entre los empatados', () => {
    const state = table21State({ ready: ['p1', 'p2'], cardCounts: { p1: 2, p2: 2 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 21, p2: 21 }, cards: { p1: [11, 10], p2: [10, 11] } },
      },
      'p1',
    ) as CucupolyState
    expect(revealed.table21!.settlement!.payouts).toEqual([
      { to: 'p1', amount: 50 },
      { to: 'p2', amount: 50 },
    ])

    const settled = reduce(revealed, { type: 'settle-table' }, 'p1') as CucupolyState
    expect(settled.money.p1).toBe(RULES.startingMoney)
    expect(settled.money.p2).toBe(RULES.startingMoney)
  })

  it('devuelve las apuestas si todos se pasan de 21', () => {
    const state = table21State({ ready: ['p1', 'p2'], cardCounts: { p1: 3, p2: 4 } })
    const revealed = reduce(
      state,
      {
        type: 'reveal-table',
        payload: { hands: { p1: 32, p2: 35 }, cards: { p1: [11, 11, 10], p2: [11, 11, 11, 2] } },
      },
      'p1',
    ) as CucupolyState
    expect(revealed.table21!.settlement).toMatchObject({
      allBusted: true,
      winnerIds: [],
      best: null,
    })
    expect(revealed.table21!.settlement!.payouts).toEqual([
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
    const notReady = table21State({ ready: ['p1'], cardCounts: { p1: 1, p2: 1 } })
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

    const ready = table21State({ ready: ['p1', 'p2'], cardCounts: { p1: 1, p2: 1 } })
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
    const state = table21State({ ready: ['p1', 'p2'], cardCounts: { p1: 1, p2: 1 } })
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
  it('la Sorpresa lo programa para la próxima ventana y todos tiran 1 dado', () => {
    let state = fresh()
    // El inicial ya ocurrió; la próxima ventana será la ronda 5.
    state.initialEvent = 'impulso_economico'
    state.nextEventRound = 5
    const seed = seedForChance(2, 1)
    aimAtChance(state, 'p1', seed)

    state = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(state.activeEvent).toBeNull()
    expect(state.scheduledEventId).toBe('dados_uno')

    // No empieza a mitad de ronda: espera a la ventana programada.
    while (state.roundNumber < 5) {
      state = passTurn(state, state.turnOrder[state.currentIndex])
    }
    expect(state.roundNumber).toBe(5)
    expect(state.phase).toBe('event')
    state = reduce(
      state,
      { type: 'start-event', payload: { eventId: 'dados_uno', gapRounds: 4 } },
      'p1',
    ) as CucupolyState
    expect(state.activeEvent).toMatchObject({
      id: 'dados_uno',
      startRound: 5,
      endRound: 5,
    })
    expect(getDiceCount(state)).toBe(1)

    const rolled = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(lastRollValues(rolled, 'Ana')).toHaveLength(1)
  })
})

describe('evento: vamos rápido (3 dados)', () => {
  it('la Sorpresa lo programa para la próxima ventana y todos tiran 3 dados', () => {
    let state = fresh()
    state.initialEvent = 'impulso_economico'
    state.nextEventRound = 5
    const seed = seedForChance(2, 2)
    aimAtChance(state, 'p1', seed)

    state = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(state.activeEvent).toBeNull()
    expect(state.scheduledEventId).toBe('dados_tres')

    while (state.roundNumber < 5) {
      state = passTurn(state, state.turnOrder[state.currentIndex])
    }
    expect(state.roundNumber).toBe(5)
    expect(state.phase).toBe('event')
    state = reduce(
      state,
      { type: 'start-event', payload: { eventId: 'dados_tres', gapRounds: 4 } },
      'p1',
    ) as CucupolyState
    expect(state.activeEvent).toMatchObject({
      id: 'dados_tres',
      startRound: 5,
      endRound: 5,
    })
    expect(getDiceCount(state)).toBe(3)

    const rolled = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(lastRollValues(rolled, 'Ana')).toHaveLength(3)
  })
})

describe('movimiento con 1 y 3 dados', () => {
  it('avanza la ficha la suma exacta de los dados', () => {
    const state = fresh()
    state.activeEvent = activeEventFor('dados_uno', 1)
    state.seed = seedForDie(4)
    state.currentIndex = 0
    state.positions.p1 = 10

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.dice!.total).toBe(4)
    expect(after.positions.p1).toBe(14)
  })

  it('con 3 dados avanza entre 3 y 18 casillas', () => {
    const state = fresh()
    state.activeEvent = activeEventFor('dados_tres', 1)
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

describe('construcción de casas y hotel', () => {
  /** Grupo marrón (1 y 3) en manos de Ana, listo para construir en su turno. */
  function buildable(
    levels: [number, number] = [0, 0],
    money: number = RULES.startingMoney,
  ): CucupolyState {
    const state = fresh()
    state.phase = 'waiting-roll'
    state.currentIndex = 0
    state.owners[1] = 'p1'
    state.owners[3] = 'p1'
    state.buildings[1] = levels[0]
    state.buildings[3] = levels[1]
    state.money.p1 = money
    return state
  }

  it('solo construye con el grupo de color completo', () => {
    const state = fresh()
    state.phase = 'waiting-roll'
    state.currentIndex = 0
    state.owners[1] = 'p1' // falta Los Estoraques (3)
    state.money.p1 = RULES.startingMoney

    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)
  })

  it('solo el dueño construye y solo en su turno antes de tirar', () => {
    const state = buildable()

    // Otro jugador no puede construir sobre el grupo de Ana.
    state.currentIndex = 1
    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p2')),
    ).toBe(true)

    // Ni Ana fuera de su turno.
    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)

    // Ni después de tirar (fase distinta a waiting-roll).
    const afterRoll = { ...state, currentIndex: 0, phase: 'buy-decision' as const, pendingBuy: 5 }
    afterRoll.owners = { ...state.owners }
    afterRoll.buildings = { ...state.buildings }
    afterRoll.money = { ...state.money }
    expect(
      isGameError(reduce(afterRoll, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)
  })

  it('no construye sin saldo suficiente', () => {
    const state = buildable([0, 0], buildCostFor(1)! - 1)
    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)
    // Al límite exacto sí se puede.
    const exact = buildable([0, 0], buildCostFor(1)!)
    expect(
      isGameError(reduce(exact, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(false)
  })

  it('construye de forma pareja: máximo un nivel de diferencia', () => {
    let state = buildable()
    state = reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1') as CucupolyState
    expect(state.buildings[1]).toBe(1)
    expect(state.buildings[3] ?? 0).toBe(0)

    // La propiedad con menos nivel del grupo debe ir primero.
    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)
    state = reduce(state, { type: 'build-house', payload: { propertyId: 3 } }, 'p1') as CucupolyState
    expect(state.buildings[3]).toBe(1)

    // Ya nivelados, cualquiera puede subir.
    state = reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1') as CucupolyState
    expect(state.buildings[1]).toBe(2)
  })

  it('tras 4 casas pasa al hotel y no admite más edificios', () => {
    let state = buildable([4, 4])

    // Con 4 casas ya no se pueden poner más casas.
    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)
    // El hotel exige 4 casas.
    expect(
      isGameError(reduce(buildable([3, 4]), { type: 'build-hotel', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)

    state = reduce(state, { type: 'build-hotel', payload: { propertyId: 1 } }, 'p1') as CucupolyState
    expect(state.buildings[1]).toBe(HOTEL_LEVEL)
    expect(state.money.p1).toBe(RULES.startingMoney - buildCostFor(1)!)

    // Ni otra casa ni otro hotel sobre la misma propiedad.
    expect(
      isGameError(reduce(state, { type: 'build-house', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'build-hotel', payload: { propertyId: 1 } }, 'p1')),
    ).toBe(true)

    // El segundo hotel del grupo sí es legal ([5, 4]).
    state = reduce(state, { type: 'build-hotel', payload: { propertyId: 3 } }, 'p1') as CucupolyState
    expect(state.buildings[3]).toBe(HOTEL_LEVEL)
  })

  it('cada construcción descuenta su costo exacto y genera un aviso', () => {
    const state = buildable()
    const after = reduce(
      state,
      { type: 'build-house', payload: { propertyId: 1 } },
      'p1',
    ) as CucupolyState

    expect(after.money.p1).toBe(RULES.startingMoney - buildCostFor(1)!)
    const notice = after.notices.find((entry) => entry.kind === 'money')
    expect(notice).toMatchObject({ from: 'p1', amount: buildCostFor(1) })
    expect(notice?.text).toBe('Ana construyó una casa en Fortaleza (−$50)')

    const hotelState = buildable([4, 4])
    const hotel = reduce(
      hotelState,
      { type: 'build-hotel', payload: { propertyId: 1 } },
      'p1',
    ) as CucupolyState
    const hotelNotice = hotel.notices.find((entry) => entry.kind === 'money')
    expect(hotel.money.p1).toBe(RULES.startingMoney - buildCostFor(1)!)
    expect(hotelNotice?.text).toBe('Ana construyó un hotel en Fortaleza (−$50)')
  })

  it('el alquiler mostrado y cobrado sigue la tabla por nivel', () => {
    const state = fresh()
    state.owners[1] = 'p1'
    const price = BOARD[1].price ?? 0

    for (let level = 0; level <= HOTEL_LEVEL; level += 1) {
      state.buildings[1] = level
      expect(rentFor(state, 1, 7)).toBe(Math.round(price * RULES.propertyRentRates[level]))
    }
    // 0 casas = 10%, 4 casas = 400%, hotel = 500%.
    state.buildings[1] = 0
    expect(rentFor(state, 1, 7)).toBe(6)
    state.buildings[1] = MAX_HOUSES
    expect(rentFor(state, 1, 7)).toBe(price * 4)
    state.buildings[1] = HOTEL_LEVEL
    expect(rentFor(state, 1, 7)).toBe(price * 5)
  })

  it('el cobro real de la renta coincide con rentFor', () => {
    const state = fresh()
    state.owners[1] = 'p2'
    state.buildings[1] = 2
    state.positions.p1 = 0
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1)
    state.activeEvent = activeEventFor('dados_uno', 1)

    const expected = rentFor(state, 1, 1)
    expect(expected).toBe(Math.round((BOARD[1].price ?? 0) * 1.5))

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(after.money.p1).toBe(RULES.startingMoney - expected)
    expect(after.money.p2).toBe(RULES.startingMoney + expected)
    const notice = after.notices.find(
      (entry) => entry.kind === 'money' && entry.text.includes('alquiler'),
    )
    expect(notice?.amount).toBe(expected)
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
    state.activeEvent = activeEventFor('dados_uno', 1)

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

  it('avisa el evento de dados programado con causa y efecto', () => {
    const state = fresh()
    state.initialEvent = 'impulso_economico'
    state.nextEventRound = 5
    const seed = seedForChance(2, 1) // Vamos despacio: 1 dado
    aimAtChance(state, 'p1', seed)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState
    expect(
      after.notices.some(
        (entry) =>
          entry.kind === 'rule' &&
          entry.text.includes('1 dado') &&
          entry.text.includes('Vamos despacio') &&
          entry.text.includes('ronda 5'),
      ),
    ).toBe(true)
  })
})

describe('bancarrota', () => {
  it('elimina al jugador, transfiere sus propiedades al acreedor y gana el último', () => {
    const state = fresh()
    state.owners[1] = 'p2' // Fortaleza: renta 6
    state.owners[3] = 'p1' // Los Estoraques: pasa al acreedor
    state.buildings[3] = 2 // el acreedor hereda el nivel de construcción
    state.money.p1 = 5
    state.positions.p1 = 0
    state.positions.p2 = 20
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1) // cae en Fortaleza (1)
    state.activeEvent = activeEventFor('dados_uno', 1)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    expect(after.bankrupt).toContain('p1')
    expect(after.money.p1).toBe(0)
    expect(after.owners[3]).toBe('p2')
    expect(after.buildings[3]).toBe(2)
    expect(after.money.p2).toBe(RULES.startingMoney + 5)
    expect(after.phase).toBe('finished')
    expect(after.winner).toBe('p2')
    expect(after.notices.some((notice) => notice.text.includes('quedó en bancarrota'))).toBe(
      true,
    )
  })

  it('si la deuda es con el banco, deja las propiedades sin dueño y sin edificios', () => {
    const state = fresh()
    state.owners[3] = 'p1' // Los Estoraques
    state.buildings[3] = 4
    state.money.p1 = 10
    state.positions.p1 = 3
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1) // cae en Impuesto (4), que cobra 50
    state.activeEvent = activeEventFor('dados_uno', 1)

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    expect(after.bankrupt).toContain('p1')
    expect(after.owners[3]).toBeNull()
    expect(after.buildings[3]).toBe(0)
    expect(after.phase).toBe('finished')
    expect(after.winner).toBe('p2')
    expect(after.notices.some((notice) => notice.text.includes('quedó en bancarrota'))).toBe(
      true,
    )
  })

  it('saca al eliminado del orden de turnos y de la cuenta de rondas', () => {
    const state = fresh(THREE)
    state.money.p1 = 10
    state.positions.p1 = 3
    state.currentIndex = 0
    state.phase = 'waiting-roll'
    state.seed = seedForDie(1) // Impuesto (4)
    state.activeEvent = activeEventFor('dados_uno', 1)

    let after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    expect(after.bankrupt).toContain('p1')
    expect(after.turnOrder).toEqual(['p2', 'p3'])
    expect(after.turnOrder[after.currentIndex]).toBe('p2')
    expect(after.roundNumber).toBe(1)
    expect(after.phase).toBe('waiting-roll')
    // El eliminado ya no puede actuar en su antiguo asiento.
    expect(isGameError(reduce(after, { type: 'roll' }, 'p1'))).toBe(true)

    after = passTurn(after, 'p2')
    expect(after.turnOrder[after.currentIndex]).toBe('p3')
    expect(after.roundNumber).toBe(1)

    after = passTurn(after, 'p3')
    expect(after.turnOrder[after.currentIndex]).toBe('p2')
    expect(after.roundNumber).toBe(2)
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

/** Deja al jugador actual a punto de caer en el Sitio de apuestas (41). */
function aimAtBetting(
  state: CucupolyState,
  playerId: string,
  seed: number,
): CucupolyState {
  const { total } = rollOutcome(seed, getDiceCount(state))
  state.seed = seed
  state.phase = 'waiting-roll'
  state.currentIndex = state.turnOrder.indexOf(playerId)
  state.positions[playerId] = (41 - total + 48) % 48
  return state
}

/** Estado ya dentro de la tragamonedas, sin pasar por los dados. */
function slotState(seed = 7, playerId = 'p1'): CucupolyState {
  const state = fresh(TWO, seed)
  state.phase = 'slots'
  state.currentIndex = state.turnOrder.indexOf(playerId)
  state.slot = {
    playerId,
    stage: 'bet',
    bet: 0,
    reels: null,
    payout: 0,
    multiplier: 0,
    spinSeq: 0,
  }
  return state
}

/** Reproduce los tres símbolos que el reducer sacará del seed. */
function reelsForSeed(seed: number): SlotSymbolId[] {
  let current = seed
  const reels: SlotSymbolId[] = []
  for (let index = 0; index < 3; index += 1) {
    const next = nextSeed(current)
    current = next.seed
    reels.push(SLOT_REEL[Math.floor(next.value * SLOT_REEL.length)])
  }
  return reels
}

/** Seed cuyo giro con `bet` deja algún premio. */
function winningSlotSeed(bet: number): number {
  for (let seed = 1; seed < 10_000; seed += 1) {
    const spun = reduce(
      slotState(seed),
      { type: 'spin-slot', payload: { bet } },
      'p1',
    ) as CucupolyState
    if (slotPayout(reelsForSeed(spun.seed), bet).payout > 0) return seed
  }
  throw new Error('Sin seed ganadora para la tragamonedas')
}

describe('tragamonedas del Sitio de apuestas', () => {
  it('se abre al caer en la casilla 41', () => {
    const after = reduce(
      aimAtBetting(fresh(), 'p1', 12345),
      { type: 'roll' },
      'p1',
    ) as CucupolyState

    expect(BOARD[41]).toMatchObject({ name: 'Sitio de apuestas', type: 'betting' })
    expect(after.positions.p1).toBe(41)
    expect(after.phase).toBe('slots')
    expect(after.slot).toMatchObject({
      playerId: 'p1',
      stage: 'bet',
      bet: 0,
      reels: null,
      payout: 0,
      multiplier: 0,
      spinSeq: 0,
    })
  })

  it('sin el saldo mínimo no abre la máquina y cierra el turno', () => {
    const state = aimAtBetting(fresh(), 'p1', 12345)
    state.money.p1 = SLOT_MIN_BET - 1

    const after = reduce(state, { type: 'roll' }, 'p1') as CucupolyState

    expect(after.phase).toBe('waiting-roll')
    expect(after.slot).toBeNull()
    expect(after.endTurnPending).toBe(true)
    expect(after.money.p1).toBe(SLOT_MIN_BET - 1)
  })

  it('cobra la apuesta al girar y rechaza apuestas fuera de la tabla', () => {
    const state = slotState()
    const before = state.money.p1

    expect(
      isGameError(reduce(state, { type: 'spin-slot', payload: { bet: 7 } }, 'p1')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'spin-slot', payload: { bet: 0 } }, 'p1')),
    ).toBe(true)
    expect(
      isGameError(reduce(state, { type: 'spin-slot' }, 'p1')),
    ).toBe(true)

    const spun = reduce(
      state,
      { type: 'spin-slot', payload: { bet: SLOT_BETS[0] } },
      'p1',
    ) as CucupolyState
    expect(spun.money.p1).toBe(before - SLOT_BETS[0])
    expect(spun.slot).toMatchObject({
      stage: 'spinning',
      bet: SLOT_BETS[0],
      reels: null,
      payout: 0,
      spinSeq: 1,
    })

    // No se puede apostar dos veces mientras gira.
    expect(
      isGameError(reduce(spun, { type: 'spin-slot', payload: { bet: 10 } }, 'p1')),
    ).toBe(true)
  })

  it('solo el jugador de la máquina puede girar', () => {
    const state = slotState()
    expect(
      isGameError(reduce(state, { type: 'spin-slot', payload: { bet: 10 } }, 'p2')),
    ).toBe(true)
  })

  it('rechaza una apuesta mayor que el saldo', () => {
    const state = slotState()
    state.money.p1 = SLOT_BETS[SLOT_BETS.length - 1] - 1
    expect(
      isGameError(
        reduce(state, { type: 'spin-slot', payload: { bet: SLOT_BETS[SLOT_BETS.length - 1] } }, 'p1'),
      ),
    ).toBe(true)
  })

  it('resuelve con el RNG del estado, paga el premio y es determinista', () => {
    const bet = 10
    const seed = winningSlotSeed(bet)

    const run = () => {
      const spun = reduce(
        slotState(seed),
        { type: 'spin-slot', payload: { bet } },
        'p1',
      ) as CucupolyState
      const expectedReels = reelsForSeed(spun.seed)
      const expected = slotPayout(expectedReels, bet)
      const settled = reduce(spun, { type: 'settle-slot' }, 'p1') as CucupolyState
      return { spun, settled, expectedReels, expected }
    }

    const first = run()
    expect(first.settled.slot).toMatchObject({
      stage: 'result',
      bet,
      payout: first.expected.payout,
      multiplier: first.expected.multiplier,
    })
    expect(first.settled.slot!.reels).toEqual(first.expectedReels)
    expect(first.expected.payout).toBeGreaterThan(0)
    expect(first.settled.money.p1).toBe(
      RULES.startingMoney - bet + first.expected.payout,
    )

    const second = run()
    expect(second.settled.slot).toEqual(first.settled.slot)
    expect(second.settled.money).toEqual(first.settled.money)
  })

  it('solo el anfitrión resuelve el giro', () => {
    const spun = reduce(
      slotState(),
      { type: 'spin-slot', payload: { bet: 10 } },
      'p1',
    ) as CucupolyState

    expect(isGameError(reduce(spun, { type: 'settle-slot' }, 'p2'))).toBe(true)
    expect(
      isGameError(reduce(spun, { type: 'settle-slot' }, 'p1')),
    ).toBe(false)
  })

  it('no deja salir mientras los rodillos giran', () => {
    const spun = reduce(
      slotState(),
      { type: 'spin-slot', payload: { bet: 10 } },
      'p1',
    ) as CucupolyState

    expect(isGameError(reduce(spun, { type: 'leave-slot' }, 'p1'))).toBe(true)
    expect(isGameError(reduce(spun, { type: 'leave-slot' }, 'p2'))).toBe(true)
  })

  it('permite volver a girar tras un resultado y sube la secuencia', () => {
    const seed = 12345
    const spun = reduce(
      slotState(seed),
      { type: 'spin-slot', payload: { bet: 5 } },
      'p1',
    ) as CucupolyState
    const settled = reduce(spun, { type: 'settle-slot' }, 'p1') as CucupolyState
    const before = settled.money.p1

    const again = reduce(
      settled,
      { type: 'spin-slot', payload: { bet: 25 } },
      'p1',
    ) as CucupolyState

    expect(again.slot).toMatchObject({
      stage: 'spinning',
      bet: 25,
      reels: null,
      payout: 0,
      multiplier: 0,
      spinSeq: 2,
    })
    expect(again.money.p1).toBe(before - 25)
  })

  it('salir tras una tirada abre la ventana de fin de turno y limpia la máquina', () => {
    const rolled = reduce(
      aimAtBetting(fresh(), 'p1', 12345),
      { type: 'roll' },
      'p1',
    ) as CucupolyState
    expect(rolled.phase).toBe('slots')

    const after = reduce(rolled, { type: 'leave-slot' }, 'p1') as CucupolyState

    expect(after.slot).toBeNull()
    expect(after.phase).toBe('waiting-roll')
    expect(after.endTurnPending).toBe(true)
    expect(after.turnOrder[after.currentIndex]).toBe('p1')
  })

  it('salir sin tirada pasa el turno directamente', () => {
    const after = reduce(slotState(), { type: 'leave-slot' }, 'p1') as CucupolyState

    expect(after.slot).toBeNull()
    expect(after.phase).toBe('waiting-roll')
    expect(after.endTurnPending).toBe(false)
    expect(after.turnOrder[after.currentIndex]).toBe('p2')
  })

  it('el anfitrión puede cerrar la máquina de un invitado desconectado', () => {
    const state = slotState(7, 'p2')
    expect(state.turnOrder[state.currentIndex]).toBe('p2')

    const after = reduce(state, { type: 'leave-slot' }, 'p1') as CucupolyState

    expect(after.slot).toBeNull()
    expect(after.turnOrder[after.currentIndex]).toBe('p1')
  })

  it('un tercero no puede cerrar la máquina', () => {
    const state = slotState(7, 'p1')
    state.order = [...state.order, 'p3']
    state.names.p3 = 'Caro'

    expect(isGameError(reduce(state, { type: 'leave-slot' }, 'p3'))).toBe(true)
  })

  it('las acciones de la máquina fallan fuera de la fase de tragamonedas', () => {
    const state = fresh()
    expect(
      isGameError(reduce(state, { type: 'spin-slot', payload: { bet: 10 } }, 'p1')),
    ).toBe(true)
    expect(isGameError(reduce(state, { type: 'settle-slot' }, 'p1'))).toBe(true)
    expect(isGameError(reduce(state, { type: 'leave-slot' }, 'p1'))).toBe(true)
  })
})
