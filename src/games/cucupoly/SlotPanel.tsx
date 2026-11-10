import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Ficha } from '../../components/Ficha'
import type { GameAction, Player } from '../../types'
import type { CucupolyState } from './engine'
import {
  SLOT_BETS,
  SLOT_MAX_BET,
  SLOT_PRIZES,
  SLOT_REEL,
  slotEmoji,
  type SlotState,
  type SlotSymbolId,
} from './slot'
import { SLOT_FLICKER_MS, SLOT_SPIN_MS } from './timing'

type Props = {
  state: CucupolyState
  slot: SlotState
  me: Player
  players: Player[]
  dispatch: (action: GameAction) => void
}

function money(value: number): string {
  return `$${value}`
}

const IDLE_REELS: SlotSymbolId[] = ['cherry', 'bell', 'diamond']

/**
 * Máquina tragamonedas del «Sitio de apuestas». La animación es solo
 * presentación: el giro lo resuelve el reducer del anfitrión y el resultado
 * llega en el snapshot.
 */
export function SlotPanel({ state, slot, me, players, dispatch }: Props) {
  const isHost = state.order[0] === me.id
  const isSpinner = slot.playerId === me.id
  const spinner = players.find((player) => player.id === slot.playerId)
  const spinnerName = spinner?.name ?? state.names[slot.playerId] ?? slot.playerId
  const balance = state.money[slot.playerId] ?? 0

  const [betChoice, setBetChoice] = useState<number>(SLOT_BETS[0])
  const [flicker, setFlicker] = useState(0)
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const affordable = SLOT_BETS.filter((amount) => amount <= balance)
  const activeBet = affordable.some((amount) => amount === betChoice)
    ? betChoice
    : affordable[affordable.length - 1] ?? 0
  const spinning = slot.stage === 'spinning'
  const result = slot.stage === 'result'
  const win = result && slot.payout > 0
  const jackpot = result && slot.multiplier >= 25
  const canSpin = isSpinner && !spinning && activeBet > 0
  const spinnerDisconnected = !isSpinner && spinner?.connected === false

  // El anfitrión deja girar los rodillos el tiempo de la animación y luego
  // resuelve el giro una sola vez. Los invitados solo ven el snapshot.
  useEffect(() => {
    if (!isHost || slot.stage !== 'spinning') return
    const timer = window.setTimeout(() => {
      dispatch({ type: 'settle-slot' })
    }, SLOT_SPIN_MS)
    return () => window.clearTimeout(timer)
  }, [isHost, slot.stage, slot.spinSeq, dispatch])

  // Símbolos que se suceden mientras giran. Con movimiento reducido se queda
  // una imagen fija y el resultado aparece al terminar.
  useEffect(() => {
    if (slot.stage !== 'spinning' || reducedMotionRef.current) return
    const timer = window.setInterval(() => {
      setFlicker((value) => value + 1)
    }, SLOT_FLICKER_MS)
    return () => window.clearInterval(timer)
  }, [slot.stage, slot.spinSeq])

  const reels: Array<SlotSymbolId | null> = spinning
    ? [0, 1, 2].map(
        (index) => SLOT_REEL[(flicker + index * 4) % SLOT_REEL.length],
      )
    : result && slot.reels
      ? slot.reels
      : IDLE_REELS

  const reelsLabel = spinning
    ? 'Rodillos girando'
    : result && slot.reels
      ? `Resultado: ${slot.reels.map(slotEmoji).join(', ')}`
      : 'Tragamonedas lista para girar'

  const message = spinning
    ? 'Girando…'
    : result
      ? slot.payout === 0
        ? 'Esta vez no hubo premio.'
        : slot.multiplier === 1
          ? `Recuperas tu apuesta de ${money(slot.bet)}.`
          : `¡Ganaste ${money(slot.payout)}! ×${slot.multiplier} tu apuesta.`
      : isSpinner
        ? 'Elige una apuesta y gira los rodillos.'
        : `${spinnerName} está eligiendo su apuesta…`

  return (
    <div className="cp-action-backdrop cp-slot-backdrop">
      <section
        className={`cp-action-card cp-slot${spinning ? ' is-spinning' : ''}${
          result ? ' is-result' : ''
        }${win ? ' is-win' : ''}${jackpot ? ' is-jackpot' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Tragamonedas del Sitio de apuestas"
      >
        <header className="cp-slot-head">
          <span className="cp-slot-badge" aria-hidden="true">
            🎰
          </span>
          <div className="cp-slot-titles">
            <span className="cp-eyebrow">Sitio de apuestas</span>
            <h2>Tragamonedas</h2>
          </div>
          <div className="cp-slot-wallet">
            <span className="cp-slot-wallet-label">
              {isSpinner ? 'Tu saldo' : `Saldo de ${spinnerName}`}
            </span>
            <strong>{money(balance)}</strong>
          </div>
        </header>

        <div className="cp-slot-cabinet">
          <div className="cp-slot-marquee" aria-hidden="true">
            <span className="cp-slot-marquee-text">TRAGAMONEDAS</span>
            <span className="cp-slot-lights">
              {Array.from({ length: 9 }, (_, index) => (
                <i key={index} />
              ))}
            </span>
          </div>

          <div className="cp-slot-window" role="img" aria-label={reelsLabel}>
            <span className="cp-slot-payline" aria-hidden="true" />
            {reels.map((symbol, index) => (
              <span
                key={`${slot.spinSeq}-${slot.stage}-${index}`}
                className="cp-slot-reel"
                aria-hidden="true"
              >
                <span className="cp-slot-reel-symbol">
                  {symbol ? slotEmoji(symbol) : '?'}
                </span>
              </span>
            ))}
          </div>

          <p className="cp-slot-message" role="status" aria-live="polite">
            {message}
          </p>

          {win ? (
            <div className="cp-slot-sparks" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <span
                  key={`${slot.spinSeq}-${index}`}
                  style={{ '--cp-slot-i': index } as CSSProperties}
                >
                  {jackpot ? '💎' : '🪙'}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {isSpinner ? (
          <div className="cp-slot-controls">
            <div className="cp-slot-bets" role="group" aria-label="Apuesta por giro">
              {SLOT_BETS.map((amount) => {
                const selected = amount === activeBet
                return (
                  <button
                    key={amount}
                    className={`cp-slot-chip${selected ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Apostar ${money(amount)}`}
                    disabled={amount > balance || spinning}
                    onClick={() => setBetChoice(amount)}
                  >
                    {money(amount)}
                  </button>
                )
              })}
            </div>

            <div className="cp-slot-actions">
              <button
                className="primary cp-slot-spin"
                type="button"
                disabled={!canSpin}
                onClick={() =>
                  dispatch({ type: 'spin-slot', payload: { bet: activeBet } })
                }
              >
                {result ? 'Girar otra vez' : 'Girar'}
              </button>
              <button
                className="ghost"
                type="button"
                disabled={spinning}
                onClick={() => dispatch({ type: 'leave-slot' })}
              >
                Irse
              </button>
            </div>

            <p className="cp-slot-note">
              {affordable.length === 0
                ? 'No te queda saldo para apostar. Pulsa Irse para cerrar el turno.'
                : `Apuesta máxima ${money(SLOT_MAX_BET)} por giro. La casa paga según la tabla.`}
            </p>
          </div>
        ) : (
          <div className="cp-slot-waiting">
            <span className="avatar" style={{ backgroundColor: spinner?.color ?? '#999' }}>
              <Ficha emoji={spinner?.emoji ?? '🙂'} />
            </span>
            <p>
              Turno de <strong>{spinnerName}</strong>
              {spinning ? ' · girando…' : '…'}
            </p>
            {isHost && spinnerDisconnected && !spinning ? (
              <button
                className="ghost"
                type="button"
                onClick={() => dispatch({ type: 'leave-slot' })}
              >
                Cerrar mesa y pasar turno
              </button>
            ) : null}
          </div>
        )}

        <details className="cp-slot-paytable" open>
          <summary>Premios por cada $1 apostado</summary>
          <ul>
            {SLOT_PRIZES.map((prize) => (
              <li key={prize.label}>
                <span className="cp-slot-prize-symbols" aria-hidden="true">
                  {prize.emoji}
                </span>
                <span>{prize.label}</span>
                <strong>×{prize.multiplier}</strong>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  )
}
