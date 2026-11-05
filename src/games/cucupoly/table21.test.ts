import { describe, expect, it } from 'vitest'
import { parseTable21Private, table21Transfers } from './table21'
import { RULES } from './rules.config'

describe('mesa de 21: datos privados', () => {
  it('acepta solo la forma { table21: { tableKey, cards } }', () => {
    expect(parseTable21Private(null)).toBeNull()
    expect(parseTable21Private({ cards: [1] })).toBeNull()
    expect(parseTable21Private({ table21: { tableKey: '', cards: [] } })).toBeNull()
    expect(parseTable21Private({ table21: { tableKey: 'k', cards: [0] } })).toBeNull()
    expect(
      parseTable21Private({
        table21: { tableKey: 'k', cards: [RULES.table21CardMax + 1] },
      }),
    ).toBeNull()
    expect(parseTable21Private({ table21: { tableKey: 'k', cards: [1, 2] } })).toEqual({
      tableKey: 'k',
      cards: [1, 2],
    })
  })
})

describe('mesa de 21: reparto visual', () => {
  it('conserva exactamente las apuestas y los premios', () => {
    const transfers = table21Transfers(
      ['p1', 'p2', 'p3'],
      { p1: 50, p2: 30, p3: 20 },
      ['p2', 'p3'],
      { p2: 60, p3: 40 },
    )
    const paid: Record<string, number> = {}
    const won: Record<string, number> = {}

    for (const transfer of transfers) {
      if (transfer.from) {
        paid[transfer.from] = (paid[transfer.from] ?? 0) + transfer.amount
      }
      won[transfer.to] = (won[transfer.to] ?? 0) + transfer.amount
    }

    expect(paid).toEqual({ p1: 50, p2: 30, p3: 20 })
    expect(won).toEqual({ p2: 60, p3: 40 })
  })
})
