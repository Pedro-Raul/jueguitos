import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GameAction, GameViewProps, Player } from '../../types'
import { BOARD } from './board'
import {
  HOTEL_LEVEL,
  MAX_HOUSES,
  buildCostFor,
  buildingLevelFor,
  buildRuleError,
  completeGroupsFor,
} from './buildings'
import {
  AUCTION_NAMES,
  getDiceCount,
  rentFor,
  type CucupolyState,
  type TradeState,
} from './engine'
import {
  AUCTION_OPEN_IDLE_TICKS,
  INITIAL_EVENT_ROUND,
  MIN_RAISE,
  eventPoolForRound,
  eventPriceMultiplier,
  freeAuctionTiles,
  hasSeenEvent,
  hasSeenFinalEvent,
  isAuctionEvent,
  isDiceEventId,
  isFinalEventId,
  markEventSeen,
  markFinalEventSeen,
  purchasePriceFor,
} from './events'
import { ActiveEventPill, DiceEventMenu, EventBanner } from './EventHud'
import { eventKey, type EventBannerData } from './eventUi'
import {
  EVENT_GAP_MAX_ROUNDS,
  EVENT_GAP_MIN_ROUNDS,
} from './eventScheduler'
import { planAnimations, snapshotSeen, type RollPlan, type SeenRoll } from './planAnimations'
import {
  AUCTION_SECRET_MS,
  AUCTION_TICK_MS,
  DICE_BANNER_MS,
  DICE_SECONDS,
  END_OF_TURN_PAUSE_MS,
  EVENT_BANNER_EXIT_MS,
  EVENT_BANNER_MS,
  PACE,
  TURN_ORDER_REVEAL_MS,
} from './timing'
import { NoticeTicker, useNoticeQueue } from './NoticeTicker'
import type { Notice } from './notices'
import { RULES } from './rules.config'
import { Table21Panel } from './Table21Panel'
import { subscribeHostActions } from '../../net/hostActions'
import {
  groupNameFor,
  isPurchasable,
  tileColor,
  tileIcon,
  tileTextColor,
} from './visual'

const BoardScene = lazy(() => import('./three/BoardScene'))

function money(value: number): string {
  return `$${value}`
}

function buildingLabel(level: number): string {
  if (level >= HOTEL_LEVEL) return 'Hotel'
  if (level === 0) return 'sin edificios'
  return `${level} ${level === 1 ? 'casa' : 'casas'}`
}

function nameOf(state: CucupolyState, id: string | null): string {
  return id ? state.names[id] ?? id : '—'
}

function phaseHint(state: CucupolyState): string {
  switch (state.phase) {
    case 'turn-order-roll': {
      const roller = state.turnOrderState?.queue[0]
      return roller
        ? `${nameOf(state, roller)} lanza el dado para el orden.`
        : 'Sorteando el orden de turnos…'
    }
    case 'turn-order-reveal':
      return 'Orden de turnos definido.'
    case 'waiting-roll':
      return `${nameOf(state, state.turnOrder[state.currentIndex])} debe tirar.`
    case 'event':
      return 'Sorteando el evento de la ronda…'
    case 'final-event':
      return 'Sorteando el evento final…'
    case 'buy-decision':
      return state.pendingBuy === null
        ? 'Decisión de compra.'
        : `¿Comprar ${BOARD[state.pendingBuy].name}?`
    case 'auction': {
      const auction = state.auction
      if (!auction) return 'Subasta.'
      const name = AUCTION_NAMES[auction.mode]
      if (auction.mode === 'open') {
        return `${name}: ${BOARD[auction.tileId].name} · cierra en ${auction.countdown}.`
      }
      const total = auction.registered.length + auction.pending.length
      return `${name} de ${BOARD[auction.tileId].name} · ${auction.registered.length}/${total} ofertas.`
    }
    case 'twenty-one':
      return 'Mesa de 21 en curso.'
    case 'trade':
      return 'Trato pendiente.'
    case 'bus-move':
      return '¿Saltar a la siguiente buseta?'
    case 'finished':
      return 'Partida terminada.'
    default:
      return ''
  }
}

/** ¿Hay una decisión pendiente que solo puede resolver `meId`? */
function mustAct(state: CucupolyState, meId: string): boolean {
  // Eliminados y partida terminada: solo espectadores, sin controles.
  if (state.phase === 'finished' || state.bankrupt.includes(meId)) return false
  const isMyTurn = state.turnOrder[state.currentIndex] === meId
  switch (state.phase) {
    case 'turn-order-roll':
      return state.turnOrderState?.queue[0] === meId
    case 'turn-order-reveal':
      return false
    case 'event':
      // El anfitrión sortea solo; nadie tiene una acción pendiente.
      return false
    case 'final-event':
      // Igual que el evento inicial: el anfitrión sortea y aplica.
      return false
    case 'auction':
      if (!state.auction) return false
      // En la relámpago todos ven el contador y pueden mejorar la puja.
      return state.auction.mode === 'open'
        ? !state.bankrupt.includes(meId)
        : state.auction.pending.includes(meId)
    case 'buy-decision':
    case 'bus-move':
    case 'waiting-roll':
      return isMyTurn
    case 'twenty-one': {
      // La mesa del 21 se muestra siempre y gestiona sus propias acciones.
      return false
    }
    case 'trade': {
      const trade = state.trade
      if (!trade) return false
      if (trade.stage === 'veto') return trade.vetoer === meId
      return trade.to === meId || trade.from === meId
    }
    default:
      return isMyTurn
  }
}

/** Fases en las que el turno ya está en juego (para la pausa de fin de turno). */
function isTurnPhase(phase: CucupolyState['phase']): boolean {
  return (
    phase === 'waiting-roll' ||
    phase === 'buy-decision' ||
    phase === 'auction' ||
    phase === 'twenty-one' ||
    phase === 'trade' ||
    phase === 'bus-move'
  )
}

