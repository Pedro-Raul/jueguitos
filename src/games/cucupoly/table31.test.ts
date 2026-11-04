import { describe, expect, it } from 'vitest'
import { parseTable31Private, table31Transfers } from './table31'
import { RULES } from './rules.config'

describe('mesa de 31: datos privados', () => {
  it('acepta solo la forma { table31: { tableKey, cards } }', () => {
    expect(parseTable31Private(null)).toBeNull()
    expect(parseTable31Private({ cards: [1] })).toBeNull()
    expect(parseTable31Private({ table31: { tableKey: '', cards: [] } })).toBeNull()
    expect(parseTable31Private({ table31: { tableKey: 'k', cards: [0] } })).toBeNull()
    expect(
      parseTable31Private({
        table31: { tableKey: 'k', cards: [RULES.table31CardMax + 1] },
      }),
    ).toBeNull()
    expect(parseTable31Private({ table31: { tableKey: 'k', cards: [1, 2] } })).toEqual({
      tableKey: 'k',
      cards: [1, 2],
    })
  })
})

describe('mesa de 31: reparto visual', () => {
  it('conserva exactamente las apuestas y los premios', () => {
    const transfers = table31Transfers(
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
