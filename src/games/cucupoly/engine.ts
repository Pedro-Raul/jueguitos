import type { GameAction, Player } from '../../types'
import {
  BOARD,
  BUS_TILES,
  ELECTRICITY_TILE,
  JAIL_TILE,
  TELEPHONE_TILE,
  WATER_TILE,
} from './board'
import { RULES } from './rules.config'
import {
  AUCTION_OPEN_IDLE_TICKS,
  INITIAL_EVENT_ROUND,
  MIN_RAISE,
  auctionModeFor,
  freeAuctionTiles,
  isInitialEventId,
  purchasePriceFor,
  type AuctionMode,
  type InitialEventId,
} from './events'
import {
  pushEventNotice,
  pushMoneyNotice,
  pushNotice,
  pushRuleNotice,
  type Notice,
} from './notices'
import {
  buildCostFor,
  buildingLevelFor,
  buildRuleError,
  rentRateFor,
} from './buildings'
import {
  table21Total,
  table21Transfers,
  type Table21Settlement,
} from './table21'

export type Phase =
  | 'turn-order-roll'
  | 'turn-order-reveal'
  | 'waiting-roll'
  | 'event'
  | 'buy-decision'
  | 'auction'
  | 'twenty-one'
  | 'trade'
  | 'bus-move'
  | 'finished'

export type LogEntry = { turn: number; text: string }

/** Ventana de una habilidad expresada en números de turno absolutos. */
export type AbilityState = { from: number; until: number; readyAt: number }

/**
 * Sorteo del orden de turnos previo a la ronda 1.
 * - `groups`: bloques de posiciones pendientes, de mayor a menor. Un bloque de
 *   más de un jugador es un empate que debe relanzar.
 * - `queue`: jugadores que deben lanzar ahora, en orden.
 * - `rolls`: último valor de cada jugador (se muestra en el HUD).
 * - `request`: jugador que ya pidió su tirada y espera el valor del anfitrión.
 */
export type TurnOrderState = {
  rolls: Record<string, number>
  queue: string[]
  groups: string[][]
  request: string | null
}

/** Tiempo que el HUD muestra el orden final antes de empezar la ronda 1. */
export { TURN_ORDER_REVEAL_MS } from './timing'

/**
 * Variantes de subasta de evento:
 * - `sealed`: Oferta Secreta; todos ofertan a ciegas.
 * - `open`: Puja Abierta; cada puja reinicia una cuenta regresiva.
 */
export const AUCTION_NAMES: Record<AuctionMode, string> = {
  sealed: 'Oferta Secreta',
  open: 'Puja Abierta',
}

/**
 * Subasta de un evento inicial. En la Oferta Secreta el estado solo guarda
 * quién ya respondió; los importes viven en el anfitrión y no se difunden.
 */
export type AuctionState = {
  tileId: number
  mode: AuctionMode
  /** Oferta Secreta: jugadores que aún no han ofertado ni pasado. */
  pending: string[]
  /** Oferta Secreta: jugadores que ya respondieron, en orden de llegada. */
  registered: string[]
  /** Puja Abierta: líder actual y su oferta. */
  leader: string | null
  leaderBid: number
  /** Puja Abierta: tics restantes antes de cerrar. */
  countdown: number
}

export type Table21Reveal = {
  hands: Record<string, number>
  cards: Record<string, number[]>
  busted: string[]
}

export type Table21State = {
  stage: 'bets' | 'draw' | 'reveal'
  pendingBets: string[]
  participants: string[]
  bets: Record<string, number>
  /** Cuántas cartas tiene cada participante; nunca sus valores ni sus totales. */
  cardCounts: Record<string, number>
  /** Plantados y pasados comparten el mismo estado público: "Listo". */
  ready: string[]
  /** Solicitudes de carta que el anfitrión debe repartir. */
  pendingDraws: string[]
  pot: number
  /** Solo existe al revelar: manos completas y totales. */
  reveal: Table21Reveal | null
  /** Solo existe al revelar: pagos calculados con las reglas existentes. */
  settlement: Table21Settlement | null
}

export type TradeState = {
  from: string
  to: string
  giveTiles: number[]
  getTiles: number[]
  giveMoney: number
  getMoney: number
  stage: 'veto' | 'pending'
  vetoer: string | null
}

export type CucupolyState = {
  seed: number
  names: Record<string, string>
  /** Asientos en orden de entrada; el primer asiento es el anfitrión. */
  order: string[]
  /** Orden de turnos resuelto con los dados; empieza como `order`. */
  turnOrder: string[]
  /** Sorteo de orden en curso; null cuando la partida ya arrancó. */
  turnOrderState: TurnOrderState | null
  currentIndex: number
  turnNumber: number
  /** Ronda actual (1-based). Sube cuando el turno vuelve a empezar. */
  roundNumber: number
  /** Evento inicial elegido por el anfitrión; null hasta que arranca. */
  initialEvent: InitialEventId | null
  /** Sube en 1 al anunciar un evento; los clientes lo usan para animar una vez. */
  eventSeq: number
  phase: Phase
  owners: Record<number, string | null>
  /** Nivel de construcción por casilla: 0..4 casas, 5 = hotel. */
  buildings: Record<number, number>
  positions: Record<string, number>
  money: Record<string, number>
  inJail: Record<string, boolean>
  jailTurns: Record<string, number>
  bankrupt: string[]
  abilities: Record<number, AbilityState>
  dice: { values: number[]; total: number } | null
  diceModifier: { from: number; until: number; dice: 1 | 3 } | null
  pendingBuy: number | null
  pendingBus: number | null
  auction: AuctionState | null
  table21: Table21State | null
  trade: TradeState | null
  log: LogEntry[]
  /** Cola corta de avisos temporales (no es un historial). */
  notices: Notice[]
  /** Id del último aviso; los clientes muestran solo los mayores a su visto. */
  noticeSeq: number
  winner: string | null
  /**
   * Contador de tiradas reales de dados (sube en 1 por tirada). Es la única
   * señal que usan los clientes para animar exactamente una vez cada tirada,
   * incluso si dos tiradas sacan los mismos valores. Entrar a la cárcel no
   * tira dados y por tanto no lo incrementa.
   */
  rollSeq: number
}

export const CHANCE_EVENTS = ['twenty-one', 'slow', 'fast'] as const
export type ChanceEvent = (typeof CHANCE_EVENTS)[number]

/** PRNG mulberry32: mismo seed => misma secuencia, sin Math.random. */
export function nextSeed(seed: number): { value: number; seed: number } {
  let t = (seed + 0x6d2b79f5) >>> 0
  let r = t
  r = Math.imul(r ^ (r >>> 15), r | 1)
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, seed: t }
}

function randomInt(state: CucupolyState, min: number, max: number): number {
  const next = nextSeed(state.seed)
  state.seed = next.seed
  return min + Math.floor(next.value * (max - min + 1))
}

function pushLog(state: CucupolyState, text: string): void {
  state.log.push({ turn: state.turnNumber, text })
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60)
}

function moneyNotice(
  state: CucupolyState,
  from: string | null,
  to: string,
  amount: number,
  reason: string,
  detail?: string,
): void {
  pushMoneyNotice(state, state.names, { from, to, amount, reason, detail })
}

/** Aviso de una regla alterada: nombre, causa y efecto en una sola línea. */
function ruleNotice(state: CucupolyState, text: string): void {
  pushRuleNotice(state, text)
}

function eventNotice(state: CucupolyState, text: string): void {
  pushEventNotice(state, text)
}

function activeIds(state: CucupolyState): string[] {
  return state.order.filter((id) => !state.bankrupt.includes(id))
}

function currentId(state: CucupolyState): string {
  return state.turnOrder[state.currentIndex]
}

function ownsType(state: CucupolyState, playerId: string, type: 'bus' | 'service'): number {
  return BOARD.filter((tile) => tile.type === type && state.owners[tile.index] === playerId).length
}

