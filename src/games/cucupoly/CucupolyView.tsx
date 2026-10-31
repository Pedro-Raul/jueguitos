import { useState } from 'react'
import type { GameAction, GameViewProps, Player } from '../../types'
import { BOARD, gridPosition, type Tile } from './board'
import type { CucupolyState, TradeState } from './engine'
import { RULES } from './rules.config'

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

function abilityLabel(tile: Tile): string {
  switch (tile.service) {
    case 'water':
      return 'Abastecimiento: +15% a tus rentas'
    case 'electricity':
      return 'Apagón: nadie puede comprar'
    case 'telephone':
      return 'Caída de red: puedes vetar tratos'
    default:
      return ''
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

function BoardCell({
  tile,
  state,
  players,
}: {
  tile: Tile
  state: CucupolyState
  players: Player[]
}) {
  const { column, row } = gridPosition(tile.index)
  const owner = state.owners[tile.index]
  const ownerPlayer = players.find((player) => player.id === owner)
  const occupants = players.filter(
    (player) =>
      !state.bankrupt.includes(player.id) && state.positions[player.id] === tile.index,
  )
  const isCorner = tile.index === 0 || tile.index === 12 || tile.index === 24 || tile.index === 36

  return (
    <div
      className={`cp-cell cp-cell-${tile.type}${isCorner ? ' cp-corner' : ''}`}
      style={{
        gridColumn: column,
        gridRow: row,
        borderTopColor: ownerPlayer?.color ?? 'transparent',
      }}
      title={`${tile.index}. ${tile.name}`}
    >
      <span className="cp-name">{tile.name}</span>
      {tile.price !== undefined ? <span className="cp-price">${tile.price}</span> : null}
      {tile.tax !== undefined ? <span className="cp-price">${tile.tax}</span> : null}
      <span className="cp-tokens">
        {occupants.map((player) => (
          <span
            key={player.id}
            className="cp-token"
            style={{ backgroundColor: player.color }}
            title={player.name}
          >
            {player.emoji}
          </span>
        ))}
      </span>
    </div>
  )
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function Die({ value }: { value: number }) {
  const on = PIPS[value] ?? []
  return (
    <span className="cp-die" role="img" aria-label={`Dado ${value}`}>
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} className={on.includes(index) ? 'is-on' : ''} />
      ))}
    </span>
  )
}

export function CucupolyView({ state, me, players, dispatch }: GameViewProps<CucupolyState>) {
  const current = state.order[state.currentIndex]
  const activeCount = state.order.filter((id) => !state.bankrupt.includes(id)).length
  const myTiles = BOARD.filter((tile) => state.owners[tile.index] === me.id)
  const services = BOARD.filter((tile) => tile.type === 'service' && state.owners[tile.index] === me.id)
  const modifier =
    state.diceModifier &&
    state.turnNumber >= state.diceModifier.from &&
    state.turnNumber < state.diceModifier.until
      ? state.diceModifier
      : null

  return (
    <div className="cp">
      <header className="cp-hud">
        <div className="cp-hud-players">
          <ul className="cp-players">
            {state.order.map((id) => {
              const player = players.find((candidate) => candidate.id === id)
              const out = state.bankrupt.includes(id)
              return (
                <li
                  key={id}
                  className={`cp-player${out ? ' is-out' : ''}${id === current ? ' is-current' : ''}`}
                >
                  <span className="cp-dot" style={{ backgroundColor: player?.color ?? '#999' }} />
                  <span className="cp-player-name">
                    {nameOf(state, id)}
                    {id === me.id ? ' (tú)' : ''}
                  </span>
                  <span className="cp-player-money">
                    {out ? 'eliminado' : money(state.money[id] ?? 0)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="cp-hud-turn">
          <span className="cp-eyebrow">Turno {state.turnNumber + 1}</span>
          <strong className="cp-current">{nameOf(state, current)}</strong>
          {modifier ? <span className="cp-badge">🎲 {modifier.dice} dado(s)</span> : null}
        </div>
      </header>

      <div className="cp-layout">
        <div className="cp-board-wrap">
          <div className="cp-board">
            {BOARD.map((tile) => (
              <BoardCell key={tile.index} tile={tile} state={state} players={players} />
            ))}

            <div className="cp-center">
              <span className="cp-eyebrow">Turno {state.turnNumber + 1}</span>
              <strong className="cp-current">{nameOf(state, current)}</strong>
              <p className="cp-hint">{phaseHint(state)}</p>
              {state.dice ? (
                <div className="cp-dice">
                  {state.dice.values.map((value, index) => (
                    <Die key={index} value={value} />
                  ))}
                  <span className="cp-dice-total">= {state.dice.total}</span>
                </div>
              ) : null}
              {modifier ? <span className="cp-badge">Esta ronda: {modifier.dice} dado(s)</span> : null}
              <ul className="cp-mini-log">
                {state.log.slice(-4).reverse().map((entry, index) => (
                  <li key={`${entry.turn}-${index}`}>{entry.text}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="cp-dock">
          <ActionPanel state={state} me={me} dispatch={dispatch} />
        </div>

        <aside className="cp-rail">
          <section className="cp-box">
            <h3>Mis propiedades</h3>
            {myTiles.length === 0 ? (
              <p className="muted small">Aún no tienes casillas.</p>
            ) : (
              <ul className="cp-chips">
                {myTiles.map((tile) => (
                  <li key={tile.index} className="cp-chip">
                    {tile.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cp-box">
            <h3>Habilidades</h3>
            {services.length === 0 ? (
              <p className="muted small">Necesitas un servicio para usar habilidades.</p>
            ) : (
              services.map((tile) => {
                const ability = state.abilities[tile.index]
                const active =
                  state.turnNumber >= ability.from && state.turnNumber < ability.until
                const remaining = Math.max(
                  0,
                  Math.ceil((ability.readyAt - state.turnNumber) / Math.max(1, activeCount)),
                )
                const ready = !active && remaining === 0

                return (
                  <div key={tile.index} className="cp-ability">
                    <div>
                      <strong>{tile.name}</strong>
                      <span className="muted small">{abilityLabel(tile)}</span>
                    </div>
                    <span className="cp-ability-state">
                      {active ? 'activa' : ready ? 'lista' : `espera ${remaining} r.`}
                    </span>
                    <button
                      className="ghost small-btn"
                      type="button"
                      disabled={!ready || state.phase !== 'waiting-roll' || current !== me.id}
                      onClick={() =>
                        dispatch({ type: 'activate-ability', payload: { tileId: tile.index } })
                      }
                    >
                      Activar
                    </button>
                  </div>
                )
              })
            )}
          </section>

          <section className="cp-box">
            <h3>Registro</h3>
            <ul className="cp-log">
              {state.log
                .slice(-10)
                .reverse()
                .map((entry, index) => (
                  <li key={`${entry.turn}-${index}`}>
                    <span className="muted small">T{entry.turn + 1}</span> {entry.text}
                  </li>
                ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
