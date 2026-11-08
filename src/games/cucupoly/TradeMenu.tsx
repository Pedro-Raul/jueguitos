import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { Ficha } from '../../components/Ficha'
import type { GameAction, Player } from '../../types'
import { BOARD, type Tile } from './board'
import type { CucupolyState } from './engine'
import { PropertyCard } from './PropertyCard'
import { ownedProperties } from './propertyView'

type TradeProps = {
  state: CucupolyState
  me: Player
  players: Player[]
  dispatch: (action: GameAction) => void
}

type ComposerProps = TradeProps & {
  onClose: () => void
}

function nameOf(state: CucupolyState, id: string | null): string {
  return id ? state.names[id] ?? id : '—'
}

function moneyLabel(value: number): string {
  return `$${value}`
}

/**
 * Motivo por el que una carta no puede entrar en el intercambio. El motor no
 * tiene hipotecas ni prohíbe propiedades con edificios, así que hoy solo
 * protege contra dueños obsoletos o cartas que no son comprables.
 */
function tradeBlockReason(
  state: CucupolyState,
  tileId: number,
  ownerId: string,
): string | null {
  if (state.bankrupt.includes(ownerId)) return 'Jugador eliminado'
  const tile = BOARD[tileId]
  if (!tile || tile.price === undefined) return 'No se puede intercambiar'
  if (state.owners[tileId] !== ownerId) return 'Ya no pertenece a ese jugador'
  return null
}

function parseMoney(value: string): number | null {
  if (value.trim() === '') return 0
  const amount = Number(value)
  return Number.isInteger(amount) ? amount : null
}

function toggleTile(list: number[], tileId: number): number[] {
  return list.includes(tileId)
    ? list.filter((item) => item !== tileId)
    : [...list, tileId]
}

function sideSummary(tiles: number[], amount: number): string {
  const parts = tiles.map((tileId) => BOARD[tileId]?.name ?? `Casilla ${tileId}`)
  if (amount > 0) parts.push(moneyLabel(amount))
  return parts.length > 0 ? parts.join(', ') : 'Nada'
}