function ownsAllBuses(state: CucupolyState, playerId: string): boolean {
  return BUS_TILES.every((tile) => state.owners[tile] === playerId)
}

function isAbilityActive(state: CucupolyState, tileId: number): boolean {
  const ability = state.abilities[tileId]
  if (!ability) return false
  return state.turnNumber >= ability.from && state.turnNumber < ability.until
}

function isWaterActive(state: CucupolyState, owner: string): boolean {
  return state.owners[WATER_TILE] === owner && isAbilityActive(state, WATER_TILE)
}

function isBlackoutActive(state: CucupolyState): boolean {
  return state.owners[ELECTRICITY_TILE] != null && isAbilityActive(state, ELECTRICITY_TILE)
}

function phoneVetoer(state: CucupolyState): string | null {
  if (!isAbilityActive(state, TELEPHONE_TILE)) return null
  return state.owners[TELEPHONE_TILE] ?? null
}

/** Renta de una casilla comprable. El bono de Abastecimiento se aplica encima. */
export function rentFor(state: CucupolyState, tileId: number, diceTotal: number): number {
  const tile = BOARD[tileId]
  const owner = state.owners[tileId]
  if (!owner) return 0

  let rent = 0
  if (tile.type === 'property') {
    rent = Math.round((tile.price ?? 0) * rentRateFor(buildingLevelFor(state, tileId)))
  } else if (tile.type === 'bus') {
    const count = Math.min(Math.max(ownsType(state, owner, 'bus'), 1), 4)
    rent = RULES.busRents[count - 1]
  } else if (tile.type === 'service') {
    const count = Math.min(Math.max(ownsType(state, owner, 'service'), 1), 3)
    rent = RULES.serviceMultipliers[count - 1] * diceTotal
  } else {
    return 0
  }

  if (isWaterActive(state, owner)) {
    rent = Math.round(rent * (1 + RULES.waterRentBonus))
  }
  return rent
}

function cloneState(source: CucupolyState): CucupolyState {
  const abilities: Record<number, AbilityState> = {}
  for (const key of Object.keys(source.abilities)) {
    const tileId = Number(key)
    abilities[tileId] = { ...source.abilities[tileId] }
  }

  return {
    ...source,
    order: [...source.order],
    turnOrder: [...source.turnOrder],
    turnOrderState: source.turnOrderState
      ? {
          rolls: { ...source.turnOrderState.rolls },
          queue: [...source.turnOrderState.queue],
          groups: source.turnOrderState.groups.map((group) => [...group]),
          request: source.turnOrderState.request,
        }
      : null,
    owners: { ...source.owners },
    buildings: { ...source.buildings },
    positions: { ...source.positions },
    money: { ...source.money },
    inJail: { ...source.inJail },
    jailTurns: { ...source.jailTurns },
    bankrupt: [...source.bankrupt],
    abilities,
    dice: source.dice ? { ...source.dice, values: [...source.dice.values] } : null,
    diceModifier: source.diceModifier ? { ...source.diceModifier } : null,
    auction: source.auction
      ? {
          ...source.auction,
          pending: [...source.auction.pending],
          registered: [...source.auction.registered],
        }
      : null,
    table21: source.table21
      ? {
          ...source.table21,
          pendingBets: [...source.table21.pendingBets],
          participants: [...source.table21.participants],
          bets: { ...source.table21.bets },
          cardCounts: { ...source.table21.cardCounts },
          ready: [...source.table21.ready],
          pendingDraws: [...source.table21.pendingDraws],
          reveal: source.table21.reveal
            ? {
                hands: { ...source.table21.reveal.hands },
                cards: Object.fromEntries(
                  Object.entries(source.table21.reveal.cards).map(([id, cards]) => [
                    id,
                    [...cards],
                  ]),
                ),
                busted: [...source.table21.reveal.busted],
              }
            : null,
          settlement: source.table21.settlement
            ? {
                ...source.table21.settlement,
                winnerIds: [...source.table21.settlement.winnerIds],
                payouts: source.table21.settlement.payouts.map((payout) => ({
                  ...payout,
                })),
                transfers: source.table21.settlement.transfers.map((transfer) => ({
                  ...transfer,
                })),
              }
            : null,
        }
      : null,
    trade: source.trade
      ? {
          ...source.trade,
          giveTiles: [...source.trade.giveTiles],
          getTiles: [...source.trade.getTiles],
        }
      : null,
    log: [...source.log],
    notices: source.notices.map((notice) => ({ ...notice })),
  }
}

function endTurn(state: CucupolyState): void {
  const remaining = activeIds(state)
  if (remaining.length <= 1) {
    state.phase = 'finished'
    state.winner = remaining[0] ?? null
    state.dice = null
    state.pendingBuy = null
    state.pendingBus = null
    state.trade = null
    state.table21 = null
    state.auction = null
    pushLog(
      state,
      remaining[0] ? `Gana ${state.names[remaining[0]]}.` : 'Fin de la partida.',
    )
    return
  }

  state.turnNumber += 1
  state.dice = null
  state.pendingBuy = null
  state.pendingBus = null
  state.trade = null
  state.table21 = null
  state.auction = null

  const size = state.turnOrder.length
  const previousIndex = state.currentIndex
  for (let step = 1; step <= size; step += 1) {
    const index = (state.currentIndex + step) % size
    if (!state.bankrupt.includes(state.turnOrder[index])) {
      state.currentIndex = index
      break
    }
  }
  // La ronda cambia cuando el turno vuelve a empezar (o salta por encima del
  // inicio porque los primeros asientos están eliminados).
  if (state.currentIndex <= previousIndex) state.roundNumber += 1
  // Al empezar la ronda 2 se abre la fase de evento. El anfitrión sortea el
  // evento fuera del reducer y lo aplica con `start-initial-event`.
  state.phase =
    state.roundNumber === INITIAL_EVENT_ROUND && state.initialEvent === null
      ? 'event'
      : 'waiting-roll'
  if (state.phase === 'waiting-roll') announceDiceModifier(state)
}

/** Recuerda a todos por qué este turno se tira con 1 o 3 dados. */
function announceDiceModifier(state: CucupolyState): void {
  const modifier = state.diceModifier
  if (!modifier) return
  if (state.turnNumber < modifier.from || state.turnNumber >= modifier.until) return

  const playerId = currentId(state)
  if (state.inJail[playerId]) return
  const dice = modifier.dice
  ruleNotice(
    state,
    `Turno de ${state.names[playerId]}: lanza ${dice} ${
      dice === 1 ? 'dado' : 'dados'
    } en vez de 2 por Sorpresa: ${dice === 1 ? 'Vamos despacio' : 'Vamos rápido'}.`,
  )
}

function eliminate(state: CucupolyState, playerId: string, creditor: string | null): void {
  if (state.bankrupt.includes(playerId)) return
  state.bankrupt.push(playerId)

  const owned = BOARD.filter((tile) => state.owners[tile.index] === playerId).map((tile) => tile.index)
  for (const tileId of owned) {
    state.owners[tileId] = creditor
    if (state.abilities[tileId]) {
      state.abilities[tileId] = { from: 0, until: 0, readyAt: 0 }
    }
  }
  state.money[playerId] = 0
  pushLog(state, `${state.names[playerId]} queda eliminado.`)
  eventNotice(
    state,
    `${state.names[playerId]} queda eliminado${creditor ? `; sus propiedades pasan a ${state.names[creditor]}` : ''}.`,
  )
}

/** Devuelve false si el jugador no puede pagar y queda en bancarrota. */
function pay(
  state: CucupolyState,
  from: string,
  to: string | null,
  amount: number,
  reason: string,
): boolean {
  const available = state.money[from] ?? 0
  const paid = Math.min(available, amount)

  if (available >= amount) {
    state.money[from] = available - amount
    if (to) state.money[to] = (state.money[to] ?? 0) + amount
    if (to && amount > 0) moneyNotice(state, from, to, amount, reason)
    return true
  }

  state.money[from] = 0
  if (to) state.money[to] = (state.money[to] ?? 0) + available
  pushLog(
    state,
    `${state.names[from]} no puede pagar $${amount} (tiene $${available}).`,
  )
  if (to && paid > 0) {
    moneyNotice(state, from, to, paid, reason, 'No pudo pagar el total y quedó eliminado.')
  }
  eliminate(state, from, to)
  return false
}

