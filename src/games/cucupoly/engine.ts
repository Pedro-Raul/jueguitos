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

export type Phase =
  | 'waiting-roll'
  | 'buy-decision'
  | 'auction'
  | 'thirty-one'
  | 'trade'
  | 'bus-move'
  | 'finished'

export type LogEntry = { turn: number; text: string }

/** Ventana de una habilidad expresada en números de turno absolutos. */
export type AbilityState = { from: number; until: number; readyAt: number }

export type AuctionState = {
  tileId: number
  minBid: number
  /** Pujas a sobre cerrado. 0 = pasar. */
  bids: Record<string, number>
  pending: string[]
}

export type Table31State = {
  stage: 'bets' | 'draw'
  pendingBets: string[]
  participants: string[]
  bets: Record<string, number>
  hands: Record<string, number>
  busted: string[]
  standing: string[]
  drawOrder: string[]
  drawIndex: number
  pot: number
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
  order: string[]
  currentIndex: number
  turnNumber: number
  phase: Phase
  owners: Record<number, string | null>
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
  table31: Table31State | null
  trade: TradeState | null
  log: LogEntry[]
  winner: string | null
}

export const CHANCE_EVENTS = ['thirty-one', 'slow', 'fast'] as const
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

function activeIds(state: CucupolyState): string[] {
  return state.order.filter((id) => !state.bankrupt.includes(id))
}