function TradeColumn({
  title,
  ownerId,
  ownerName,
  balance,
  tiles,
  selected,
  onToggle,
  state,
  hint,
}: {
  title: string
  ownerId: string
  ownerName: string
  balance: number
  tiles: Tile[]
  selected: number[]
  onToggle?: (tileId: number) => void
  state: CucupolyState
  hint: string
}) {
  return (
    <section className="cp-trade-column">
      <header className="cp-trade-column-head">
        <h3>{title}</h3>
        <span>
          {ownerName} · {moneyLabel(balance)}
        </span>
      </header>
      {tiles.length === 0 ? (
        <p className="cp-trade-empty">{hint}</p>
      ) : (
        <div className="cp-prop-grid cp-trade-grid">
          {tiles.map((tile) => {
            const blocker = tradeBlockReason(state, tile.index, ownerId)
            const isSelected = selected.includes(tile.index)
            return (
              <PropertyCard
                key={tile.index}
                propiedad={tile}
                nivel={state.buildings[tile.index] ?? 0}
                compact
                selectable={onToggle !== undefined && blocker === null}
                selected={isSelected}
                disabled={blocker !== null}
                disabledReason={blocker ?? undefined}
                onClick={onToggle ? () => onToggle(tile.index) : undefined}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Menú de composición de un intercambio. Solo se muestra al jugador actual
 * dentro de la ventana posterior a la tirada; no despacha nada hasta Proponer.
 */
export function TradeComposer({
  state,
  me,
  players,
  dispatch,
  onClose,
}: ComposerProps) {
  const [toId, setToId] = useState<string | null>(null)
  const [giveTiles, setGiveTiles] = useState<number[]>([])
  const [getTiles, setGetTiles] = useState<number[]>([])
  const [giveMoney, setGiveMoney] = useState('')
  const [getMoney, setGetMoney] = useState('')

  const candidates = state.order.filter(
    (id) => id !== me.id && !state.bankrupt.includes(id),
  )

  useEffect(() => {
    if (toId !== null && !candidates.includes(toId)) setToId(null)
  }, [candidates, toId])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const closeFromBackdrop = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose()
    },
    [onClose],
  )

  const choosePlayer = (id: string) => {
    setToId(id)
    setGetTiles([])
    setGetMoney('')
  }

  const myTiles = ownedProperties(state.owners, me.id)
  const theirTiles = toId ? ownedProperties(state.owners, toId) : []
  const myMoney = state.money[me.id] ?? 0
  const theirMoney = toId ? state.money[toId] ?? 0 : 0
  const giveAmount = parseMoney(giveMoney)
  const getAmount = parseMoney(getMoney)

  let error: string | null = null
  if (toId === null) {
    error = 'Elige con quién quieres negociar.'
  } else if (giveAmount === null || getAmount === null) {
    error = 'El dinero debe ser un número entero.'
  } else if (giveAmount < 0 || getAmount < 0) {
    error = 'El dinero no puede ser negativo.'
  } else if (giveAmount > myMoney) {
    error = 'No tienes ese dinero.'
  } else if (getAmount > theirMoney) {
    error = 'El otro jugador no tiene ese dinero.'
  } else if (
    !giveTiles.every((tileId) => state.owners[tileId] === me.id) ||
    !getTiles.every((tileId) => state.owners[tileId] === toId)
  ) {
    error = 'Una propiedad cambió de dueño; revisa la selección.'
  } else if (
    giveTiles.length + getTiles.length + giveAmount + getAmount ===
    0
  ) {
    error = 'El intercambio está vacío.'
  }

  const canPropose = error === null && state.phase === 'waiting-roll'

  const propose = () => {
    if (!canPropose || toId === null) return
    dispatch({
      type: 'propose-trade',
      payload: {
        to: toId,
        giveTiles,
        getTiles,
        giveMoney: giveAmount ?? 0,
        getMoney: getAmount ?? 0,
      },
    })
  }

  const opponent = players.find((player) => player.id === toId)

  return (
    <div className="cp-prop-overlay" onClick={closeFromBackdrop}>
      <section
        className="cp-prop-panel cp-trade-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-trade-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cp-prop-head">
          <div className="cp-prop-head-text">
            <span className="cp-prop-eyebrow">Trato directo</span>
            <h2 id="cp-trade-title">Intercambio</h2>
          </div>
          <button
            className="cp-prop-close"
            type="button"
            aria-label="Cerrar intercambio"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="cp-prop-players" role="tablist" aria-label="Elegir jugador">
          {candidates.length === 0 ? (
            <p className="cp-trade-empty">No hay otros jugadores activos.</p>
          ) : (
            candidates.map((id) => {
              const player = players.find((candidate) => candidate.id === id)
              const active = id === toId
              return (
                <button
                  key={id}
                  className={`cp-prop-player${active ? ' is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => choosePlayer(id)}
                >
                  <span
                    className="avatar cp-prop-avatar"
                    style={{ backgroundColor: player?.color ?? '#999' }}
                    aria-hidden="true"
                  >
                    <Ficha emoji={player?.emoji ?? '🙂'} />
                  </span>
                  <span className="cp-prop-player-name">{nameOf(state, id)}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="cp-prop-body cp-trade-body">
          {toId === null ? (
            <div className="cp-prop-empty">
              <span className="cp-prop-empty-icon" aria-hidden="true">
                🤝
              </span>
              <strong>Elige un jugador</strong>
              <p>Selecciona arriba con quién quieres intercambiar cartas o dinero.</p>
            </div>
          ) : (
            <>
              <div className="cp-trade-columns">
                <TradeColumn
                  title="Tú ofreces"
                  ownerId={me.id}
                  ownerName="Tú"
                  balance={myMoney}
                  tiles={myTiles}
                  selected={giveTiles}
                  onToggle={(tileId) => setGiveTiles((list) => toggleTile(list, tileId))}
                  state={state}
                  hint="No tienes propiedades para ofrecer."
                />
                <TradeColumn
                  title="Tú recibes"
                  ownerId={toId}
                  ownerName={opponent?.name ?? nameOf(state, toId)}
                  balance={theirMoney}
                  tiles={theirTiles}
                  selected={getTiles}
                  onToggle={(tileId) => setGetTiles((list) => toggleTile(list, tileId))}
                  state={state}
                  hint={`${nameOf(state, toId)} no tiene propiedades.`}
                />
              </div>

              <div className="cp-trade-money-row">
                <label className="cp-trade-money">
                  <span>Dinero que ofreces</span>
                  <input
                    type="number"
                    min={0}
                    max={myMoney}
                    step={1}
                    inputMode="numeric"
                    placeholder="0"
                    value={giveMoney}
                    onChange={(event) => setGiveMoney(event.target.value)}
                  />
                  <small>Saldo: {moneyLabel(myMoney)}</small>
                </label>
                <label className="cp-trade-money">
                  <span>Dinero que recibes</span>
                  <input
                    type="number"
                    min={0}
                    max={theirMoney}
                    step={1}
                    inputMode="numeric"
                    placeholder="0"
                    value={getMoney}
                    onChange={(event) => setGetMoney(event.target.value)}
                  />
                  <small>Saldo: {moneyLabel(theirMoney)}</small>
                </label>
              </div>

              <div className="cp-trade-summary" aria-live="polite">
                <div className="cp-trade-summary-side">
                  <span className="cp-trade-summary-label">Das</span>
                  <strong>{sideSummary(giveTiles, giveAmount ?? 0)}</strong>
                </div>
                <div className="cp-trade-summary-side">
                  <span className="cp-trade-summary-label">Recibes</span>
                  <strong>{sideSummary(getTiles, getAmount ?? 0)}</strong>
                </div>
              </div>

              <div className="cp-trade-actions">
                <p className="cp-trade-note" role="status">
                  {error ?? `Propuesta para ${nameOf(state, toId)}.`}
                </p>
                <div className="actions">
                  <button className="ghost" type="button" onClick={onClose}>
                    Cancelar
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={!canPropose}
                    onClick={propose}
                  >
                    Proponer
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function ProposalColumn({
  title,
  tiles,
  money,
  state,
}: {
  title: string
  tiles: number[]
  money: number
  state: CucupolyState
}) {
  return (
    <section className="cp-trade-column">
      <header className="cp-trade-column-head">
        <h3>{title}</h3>
        {money > 0 ? <span>{moneyLabel(money)}</span> : <span>Sin dinero</span>}
      </header>
      {tiles.length === 0 ? (
        <p className="cp-trade-empty">Sin propiedades en este lado.</p>
      ) : (
        <div className="cp-prop-grid cp-trade-grid">
          {tiles.map((tileId) => {
            const tile = BOARD[tileId]
            if (!tile) return null
            return (
              <PropertyCard
                key={tileId}
                propiedad={tile}
                nivel={state.buildings[tileId] ?? 0}
                compact
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Ventana de propuesta. El receptor puede aceptar o rechazar sin esperar su
 * turno; el proponente puede cancelar. El tercero con Caída de red conserva su
 * veto antes de que la propuesta llegue al receptor.
 */
export function TradeProposal({ state, me, players, dispatch }: TradeProps) {
  const trade = state.phase === 'trade' ? state.trade : null
  if (!trade) return null

  const isFrom = trade.from === me.id
  const isTo = trade.to === me.id
  const isVetoer = trade.vetoer === me.id
  if (!isFrom && !isTo && !isVetoer) return null

  const vetoing = trade.stage === 'veto'
  const offered = trade.giveTiles
  const requested = trade.getTiles

  const offeredLabel = isTo ? 'Recibes' : isFrom ? 'Das' : `Pone ${nameOf(state, trade.from)}`
  const requestedLabel = isTo ? 'Das' : isFrom ? 'Recibes' : `Pone ${nameOf(state, trade.to)}`

  const title = vetoing
    ? 'Caída de red'
    : isTo
      ? `Propuesta de ${nameOf(state, trade.from)}`
      : isFrom
        ? `Esperando respuesta de ${nameOf(state, trade.to)}…`
        : 'Trato autorizado'

  const subtitle = vetoing
    ? `${nameOf(state, trade.vetoer)} revisa el trato entre ${nameOf(state, trade.from)} y ${nameOf(state, trade.to)}.`
    : isTo
      ? `${nameOf(state, trade.from)} te propone un intercambio.`
      : isFrom
        ? 'Tu propuesta está abierta. Puedes retirarla.'
        : 'Ya dejaste pasar el trato; falta la respuesta del receptor.'

  return (
    <div className="cp-prop-overlay">
      <section
        className="cp-prop-panel cp-trade-panel cp-trade-proposal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-trade-proposal-title"
      >
        <header className="cp-prop-head">
          <div className="cp-prop-head-text">
            <span className="cp-prop-eyebrow">
              {vetoing ? 'Vigilancia' : 'Trato pendiente'}
            </span>
            <h2 id="cp-trade-proposal-title">{title}</h2>
            <p className="cp-trade-subtitle">{subtitle}</p>
          </div>
        </header>

        <div className="cp-prop-body cp-trade-body">
          <div className="cp-trade-columns">
            <ProposalColumn
              title={offeredLabel}
              tiles={offered}
              money={trade.giveMoney}
              state={state}
            />
            <ProposalColumn
              title={requestedLabel}
              tiles={requested}
              money={trade.getMoney}
              state={state}
            />
          </div>

          {vetoing ? (
            <div className="cp-trade-actions">
              <p className="cp-trade-note" role="status">
                {isVetoer
                  ? 'Puedes vetar el trato o dejar que siga al receptor.'
                  : `Esperando la decisión de ${nameOf(state, trade.vetoer)}…`}
              </p>
              <div className="actions">
                {isFrom ? (
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => dispatch({ type: 'cancel-trade' })}
                  >
                    Cancelar propuesta
                  </button>
                ) : null}
                {isVetoer ? (
                  <>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => dispatch({ type: 'veto-trade' })}
                    >
                      Vetar
                    </button>
                    <button
                      className="primary"
                      type="button"
                      onClick={() => dispatch({ type: 'allow-trade' })}
                    >
                      Dejar pasar
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : isTo ? (
            <div className="cp-trade-actions">
              <p className="cp-trade-note" role="status">
                Acepta solo si el trato te parece justo.
              </p>
              <div className="actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => dispatch({ type: 'reject-trade' })}
                >
                  Rechazar
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={() => dispatch({ type: 'accept-trade' })}
                >
                  Aceptar
                </button>
              </div>
            </div>
          ) : isFrom ? (
            <div className="cp-trade-actions">
              <p className="cp-trade-note" role="status">
                Esperando respuesta de {nameOf(state, trade.to)}…
              </p>
              <div className="actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => dispatch({ type: 'cancel-trade' })}
                >
                  Cancelar propuesta
                </button>
              </div>
            </div>
          ) : (
            <p className="cp-trade-note" role="status">
              {players.find((player) => player.id === trade.to)?.name ??
                nameOf(state, trade.to)}{' '}
              decide si acepta.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