function diceCount(state: CucupolyState): number {
  const modifier = state.diceModifier
  if (modifier && state.turnNumber >= modifier.from && state.turnNumber < modifier.until) {
    return modifier.dice
  }
  return 2
}

function nextBus(tileId: number): number {
  const index = BUS_TILES.indexOf(tileId as (typeof BUS_TILES)[number])
  return BUS_TILES[(index + 1) % BUS_TILES.length]
}

function readInt(payload: unknown, key: string): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function readString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function readEventId(payload: unknown): InitialEventId | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>).eventId
  return isInitialEventId(value) ? value : null
}

function readTiles(value: unknown): number[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const tiles: number[] = []
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item)) return null
    const tile = BOARD[item]
    if (!tile || tile.price === undefined) return null
    if (!tiles.includes(item)) tiles.push(item)
  }
  return tiles
}

export function init(players: Player[], seed: number): CucupolyState {
  const order = players.map((player) => player.id)
  const names: Record<string, string> = {}
  const money: Record<string, number> = {}
  const positions: Record<string, number> = {}
  const inJail: Record<string, boolean> = {}
  const jailTurns: Record<string, number> = {}

  for (const player of players) {
    names[player.id] = player.name
    money[player.id] = RULES.startingMoney
    positions[player.id] = 0
    inJail[player.id] = false
    jailTurns[player.id] = 0
  }

  const abilities: Record<number, AbilityState> = {}
  for (const tile of BOARD) {
    if (tile.type === 'service') abilities[tile.index] = { from: 0, until: 0, readyAt: 0 }
  }

  const state: CucupolyState = {
    seed,
    names,
    order,
    turnOrder: [...order],
    turnOrderState: {
      rolls: {},
      queue: [...order],
      groups: [[...order]],
      request: null,
    },
    currentIndex: 0,
    turnNumber: 0,
    roundNumber: 1,
    initialEvent: null,
    eventSeq: 0,
    phase: 'turn-order-roll',
    owners: {},
    buildings: {},
    positions,
    money,
    inJail,
    jailTurns,
    bankrupt: [],
    abilities,
    dice: null,
    diceModifier: null,
    pendingBuy: null,
    pendingBus: null,
    auction: null,
    table21: null,
    trade: null,
    log: [],
    notices: [],
    noticeSeq: 0,
    winner: null,
    rollSeq: 0,
  }

  return state
}

export function reduce(
  source: CucupolyState,
  action: GameAction,
  playerId: string,
): CucupolyState | { error: string } {
  if (!source.order.includes(playerId)) return { error: 'Jugador desconocido.' }

  const state = cloneState(source)

  switch (action.type) {
    case 'request-order-roll':
      return handleRequestOrderRoll(state, playerId)
    case 'roll-for-order':
      return handleRollForOrder(state, playerId, action.payload)
    case 'finish-turn-order':
      return handleFinishTurnOrder(state, playerId)
    case 'roll':
      return handleRoll(state, playerId)
    case 'buy':
      return handleBuy(state, playerId)
    case 'decline':
      return handleDecline(state, playerId)
    case 'build-house':
      return handleBuild(state, playerId, action.payload, 'house')
    case 'build-hotel':
      return handleBuild(state, playerId, action.payload, 'hotel')
    case 'secret-bid':
      return handleSecretBid(state, playerId, action.payload)
    case 'open-bid':
      return handleOpenBid(state, playerId, action.payload)
    case 'auction-tick':
      return handleAuctionTick(state, playerId)
    case 'resolve-secret-auction':
      return handleResolveSecretAuction(state, playerId, action.payload)
    case 'open-initial-auction':
      return handleOpenInitialAuction(state, playerId)
    case 'start-initial-event':
      return handleStartInitialEvent(state, playerId, action.payload)
    case 'pay-bail':
      return handlePayBail(state, playerId)
    case 'activate-ability':
      return handleActivateAbility(state, playerId, action.payload)
    case 'propose-trade':
      return handleProposeTrade(state, playerId, action.payload)
    case 'accept-trade':
      return handleAcceptTrade(state, playerId)
    case 'reject-trade':
      return handleRejectTrade(state, playerId)
    case 'veto-trade':
      return handleVetoTrade(state, playerId)
    case 'allow-trade':
      return handleAllowTrade(state, playerId)
    case 'cancel-trade':
      return handleCancelTrade(state, playerId)
    case 'join-table':
      return handleJoinTable(state, playerId, action.payload)
    case 'pass-table':
      return handlePassTable(state, playerId)
    case 'draw-card':
      return handleDrawCard(state, playerId)
    case 'deal-card':
      return handleDealCard(state, playerId, action.payload)
    case 'stand':
      return handleStand(state, playerId)
    case 'reveal-table':
      return handleRevealTable(state, playerId, action.payload)
    case 'settle-table':
      return handleSettleTable(state, playerId)
    case 'bus-move':
      return handleBusMove(state, playerId)
    case 'skip-bus-move':
      return handleSkipBusMove(state, playerId)
    default:
      return { error: `Acción desconocida: ${action.type}` }
  }
}

function handleRequestOrderRoll(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'turn-order-roll' || !state.turnOrderState) {
    return { error: 'El sorteo de orden ya terminó.' }
  }

  const sorteo = state.turnOrderState
  if (sorteo.request !== null) return { error: 'Ya hay una tirada en curso.' }
  if (sorteo.queue[0] !== playerId) return { error: 'No te toca lanzar.' }

  sorteo.request = playerId
  return state
}

function handleRollForOrder(
  state: CucupolyState,
  senderId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'turn-order-roll' || !state.turnOrderState) {
    return { error: 'El sorteo de orden ya terminó.' }
  }
  // El valor lo decide el anfitrión; ningún invitado puede inyectarlo.
  if (senderId !== state.order[0]) {
    return { error: 'Solo el anfitrión puede resolver la tirada.' }
  }

  const roller = readString(payload, 'playerId')
  const value = readInt(payload, 'value')
  if (roller === null || value === null) return { error: 'Tirada no válida.' }
  if (value < 1 || value > 6) return { error: 'El dado va del 1 al 6.' }

  const sorteo = state.turnOrderState
  if (sorteo.request !== roller || sorteo.queue[0] !== roller) {
    return { error: 'Esa tirada no está pendiente.' }
  }

  sorteo.rolls[roller] = value
  sorteo.request = null
  sorteo.queue = sorteo.queue.slice(1)
  state.rollSeq += 1
  pushLog(
    state,
    `${state.names[roller]} tira ${value} = ${value} y espera el orden de turnos.`,
  )

  if (sorteo.queue.length === 0) resolveOrderRound(state)
  return state
}

/**
 * Cierra la pasada de tiradas del primer bloque pendiente y lo divide por
 * valores. Los bloques de un solo jugador quedan fijos; los empates vuelven a
 * la cola solo entre sus miembros, sin mover a los demás.
 */
function resolveOrderRound(state: CucupolyState): void {
  const sorteo = state.turnOrderState
  if (!sorteo) return

  const index = sorteo.groups.findIndex((group) => group.length > 1)
  if (index !== -1) {
    const block = sorteo.groups[index]
    const sorted = [...block].sort(
      (a, b) => (sorteo.rolls[b] ?? 0) - (sorteo.rolls[a] ?? 0),
    )

    const split: string[][] = []
    for (const id of sorted) {
      const last = split[split.length - 1]
      if (last && sorteo.rolls[last[0]] === sorteo.rolls[id]) last.push(id)
      else split.push([id])
    }
    sorteo.groups.splice(index, 1, ...split)
  }

  const pending = sorteo.groups.find((group) => group.length > 1)
  sorteo.queue = pending ? [...pending] : []

  if (!pending) {
    state.turnOrder = sorteo.groups.flat()
    state.currentIndex = 0
    state.phase = 'turn-order-reveal'
    pushLog(
      state,
      `Orden de turnos: ${state.turnOrder.map((id) => state.names[id]).join(', ')}.`,
    )
  }
}