/** Indicador flotante junto al saldo del jugador afectado por el aviso actual. */
function moneyChip(
  notice: Notice | null,
  playerId: string,
): { text: string; positive: boolean } | null {
  if (!notice || notice.kind !== 'money' || notice.amount === undefined) return null
  if (notice.from === playerId) return { text: `−${money(notice.amount)}`, positive: false }
  if (notice.to === playerId) return { text: `+${money(notice.amount)}`, positive: true }
  return null
}

function actionIcon(state: CucupolyState): string {
  switch (state.phase) {
    case 'turn-order-roll':
      return '🎲'
    case 'turn-order-reveal':
      return '🏁'
    case 'buy-decision':
      return '🏷️'
    case 'auction':
      return state.auction?.mode === 'open' ? '⚡' : '🔨'
    case 'twenty-one':
      return '🃏'
    case 'trade':
      return '🤝'
    case 'bus-move':
      return '🚌'
    default:
      return '🎲'
  }
}

function actionTitle(state: CucupolyState, me: Player): string {
  switch (state.phase) {
    case 'turn-order-roll':
      return 'Sorteo del orden de turnos'
    case 'turn-order-reveal':
      return 'Orden de turnos'
    case 'buy-decision':
      return 'Comprar o subastar'
    case 'auction':
      return state.auction ? AUCTION_NAMES[state.auction.mode] : 'Subasta'
    case 'twenty-one':
      return 'Mesa de 21'
    case 'trade':
      return 'Trato'
    case 'bus-move':
      return 'Parada de busetas'
    default:
      return `Tu turno, ${nameOf(state, me.id)}`
  }
}

function describeTrade(state: CucupolyState, trade: TradeState): string {
  const give = [
    ...trade.giveTiles.map((tile) => BOARD[tile].name),
    trade.giveMoney > 0 ? money(trade.giveMoney) : '',
  ].filter(Boolean)
  const get = [
    ...trade.getTiles.map((tile) => BOARD[tile].name),
    trade.getMoney > 0 ? money(trade.getMoney) : '',
  ].filter(Boolean)

  return `${nameOf(state, trade.from)} da ${give.join(', ') || 'nada'} y recibe ${
    get.join(', ') || 'nada'
  }.`
}

function toggle(list: number[], setList: (value: number[]) => void, value: number): void {
  setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
}

type PanelProps = {
  state: CucupolyState
  me: Player
  dispatch: (action: GameAction) => void
}

