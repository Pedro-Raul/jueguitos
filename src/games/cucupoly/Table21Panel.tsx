import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Ficha } from '../../components/Ficha'
import type { GameAction, Player } from '../../types'
import { subscribeHostActions } from '../../net/hostActions'
import type { CucupolyState } from './engine'
import { RULES } from './rules.config'
import {
  drawTable21Card,
  parseTable21Private,
  table21Total,
  type Table21Settlement,
  type Table21Transfer,
} from './table21'
import {
  REVEAL_HOLD_MS,
  TABLE21_COUNT_MS,
  TABLE21_DEAL_MS,
  TABLE21_PAYOUT_MS,
} from './timing'

type Props = {
  state: CucupolyState
  me: Player
  players: Player[]
  dispatch: (action: GameAction) => void
  privateData?: unknown
  sendPrivate?: (targetId: string, data: unknown) => void
}

type Coin = {
  key: string
  amount: number
  x: number
  y: number
  dx: number
  dy: number
  delay: number
}

function money(value: number): string {
  return `$${value}`
}

function nameOf(state: CucupolyState, id: string): string {
  return state.names[id] ?? id
}

function sum(cards: readonly number[]): number {
  return table21Total(cards)
}

/** Transferencias visibles: los autopagos salen del pozo para no volar a sí mismos. */
function visibleTransfers(settlement: Table21Settlement): Table21Transfer[] {
  return settlement.transfers
    .filter((transfer) => transfer.amount > 0)
    .map((transfer) =>
      transfer.from === transfer.to ? { ...transfer, from: null } : transfer,
    )
}