function handleFinishTurnOrder(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'turn-order-reveal') {
    return { error: 'El orden de turnos aún no está listo.' }
  }
  if (playerId !== state.order[0]) {
    return { error: 'Solo el anfitrión puede empezar la partida.' }
  }

  state.turnOrderState = null
  state.phase = 'waiting-roll'
  state.currentIndex = 0
  state.roundNumber = 1
  pushLog(state, `Empieza la ronda 1 con ${state.names[state.turnOrder[0]]}.`)
  return state
}

function handleRoll(state: CucupolyState, playerId: string): CucupolyState | { error: string } {
  if (state.phase !== 'waiting-roll') return { error: 'Ahora no toca tirar.' }
  if (currentId(state) !== playerId) return { error: 'No es tu turno.' }

  if (state.inJail[playerId]) {
    const turns = (state.jailTurns[playerId] ?? 0) + 1
    state.jailTurns[playerId] = turns
    if (turns >= RULES.jailTurns) {
      state.inJail[playerId] = false
      state.jailTurns[playerId] = 0
      pushLog(state, `${state.names[playerId]} cumple la condena y sale de la cárcel.`)
      eventNotice(
        state,
        `Cárcel: ${state.names[playerId]} cumplió la condena y sale de la cárcel.`,
      )
    } else {
      pushLog(state, `${state.names[playerId]} sigue en la cárcel (${turns}/${RULES.jailTurns}).`)
      eventNotice(
        state,
        `Cárcel: ${state.names[playerId]} sigue en la cárcel (${turns}/${RULES.jailTurns}) y pierde este turno.`,
      )
    }
    endTurn(state)
    return state
  }

  const count = diceCount(state)
  const values: number[] = []
  for (let i = 0; i < count; i += 1) values.push(randomInt(state, 1, 6))
  const total = values.reduce((sum, value) => sum + value, 0)
  state.dice = { values, total }
  state.rollSeq += 1

  const from = state.positions[playerId] ?? 0
  if (from + total >= 48) {
    state.money[playerId] = (state.money[playerId] ?? 0) + RULES.goSalary
    pushLog(state, `${state.names[playerId]} pasa por GO y cobra $${RULES.goSalary}.`)
    eventNotice(
      state,
      `GO: ${state.names[playerId]} cobró $${RULES.goSalary} por pasar por la salida.`,
    )
  }
  const to = (from + total) % 48
  state.positions[playerId] = to
  pushLog(
    state,
    `${state.names[playerId]} tira ${values.join('+')} = ${total} y cae en ${BOARD[to].name}.`,
  )

  return handleLanding(state, playerId, to, total, true)
}

function handleLanding(
  state: CucupolyState,
  playerId: string,
  tileId: number,
  diceTotal: number,
  allowRoute: boolean,
): CucupolyState {
  const tile = BOARD[tileId]

  if (tile.type === 'property' || tile.type === 'bus' || tile.type === 'service') {
    if (tile.type === 'bus' && allowRoute && ownsAllBuses(state, playerId)) {
      state.pendingBus = tileId
      state.phase = 'bus-move'
      pushLog(state, `${state.names[playerId]} puede saltar gratis a la siguiente buseta.`)
      ruleNotice(
        state,
        `Ruta de busetas: ${state.names[playerId]} tiene las 4 busetas y puede saltar gratis a la siguiente.`,
      )
      return state
    }

    const owner = state.owners[tileId] ?? null
    if (!owner) {
      if (isBlackoutActive(state)) {
        pushLog(state, `Apagón: ${tile.name} no se puede comprar.`)
        ruleNotice(
          state,
          `Apagón: ${tile.name} no se puede comprar mientras dure la habilidad de Ser. Luz.`,
        )
        endTurn(state)
        return state
      }
      state.pendingBuy = tileId
      state.phase = 'buy-decision'
      return state
    }

    if (owner === playerId) {
      pushLog(state, `${state.names[playerId]} cae en su propia casilla.`)
      endTurn(state)
      return state
    }

    const rent = rentFor(state, tileId, diceTotal)
    pushLog(
      state,
      `${state.names[playerId]} paga $${rent} a ${state.names[owner]} por ${tile.name}.`,
    )
    pay(
      state,
      playerId,
      owner,
      rent,
      isWaterActive(state, owner)
        ? `alquiler en ${tile.name}, +15% por Abastecimiento`
        : `alquiler en ${tile.name}`,
    )
    endTurn(state)
    return state
  }

  switch (tile.type) {
    case 'treasury': {
      const card = RULES.treasuryDeck[randomInt(state, 0, RULES.treasuryDeck.length - 1)]
      pushLog(state, `Tesorería: ${card.text}.`)
      eventNotice(state, `Tesorería: ${state.names[playerId]} — ${card.text}.`)
      if (card.amount >= 0) {
        state.money[playerId] = (state.money[playerId] ?? 0) + card.amount
      } else {
        pay(state, playerId, null, -card.amount, 'carta de tesorería')
      }
      endTurn(state)
      return state
    }
    case 'tax': {
      const amount = tile.tax ?? 0
      const paid = Math.min(state.money[playerId] ?? 0, amount)
      pushLog(state, `${state.names[playerId]} paga $${amount} de impuesto.`)
      eventNotice(
        state,
        paid < amount
          ? `Impuesto: ${state.names[playerId]} no pudo pagar $${amount} y entregó $${paid} al banco.`
          : `Impuesto: ${state.names[playerId]} pagó $${amount} al banco.`,
      )
      pay(state, playerId, null, amount, 'impuesto')
      endTurn(state)
      return state
    }
    case 'chance': {
      drawChance(state)
      return state
    }
    case 'go-to-jail': {
      state.positions[playerId] = JAIL_TILE
      state.inJail[playerId] = true
      state.jailTurns[playerId] = 0
      pushLog(state, `${state.names[playerId]} va a la cárcel.`)
      eventNotice(
        state,
        `Cárcel: ${state.names[playerId]} fue enviado a la cárcel; pierde hasta ${RULES.jailTurns} turnos o paga $${RULES.jailFine} de fianza.`,
      )
      endTurn(state)
      return state
    }
    default: {
      endTurn(state)
      return state
    }
  }
}

function drawChance(state: CucupolyState): void {
  const event = CHANCE_EVENTS[randomInt(state, 0, CHANCE_EVENTS.length - 1)]

  if (event === 'slow' || event === 'fast') {
    const rounds = activeIds(state).length
    const from = state.turnNumber + 1
    state.diceModifier = { from, until: from + rounds, dice: event === 'slow' ? 1 : 3 }
    pushLog(
      state,
      event === 'slow'
        ? 'Sorpresa: Vamos despacio. La próxima ronda se tira 1 dado.'
        : 'Sorpresa: Vamos rápido. La próxima ronda se tiran 3 dados.',
    )
    ruleNotice(
      state,
      event === 'slow'
        ? 'Sorpresa: Vamos despacio — durante la próxima ronda se lanza 1 dado en vez de 2.'
        : 'Sorpresa: Vamos rápido — durante la próxima ronda se lanzan 3 dados en vez de 2.',
    )
    endTurn(state)
    return
  }

  state.table21 = {
    stage: 'bets',
    pendingBets: [...activeIds(state)],
    participants: [],
    bets: {},
    cardCounts: {},
    ready: [],
    pendingDraws: [],
    pot: 0,
    reveal: null,
    settlement: null,
  }
  state.phase = 'twenty-one'
  pushLog(state, 'Sorpresa: se abre la mesa de 21.')
  ruleNotice(
    state,
    'Sorpresa: Mesa de 21 — se abre una ronda de apuestas para todos los jugadores activos.',
  )
}