function ActionPanel({ state, me, dispatch }: PanelProps) {
  const [bid, setBid] = useState('')
  const [tradeTo, setTradeTo] = useState('')
  const [giveTiles, setGiveTiles] = useState<number[]>([])
  const [getTiles, setGetTiles] = useState<number[]>([])
  const [giveMoney, setGiveMoney] = useState('')
  const [getMoney, setGetMoney] = useState('')

  const current = state.turnOrder[state.currentIndex]
  const isMyTurn = current === me.id
  const myMoney = state.money[me.id] ?? 0

  if (state.phase === 'finished') {
    return <p className="cp-banner">Gana {nameOf(state, state.winner)}.</p>
  }

  if (state.phase === 'turn-order-roll' && state.turnOrderState) {
    const sorteo = state.turnOrderState
    const roller = sorteo.queue[0]
    if (roller !== me.id) {
      return <p className="muted">Esperando a {nameOf(state, roller)}…</p>
    }
    return (
      <div className="cp-action">
        <p>Lanza un dado para decidir el orden de turnos.</p>
        <div className="actions">
          <button
            className="primary"
            type="button"
            disabled={sorteo.request !== null}
            onClick={() => dispatch({ type: 'request-order-roll' })}
          >
            {sorteo.request === me.id ? 'Lanzando…' : 'Lanzar dado'}
          </button>
        </div>
        <p className="muted small">
          El número más alto juega primero. Los empates relanzan solo entre ellos.
        </p>
      </div>
    )
  }

  if (state.phase === 'turn-order-reveal') {
    return <p className="muted">El orden de turnos ya está definido.</p>
  }

  if (state.phase === 'auction' && state.auction) {
    const auction = state.auction
    const tileName = BOARD[auction.tileId].name
    const eventLabel = 'Evento inicial'

    if (auction.mode === 'open') {
      const leading = auction.leader === me.id
      const floor = auction.leader ? auction.leaderBid + MIN_RAISE : MIN_RAISE
      const amount = bid === '' ? floor : Number(bid)
      const valid =
        Number.isInteger(amount) && amount >= floor && amount <= myMoney
      return (
        <div className="cp-action">
          <p className="cp-auction-event">
            <span className="cp-eyebrow">{eventLabel}</span>{' '}
            <strong>{AUCTION_NAMES.open}</strong> por <strong>{tileName}</strong>.
          </p>
          <p>
            {auction.leader
              ? `Mejor puja: ${money(auction.leaderBid)} de ${nameOf(state, auction.leader)}.`
              : `Puja mínima: ${money(MIN_RAISE)}.`}
          </p>
          <div className="cp-countdown" role="timer" aria-live="polite">
            <span>{leading ? 'Vas ganando' : 'Cierra en'}</span>
            <strong>{auction.countdown}</strong>
            <span className="cp-countdown-dots" aria-hidden="true">
              {Array.from({ length: AUCTION_OPEN_IDLE_TICKS }, (_, index) => (
                <i key={index} className={index < auction.countdown ? 'is-on' : ''} />
              ))}
            </span>
          </div>
          {leading ? (
            <p className="muted small">
              Si nadie supera tu puja, te llevas la propiedad.
            </p>
          ) : (
            <>
              <input
                type="number"
                min={floor}
                max={myMoney}
                value={bid}
                placeholder={String(floor)}
                onChange={(event) => setBid(event.target.value)}
              />
              <div className="actions">
                <button
                  className="primary"
                  type="button"
                  disabled={!valid}
                  onClick={() => {
                    dispatch({ type: 'open-bid', payload: { amount } })
                    setBid('')
                  }}
                >
                  Pujar {money(amount)}
                </button>
              </div>
              <p className="muted small">Cada puja reinicia la cuenta regresiva.</p>
            </>
          )}
        </div>
      )
    }

    const waiting = auction.pending.includes(me.id)
    const sealedAmount = bid === '' ? null : Number(bid)
    const sealedValid =
      sealedAmount !== null &&
      Number.isInteger(sealedAmount) &&
      sealedAmount >= 0 &&
      sealedAmount <= myMoney &&
      (sealedAmount === 0 || sealedAmount >= MIN_RAISE)
    return (
      <div className="cp-action">
        <p className="cp-auction-event">
          <span className="cp-eyebrow">{eventLabel}</span>{' '}
          <strong>{AUCTION_NAMES.sealed}</strong> por <strong>{tileName}</strong>{' '}
          desde {money(MIN_RAISE)}.
        </p>
        {waiting ? (
          <>
            <input
              type="number"
              min={0}
              max={myMoney}
              value={bid}
              placeholder={String(MIN_RAISE)}
              onChange={(event) => setBid(event.target.value)}
            />
            <div className="actions">
              <button
                className="primary"
                type="button"
                disabled={!sealedValid}
                onClick={() => {
                  dispatch({ type: 'secret-bid', payload: { amount: sealedAmount ?? 0 } })
                  setBid('')
                }}
              >
                Ofertar
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  dispatch({ type: 'secret-bid', payload: { amount: 0 } })
                  setBid('')
                }}
              >
                Pasar
              </button>
            </div>
            <p className="muted small">
              Tu oferta es secreta. 0 = pasar; mínimo {money(MIN_RAISE)}.
            </p>
          </>
        ) : (
          <p className="muted small">
            {auction.pending.length > 0
              ? `Esperando ofertas de ${auction.pending
                  .map((id) => nameOf(state, id))
                  .join(', ')}.`
              : 'Cerrando la subasta…'}
          </p>
        )}
      </div>
    )
  }

  if (state.phase === 'buy-decision' && state.pendingBuy !== null) {
    const tile = BOARD[state.pendingBuy]
    const price = purchasePriceFor(tile.price ?? 0, state.activeEvent, state.roundNumber)
    if (!isMyTurn) {
      return <p className="muted">Esperando a {nameOf(state, current)}…</p>
    }
    return (
      <div className="cp-action">
        <p>
          ¿Compras <strong>{tile.name}</strong> por {money(price)}?
          {price !== (tile.price ?? 0) ? (
            <span className="cp-price-was"> antes {money(tile.price ?? 0)}</span>
          ) : null}
        </p>
        <div className="actions">
          <button className="primary" type="button" onClick={() => dispatch({ type: 'buy' })}>
            Comprar
          </button>
          <button className="ghost" type="button" onClick={() => dispatch({ type: 'decline' })}>
            No comprar
          </button>
        </div>
      </div>
    )
  }

  if (state.phase === 'trade' && state.trade) {
    const trade = state.trade
    if (trade.stage === 'veto') {
      if (trade.vetoer === me.id) {
        return (
          <div className="cp-action">
            <p>
              {nameOf(state, trade.from)} quiere tratar con {nameOf(state, trade.to)}.
            </p>
            <div className="actions">
              <button className="danger" type="button" onClick={() => dispatch({ type: 'veto-trade' })}>
                Vetar
              </button>
              <button className="ghost" type="button" onClick={() => dispatch({ type: 'allow-trade' })}>
                Dejar pasar
              </button>
            </div>
          </div>
        )
      }
      return <p className="muted">Esperando el veto de {nameOf(state, trade.vetoer)}…</p>
    }

    if (trade.to === me.id) {
      return (
        <div className="cp-action">
          <p>{describeTrade(state, trade)}</p>
          <div className="actions">
            <button className="primary" type="button" onClick={() => dispatch({ type: 'accept-trade' })}>
              Aceptar
            </button>
            <button className="ghost" type="button" onClick={() => dispatch({ type: 'reject-trade' })}>
              Rechazar
            </button>
          </div>
        </div>
      )
    }

    if (trade.from === me.id) {
      return (
        <div className="cp-action">
          <p className="muted">Esperando respuesta de {nameOf(state, trade.to)}…</p>
          <button className="ghost" type="button" onClick={() => dispatch({ type: 'cancel-trade' })}>
            Cancelar trato
          </button>
        </div>
      )
    }

    return <p className="muted">Trato entre {nameOf(state, trade.from)} y {nameOf(state, trade.to)}.</p>
  }

  if (state.phase === 'bus-move') {
    if (!isMyTurn) return <p className="muted">Esperando a {nameOf(state, current)}…</p>
    return (
      <div className="cp-action">
        <p>Tienes las 4 busetas. ¿Saltas gratis a la siguiente?</p>
        <div className="actions">
          <button className="primary" type="button" onClick={() => dispatch({ type: 'bus-move' })}>
            Saltar
          </button>
          <button className="ghost" type="button" onClick={() => dispatch({ type: 'skip-bus-move' })}>
            Quedarme
          </button>
        </div>
      </div>
    )
  }

  if (!isMyTurn) {
    return <p className="muted">Esperando a {nameOf(state, current)}…</p>
  }

  const inJail = state.inJail[me.id] === true
  const diceEvent =
    state.activeEvent && isDiceEventId(state.activeEvent.id) ? state.activeEvent : null

  return (
    <div className="cp-action">
      {inJail ? (
        <p>
          Estás en la cárcel: paga {money(RULES.jailFine)} o espera {RULES.jailTurns} turnos.
        </p>
      ) : null}
      <div className="cp2-roll-row">
        {diceEvent && state.phase === 'waiting-roll' && !inJail && state.dice === null ? (
          <DiceEventMenu
            event={diceEvent}
            diceCount={getDiceCount(state)}
            roundNumber={state.roundNumber}
          />
        ) : null}
        <div className="actions">
          <button className="primary" type="button" onClick={() => dispatch({ type: 'roll' })}>
            {inJail ? 'Esperar turno' : 'Tirar dados'}
          </button>
          {inJail ? (
            <button className="ghost" type="button" onClick={() => dispatch({ type: 'pay-bail' })}>
              Pagar fianza {money(RULES.jailFine)}
            </button>
          ) : null}
        </div>
      </div>

      {!inJail ? (
        <details className="cp-trade">
          <summary>Proponer un trato</summary>
          <select value={tradeTo} onChange={(event) => setTradeTo(event.target.value)}>
            <option value="">Elige jugador</option>
            {state.order
              .filter((id) => id !== me.id && !state.bankrupt.includes(id))
              .map((id) => (
                <option key={id} value={id}>
                  {nameOf(state, id)}
                </option>
              ))}
          </select>

          {tradeTo ? (
            <>
              <div className="cp-trade-cols">
                <fieldset>
                  <legend>Doy</legend>
                  {BOARD.filter((tile) => state.owners[tile.index] === me.id).map((tile) => (
                    <label key={tile.index}>
                      <input
                        type="checkbox"
                        checked={giveTiles.includes(tile.index)}
                        onChange={() => toggle(giveTiles, setGiveTiles, tile.index)}
                      />
                      {tile.name}
                    </label>
                  ))}
                  <input
                    type="number"
                    min={0}
                    max={myMoney}
                    placeholder="Dinero"
                    value={giveMoney}
                    onChange={(event) => setGiveMoney(event.target.value)}
                  />
                </fieldset>
                <fieldset>
                  <legend>Recibo</legend>
                  {BOARD.filter((tile) => state.owners[tile.index] === tradeTo).map((tile) => (
                    <label key={tile.index}>
                      <input
                        type="checkbox"
                        checked={getTiles.includes(tile.index)}
                        onChange={() => toggle(getTiles, setGetTiles, tile.index)}
                      />
                      {tile.name}
                    </label>
                  ))}
                  <input
                    type="number"
                    min={0}
                    max={state.money[tradeTo] ?? 0}
                    placeholder="Dinero"
                    value={getMoney}
                    onChange={(event) => setGetMoney(event.target.value)}
                  />
                </fieldset>
              </div>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  dispatch({
                    type: 'propose-trade',
                    payload: {
                      to: tradeTo,
                      giveTiles,
                      getTiles,
                      giveMoney: Number(giveMoney || 0),
                      getMoney: Number(getMoney || 0),
                    },
                  })
                  setGiveTiles([])
                  setGetTiles([])
                  setGiveMoney('')
                  setGetMoney('')
                }}
              >
                Proponer
              </button>
            </>
          ) : null}
        </details>
      ) : null}

      <BuildPanel state={state} me={me} dispatch={dispatch} myMoney={myMoney} />
    </div>
  )
}

