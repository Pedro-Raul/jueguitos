import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameAction, GameViewProps, Player } from '../../types'
import { BOARD } from './board'
import { rentFor, type CucupolyState, type TradeState } from './engine'
import { latestRoll, rollKey, type RollHint } from './rollHint'
import { DICE_SECONDS } from './three/layout'
import { RULES } from './rules.config'
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
    case 'waiting-roll':
      return `${nameOf(state, state.order[state.currentIndex])} debe tirar.`
    case 'buy-decision':
      return state.pendingBuy === null
        ? 'Decisión de compra.'
        : `¿Comprar ${BOARD[state.pendingBuy].name}?`
    case 'auction':
      return state.auction ? `Subasta de ${BOARD[state.auction.tileId].name}.` : 'Subasta.'
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
  const isMyTurn = state.order[state.currentIndex] === meId
  switch (state.phase) {
    case 'auction':
      return state.auction?.pending.includes(meId) ?? false
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
    case 'buy-decision':
      return '🏷️'
    case 'auction':
      return '🔨'
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
    case 'buy-decision':
      return 'Comprar o subastar'
    case 'auction':
      return 'Subasta'
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

  const current = state.order[state.currentIndex]
  const isMyTurn = current === me.id
  const myMoney = state.money[me.id] ?? 0

  if (state.phase === 'finished') {
    return <p className="cp-banner">Gana {nameOf(state, state.winner)}.</p>
  }

  if (state.phase === 'auction' && state.auction) {
    const auction = state.auction
    const waiting = auction.pending.includes(me.id)
    return (
      <div className="cp-action">
        <p>
          Subasta de <strong>{BOARD[auction.tileId].name}</strong> desde{' '}
          {money(auction.minBid)}.
        </p>
        {waiting ? (
          <>
            <input
              type="number"
              min={0}
              max={myMoney}
              value={bid}
              placeholder={String(auction.minBid)}
              onChange={(event) => setBid(event.target.value)}
            />
            <div className="actions">
              <button
                className="primary"
                type="button"
                disabled={bid === ''}
                onClick={() => {
                  dispatch({ type: 'bid', payload: { amount: Number(bid) } })
                  setBid('')
                }}
              >
                Pujar
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  dispatch({ type: 'bid', payload: { amount: 0 } })
                  setBid('')
                }}
              >
                Pasar
              </button>
            </div>
          </>
        ) : (
          <p className="muted small">
            Esperando pujas de {auction.pending.map((id) => nameOf(state, id)).join(', ')}.
          </p>
        )}
      </div>
    )
  }

  if (state.phase === 'buy-decision' && state.pendingBuy !== null) {
    const tile = BOARD[state.pendingBuy]
    if (!isMyTurn) {
      return <p className="muted">Esperando a {nameOf(state, current)}…</p>
    }
    return (
      <div className="cp-action">
        <p>
          ¿Compras <strong>{tile.name}</strong> por {money(tile.price ?? 0)}?
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
          {tile.price !== undefined ? (
            <div>
              <dt>Precio</dt>
              <dd>{money(tile.price)}</dd>
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
  const [play, setPlay] = useState<{ hint: RollHint; seq: number } | null>(null)
  const [diceBlocked, setDiceBlocked] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const seenRoll = useRef<string | null>(null)
  const firstRoll = useRef(true)

  const current = state.order[state.currentIndex]
  const modifier =
    state.diceModifier &&
    state.turnNumber >= state.diceModifier.from &&
    state.turnNumber < state.diceModifier.until
      ? state.diceModifier
      : null

  const handleSelect = useCallback((index: number) => setSelected(index), [])
  const handleBusy = useCallback((value: boolean) => setBusy(value), [])

  const hint = useMemo(() => latestRoll(state), [state])

  // Detección sincrónica durante el render: al llegar un snapshot con una
  // tirada nueva, el bloqueo de dados queda activo en esta misma pasada,
  // así las fichas esperan sin carreras de estados.
  if (hint && rollKey(hint) !== seenRoll.current) {
    seenRoll.current = rollKey(hint)
    if (firstRoll.current) {
      // Reconexión o entrada tarde: baseline sin animación.
      firstRoll.current = false
    } else {
      setPlay({ hint, seq: (play?.seq ?? 0) + 1 })
      setDiceBlocked(true)
    }
  }

  // Orden dados → ficha → botones: 1.2 s de dados, banner central 2 s.
  useEffect(() => {
    if (!play) return
    const text =
      play.hint.values.length > 1
        ? `${play.hint.values.join(' + ')} = ${play.hint.total}`
        : `${play.hint.total}`
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

  const roll = play ? { ...play.hint, seq: play.seq } : null
  const locked = diceBlocked || busy
  const acting = mustAct(state, me.id)

  return (
    <div className="cp-stage">
      <div className="cp-canvas">
        <Suspense fallback={<div className="cp-loading">Cargando tablero 3D…</div>}>
          <BoardScene
            state={state}
            players={players}
            roll={roll}
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
                  </span>
                  <span className="cp-pmoney">
                    {out ? 'eliminado' : money(state.money[id] ?? 0)}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      </header>

      <div className="cp-turnbanner" role="status">
        <span className="cp-eyebrow">Turno {state.turnNumber + 1}</span>
        <strong>{nameOf(state, current)}</strong>
        <span className="cp-phase">{phaseHint(state)}</span>
        {modifier ? <span className="cp-badge">🎲 {modifier.dice} dado(s)</span> : null}
      </div>

      {!acting && state.phase !== 'finished' ? (
        <div className="cp-dock" role="status">
          {phaseHint(state)}
        </div>
      ) : null}

      {acting ? (
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
                <span className="cp-eyebrow">Turno {state.turnNumber + 1}</span>
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