function handleBuy(state: CucupolyState, playerId: string): CucupolyState | { error: string } {
  if (state.phase !== 'buy-decision') return { error: 'No hay una compra pendiente.' }
  if (currentId(state) !== playerId) return { error: 'No es tu turno.' }
  if (state.pendingBuy === null) return { error: 'No hay una propiedad pendiente.' }
  if (isBlackoutActive(state)) return { error: 'Apagón: nadie puede comprar propiedades.' }

  const tile = BOARD[state.pendingBuy]
  const price = purchasePriceFor(tile.price ?? 0, state.initialEvent, state.roundNumber)
  if ((state.money[playerId] ?? 0) < price) return { error: 'No tienes dinero suficiente.' }

  state.money[playerId] = (state.money[playerId] ?? 0) - price
  state.owners[tile.index] = playerId
  pushLog(state, `${state.names[playerId]} compra ${tile.name} por $${price}.`)
  endTurn(state)
  return state
}

function handleDecline(state: CucupolyState, playerId: string): CucupolyState | { error: string } {
  if (state.phase !== 'buy-decision') return { error: 'No hay una compra pendiente.' }
  if (currentId(state) !== playerId) return { error: 'No es tu turno.' }

  const tile = state.pendingBuy === null ? null : BOARD[state.pendingBuy]
  pushLog(
    state,
    `${state.names[playerId]} no compra${tile ? ` ${tile.name}` : ''}.`,
  )
  endTurn(state)
  return state
}

/**
 * Construye una casa o el hotel. Todas las reglas viven aquí: el cliente solo
 * manda la propiedad y el anfitrión rechaza cualquier jugada ilegal.
 */
function handleBuild(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
  kind: 'house' | 'hotel',
): CucupolyState | { error: string } {
  if (state.phase !== 'waiting-roll' || currentId(state) !== playerId) {
    return { error: 'Solo puedes construir en tu turno antes de tirar.' }
  }

  const propertyId = readInt(payload, 'propertyId')
  if (propertyId === null) return { error: 'Propiedad no válida.' }

  const ruleError = buildRuleError(state, propertyId, playerId, kind)
  if (ruleError) return { error: ruleError }

  const cost = buildCostFor(propertyId)
  if (cost === null) return { error: 'Esa propiedad no permite edificios.' }
  if ((state.money[playerId] ?? 0) < cost) {
    return { error: 'No tienes dinero suficiente.' }
  }

  state.money[playerId] = (state.money[playerId] ?? 0) - cost
  state.buildings[propertyId] = buildingLevelFor(state, propertyId) + 1

  const tile = BOARD[propertyId]
  const what = kind === 'hotel' ? 'un hotel' : 'una casa'
  const text = `${state.names[playerId]} construyó ${what} en ${tile.name} (−$${cost})`
  pushLog(state, `${text}.`)
  pushNotice(state, { kind: 'money', text, from: playerId, amount: cost })
  return state
}

function handleStartInitialEvent(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (playerId !== state.order[0]) {
    return { error: 'Solo el anfitrión puede sortear el evento inicial.' }
  }
  if (state.phase !== 'event') return { error: 'No es el momento del evento inicial.' }
  if (state.roundNumber !== INITIAL_EVENT_ROUND) {
    return { error: 'El evento inicial solo ocurre al empezar la ronda 2.' }
  }
  if (state.initialEvent !== null) return { error: 'El evento inicial ya ocurrió.' }

  const eventId = readEventId(payload)
  if (!eventId) return { error: 'Evento inicial no válido.' }

  const mode = auctionModeFor(eventId)
  if (mode) {
    const tileId = readInt(payload, 'tileId')
    if (tileId === null) return { error: 'Falta la propiedad de la subasta.' }
    if (!freeAuctionTiles(state.owners).includes(tileId)) {
      return { error: 'Esa propiedad ya tiene dueño.' }
    }

    state.initialEvent = eventId
    state.eventSeq += 1
    state.auction = {
      tileId,
      mode,
      pending: activeIds(state),
      registered: [],
      leader: null,
      leaderBid: 0,
      countdown: 0,
    }
    pushLog(
      state,
      `Evento inicial: ${AUCTION_NAMES[mode]} por ${BOARD[tileId].name}.`,
    )
    eventNotice(
      state,
      `Evento inicial: ${AUCTION_NAMES[mode]} por ${BOARD[tileId].name} — ${
        mode === 'sealed' ? 'todos ofertan a ciegas.' : 'gana la última puja.'
      }`,
    )
    // La fase sigue en 'event': el anfitrión abre la subasta cuando el anuncio
    // termina, con `open-initial-auction`.
    return state
  }

  state.initialEvent = eventId
  state.eventSeq += 1

  if (eventId === 'impulso_economico') {
    for (const id of activeIds(state)) {
      state.money[id] = (state.money[id] ?? 0) + RULES.initialEventBoost
    }
    pushLog(
      state,
      `Evento inicial: Impulso Económico. Todos los jugadores activos reciben $${RULES.initialEventBoost}.`,
    )
    eventNotice(
      state,
      `Evento inicial: Impulso Económico — todos los jugadores activos reciben $${RULES.initialEventBoost}.`,
    )
  } else {
    pushLog(
      state,
      'Evento inicial: Semana de descuentos. Las propiedades estarán a mitad de precio en las rondas 3, 4 y 5.',
    )
    eventNotice(
      state,
      'Evento inicial: Semana de descuentos — las propiedades cuestan la mitad en las rondas 3, 4 y 5.',
    )
  }

  state.phase = 'waiting-roll'
  return state
}

type SecretBid = { playerId: string; amount: number }

function readSecretBids(payload: unknown): SecretBid[] | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = (payload as Record<string, unknown>).bids
  if (!Array.isArray(raw)) return null

  const bids: SecretBid[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.playerId !== 'string') return null
    if (typeof entry.amount !== 'number' || !Number.isInteger(entry.amount)) return null
    if (entry.amount < 0) return null
    if (bids.some((bid) => bid.playerId === entry.playerId)) return null
    bids.push({ playerId: entry.playerId, amount: entry.amount })
  }
  return bids
}

/**
 * Oferta Secreta: registra que el jugador respondió. El importe NO entra en el
 * estado (se difunde a todos los clientes); el anfitrión lo guarda aparte y lo
 * envía al cerrar con `resolve-secret-auction`.
 */
function handleSecretBid(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'auction' || !state.auction) return { error: 'No hay subasta activa.' }
  if (state.auction.mode !== 'sealed') return { error: 'La subasta no es a ciegas.' }
  if (state.bankrupt.includes(playerId)) return { error: 'Estás eliminado.' }
  if (!state.auction.pending.includes(playerId)) return { error: 'Ya ofertaste.' }

  const amount = readInt(payload, 'amount')
  if (amount === null || amount < 0) return { error: 'Oferta no válida.' }
  if (amount > 0 && amount < MIN_RAISE) {
    return { error: `La oferta mínima es $${MIN_RAISE}.` }
  }
  if (amount > (state.money[playerId] ?? 0)) return { error: 'No tienes tanto dinero.' }

  state.auction.pending = state.auction.pending.filter((id) => id !== playerId)
  state.auction.registered.push(playerId)
  return state
}

/** Puja Abierta: cada puja válida reinicia la cuenta regresiva visible. */
function handleOpenBid(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'auction' || !state.auction) return { error: 'No hay subasta activa.' }
  const auction = state.auction
  if (auction.mode !== 'open') return { error: 'La subasta no es abierta.' }
  if (state.bankrupt.includes(playerId)) return { error: 'Estás eliminado.' }
  if (auction.leader === playerId) return { error: 'Ya vas ganando la subasta.' }

  const amount = readInt(payload, 'amount')
  if (amount === null || amount < 0) return { error: 'Puja no válida.' }
  const floor = auction.leader ? auction.leaderBid + MIN_RAISE : MIN_RAISE
  if (amount < floor) return { error: `La puja mínima es $${floor}.` }
  if (amount > (state.money[playerId] ?? 0)) return { error: 'No tienes tanto dinero.' }

  auction.leader = playerId
  auction.leaderBid = amount
  auction.countdown = AUCTION_OPEN_IDLE_TICKS
  pushLog(
    state,
    `${state.names[playerId]} puja $${amount} por ${BOARD[auction.tileId].name}.`,
  )
  return state
}