function currentId(state: CucupolyState): string {
  return state.order[state.currentIndex]
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
    rent = Math.round((tile.price ?? 0) * RULES.propertyRentRate)
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
    owners: { ...source.owners },
    positions: { ...source.positions },
    money: { ...source.money },
    inJail: { ...source.inJail },
    jailTurns: { ...source.jailTurns },
    bankrupt: [...source.bankrupt],
    abilities,
    dice: source.dice ? { ...source.dice, values: [...source.dice.values] } : null,
    diceModifier: source.diceModifier ? { ...source.diceModifier } : null,
    auction: source.auction
      ? { ...source.auction, bids: { ...source.auction.bids }, pending: [...source.auction.pending] }
      : null,
    table31: source.table31
      ? {
          ...source.table31,
          pendingBets: [...source.table31.pendingBets],
          participants: [...source.table31.participants],
          bets: { ...source.table31.bets },
          hands: { ...source.table31.hands },
          busted: [...source.table31.busted],
          standing: [...source.table31.standing],
          drawOrder: [...source.table31.drawOrder],
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
    state.table31 = null
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
  state.table31 = null
  state.auction = null

  const size = state.order.length
  for (let step = 1; step <= size; step += 1) {
    const index = (state.currentIndex + step) % size
    if (!state.bankrupt.includes(state.order[index])) {
      state.currentIndex = index
      break
    }
  }
  state.phase = 'waiting-roll'
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
}

/** Devuelve false si el jugador no puede pagar y queda en bancarrota. */
function pay(state: CucupolyState, from: string, to: string | null, amount: number): boolean {
  const available = state.money[from] ?? 0
  if (available >= amount) {
    state.money[from] = available - amount
    if (to) state.money[to] = (state.money[to] ?? 0) + amount
    return true
  }

  state.money[from] = 0
  if (to) state.money[to] = (state.money[to] ?? 0) + available
  pushLog(
    state,
    `${state.names[from]} no puede pagar $${amount} (tiene $${available}).`,
  )
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
    currentIndex: 0,
    turnNumber: 0,
    phase: 'waiting-roll',
    owners: {},
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
    table31: null,
    trade: null,
    log: [],
    winner: null,
  }

  const properties = BOARD.filter((tile) => tile.type === 'property')
  const picked = properties[randomInt(state, 0, properties.length - 1)]
  state.auction = {
    tileId: picked.index,
    minBid: Math.round((picked.price ?? 0) * RULES.auctionStartRate),
    bids: {},
    pending: [...order],
  }
  state.phase = 'auction'
  pushLog(
    state,
    `Subasta sorpresa inicial: ${picked.name} desde $${state.auction.minBid}.`,
  )

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
    case 'roll':
      return handleRoll(state, playerId)
    case 'buy':
      return handleBuy(state, playerId)
    case 'decline':
      return handleDecline(state, playerId)
    case 'bid':
      return handleBid(state, playerId, action.payload)
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
    case 'stand':
      return handleStand(state, playerId)
    case 'bus-move':
      return handleBusMove(state, playerId)
    case 'skip-bus-move':
      return handleSkipBusMove(state, playerId)
    default:
      return { error: `Acción desconocida: ${action.type}` }
  }
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
    } else {
      pushLog(state, `${state.names[playerId]} sigue en la cárcel (${turns}/${RULES.jailTurns}).`)
    }
    endTurn(state)
    return state
  }

  const count = diceCount(state)
  const values: number[] = []
  for (let i = 0; i < count; i += 1) values.push(randomInt(state, 1, 6))
  const total = values.reduce((sum, value) => sum + value, 0)
  state.dice = { values, total }

  const from = state.positions[playerId] ?? 0
  if (from + total >= 48) {
    state.money[playerId] = (state.money[playerId] ?? 0) + RULES.goSalary
    pushLog(state, `${state.names[playerId]} pasa por GO y cobra $${RULES.goSalary}.`)
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
      return state
    }

    const owner = state.owners[tileId] ?? null
    if (!owner) {
      if (isBlackoutActive(state)) {
        pushLog(state, `Apagón: ${tile.name} no se puede comprar.`)
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
    pay(state, playerId, owner, rent)
    endTurn(state)
    return state
  }

  switch (tile.type) {
    case 'treasury': {
      const card = RULES.treasuryDeck[randomInt(state, 0, RULES.treasuryDeck.length - 1)]
      pushLog(state, `Tesorería: ${card.text}.`)
      if (card.amount >= 0) {
        state.money[playerId] = (state.money[playerId] ?? 0) + card.amount
      } else {
        pay(state, playerId, null, -card.amount)
      }
      endTurn(state)
      return state
    }
    case 'tax': {
      const amount = tile.tax ?? 0
      pushLog(state, `${state.names[playerId]} paga $${amount} de impuesto.`)
      pay(state, playerId, null, amount)
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
    endTurn(state)
    return
  }

  state.table31 = {
    stage: 'bets',
    pendingBets: [...activeIds(state)],
    participants: [],
    bets: {},
    hands: {},
    busted: [],
    standing: [],
    drawOrder: [],
    drawIndex: 0,
    pot: 0,
  }
  state.phase = 'thirty-one'
  pushLog(state, 'Sorpresa: se abre la mesa de 31.')
}

function handleBuy(state: CucupolyState, playerId: string): CucupolyState | { error: string } {
  if (state.phase !== 'buy-decision') return { error: 'No hay una compra pendiente.' }
  if (currentId(state) !== playerId) return { error: 'No es tu turno.' }
  if (state.pendingBuy === null) return { error: 'No hay una propiedad pendiente.' }
  if (isBlackoutActive(state)) return { error: 'Apagón: nadie puede comprar propiedades.' }

  const tile = BOARD[state.pendingBuy]
  const price = tile.price ?? 0
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

function handleBid(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'auction' || !state.auction) return { error: 'No hay subasta activa.' }
  if (!state.auction.pending.includes(playerId)) return { error: 'Ya pujaste.' }

  const amount = readInt(payload, 'amount')
  if (amount === null || amount < 0) return { error: 'Puja no válida.' }
  if (amount > 0 && amount < state.auction.minBid) {
    return { error: `La puja mínima es $${state.auction.minBid}.` }
  }
  if (amount > (state.money[playerId] ?? 0)) return { error: 'No tienes tanto dinero.' }

  state.auction.bids[playerId] = amount
  state.auction.pending = state.auction.pending.filter((id) => id !== playerId)
  if (state.auction.pending.length === 0) resolveAuction(state)
  return state
}

function resolveAuction(state: CucupolyState): void {
  const auction = state.auction
  if (!auction) return

  const bidders = Object.keys(auction.bids).filter(
    (id) => (auction.bids[id] ?? 0) >= auction.minBid,
  )

  if (bidders.length === 0) {
    pushLog(state, `Nadie puja por ${BOARD[auction.tileId].name}; queda sin dueño.`)
  } else {
    bidders.sort((a, b) => {
      const diff = (auction.bids[b] ?? 0) - (auction.bids[a] ?? 0)
      if (diff !== 0) return diff
      return state.order.indexOf(a) - state.order.indexOf(b)
    })
    const winner = bidders[0]
    const bid = auction.bids[winner] ?? 0
    state.money[winner] = (state.money[winner] ?? 0) - bid
    state.owners[auction.tileId] = winner
    pushLog(
      state,
      `${state.names[winner]} gana ${BOARD[auction.tileId].name} en subasta por $${bid}.`,
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
  return state
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

  pushLog(state, `${state.names[trade.to]} acepta el trato de ${state.names[trade.from]}.`)
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
  return state
}

function handleCancelTrade(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'trade' || !state.trade) return { error: 'No hay trato pendiente.' }
  if (playerId !== state.trade.from) return { error: 'Solo quien propone puede cancelar.' }

  pushLog(state, `${state.names[playerId]} cancela el trato.`)
  state.trade = null
  state.phase = 'waiting-roll'
  return state
}

function handleJoinTable(
  state: CucupolyState,
  playerId: string,
  payload: unknown,
): CucupolyState | { error: string } {
  if (state.phase !== 'thirty-one' || !state.table31) return { error: 'No hay mesa de 31.' }
  const table = state.table31
  if (table.stage !== 'bets') return { error: 'La mesa ya está jugando.' }
  if (!table.pendingBets.includes(playerId)) return { error: 'Ya decidiste.' }

  const bet = readInt(payload, 'bet')
  if (bet === null || bet < 1 || bet > RULES.table31BetLimit) {
    return { error: `La apuesta debe estar entre 1 y ${RULES.table31BetLimit}.` }
  }
  if (bet > (state.money[playerId] ?? 0)) return { error: 'No tienes ese dinero.' }

  state.money[playerId] = (state.money[playerId] ?? 0) - bet
  table.bets[playerId] = bet
  table.hands[playerId] = 0
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
  if (state.phase !== 'thirty-one' || !state.table31) return { error: 'No hay mesa de 31.' }
  const table = state.table31
  if (table.stage !== 'bets') return { error: 'La mesa ya está jugando.' }
  if (!table.pendingBets.includes(playerId)) return { error: 'Ya decidiste.' }

  table.pendingBets = table.pendingBets.filter((id) => id !== playerId)
  pushLog(state, `${state.names[playerId]} no se sienta en la mesa.`)
  if (table.pendingBets.length === 0) startTableDraw(state)
  return state
}

function startTableDraw(state: CucupolyState): void {
  const table = state.table31
  if (!table) return

  if (table.participants.length === 0) {
    pushLog(state, 'Nadie se sentó en la mesa de 31.')
    state.table31 = null
    endTurn(state)
    return
  }

  const size = state.order.length
  const rotated: string[] = []
  for (let step = 0; step < size; step += 1) {
    const id = state.order[(state.currentIndex + step) % size]
    if (table.participants.includes(id)) rotated.push(id)
  }

  table.drawOrder = rotated
  table.drawIndex = 0
  table.pot = table.participants.reduce((sum, id) => sum + (table.bets[id] ?? 0), 0)
  table.stage = 'draw'
  pushLog(state, `Mesa de 31: pozo de $${table.pot}.`)
}

function handleDrawCard(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'thirty-one' || !state.table31) return { error: 'No hay mesa de 31.' }
  const table = state.table31
  if (table.stage !== 'draw') return { error: 'La mesa no está repartiendo.' }
  if (table.drawOrder[table.drawIndex] !== playerId) {
    return { error: 'No es tu turno en la mesa.' }
  }

  const card = randomInt(state, 1, RULES.table31CardMax)
  table.hands[playerId] = (table.hands[playerId] ?? 0) + card
  pushLog(
    state,
    `${state.names[playerId]} pide carta: ${card} (total ${table.hands[playerId]}).`,
  )

  if (table.hands[playerId] > RULES.table31Target) {
    table.busted.push(playerId)
    pushLog(state, `${state.names[playerId]} se pasa de 31.`)
    advanceDraw(state)
  }
  return state
}

function handleStand(
  state: CucupolyState,
  playerId: string,
): CucupolyState | { error: string } {
  if (state.phase !== 'thirty-one' || !state.table31) return { error: 'No hay mesa de 31.' }
  const table = state.table31
  if (table.stage !== 'draw') return { error: 'La mesa no está repartiendo.' }
  if (table.drawOrder[table.drawIndex] !== playerId) {
    return { error: 'No es tu turno en la mesa.' }
  }

  table.standing.push(playerId)
  pushLog(state, `${state.names[playerId]} se planta con ${table.hands[playerId] ?? 0}.`)
  advanceDraw(state)
  return state
}

function advanceDraw(state: CucupolyState): void {
  const table = state.table31
  if (!table) return

  let index = table.drawIndex + 1
  while (index < table.drawOrder.length) {
    const id = table.drawOrder[index]
    if (!table.busted.includes(id) && !table.standing.includes(id)) {
      table.drawIndex = index
      return
    }
    index += 1
  }
  resolveTable(state)
}

function resolveTable(state: CucupolyState): void {
  const table = state.table31
  if (!table) return

  const eligible = table.participants.filter((id) => !table.busted.includes(id))

  if (eligible.length === 0) {
    for (const id of table.participants) {
      state.money[id] = (state.money[id] ?? 0) + (table.bets[id] ?? 0)
    }
    pushLog(state, 'Todos se pasaron de 31: se devuelven las apuestas.')
  } else {
    const best = Math.max(...eligible.map((id) => table.hands[id] ?? 0))
    const winners = eligible.filter((id) => (table.hands[id] ?? 0) === best)
    const share = Math.floor(table.pot / winners.length)
    let remainder = table.pot - share * winners.length

    for (const id of winners) {
      state.money[id] = (state.money[id] ?? 0) + share
      if (remainder > 0) {
        state.money[id] += 1
        remainder -= 1
      }
    }
    pushLog(
      state,
      `${winners.map((id) => state.names[id]).join(', ')} gana(n) el pozo de $${table.pot} con ${best}.`,
    )
  }

  state.table31 = null
  endTurn(state)
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