export function Table21Panel({
  state,
  me,
  players,
  dispatch,
  privateData,
  sendPrivate,
}: Props) {
  const table = state.table21
  const isHost = state.order[0] === me.id
  const participantKey = table?.participants.join('|') ?? ''
  const tableKey = table
    ? `${state.roundNumber}:${state.turnNumber}:${participantKey}`
    : ''
  const pendingKey = table?.pendingDraws.join('|') ?? ''
  const readyKey = table?.ready.join('|') ?? ''
  const countsKey = table
    ? Object.entries(table.cardCounts)
        .map(([id, count]) => `${id}:${count}`)
        .join('|')
    : ''

  const [bet, setBet] = useState('')
  const [revealPhase, setRevealPhase] = useState<'hold' | 'payout'>('hold')
  const [countProgress, setCountProgress] = useState(1)
  const [coins, setCoins] = useState<Coin[]>([])
  const handsRef = useRef<Record<string, number[]>>({})
  const playerRefs = useRef(new Map<string, HTMLDivElement>())
  const potRef = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  const lastTableKey = useRef('')

  // Una mesa nueva empieza con las manos privadas vacías.
  useEffect(() => {
    if (!table || table.stage !== 'bets') return
    if (lastTableKey.current === tableKey) return
    lastTableKey.current = tableKey
    handsRef.current = {}
  }, [table?.stage, tableKey])

  // El anfitrión mantiene las manos fuera del estado público. Solo apunta una
  // carta cuando el reducer confirma el reparto, para que la mano privada y el
  // conteo público nunca se desincronicen.
  useEffect(() => {
    if (!isHost) return
    return subscribeHostActions(({ action, ok }) => {
      if (!ok || action.type !== 'deal-card') return
      const payload = action.payload
      if (typeof payload !== 'object' || payload === null) return
      const target = (payload as Record<string, unknown>).playerId
      const card = (payload as Record<string, unknown>).card
      if (typeof target !== 'string') return
      if (typeof card !== 'number' || !Number.isInteger(card)) return
      handsRef.current[target] = [...(handsRef.current[target] ?? []), card]
    })
  }, [isHost])

  // Solicitud de carta → el anfitrión sortea la carta fuera del reducer.
  useEffect(() => {
    if (!isHost || !table || table.stage !== 'draw') return
    const target = table.pendingDraws[0]
    if (!target) return
    if (table.ready.includes(target)) return
    const card = drawTable21Card()
    const total = sum([...(handsRef.current[target] ?? []), card])
    dispatch({
      type: 'deal-card',
      payload: { playerId: target, card, total },
    })
  }, [isHost, table?.stage, pendingKey, dispatch])

  // Cada asiento recibe solo su mano. Los demás solo ven el conteo público.
  useEffect(() => {
    if (!isHost || !table || !sendPrivate || table.stage !== 'draw') return
    for (const id of table.participants) {
      if (id === me.id) continue
      sendPrivate(id, {
        table21: { tableKey, cards: [...(handsRef.current[id] ?? [])] },
      })
    }
  }, [
    isHost,
    sendPrivate,
    table?.stage,
    tableKey,
    participantKey,
    countsKey,
    players,
    me.id,
  ])

  // Todos listos → el anfitrión revela todas las manos de una sola vez.
  useEffect(() => {
    if (!isHost || !table || table.stage !== 'draw') return
    if (table.participants.length === 0) return
    if (!table.participants.every((id) => table.ready.includes(id))) return

    const hands: Record<string, number> = {}
    const cards: Record<string, number[]> = {}
    for (const id of table.participants) {
      const hand = [...(handsRef.current[id] ?? [])]
      cards[id] = hand
      hands[id] = sum(hand)
    }
    dispatch({ type: 'reveal-table', payload: { hands, cards } })
  }, [isHost, table?.stage, participantKey, readyKey, dispatch])

  // La revelación se mantiene REVEAL_HOLD_MS; después corren las monedas.
  useEffect(() => {
    if (!table || table.stage !== 'reveal') return
    setRevealPhase('hold')
    setCoins([])
    const hold = window.setTimeout(() => {
      setRevealPhase('payout')
      if (isHost) {
        settleTimer.current = window.setTimeout(() => {
          dispatch({ type: 'settle-table' })
        }, TABLE21_PAYOUT_MS)
      }
    }, REVEAL_HOLD_MS)
    return () => {
      window.clearTimeout(hold)
      if (settleTimer.current !== undefined) {
        window.clearTimeout(settleTimer.current)
        settleTimer.current = undefined
      }
    }
  }, [table?.stage, isHost, dispatch])

  // Conteo ascendente de la suma al revelar.
  useEffect(() => {
    if (!table || table.stage !== 'reveal') return
    setCountProgress(0)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / TABLE21_COUNT_MS)
      setCountProgress(progress)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [table?.stage])

  // Mide el pozo y cada asiento para que las monedas vuelen de verdad.
  useLayoutEffect(() => {
    if (!table || table.stage !== 'reveal' || revealPhase !== 'payout' || !table.settlement) {
      setCoins([])
      return
    }
    const pot = potRef.current?.getBoundingClientRect()
    if (!pot) return
    const transfers = visibleTransfers(table.settlement)
    const next: Coin[] = []

    transfers.forEach((transfer, index) => {
      const target = playerRefs.current.get(transfer.to)
      if (!target) return
      const payer = transfer.from ? playerRefs.current.get(transfer.from) : null
      const source = payer ? payer.getBoundingClientRect() : pot
      const originX = source.left + source.width / 2
      const originY = source.top + source.height / 2
      const rect = target.getBoundingClientRect()
      next.push({
        key: `${transfer.from ?? 'pot'}-${transfer.to}-${index}`,
        amount: transfer.amount,
        x: originX,
        y: originY,
        dx: rect.left + rect.width / 2 - originX,
        dy: rect.top + rect.height / 2 - originY,
        delay: Math.min(index * 50, 300),
      })
    })
    setCoins(next)
  }, [table?.stage, revealPhase, table?.settlement])

  if (!table) return null

  const parsedPrivate = parseTable21Private(privateData)
  const myCards =
    table.stage === 'reveal'
      ? []
      : isHost
        ? handsRef.current[me.id] ?? []
        : parsedPrivate && parsedPrivate.tableKey === tableKey
          ? parsedPrivate.cards
          : []
  const myTotal = sum(myCards)
  const isSpectator = state.bankrupt.includes(me.id)
  const myReady = !isSpectator && table.ready.includes(me.id)
  const myPending = !isSpectator && table.pendingDraws.includes(me.id)
  const myMoney = state.money[me.id] ?? 0
  const maxBet = Math.min(RULES.table21BetLimit, myMoney)
  const betValue = Number(bet)
  const betValid =
    bet !== '' && Number.isInteger(betValue) && betValue >= 1 && betValue <= maxBet
  const reveal = table.reveal
  const settlement = table.settlement
  const shownPot =
    table.stage === 'bets'
      ? Object.values(table.bets).reduce((total, amount) => total + amount, 0)
      : table.pot

  const paceStyle = {
    '--cp21-deal': `${TABLE21_DEAL_MS}ms`,
    '--cp21-count': `${TABLE21_COUNT_MS}ms`,
    '--cp21-payout': `${TABLE21_PAYOUT_MS}ms`,
  } as CSSProperties

  return (
    <div className="cp-action-backdrop cp-table21-backdrop">
      <section
        className={`cp-action-card cp-table21 is-${table.stage}`}
        style={paceStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Mesa de 21"
      >
        <header className="cp-action-head cp-table21-head">
          <span className="cp-action-icon" aria-hidden="true">
            🃏
          </span>
          <div>
            <span className="cp-eyebrow">Mesa de 21</span>
            <h2>
              {table.stage === 'bets'
                ? 'Apuestas'
                : table.stage === 'draw'
                  ? 'Cartas a la mesa'
                  : 'Revelación'}
            </h2>
          </div>
          <div className="cp-table21-pot" ref={potRef}>
            <span aria-hidden="true">🪙</span>
            <span>Pozo</span>
            <strong>{money(shownPot)}</strong>
          </div>
        </header>

        {table.stage === 'bets' ? (
          <>
            <p className="cp-table21-lead">
              Todos apuestan a la vez. Apuesta hasta {money(RULES.table21BetLimit)}.
            </p>
            {!isSpectator && table.pendingBets.includes(me.id) ? (
              <div className="cp-table21-bet">
                <input
                  type="number"
                  min={1}
                  max={maxBet}
                  value={bet}
                  placeholder="Apuesta"
                  aria-label="Apuesta de la mesa de 21"
                  onChange={(event) => setBet(event.target.value)}
                />
                <div className="actions">
                  <button
                    className="primary"
                    type="button"
                    disabled={!betValid}
                    onClick={() => {
                      dispatch({ type: 'join-table', payload: { bet: betValue } })
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
              </div>
            ) : (
              <p className="muted small">Esperando decisiones…</p>
            )}

            <ul className="cp-table21-bet-list">
              {state.order
                .filter((id) => !state.bankrupt.includes(id))
                .map((id) => {
                  const isParticipant = table.participants.includes(id)
                  const isPending = table.pendingBets.includes(id)
                  return (
                    <li key={id}>
                      <span>{nameOf(state, id)}</span>
                      <strong>
                        {isParticipant
                          ? `Apostó ${money(table.bets[id] ?? 0)}`
                          : isPending
                            ? 'Decidiendo…'
                            : 'No juega'}
                      </strong>
                    </li>
                  )
                })}
            </ul>
          </>
        ) : (
          <>
            <div className="cp-table21-players">
              {table.participants.map((id) => {
                const player = players.find((candidate) => candidate.id === id)
                const isMe = id === me.id
                const count = table.cardCounts[id] ?? 0
                const isRevealed = table.stage === 'reveal' && reveal !== null
                const cards =
                  isRevealed && reveal ? reveal.cards[id] ?? [] : isMe ? myCards : []
                const total =
                  isRevealed && reveal
                    ? reveal.hands[id] ?? 0
                    : isMe
                      ? myTotal
                      : null
                const ready = table.ready.includes(id)
                const busted = isRevealed && reveal ? reveal.busted.includes(id) : false
                const winner =
                  isRevealed &&
                  settlement !== null &&
                  !settlement.allBusted &&
                  settlement.winnerIds.includes(id)

                return (
                  <div
                    key={id}
                    ref={(element) => {
                      if (element) playerRefs.current.set(id, element)
                      else playerRefs.current.delete(id)
                    }}
                    className={`cp-table21-player${isMe ? ' is-me' : ''}${
                      busted ? ' is-busted' : ''
                    }${winner ? ' is-winner' : ''}`}
                  >
                    <div className="cp-table21-player-head">
                      <span
                        className="avatar"
                        style={{ backgroundColor: player?.color ?? '#999' }}
                      >
                        <Ficha emoji={player?.emoji ?? '🙂'} />
                      </span>
                      <span className="cp-table21-name">
                        {nameOf(state, id)}
                        {isMe ? ' (tú)' : ''}
                      </span>
                      {ready ? <span className="cp-table21-ready">Listo</span> : null}
                    </div>

                    <div className="cp-table21-cards">
                      {isRevealed ? (
                        cards.length > 0 ? (
                          cards.map((card, index) => (
                            <span key={`${index}-${card}`} className="cp-card is-revealed">
                              {card}
                            </span>
                          ))
                        ) : (
                          <span className="cp-table21-empty">Sin cartas</span>
                        )
                      ) : isMe ? (
                        myCards.length > 0 ? (
                          myCards.map((card, index) => (
                            <span key={`${index}-${card}`} className="cp-card is-mine">
                              {card}
                            </span>
                          ))
                        ) : (
                          <span className="cp-table21-empty">Sin cartas</span>
                        )
                      ) : (
                        <>
                          {Array.from({ length: Math.min(count, 5) }, (_, index) => (
                            <span key={index} className="cp-card-back" />
                          ))}
                          {count > 0 ? (
                            <span className="cp-table21-count">
                              {count} {count === 1 ? 'carta' : 'cartas'}
                            </span>
                          ) : (
                            <span className="cp-table21-empty">Sin cartas</span>
                          )}
                        </>
                      )}
                    </div>

                    {isRevealed ? (
                      <div className="cp-table21-total">
                        <strong>{Math.round((total ?? 0) * countProgress)}</strong>
                        {busted ? <span className="cp-table21-busted">Pasado</span> : null}
                        {winner ? <span className="cp-table21-winner">Ganador</span> : null}
                      </div>
                    ) : isMe ? (
                      <div className="cp-table21-total">
                        <strong>{myTotal}</strong>
                        {myTotal > RULES.table21Target ? (
                          <span className="cp-table21-busted">Te pasaste</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {table.stage === 'draw' && !isSpectator ? (
              <div className="cp-table21-actions">
                {myReady ? (
                  <p className="muted small">Listo. Esperando a los demás…</p>
                ) : myPending ? (
                  <p className="muted small">Repartiendo…</p>
                ) : (
                  <div className="actions">
                    <button
                      className="primary"
                      type="button"
                      onClick={() => dispatch({ type: 'draw-card' })}
                    >
                      Pedir carta
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => dispatch({ type: 'stand' })}
                    >
                      Plantarse
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {table.stage === 'reveal' && settlement ? (
              <div className="cp-table21-result">
                {settlement.allBusted ? (
                  <p>Todos se pasaron: cada jugador recupera su apuesta.</p>
                ) : (
                  <p>
                    Gana(n){' '}
                    {settlement.winnerIds
                      .map((id) => nameOf(state, id))
                      .join(', ')}{' '}
                    con {settlement.best}. Pozo {money(settlement.pot)}.
                  </p>
                )}
                <ul className="cp-table21-payouts">
                  {settlement.payouts
                    .filter((payout) => payout.amount > 0)
                    .map((payout) => (
                      <li key={payout.to}>
                        <span>{nameOf(state, payout.to)}</span>
                        <strong>+{money(payout.amount)}</strong>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      {coins.length > 0 ? (
        <div className="cp-table21-coins" aria-hidden="true">
          {coins.map((coin) => (
            <span
              key={coin.key}
              className="cp-table21-coin"
              style={
                {
                  left: coin.x,
                  top: coin.y,
                  '--cp21-dx': `${coin.dx}px`,
                  '--cp21-dy': `${coin.dy}px`,
                  animationDelay: `${coin.delay}ms`,
                  animationDuration: `${TABLE21_PAYOUT_MS - 400}ms`,
                } as CSSProperties
              }
            >
              +{money(coin.amount)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