/**
 * Reloj de la Puja Abierta. Solo el anfitrión (primer asiento) lo mueve; los
 * clientes no usan `Date.now`, así que el cierre es determinista.
 */
function handleAuctionTick(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (playerId !== state.order[0]) {
    return { error: 'Solo el anfitrión controla el reloj de la subasta.' }
  }
  // Un tic tardío después de cerrar no es un error: el temporizador del
  // anfitrión puede dispararse una vez más antes de desmontarse.
  if (state.phase !== 'auction' || !state.auction || state.auction.mode !== 'open') {
    return state
  }
  if (state.auction.countdown <= 0) return state

  state.auction.countdown -= 1
  if (state.auction.countdown === 0) resolveOpenAuction(state)
  return state
}

/**
 * Cierre de la Oferta Secreta. Solo el anfitrión lo dispara, con las ofertas en
 * orden de llegada; en empate gana la primera registrada.
 */
function handleResolveSecretAuction(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (playerId !== state.order[0]) {
    return { error: 'Solo el anfitrión puede cerrar la subasta.' }
  }
  // Un cierre tardío (el temporizador y "todos respondieron" pueden coincidir)
  // no es un error: la subasta ya terminó.
  if (state.phase !== 'auction' || !state.auction) return state
  if (state.auction.mode !== 'sealed') return state

  const bids = readSecretBids(payload)
  if (!bids) return { error: 'Ofertas no válidas.' }

  const registered = new Set(state.auction.registered)
  for (const bid of bids) {
    if (!registered.has(bid.playerId)) {
      return { error: 'Oferta de un jugador que no participó.' }
    }
    if (bid.amount > (state.money[bid.playerId] ?? 0)) {
      return { error: 'Oferta superior al efectivo del jugador.' }
    }
  }

  resolveSealedAuction(state, bids)
  return state
}

/** El anuncio terminó: la subasta pasa a estar activa. */
function handleOpenInitialAuction(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (playerId !== state.order[0]) {
    return { error: 'Solo el anfitrión puede abrir la subasta.' }
  }
  // Si el anuncio ya terminó, el temporizador tardío no debe romper nada.
  if (state.phase !== 'event') return state
  if (!state.auction) return state

  state.phase = 'auction'
  if (state.auction.mode === 'open') {
    state.auction.countdown = AUCTION_OPEN_IDLE_TICKS
  }
  return state
}

function resolveSealedAuction(state: CucupolyState, bids: SecretBid[]): void {
  const auction = state.auction
  if (!auction) return

  let winner: SecretBid | null = null
  for (const bid of bids) {
    if (bid.amount <= 0) continue
    // Estrictamente mayor: en empate gana quien llegó primero.
    if (!winner || bid.amount > winner.amount) winner = bid
  }

  if (!winner) {
    pushLog(state, `Nadie oferta por ${BOARD[auction.tileId].name}; queda sin dueño.`)
    eventNotice(
      state,
      `Subasta: nadie ofertó por ${BOARD[auction.tileId].name}; la propiedad queda sin dueño.`,
    )
  } else {
    state.money[winner.playerId] = (state.money[winner.playerId] ?? 0) - winner.amount
    state.owners[auction.tileId] = winner.playerId
    pushLog(
      state,
      `${state.names[winner.playerId]} gana ${BOARD[auction.tileId].name} en ${AUCTION_NAMES.sealed} por $${winner.amount}.`,
    )
    eventNotice(
      state,
      `Subasta: ${state.names[winner.playerId]} gana ${BOARD[auction.tileId].name} en ${AUCTION_NAMES.sealed} por $${winner.amount}.`,
    )
  }

  state.auction = null
  state.phase = 'waiting-roll'
}

function resolveOpenAuction(state: CucupolyState): void {
  const auction = state.auction
  if (!auction) return

  if (auction.leader) {
    const bid = auction.leaderBid
    state.money[auction.leader] = (state.money[auction.leader] ?? 0) - bid
    state.owners[auction.tileId] = auction.leader
    pushLog(
      state,
      `${state.names[auction.leader]} gana ${BOARD[auction.tileId].name} en ${AUCTION_NAMES.open} por $${bid}.`,
    )
    eventNotice(
      state,
      `Subasta: ${state.names[auction.leader]} gana ${BOARD[auction.tileId].name} en ${AUCTION_NAMES.open} por $${bid}.`,
    )
  } else {
    pushLog(state, `Nadie puja por ${BOARD[auction.tileId].name}; queda sin dueño.`)
    eventNotice(
      state,
      `Subasta: nadie pujó por ${BOARD[auction.tileId].name}; la propiedad queda sin dueño.`,
    )
  }

  state.auction = null
  state.phase = 'waiting-roll'
}

function handlePayBail(state: CucupolyState, playerId: string): CucupolyState | { error: string } {
  if (state.phase !== 'waiting-roll' || currentId(state) !== playerId) {
    return { error: 'Solo puedes pagar la fianza en tu turno antes de tirar.' }
  }
  if (!state.inJail[playerId]) return { error: 'No estás en la cárcel.' }
  if ((state.money[playerId] ?? 0) < RULES.jailFine) {
    return { error: 'No tienes dinero para la fianza.' }
  }

  state.money[playerId] = (state.money[playerId] ?? 0) - RULES.jailFine
  state.inJail[playerId] = false
  state.jailTurns[playerId] = 0
  pushLog(state, `${state.names[playerId]} paga $${RULES.jailFine} y sale de la cárcel.`)
  eventNotice(
    state,
    `Cárcel: ${state.names[playerId]} pagó $${RULES.jailFine} de fianza y salió de la cárcel.`,
  )
  return state
}

function handleActivateAbility(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  const tileId = readInt(payload, 'tileId')
  if (tileId === null) return { error: 'Habilidad no válida.' }

  const tile = BOARD[tileId]
  if (!tile || tile.type !== 'service') return { error: 'Esa casilla no tiene habilidad.' }
  if (state.owners[tileId] !== playerId) return { error: 'No eres el dueño de ese servicio.' }
  if (state.phase !== 'waiting-roll' || currentId(state) !== playerId) {
    return { error: 'Solo puedes activarla en tu turno antes de tirar.' }
  }

  const ability = state.abilities[tileId]
  if (state.turnNumber < ability.until) return { error: 'La habilidad ya está activa.' }
  if (state.turnNumber < ability.readyAt) return { error: 'La habilidad sigue en espera.' }

  const rounds = activeIds(state).length
  ability.from = state.turnNumber + 1
  ability.until = ability.from + rounds * RULES.abilityRounds
  ability.readyAt = ability.until + rounds * RULES.abilityCooldownRounds

  pushLog(
    state,
    `${state.names[playerId]} activa ${tile.name} hasta el turno ${ability.until}.`,
  )
  ruleNotice(
    state,
    `Habilidad ${tile.name} (${state.names[playerId]}): ${abilityEffect(
      state,
      tileId,
      playerId,
    )} hasta el turno ${ability.until}.`,
  )
  return state
}

function abilityEffect(state: CucupolyState, tileId: number, playerId: string): string {
  if (tileId === WATER_TILE) {
    return `las rentas de ${state.names[playerId]} suben un 15%`
  }
  if (tileId === ELECTRICITY_TILE) {
    return 'nadie puede comprar propiedades'
  }
  if (tileId === TELEPHONE_TILE) {
    return `${state.names[playerId]} puede vetar los tratos entre otros jugadores`
  }
  return 'su efecto especial queda activo'
}

