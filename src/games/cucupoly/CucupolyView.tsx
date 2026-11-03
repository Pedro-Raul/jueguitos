import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { GameAction, GameViewProps, Player } from '../../types'
import { BOARD } from './board'
import {
  AUCTION_NAMES,
  TURN_ORDER_REVEAL_MS,
  rentFor,
  type CucupolyState,
  type TradeState,
} from './engine'
import {
  EVENTS,
  EVENT_BANNER_EXIT_MS,
  EVENT_BANNER_MS,
  AUCTION_OPEN_IDLE_TICKS,
  AUCTION_SECRET_MS,
  AUCTION_TICK_MS,
  MIN_RAISE,
  discountRoundsLeft,
  drawableEvents,
  freeAuctionTiles,
  hasSeenEvent,
  isAuctionEvent,
  isDiscountActive,
  markEventSeen,
  purchasePriceFor,
  type InitialEventId,
} from './events'
import { planAnimations, snapshotSeen, type RollPlan, type SeenRoll } from './planAnimations'
import { DICE_SECONDS } from './three/layout'
import { RULES } from './rules.config'
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
      return 'Sorteando el evento inicial…'
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
    case 'thirty-one':
      return 'Mesa de 31 en curso.'
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
  if (state.phase === 'finished') return false
  const isMyTurn = state.turnOrder[state.currentIndex] === meId
  switch (state.phase) {
    case 'turn-order-roll':
      return state.turnOrderState?.queue[0] === meId
    case 'turn-order-reveal':
      return false
    case 'event':
      // El anfitrión sortea solo; nadie tiene una acción pendiente.
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
    case 'thirty-one': {
      const table = state.table31
      if (!table) return false
      return table.stage === 'bets'
        ? table.pendingBets.includes(meId)
        : table.drawOrder[table.drawIndex] === meId
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
    case 'thirty-one':
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
    case 'thirty-one':
      return 'Mesa de 31'
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
  const [bet, setBet] = useState('')
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
    const price = purchasePriceFor(tile.price ?? 0, state.initialEvent, state.roundNumber)
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

  if (state.phase === 'thirty-one' && state.table31) {
    const table = state.table31
    if (table.stage === 'bets') {
      const waiting = table.pendingBets.includes(me.id)
      return (
        <div className="cp-action">
          <p>Mesa de 31: apuesta hasta {money(RULES.table31BetLimit)}.</p>
          {waiting ? (
            <>
              <input
                type="number"
                min={1}
                max={Math.min(RULES.table31BetLimit, myMoney)}
                value={bet}
                placeholder="Apuesta"
                onChange={(event) => setBet(event.target.value)}
              />
              <div className="actions">
                <button
                  className="primary"
                  type="button"
                  disabled={bet === ''}
                  onClick={() => {
                    dispatch({ type: 'join-table', payload: { bet: Number(bet) } })
                    setBet('')
                  }}
                >
                  Sentarse
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => dispatch({ type: 'pass-table' })}
                >
                  No jugar
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">Esperando decisiones…</p>
          )}
        </div>
      )
    }

    const drawer = table.drawOrder[table.drawIndex]
    return (
      <div className="cp-action">
        <ul className="cp-hands">
          {table.participants.map((id) => (
            <li key={id}>
              <span>{nameOf(state, id)}</span>
              <strong>{table.hands[id] ?? 0}</strong>
              {table.busted.includes(id) ? <em>pasado</em> : null}
              {table.standing.includes(id) ? <em>planta</em> : null}
            </li>
          ))}
        </ul>
        {drawer === me.id ? (
          <div className="actions">
            <button className="primary" type="button" onClick={() => dispatch({ type: 'draw-card' })}>
              Pedir carta
            </button>
            <button className="ghost" type="button" onClick={() => dispatch({ type: 'stand' })}>
              Plantarse
            </button>
          </div>
        ) : (
          <p className="muted small">Turno de {nameOf(state, drawer)} en la mesa.</p>
        )}
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

  return (
    <div className="cp-action">
      {inJail ? (
        <p>
          Estás en la cárcel: paga {money(RULES.jailFine)} o espera {RULES.jailTurns} turnos.
        </p>
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
    </div>
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
  // Mismo cálculo que `handleBuy`: lo mostrado y lo cobrado no pueden divergir.
  const purchasePrice =
    tile.price === undefined
      ? null
      : ownerId === null
        ? purchasePriceFor(tile.price, state.initialEvent, state.roundNumber)
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

export function CucupolyView({ state, me, players, dispatch }: GameViewProps<CucupolyState>) {
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [play, setPlay] = useState<RollPlan | null>(null)
  const [diceBlocked, setDiceBlocked] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [eventBanner, setEventBanner] = useState<InitialEventId | null>(null)
  const [eventLeaving, setEventLeaving] = useState(false)
  const seenRoll = useRef<SeenRoll | null>(null)
  const seenEventSeq = useRef(0)

  const current =
    state.phase === 'turn-order-roll' && state.turnOrderState
      ? state.turnOrderState.queue[0] ?? state.turnOrder[0]
      : state.turnOrder[state.currentIndex]
  const modifier =
    state.diceModifier &&
    state.turnNumber >= state.diceModifier.from &&
    state.turnNumber < state.diceModifier.until
      ? state.diceModifier
      : null

  const handleSelect = useCallback((index: number) => setSelected(index), [])
  const handleBusy = useCallback((value: boolean) => setBusy(value), [])

  // Detección sincrónica durante el render: al llegar un snapshot con una
  // tirada nueva (rollSeq distinto), el plan y el bloqueo entran en esta misma
  // pasada, así las fichas esperan a los dados sin carreras de estados.
  const animation = planAnimations(state, seenRoll.current)
  seenRoll.current = snapshotSeen(state)
  if (animation.kind === 'roll') {
    setPlay(animation.roll)
    setDiceBlocked(true)
  }

  // Orden dados → ficha → botones: 1.2 s de dados, banner central 2 s.
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
    const hide = window.setTimeout(() => setBanner(null), diceMs + 2000)
    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(hide)
      setBanner(null)
    }
  }, [play])

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

  // El anfitrión sortea el evento inicial FUERA del reducer y lo aplica como
  // acción; así el reducer sigue siendo puro y determinista. Las subastas solo
  // entran al sorteo si queda alguna propiedad sin dueño.
  const drawnRound = useRef(0)
  useEffect(() => {
    if (!isHost || state.phase !== 'event' || state.initialEvent !== null) return
    if (drawnRound.current === state.roundNumber) return
    drawnRound.current = state.roundNumber

    const free = freeAuctionTiles(state.owners)
    const pool = drawableEvents(state.owners)
    const eventId = pool[Math.floor(Math.random() * pool.length)]
    const tileId = isAuctionEvent(eventId)
      ? free[Math.floor(Math.random() * free.length)]
      : undefined
    dispatch({ type: 'start-initial-event', payload: { eventId, tileId } })
  }, [isHost, state.phase, state.initialEvent, state.owners, state.roundNumber, dispatch])

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

  // Anuncio del evento inicial: se dispara con `eventSeq` una sola vez por
  // cliente. `sessionStorage` evita repetirlo al reconectar o recargar.
  useEffect(() => {
    const seq = state.eventSeq
    const eventId = state.initialEvent
    if (!eventId || seq <= 0) return
    if (seenEventSeq.current >= seq) return
    seenEventSeq.current = seq
    if (hasSeenEvent(state.seed, seq)) return

    markEventSeen(state.seed, seq)
    setEventBanner(eventId)
    setEventLeaving(false)
    const leave = window.setTimeout(() => setEventLeaving(true), EVENT_BANNER_MS)
    const clear = window.setTimeout(() => {
      setEventBanner(null)
      setEventLeaving(false)
    }, EVENT_BANNER_MS + EVENT_BANNER_EXIT_MS)
    return () => {
      window.clearTimeout(leave)
      window.clearTimeout(clear)
    }
  }, [state.eventSeq, state.initialEvent, state.seed])

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
    : phaseHint(state)
  const locked = animating
  const acting = mustAct(state, me.id)

  return (
    <div className="cp-stage">
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
        <div
          className={`cp-event-overlay${eventLeaving ? ' is-leaving' : ''}`}
          role="status"
          aria-live="assertive"
        >
          <div className="cp-event-card">
            <span className="cp-event-icon" aria-hidden="true">
              {EVENTS[eventBanner].icon}
            </span>
            <span className="cp-eyebrow">Evento inicial</span>
            <h2>{EVENTS[eventBanner].name}</h2>
            <p>{EVENTS[eventBanner].description}</p>
          </div>
        </div>
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
                  </span>
                </div>
              </article>
            )
          })}
        </div>

        <div className="cp-turnbanner" role="status">
          <span className="cp-eyebrow">
            {state.phase === 'turn-order-roll' || state.phase === 'turn-order-reveal'
              ? 'Sorteo del orden de turnos'
              : `Ronda ${state.roundNumber} · Turno ${state.turnNumber + 1}`}
          </span>
          <strong>{nameOf(state, current)}</strong>
          <span className="cp-phase">{statusHint}</span>
          {modifier ? <span className="cp-badge">🎲 {modifier.dice} dado(s)</span> : null}
          {isDiscountActive(state.initialEvent, state.roundNumber) ? (
            <span className="cp-badge cp-badge-discount">
              🏷️ Semana de descuentos: quedan {discountRoundsLeft(state.roundNumber)}{' '}
              {discountRoundsLeft(state.roundNumber) === 1 ? 'ronda' : 'rondas'}
            </span>
          ) : null}
        </div>

        {!acting && state.phase !== 'finished' ? (
          <div className="cp-dock" role="status">
            {statusHint}
          </div>
        ) : null}
      </header>

      {acting && !animating ? (
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
