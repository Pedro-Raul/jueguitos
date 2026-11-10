import { describe, expect, it } from 'vitest'
import {
  SLOT_BETS,
  SLOT_MAX_BET,
  SLOT_MIN_BET,
  SLOT_PRIZES,
  SLOT_REEL,
  SLOT_SYMBOLS,
  SLOT_TRIPLE_MULTIPLIERS,
  slotEmoji,
  slotLabel,
  slotPayout,
  spinSlotReels,
  type SlotSymbolId,
} from './slot'

const SYMBOLS = Object.keys(SLOT_SYMBOLS) as SlotSymbolId[]

describe('tragamonedas: apuestas', () => {
  it('ofrece apuestas dentro del mínimo y el máximo', () => {
    expect(SLOT_MIN_BET).toBeGreaterThan(0)
    expect(SLOT_MAX_BET).toBe(Math.max(...SLOT_BETS))
    expect(SLOT_BETS).toEqual([5, 10, 25, 50])
    expect(SLOT_BETS.every((bet) => bet >= SLOT_MIN_BET && bet <= SLOT_MAX_BET)).toBe(true)
  })
})

describe('tragamonedas: rodillos', () => {
  it('solo devuelve símbolos de la bolsa', () => {
    const reels = spinSlotReels((min, max) => {
      expect(min).toBe(0)
      expect(max).toBe(SLOT_REEL.length - 1)
      return max
    })
    expect(reels).toHaveLength(3)
    reels.forEach((symbol) => expect(SLOT_REEL).toContain(symbol))
    expect(reels).toEqual([SLOT_REEL[SLOT_REEL.length - 1], SLOT_REEL[SLOT_REEL.length - 1], SLOT_REEL[SLOT_REEL.length - 1]])
  })

  it('es determinista con la misma secuencia del RNG', () => {
    const queue = [0, 3, 6]
    const randomInt = () => queue.shift() ?? 0
    expect(spinSlotReels(randomInt)).toEqual([SLOT_REEL[0], SLOT_REEL[3], SLOT_REEL[6]])
  })
})

describe('tragamonedas: premios', () => {
  it('paga tres iguales según la tabla', () => {
    for (const symbol of SYMBOLS) {
      const outcome = slotPayout([symbol, symbol, symbol], 10)
      expect(outcome.multiplier).toBe(SLOT_TRIPLE_MULTIPLIERS[symbol])
      expect(outcome.payout).toBe(10 * SLOT_TRIPLE_MULTIPLIERS[symbol])
    }
  })

  it('paga el doble con dos cerezas en cualquier orden', () => {
    const orders: SlotSymbolId[][] = [
      ['cherry', 'cherry', 'bell'],
      ['bell', 'cherry', 'cherry'],
      ['cherry', 'bell', 'cherry'],
    ]
    for (const reels of orders) {
      expect(slotPayout(reels, 10)).toMatchObject({ multiplier: 2, payout: 20 })
    }
  })

  it('devuelve la apuesta con cualquier otra pareja', () => {
    const orders: SlotSymbolId[][] = [
      ['lemon', 'lemon', 'bell'],
      ['star', 'bell', 'star'],
      ['diamond', 'seven', 'diamond'],
    ]
    for (const reels of orders) {
      expect(slotPayout(reels, 25)).toMatchObject({ multiplier: 1, payout: 25 })
    }
  })

  it('no paga nada con tres símbolos distintos', () => {
    expect(slotPayout(['cherry', 'lemon', 'bell'], 50)).toMatchObject({
      multiplier: 0,
      payout: 0,
      label: 'Sin premio',
    })
  })

  it('no paga con una apuesta inválida o vacía', () => {
    expect(slotPayout(['diamond', 'diamond', 'diamond'], 0).payout).toBe(0)
    expect(slotPayout(['diamond', 'diamond', 'diamond'], -10).payout).toBe(0)
    expect(slotPayout(['diamond', 'diamond', 'diamond'], Number.NaN).payout).toBe(0)
  })

  it('redondea apuestas fraccionarias antes de pagar', () => {
    expect(slotPayout(['lemon', 'lemon', 'lemon'], 10.9)).toMatchObject({
      multiplier: 5,
      payout: 50,
    })
  })

  it('la tabla visible coincide con los multiplicadores reales', () => {
    const hands: Record<string, SlotSymbolId[]> = {
      'Tres diamantes': ['diamond', 'diamond', 'diamond'],
      'Tres sietes': ['seven', 'seven', 'seven'],
      'Tres estrellas': ['star', 'star', 'star'],
      'Tres campanas': ['bell', 'bell', 'bell'],
      'Tres limones': ['lemon', 'lemon', 'lemon'],
      'Tres cerezas': ['cherry', 'cherry', 'cherry'],
      'Dos cerezas': ['cherry', 'cherry', 'bell'],
      'Cualquier pareja': ['lemon', 'lemon', 'bell'],
    }
    for (const prize of SLOT_PRIZES) {
      const hand = hands[prize.label]
      expect(hand, prize.label).toBeDefined()
      expect(slotPayout(hand ?? [], 1).multiplier, prize.label).toBe(prize.multiplier)
    }
  })
})

describe('tragamonedas: símbolos', () => {
  it('cada símbolo tiene emoji y etiqueta', () => {
    for (const symbol of SYMBOLS) {
      expect(slotEmoji(symbol)).toBe(SLOT_SYMBOLS[symbol].emoji)
      expect(slotLabel(symbol)).toBe(SLOT_SYMBOLS[symbol].label)
      expect(slotEmoji(symbol).length).toBeGreaterThan(0)
    }
  })
})