/** Panel de construcción: solo grupos completos del jugador, con costo y nivel. */
function BuildPanel({ state, me, dispatch, myMoney }: PanelProps & { myMoney: number }) {
  const [selected, setSelected] = useState<number | ''>('')
  const multiplier = eventPriceMultiplier(state.activeEvent, state.roundNumber)
  const groups = completeGroupsFor(state, me.id, multiplier)

  if (groups.length === 0) {
    return (
      <details className="cp-trade cp-build">
        <summary>Construir</summary>
        <p className="muted small">
          Necesitas un grupo de color completo para construir casas u hoteles.
        </p>
      </details>
    )
  }

  const tileId = selected === '' ? null : Number(selected)
  const tile = tileId === null ? null : BOARD[tileId]
  const level = tileId === null ? 0 : buildingLevelFor(state, tileId)
  const cost = tileId === null ? null : buildCostFor(tileId, multiplier)
  const isHotel = level >= MAX_HOUSES
  const error =
    tileId === null ? null : buildRuleError(state, tileId, me.id, isHotel ? 'hotel' : 'house')
  const affordable = cost !== null && myMoney >= cost
  const canBuild = tileId !== null && error === null && affordable

  return (
    <details className="cp-trade cp-build">
      <summary>Construir</summary>
      <p className="muted small">
        Solo en grupos de color completos y de forma pareja. Tras {MAX_HOUSES} casas se monta el
        hotel.
      </p>
      <select
        value={selected}
        onChange={(event) =>
          setSelected(event.target.value === '' ? '' : Number(event.target.value))
        }
      >
        <option value="">Elige propiedad</option>
        {groups.map((group) => (
          <optgroup key={group.color} label={`${group.name} · ${money(group.cost)} por edificio`}>
            {group.tiles.map((id) => (
              <option key={id} value={id}>
                {BOARD[id].name} · {buildingLabel(buildingLevelFor(state, id))}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {tile && cost !== null ? (
        <>
          <div className="cp-build-facts">
            <span>
              Nivel actual: <strong>{buildingLabel(level)}</strong>
            </span>
            <span>
              Costo: <strong>{money(cost)}</strong>
            </span>
            <span>
              Alquiler: <strong>{money(rentFor(state, tile.index, state.dice?.total ?? 7))}</strong>
            </span>
          </div>
          {error ? <p className="muted small">{error}</p> : null}
          {!error && !affordable ? (
            <p className="muted small">No tienes saldo suficiente.</p>
          ) : null}
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={!canBuild}
              onClick={() =>
                dispatch({
                  type: isHotel ? 'build-hotel' : 'build-house',
                  payload: { propertyId: tile.index },
                })
              }
            >
              {isHotel ? 'Montar hotel' : 'Construir casa'} {money(cost)}
            </button>
          </div>
        </>
      ) : null}
    </details>
  )
}

function TileSheet({
  index,
  state,
  players,
  onClose,
}: {
  index: number
  state: CucupolyState
  players: Player[]
  onClose: () => void
}) {
  const tile = BOARD[index]
  const ownerId = state.owners[index] ?? null
  const owner = ownerId ? players.find((player) => player.id === ownerId) : undefined
  const rent = ownerId && isPurchasable(tile) ? rentFor(state, index, state.dice?.total ?? 7) : null
  const level = state.buildings[index] ?? 0
  // Mismo cálculo que `handleBuy`: lo mostrado y lo cobrado no pueden divergir.
  const purchasePrice =
    tile.price === undefined
      ? null
      : ownerId === null
        ? purchasePriceFor(tile.price, state.activeEvent, state.roundNumber)
        : tile.price
  const discounted = purchasePrice !== null && purchasePrice !== tile.price

  return (
    <div className="cp-sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="cp-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={tile.name}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cp-sheet-head" style={{ background: tileColor(tile), color: tileTextColor(tile) }}>
          <span className="cp-sheet-icon" aria-hidden="true">
            {tileIcon(tile) ?? '🏠'}
          </span>
          <div>
            <span className="cp-sheet-index">Casilla {index}</span>
            <h2>{tile.name}</h2>
          </div>
        </header>

        <dl className="cp-sheet-facts">
          <div>
            <dt>Grupo</dt>
            <dd>{groupNameFor(tile)}</dd>
          </div>
          {purchasePrice !== null ? (
            <div>
              <dt>Precio</dt>
              <dd>
                {money(purchasePrice)}
                {discounted ? (
                  <span className="cp-price-was"> antes {money(tile.price ?? 0)}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {rent !== null ? (
            <div>
              <dt>Renta</dt>
              <dd>{money(rent)}</dd>
            </div>
          ) : null}
          {level > 0 ? (
            <div>
              <dt>Edificios</dt>
              <dd>{buildingLabel(level)}</dd>
            </div>
          ) : null}
          {tile.tax !== undefined ? (
            <div>
              <dt>Impuesto</dt>
              <dd>{money(tile.tax)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Dueño</dt>
            <dd>
              {owner
                ? `${owner.emoji} ${owner.name}`
                : isPurchasable(tile)
                  ? 'Sin dueño'
                  : '—'}
            </dd>
          </div>
        </dl>

        <button className="primary" type="button" onClick={onClose}>
          Cerrar
        </button>
      </section>
    </div>
  )
}

export function CucupolyView({
  state,
  me,
  players,
  dispatch,
  privateData,
  sendPrivate,
}: GameViewProps<CucupolyState>) {
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [play, setPlay] = useState<RollPlan | null>(null)
  const [diceBlocked, setDiceBlocked] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [eventBanner, setEventBanner] = useState<EventBannerData | null>(null)
  const [eventLeaving, setEventLeaving] = useState(false)
  const [turnPause, setTurnPause] = useState(false)
  const seenRoll = useRef<SeenRoll | null>(null)
  // Se inicializan con la secuencia actual: al reconectar o entrar tarde no se
  // reproducen anuncios pasados, pero la etiqueta sigue leyendo `activeEvent`.
  const seenEventSeq = useRef(state.initialEventSeq)
  const seenFinalEventSeq = useRef(state.finalEventSeq)
  const bannerTimers = useRef<{ leave: number | null; clear: number | null }>({
    leave: null,
    clear: null,
  })
  const shownBannerKey = useRef<string | null>(null)
  // El id (no el índice) evita pausas falsas cuando un eliminado sale del orden.
  const turnKey = `${state.turnNumber}:${state.turnOrder[state.currentIndex] ?? ''}`
  const lastTurnKey = useRef(turnKey)

  const current =
    state.phase === 'turn-order-roll' && state.turnOrderState
      ? state.turnOrderState.queue[0] ?? state.turnOrder[0]
      : state.turnOrder[state.currentIndex]
  const activeEventKey = eventKey(state.activeEvent)
  const lastActiveEventKey = useRef(activeEventKey)

  const handleSelect = useCallback((index: number) => setSelected(index), [])
  const handleBusy = useCallback((value: boolean) => setBusy(value), [])

  const clearBannerTimers = useCallback(() => {
    if (bannerTimers.current.leave !== null) {
      window.clearTimeout(bannerTimers.current.leave)
    }
    if (bannerTimers.current.clear !== null) {
      window.clearTimeout(bannerTimers.current.clear)
    }
    bannerTimers.current = { leave: null, clear: null }
  }, [])

  const resetEventBanner = useCallback(() => {
    shownBannerKey.current = null
    setEventBanner(null)
    setEventLeaving(false)
  }, [])

  const showEventBanner = useCallback(
    (data: EventBannerData) => {
      clearBannerTimers()
      shownBannerKey.current = data.key
      setEventBanner(data)
      setEventLeaving(false)
      bannerTimers.current.leave = window.setTimeout(() => {
        bannerTimers.current.leave = null
        setEventLeaving(true)
      }, EVENT_BANNER_MS)
      bannerTimers.current.clear = window.setTimeout(() => {
        bannerTimers.current.clear = null
        resetEventBanner()
      }, EVENT_BANNER_MS + EVENT_BANNER_EXIT_MS)
    },
    [clearBannerTimers, resetEventBanner],
  )

  const dismissEventBanner = useCallback(() => {
    if (!eventBanner) return
    clearBannerTimers()
    setEventLeaving(true)
    bannerTimers.current.clear = window.setTimeout(() => {
      bannerTimers.current.clear = null
      resetEventBanner()
    }, EVENT_BANNER_EXIT_MS)
  }, [eventBanner, clearBannerTimers, resetEventBanner])

  useEffect(() => () => clearBannerTimers(), [clearBannerTimers])

  // Detección sincrónica durante el render: al llegar un snapshot con una
  // tirada nueva (rollSeq distinto), el plan y el bloqueo entran en esta misma
  // pasada, así las fichas esperan a los dados sin carreras de estados.
  const animation = planAnimations(state, seenRoll.current)
  seenRoll.current = snapshotSeen(state)
  if (animation.kind === 'roll') {
    setPlay(animation.roll)
    setDiceBlocked(true)
  }

  // Orden dados → ficha → botones: dados, banner central y pausa de fin de turno.
  useEffect(() => {
    if (!play) return
    const text =
      play.values.length > 1
        ? `${play.values.join(' + ')} = ${play.total}`
        : `${play.total}`
    const diceMs = DICE_SECONDS * 1000
    const settle = window.setTimeout(() => {
      setDiceBlocked(false)
      setBanner(text)
    }, diceMs)
    const hide = window.setTimeout(() => setBanner(null), diceMs + DICE_BANNER_MS)
    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(hide)
      setBanner(null)
    }
  }, [play])

  // El reducer avanza el turno al instante; el HUD espera a que terminen los
  // dados y la caminata, y deja un respiro antes de habilitar al siguiente.
  useEffect(() => {
    if (lastTurnKey.current === turnKey) return
    lastTurnKey.current = turnKey
    if (!isTurnPhase(state.phase)) return
    setTurnPause(true)
  }, [turnKey, state.phase])

  useEffect(() => {
    if (!turnPause || diceBlocked || busy) return
    const timer = window.setTimeout(() => setTurnPause(false), END_OF_TURN_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [turnPause, diceBlocked, busy])

  // El anfitrión mueve el reloj de la Puja Abierta. Cada tic produce un
  // snapshot; el temporizador se reprograma al cambiar el contador o la puja,
  // así una mejora siempre regala la cuenta regresiva completa.
  const isHost = state.order[0] === me.id
  const openAuction = state.phase === 'auction' && state.auction?.mode === 'open'
  const sealedAuction =
    state.phase === 'auction' && state.auction?.mode === 'sealed'
  const auctionCountdown = state.auction?.countdown ?? 0
  const auctionLeader = state.auction?.leader ?? null

  useEffect(() => {
    if (!isHost || !openAuction) return
    const timer = window.setTimeout(() => {
      dispatch({ type: 'auction-tick' })
    }, AUCTION_TICK_MS)
    return () => window.clearTimeout(timer)
  }, [isHost, openAuction, auctionCountdown, auctionLeader, dispatch])

  // Sorteo de orden: el jugador pide su tirada y el anfitrión genera el valor
  // fuera del reducer. El estado solo guarda el número ya decidido.
  const orderRequest = state.turnOrderState?.request ?? null
  useEffect(() => {
    if (!isHost || state.phase !== 'turn-order-roll' || !orderRequest) return
    const value = 1 + Math.floor(Math.random() * 6)
    dispatch({ type: 'roll-for-order', payload: { playerId: orderRequest, value } })
  }, [isHost, state.phase, orderRequest, dispatch])

  // Tras mostrar el orden final durante TURN_ORDER_REVEAL_MS, empieza la ronda 1.
  useEffect(() => {
    if (!isHost || state.phase !== 'turn-order-reveal') return
    const timer = window.setTimeout(() => {
      dispatch({ type: 'finish-turn-order' })
    }, TURN_ORDER_REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [isHost, state.phase, dispatch])

  // Ofertas secretas: solo el anfitrión conoce los importes. Viven en un ref
  // para que nunca entren al estado que se difunde a los invitados.
  const secretBids = useRef<{ playerId: string; amount: number }[]>([])
  useEffect(() => {
    if (!isHost) return
    return subscribeHostActions(({ action, playerId, ok }) => {
      if (!ok || action.type !== 'secret-bid') return
      const payload = action.payload
      if (typeof payload !== 'object' || payload === null) return
      const amount = (payload as Record<string, unknown>).amount
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return
      secretBids.current = [
        ...secretBids.current.filter((bid) => bid.playerId !== playerId),
        { playerId, amount },
      ]
    })
  }, [isHost])

  // Único sorteo del anfitrión. El planificador decide si toca evento
  // (`nextEventRound`), valida el pool y garantiza que solo haya uno activo. La
  // aleatoriedad (evento, propiedad de la subasta, permutación del caos y pausa)
  // se genera aquí, fuera del reducer.
  const drawnRound = useRef(0)
  useEffect(() => {
    if (!isHost || state.phase !== 'event' || state.activeEvent !== null) return
    if (state.roundNumber < state.nextEventRound) return
    if (drawnRound.current === state.roundNumber) return
    drawnRound.current = state.roundNumber

    const initialRound =
      state.initialEvent === null && state.roundNumber === INITIAL_EVENT_ROUND
    let pool = eventPoolForRound(state.roundNumber, state.owners, state.lastEventId)
    if (initialRound) {
      pool = pool.filter((id) => !isFinalEventId(id) && !isDiceEventId(id))
    }

    const scheduled = state.scheduledEventId
    const eventId =
      scheduled && pool.includes(scheduled)
        ? scheduled
        : pool[Math.floor(Math.random() * pool.length)]
    if (!eventId) return

    const gapRounds =
      EVENT_GAP_MIN_ROUNDS +
      Math.floor(Math.random() * (EVENT_GAP_MAX_ROUNDS - EVENT_GAP_MIN_ROUNDS + 1))
    const payload: Record<string, unknown> = { eventId, gapRounds }

    if (isAuctionEvent(eventId)) {
      const free = freeAuctionTiles(state.owners)
      payload.tileId = free[Math.floor(Math.random() * free.length)]
    }

    if (eventId === 'caos') {
      const active = state.order.filter((id) => !state.bankrupt.includes(id))
      const order = [...active]
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        const swap = order[i]
        order[i] = order[j]
        order[j] = swap
      }
      payload.order = order
    }

    dispatch({ type: 'start-event', payload })
  }, [
    isHost,
    state.phase,
    state.activeEvent,
    state.roundNumber,
    state.nextEventRound,
    state.initialEvent,
    state.scheduledEventId,
    state.lastEventId,
    state.owners,
    state.order,
    state.bankrupt,
    dispatch,
  ])

  // La subasta abre cuando termina el anuncio. Si este cliente ya había visto
  // el anuncio (recarga o reconexión), abre de inmediato.
  const auctionEventSeq =
    state.phase === 'event' && state.auction ? state.eventSeq : 0
  useEffect(() => {
    if (!isHost || !auctionEventSeq) return
    const delay = hasSeenEvent(state.seed, auctionEventSeq)
      ? 0
      : EVENT_BANNER_MS + EVENT_BANNER_EXIT_MS
    const timer = window.setTimeout(() => {
      dispatch({ type: 'open-initial-auction' })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [isHost, auctionEventSeq, state.seed, dispatch])

  // Cada Oferta Secreta empieza sin ofertas registradas.
  useEffect(() => {
    if (!sealedAuction) return
    secretBids.current = []
  }, [sealedAuction, state.eventSeq])

  // Cuando todos respondieron, el anfitrión revela las ofertas al reducer.
  const sealedPending = state.auction?.pending.length ?? 0
  useEffect(() => {
    if (!isHost || !sealedAuction || sealedPending > 0) return
    dispatch({
      type: 'resolve-secret-auction',
      payload: { bids: secretBids.current.map((bid) => ({ ...bid })) },
    })
  }, [isHost, sealedAuction, sealedPending, dispatch])

  // Cierre forzoso de la Oferta Secreta al vencer AUCTION_SECRET_MS.
  useEffect(() => {
    if (!isHost || !sealedAuction) return
    const timer = window.setTimeout(() => {
      dispatch({
        type: 'resolve-secret-auction',
        payload: { bids: secretBids.current.map((bid) => ({ ...bid })) },
      })
    }, AUCTION_SECRET_MS)
    return () => window.clearTimeout(timer)
  }, [isHost, sealedAuction, state.eventSeq, dispatch])

  // Anuncio del evento inicial: se dispara con `initialEventSeq` una sola vez
  // por cliente (no con `eventSeq`, que también avanza con otros eventos).
  // Los temporizadores viven fuera del efecto: un snapshot nuevo ya no cancela
  // la salida del banner.
  useEffect(() => {
    const seq = state.initialEventSeq
    const eventId = state.initialEvent
    if (!eventId || seq <= seenEventSeq.current) return
    seenEventSeq.current = seq
    if (hasSeenEvent(state.seed, seq)) return

    markEventSeen(state.seed, seq)
    showEventBanner({ id: eventId, kind: 'initial', key: activeEventKey })
  }, [
    state.initialEventSeq,
    state.initialEvent,
    state.seed,
    activeEventKey,
    showEventBanner,
  ])

  // Anuncio del evento final: misma regla, con secuencia propia.
  useEffect(() => {
    const seq = state.finalEventSeq
    const event = state.finalEvent
    if (!event || seq <= seenFinalEventSeq.current) return
    seenFinalEventSeq.current = seq
    if (hasSeenFinalEvent(state.seed, seq)) return

    markFinalEventSeen(state.seed, seq)
    showEventBanner({ id: event.id, kind: 'final', key: activeEventKey })
  }, [state.finalEventSeq, state.finalEvent, state.seed, activeEventKey, showEventBanner])

  // Cambiar de evento, cerrarlo o terminar la partida retira el anuncio. El
  // `key` evita que un anuncio recién abierto se borre en el mismo commit.
  useEffect(() => {
    if (lastActiveEventKey.current === activeEventKey) return
    lastActiveEventKey.current = activeEventKey
    if (shownBannerKey.current === null || shownBannerKey.current === activeEventKey) return
    clearBannerTimers()
    resetEventBanner()
  }, [activeEventKey, clearBannerTimers, resetEventBanner])

  useEffect(() => {
    if (state.phase !== 'finished') return
    clearBannerTimers()
    resetEventBanner()
  }, [state.phase, clearBannerTimers, resetEventBanner])

  // Nueva partida en la misma vista: reinicia los cursores de anuncios para
  // que su primer evento sí se muestre.
  const seedRef = useRef(state.seed)
  useEffect(() => {
    if (seedRef.current === state.seed) return
    seedRef.current = state.seed
    seenEventSeq.current = state.initialEventSeq
    seenFinalEventSeq.current = state.finalEventSeq
    clearBannerTimers()
    resetEventBanner()
  }, [
    state.seed,
    state.initialEventSeq,
    state.finalEventSeq,
    clearBannerTimers,
    resetEventBanner,
  ])

  // Los avisos no compiten con los anuncios grandes (evento inicial u orden de
  // turnos). Tras la victoria se dejan correr para que el último «quedó en
  // bancarrota» también llegue a todos.
  const noticesPaused = eventBanner !== null || state.phase === 'turn-order-reveal'
  const noticeQueue = useNoticeQueue(state.notices, state.noticeSeq, noticesPaused)

  const roll = play
    ? { values: play.values, total: play.total, seq: play.seq }
    : null
  // Dados + caminata: mientras dure, no se revela la casilla ni el menú de
  // decisión, porque el estado ya conoce el destino antes de que la ficha caiga.
  const animating = diceBlocked || busy
  const statusHint = animating
    ? diceBlocked
      ? 'Tirando los dados…'
      : 'Moviendo la ficha…'
    : turnPause
      ? `${nameOf(state, current)} prepara su turno…`
      : phaseHint(state)
  const locked = animating || turnPause
  const acting = mustAct(state, me.id)

  return (
    <div
      className="cp-stage"
      style={{ '--cp-pace': String(PACE) } as CSSProperties}
    >
      <div className="cp-canvas">
        <Suspense fallback={<div className="cp-loading">Cargando tablero 3D…</div>}>
          <BoardScene
            state={state}
            players={players}
            roll={roll}
            walk={play}
            tokenGate={!diceBlocked}
            onSelectTile={handleSelect}
            onBusyChange={handleBusy}
          />
        </Suspense>
      </div>

      {banner ? (
        <div className="cp-dice-banner" aria-live="polite">
          {banner}
        </div>
      ) : null}

      {eventBanner ? (
        <EventBanner
          banner={eventBanner}
          leaving={eventLeaving}
          onDismiss={dismissEventBanner}
        />
      ) : null}

      {state.phase === 'turn-order-reveal' && state.turnOrderState ? (
        <div className="cp-event-overlay" role="status" aria-live="assertive">
          <div className="cp-event-card cp-turn-order-card">
            <span className="cp-event-icon" aria-hidden="true">
              🎲
            </span>
            <span className="cp-eyebrow">Orden de turnos</span>
            <h2>¡A jugar!</h2>
            <ol className="cp-turn-order-list">
              {state.turnOrder.map((id, index) => (
                <li key={id}>
                  <span className="cp-turn-order-pos">{index + 1}.</span>
                  <span>{nameOf(state, id)}</span>
                  <strong>{state.turnOrderState?.rolls[id] ?? '—'}</strong>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      {state.phase === 'finished' ? (
        <div className="cp-winner" role="status">
          <span className="cp-winner-emoji" aria-hidden="true">
            🏆
          </span>
          <p>¡Gana {nameOf(state, state.winner)}!</p>
        </div>
      ) : null}

      <header className="cp-hud">
        <div className="cp-hud-players">
          {state.order.map((id) => {
            const player = players.find((candidate) => candidate.id === id)
            const out = state.bankrupt.includes(id)
            const rolled = state.turnOrderState?.rolls[id]
            const chip = moneyChip(noticeQueue.current, id)
            return (
              <article
                key={id}
                className={`cp-pcard${id === current ? ' is-current' : ''}${out ? ' is-out' : ''}`}
              >
                <span className="avatar" style={{ backgroundColor: player?.color ?? '#999' }}>
                  {player?.emoji ?? '🙂'}
                </span>
                <div className="cp-pinfo">
                  <span className="cp-pname">
                    {nameOf(state, id)}
                    {id === me.id ? ' (tú)' : ''}
                    {rolled !== undefined ? (
                      <span className="cp-roll-chip" aria-label={`dado ${rolled}`}>
                        🎲 {rolled}
                      </span>
                    ) : null}
                  </span>
                  <span className="cp-pmoney">
                    {out ? 'eliminado' : money(state.money[id] ?? 0)}
                    {chip ? (
                      <span
                        key={noticeQueue.current?.id}
                        className={`cp-money-chip ${chip.positive ? 'is-in' : 'is-out'}`}
                        aria-hidden="true"
                      >
                        {chip.text}
                      </span>
                    ) : null}
                  </span>
                </div>
              </article>
            )
          })}
        </div>

        {state.activeEvent ? (
          <div className="cp2-event-pill-slot">
            <ActiveEventPill
              key={activeEventKey ?? state.activeEvent.id}
              event={state.activeEvent}
              roundNumber={state.roundNumber}
            />
          </div>
        ) : null}

        <div className="cp-turnbanner" role="status">
          <span className="cp-eyebrow">
            {state.phase === 'turn-order-roll' || state.phase === 'turn-order-reveal'
              ? 'Sorteo del orden de turnos'
              : `Ronda ${state.roundNumber} · Turno ${state.turnNumber + 1}`}
          </span>
          <strong>{nameOf(state, current)}</strong>
          <span className="cp-phase">{statusHint}</span>
        </div>

        <NoticeTicker notice={noticeQueue.current} />

        {(!acting || turnPause) && state.phase !== 'finished' ? (
          <div className="cp-dock" role="status">
            {statusHint}
          </div>
        ) : null}
      </header>

      {acting && !animating && !turnPause ? (
        <div className="cp-action-backdrop">
          <section
            className="cp-action-card"
            role="dialog"
            aria-modal="true"
            aria-label={actionTitle(state, me)}
          >
            <header className="cp-action-head">
              <span className="cp-action-icon" aria-hidden="true">
                {actionIcon(state)}
              </span>
              <div>
                <span className="cp-eyebrow">
                  {state.phase === 'turn-order-roll' || state.phase === 'turn-order-reveal'
                    ? 'Sorteo del orden de turnos'
                    : `Ronda ${state.roundNumber} · Turno ${state.turnNumber + 1}`}
                </span>
                <h2>{actionTitle(state, me)}</h2>
              </div>
            </header>
            <fieldset className="cp-lock" disabled={locked}>
              <ActionPanel state={state} me={me} dispatch={dispatch} />
            </fieldset>
          </section>
        </div>
      ) : null}

      {state.phase === 'twenty-one' && state.table21 && !animating ? (
        <Table21Panel
          state={state}
          me={me}
          players={players}
          dispatch={dispatch}
          privateData={privateData}
          sendPrivate={sendPrivate}
        />
      ) : null}

      {selected !== null ? (
        <TileSheet
          index={selected}
          state={state}
          players={players}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  )
}