function handleProposeTrade(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'waiting-roll' || currentId(state) !== playerId) {
    return { error: 'Solo puedes proponer tratos en tu turno antes de tirar.' }
  }
  if (typeof payload !== 'object' || payload === null) return { error: 'Trato no válido.' }

  const raw = payload as Record<string, unknown>
  const to = typeof raw.to === 'string' ? raw.to : null
  if (!to || to === playerId) return { error: 'Elige otro jugador.' }
  if (!state.order.includes(to) || state.bankrupt.includes(to)) {
    return { error: 'Ese jugador no está disponible.' }
  }

  const giveTiles = readTiles(raw.giveTiles)
  const getTiles = readTiles(raw.getTiles)
  if (!giveTiles || !getTiles) return { error: 'Propiedades no válidas.' }

  const giveMoney = readInt(raw, 'giveMoney') ?? 0
  const getMoney = readInt(raw, 'getMoney') ?? 0
  if (giveMoney < 0 || getMoney < 0) return { error: 'Dinero no válido.' }
  if (giveMoney > (state.money[playerId] ?? 0)) return { error: 'No tienes ese dinero.' }
  if (getMoney > (state.money[to] ?? 0)) return { error: 'El otro jugador no tiene ese dinero.' }

  for (const tileId of giveTiles) {
    if (state.owners[tileId] !== playerId) {
      return { error: 'No posees una de las propiedades ofrecidas.' }
    }
  }
  for (const tileId of getTiles) {
    if (state.owners[tileId] !== to) {
      return { error: 'El otro jugador no posee una de las propiedades pedidas.' }
    }
  }
  if (giveTiles.length + getTiles.length + giveMoney + getMoney === 0) {
    return { error: 'El trato está vacío.' }
  }

  const vetoer = phoneVetoer(state)
  const stage: 'veto' | 'pending' =
    vetoer && vetoer !== playerId && vetoer !== to ? 'veto' : 'pending'

  state.trade = {
    from: playerId,
    to,
    giveTiles,
    getTiles,
    giveMoney,
    getMoney,
    stage,
    vetoer: stage === 'veto' ? vetoer : null,
  }
  state.phase = 'trade'
  pushLog(
    state,
    `${state.names[playerId]} propone un trato a ${state.names[to]}${
      stage === 'veto' ? ` (vigilado por ${state.names[vetoer as string]})` : ''
    }.`,
  )
  if (stage === 'veto' && vetoer) {
    ruleNotice(
      state,
      `Caída de red: ${state.names[vetoer]} vigila el trato de ${state.names[playerId]} a ${state.names[to]} y puede vetarlo.`,
    )
  }
  return state
}

function handleAcceptTrade(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'trade' || !state.trade) return { error: 'No hay trato pendiente.' }
  const trade = state.trade
  if (trade.stage !== 'pending') return { error: 'El trato aún no está listo.' }
  if (playerId !== trade.to) return { error: 'Solo el receptor puede aceptar.' }

  state.money[trade.from] =
    (state.money[trade.from] ?? 0) - trade.giveMoney + trade.getMoney
  state.money[trade.to] = (state.money[trade.to] ?? 0) + trade.giveMoney - trade.getMoney
  for (const tileId of trade.giveTiles) state.owners[tileId] = trade.to
  for (const tileId of trade.getTiles) state.owners[tileId] = trade.from

  const net = trade.giveMoney - trade.getMoney
  if (net > 0) {
    moneyNotice(state, trade.from, trade.to, net, 'intercambio')
  } else if (net < 0) {
    moneyNotice(state, trade.to, trade.from, -net, 'intercambio')
  }

  pushLog(state, `${state.names[trade.to]} acepta el trato de ${state.names[trade.from]}.`)
  const parts: string[] = []
  if (trade.giveTiles.length + trade.getTiles.length > 0) parts.push('propiedades')
  if (net !== 0) parts.push('dinero')
  eventNotice(
    state,
    parts.length > 0
      ? `Trato cerrado: ${state.names[trade.from]} y ${state.names[trade.to]} intercambiaron ${parts.join(
          ' y ',
        )}.`
      : `Trato cerrado: ${state.names[trade.from]} y ${state.names[trade.to]}.`,
  )
  state.trade = null
  state.phase = 'waiting-roll'
  return state
}

function handleRejectTrade(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'trade' || !state.trade) return { error: 'No hay trato pendiente.' }
  if (state.trade.stage !== 'pending') return { error: 'El trato aún no está listo.' }
  if (playerId !== state.trade.to) return { error: 'Solo el receptor puede rechazar.' }

  pushLog(state, `${state.names[playerId]} rechaza el trato.`)
  eventNotice(
    state,
    `Trato rechazado: ${state.names[playerId]} no aceptó la propuesta de ${state.names[state.trade.from]}.`,
  )
  state.trade = null
  state.phase = 'waiting-roll'
  return state
}

function handleVetoTrade(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'trade' || !state.trade) return { error: 'No hay trato pendiente.' }
  if (state.trade.stage !== 'veto' || state.trade.vetoer !== playerId) {
    return { error: 'No puedes vetar este trato.' }
  }

  pushLog(state, `${state.names[playerId]} veta el trato con Caída de red.`)
  ruleNotice(
    state,
    `Caída de red: ${state.names[playerId]} vetó el trato entre ${state.names[state.trade.from]} y ${state.names[state.trade.to]}.`,
  )
  state.trade = null
  state.phase = 'waiting-roll'
  return state
}

function handleAllowTrade(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'trade' || !state.trade) return { error: 'No hay trato pendiente.' }
  if (state.trade.stage !== 'veto' || state.trade.vetoer !== playerId) {
    return { error: 'No puedes autorizar este trato.' }
  }

  state.trade.stage = 'pending'
  pushLog(state, `${state.names[playerId]} deja pasar el trato.`)
  ruleNotice(
    state,
    `Caída de red: ${state.names[playerId]} dejó pasar el trato entre ${state.names[state.trade.from]} y ${state.names[state.trade.to]}.`,
  )
  return state
}

function handleCancelTrade(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'trade' || !state.trade) return { error: 'No hay trato pendiente.' }
  if (playerId !== state.trade.from) return { error: 'Solo quien propone puede cancelar.' }

  pushLog(state, `${state.names[playerId]} cancela el trato.`)
  eventNotice(
    state,
    `Trato cancelado: ${state.names[playerId]} retiró su propuesta a ${state.names[state.trade.to]}.`,
  )
  state.trade = null
  state.phase = 'waiting-roll'
  return state
}

function handleJoinTable(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'bets') return { error: 'La mesa ya está jugando.' }
  if (!table.pendingBets.includes(playerId)) return { error: 'Ya decidiste.' }

  const bet = readInt(payload, 'bet')
  if (bet === null || bet < 1 || bet > RULES.table21BetLimit) {
    return { error: `La apuesta debe estar entre 1 y ${RULES.table21BetLimit}.` }
  }
  if (bet > (state.money[playerId] ?? 0)) return { error: 'No tienes ese dinero.' }

  state.money[playerId] = (state.money[playerId] ?? 0) - bet
  table.bets[playerId] = bet
  table.cardCounts[playerId] = 0
  table.participants.push(playerId)
  table.pendingBets = table.pendingBets.filter((id) => id !== playerId)
  pushLog(state, `${state.names[playerId]} se sienta en la mesa con $${bet}.`)

  if (table.pendingBets.length === 0) startTableDraw(state)
  return state
}

function handlePassTable(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'bets') return { error: 'La mesa ya está jugando.' }
  if (!table.pendingBets.includes(playerId)) return { error: 'Ya decidiste.' }

  table.pendingBets = table.pendingBets.filter((id) => id !== playerId)
  pushLog(state, `${state.names[playerId]} no se sienta en la mesa.`)
  if (table.pendingBets.length === 0) startTableDraw(state)
  return state
}

function startTableDraw(state: CucupolyState): void {
  const table = state.table21
  if (!table) return

  if (table.participants.length === 0) {
    pushLog(state, 'Nadie se sentó en la mesa de 21.')
    state.table21 = null
    endTurn(state)
    return
  }

  for (const id of table.participants) table.cardCounts[id] = 0
  table.ready = []
  table.pendingDraws = []
  table.pot = table.participants.reduce((sum, id) => sum + (table.bets[id] ?? 0), 0)
  table.stage = 'draw'
  pushLog(state, `Mesa de 21: pozo de $${table.pot}.`)
}

function handleDrawCard(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'draw') return { error: 'La mesa no está repartiendo.' }
  if (!table.participants.includes(playerId)) return { error: 'No estás en la mesa.' }
  if (table.ready.includes(playerId)) return state

  // Es una solicitud: el anfitrión resuelve la carta fuera del reducer.
  if (!table.pendingDraws.includes(playerId)) table.pendingDraws.push(playerId)
  return state
}

function handleDealCard(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'draw') return { error: 'La mesa no está repartiendo.' }
  if (playerId !== state.order[0]) return { error: 'Solo el anfitrión reparte.' }

  const target = readString(payload, 'playerId')
  if (!target || !table.participants.includes(target)) return { error: 'Jugador inválido.' }
  if (!table.pendingDraws.includes(target)) return { error: 'Ese jugador no pidió carta.' }

  const card = readInt(payload, 'card')
  const total = readInt(payload, 'total')
  if (card === null || card < 1 || card > RULES.table21CardMax) {
    return { error: 'Carta inválida.' }
  }
  if (total === null || total < 0) return { error: 'Total inválido.' }

  table.cardCounts[target] = (table.cardCounts[target] ?? 0) + 1
  table.pendingDraws = table.pendingDraws.filter((id) => id !== target)
  if (total > RULES.table21Target && !table.ready.includes(target)) {
    // Públicamente solo se marca "Listo"; no se revela que se pasó.
    table.ready.push(target)
  }
  pushLog(state, `${state.names[target]} recibe una carta.`)
  return state
}

function handleStand(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'draw') return { error: 'La mesa no está repartiendo.' }
  if (!table.participants.includes(playerId)) return { error: 'No estás en la mesa.' }
  if (table.ready.includes(playerId)) return state

  table.ready.push(playerId)
  table.pendingDraws = table.pendingDraws.filter((id) => id !== playerId)
  pushLog(state, `${state.names[playerId]} queda listo.`)
  return state
}

function readHands(
  payload: unknown,
  key: string,
  participants: readonly string[],
): Record<string, number> | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = (payload as Record<string, unknown>)[key]
  if (typeof raw !== 'object' || raw === null) return null

  const hands: Record<string, number> = {}
  for (const id of participants) {
    const value = (raw as Record<string, unknown>)[id]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
    hands[id] = value
  }
  return hands
}

function readCards(
  payload: unknown,
  key: string,
  participants: readonly string[],
): Record<string, number[]> | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = (payload as Record<string, unknown>)[key]
  if (typeof raw !== 'object' || raw === null) return null

  const cards: Record<string, number[]> = {}
  for (const id of participants) {
    const value = (raw as Record<string, unknown>)[id]
    if (!Array.isArray(value) || value.length > 100) return null
    const hand: number[] = []
    for (const card of value) {
      if (typeof card !== 'number' || !Number.isInteger(card)) return null
      if (card < 1 || card > RULES.table21CardMax) return null
      hand.push(card)
    }
    cards[id] = hand
  }
  return cards
}

function buildTableSettlement(
  table: Table21State,
  hands: Record<string, number>,
  busted: readonly string[],
): Table21Settlement {
  const eligible = table.participants.filter((id) => !busted.includes(id))

  if (eligible.length === 0) {
    const payouts = table.participants.map((id) => ({
      to: id,
      amount: table.bets[id] ?? 0,
    }))
    return {
      allBusted: true,
      winnerIds: [],
      best: null,
      pot: table.pot,
      payouts,
      transfers: payouts.map((payout) => ({
        from: null,
        to: payout.to,
        amount: payout.amount,
      })),
    }
  }

  const best = Math.max(...eligible.map((id) => hands[id] ?? 0))
  const winnerIds = eligible.filter((id) => (hands[id] ?? 0) === best)
  const share = Math.floor(table.pot / winnerIds.length)
  let remainder = table.pot - share * winnerIds.length
  const won: Record<string, number> = {}
  const payouts = winnerIds.map((id) => {
    let amount = share
    if (remainder > 0) {
      amount += 1
      remainder -= 1
    }
    won[id] = amount
    return { to: id, amount }
  })

  return {
    allBusted: false,
    winnerIds,
    best,
    pot: table.pot,
    payouts,
    transfers: table21Transfers(table.participants, table.bets, winnerIds, won),
  }
}

function handleRevealTable(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'draw') return { error: 'La mesa no está repartiendo.' }
  if (playerId !== state.order[0]) return { error: 'Solo el anfitrión revela.' }
  if (!table.participants.every((id) => table.ready.includes(id))) {
    return { error: 'Faltan jugadores por quedar listos.' }
  }

  const hands = readHands(payload, 'hands', table.participants)
  const cards = readCards(payload, 'cards', table.participants)
  if (!hands || !cards) return { error: 'Manos inválidas.' }

  for (const id of table.participants) {
    if (table21Total(cards[id] ?? []) !== hands[id]) {
      return { error: 'Las cartas no cuadran con el total.' }
    }
  }

  const busted = table.participants.filter((id) => (hands[id] ?? 0) > RULES.table21Target)
  table.reveal = { hands, cards, busted }
  table.settlement = buildTableSettlement(table, hands, busted)
  table.stage = 'reveal'
  pushLog(state, 'Mesa de 21: se revelan las cartas.')
  return state
}

function handleSettleTable(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'twenty-one' || !state.table21) return { error: 'No hay mesa de 21.' }
  const table = state.table21
  if (table.stage !== 'reveal' || !table.reveal || !table.settlement) {
    return { error: 'La mesa todavía no se ha revelado.' }
  }
  if (playerId !== state.order[0]) return { error: 'Solo el anfitrión liquida.' }

  const settlement = table.settlement
  for (const payout of settlement.payouts) {
    if (payout.amount <= 0) continue
    state.money[payout.to] = (state.money[payout.to] ?? 0) + payout.amount
    if (!settlement.allBusted) {
      moneyNotice(state, null, payout.to, payout.amount, 'pozo de la mesa de 21')
    }
  }

  if (settlement.allBusted) {
    pushLog(state, 'Todos se pasaron de 21: se devuelven las apuestas.')
    eventNotice(state, 'Mesa de 21: todos se pasaron; cada jugador recupera su apuesta.')
  } else {
    const best = settlement.best ?? 0
    pushLog(
      state,
      `${settlement.winnerIds.map((id) => state.names[id]).join(', ')} gana(n) el pozo de $${settlement.pot} con ${best}.`,
    )
  }

  state.table21 = null
  endTurn(state)
  return state
}

function handleBusMove(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'bus-move' || state.pendingBus === null) {
    return { error: 'No hay salto de buseta disponible.' }
  }
  if (currentId(state) !== playerId) return { error: 'No es tu turno.' }

  const destination = nextBus(state.pendingBus)
  state.pendingBus = null
  state.positions[playerId] = destination
  pushLog(
    state,
    `${state.names[playerId]} usa la ruta y salta a ${BOARD[destination].name}.`,
  )
  eventNotice(
    state,
    `Ruta de busetas: ${state.names[playerId]} saltó gratis a ${BOARD[destination].name}.`,
  )
  return handleLanding(state, playerId, destination, state.dice?.total ?? 0, false)
}

function handleSkipBusMove(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'bus-move') return { error: 'No hay salto de buseta disponible.' }
  if (currentId(state) !== playerId) return { error: 'No es tu turno.' }

  state.pendingBus = null
  pushLog(state, `${state.names[playerId]} decide no usar la ruta.`)
  endTurn(state)
  return state
}
