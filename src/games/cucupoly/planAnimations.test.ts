import { describe, expect, it } from 'vitest'
import type { CucupolyState, LogEntry } from './engine'
import { planAnimations, snapshotSeen } from './planAnimations'

type Overrides = Partial<CucupolyState>

function makeState(overrides: Overrides = {}): CucupolyState {
  return {
    seed: 1,
    names: { p1: 'Ana', p2: 'Beto' },
    order: ['p1', 'p2'],
    turnOrder: ['p1', 'p2'],
    turnOrderState: null,
    currentIndex: 0,
    turnNumber: 0,
    roundNumber: 1,
    initialEvent: null,
    eventSeq: 0,
    finalEvent: null,
    finalEventSeq: 0,
    phase: 'waiting-roll',
    owners: {},
    buildings: {},
    positions: { p1: 0, p2: 0 },
    money: {},
    inJail: {},
    jailTurns: {},
    bankrupt: [],
    abilities: {},
    dice: null,
    diceModifier: null,
    pendingBuy: null,
    pendingBus: null,
    auction: null,
    table21: null,
    trade: null,
    log: [],
    notices: [],
    noticeSeq: 0,
    winner: null,
    rollSeq: 0,
    ...overrides,
  }
}

function rollLog(name: string, values: number[], turn = 0): LogEntry {
  const total = values.reduce((sum, value) => sum + value, 0)
  return { turn, text: `${name} tira ${values.join('+')} = ${total} y cae en alguna casilla.` }
}

describe('planAnimations', () => {
  it('anima cada tirada exactamente una vez', () => {
    const before = makeState({ rollSeq: 0, positions: { p1: 10, p2: 0 } })
    const after = makeState({
      rollSeq: 1,
      positions: { p1: 17, p2: 0 },
      log: [rollLog('Ana', [3, 4])],
    })

    const plan = planAnimations(after, snapshotSeen(before))
    expect(plan).toEqual({
      kind: 'roll',
      roll: {
        seq: 1,
        playerId: 'p1',
        values: [3, 4],
        total: 7,
        from: 10,
        to: 17,
        steps: [11, 12, 13, 14, 15, 16, 17],
        direct: false,
      },
    })

    // El mismo snapshot ya pintado no vuelve a animarse.
    expect(planAnimations(after, snapshotSeen(after))).toEqual({ kind: 'idle' })
  })

  it('anima dos tiradas con los mismos valores porque cambia rollSeq', () => {
    const first = makeState({
      rollSeq: 1,
      turnNumber: 0,
      positions: { p1: 17, p2: 0 },
      log: [rollLog('Ana', [3, 4], 0)],
    })
    const second = makeState({
      rollSeq: 2,
      turnNumber: 1,
      positions: { p1: 24, p2: 0 },
      log: [rollLog('Ana', [3, 4], 0), rollLog('Ana', [3, 4], 1)],
    })

    const plan = planAnimations(second, snapshotSeen(first))
    expect(plan.kind).toBe('roll')
    if (plan.kind !== 'roll') return
    expect(plan.roll.seq).toBe(2)
    expect(plan.roll.values).toEqual([3, 4])
    expect(plan.roll.from).toBe(17)
    expect(plan.roll.to).toBe(24)
    expect(plan.roll.steps).toEqual([18, 19, 20, 21, 22, 23, 24])
  })

  it('pasa por GO al dar la vuelta', () => {
    const before = makeState({ rollSeq: 0, positions: { p1: 46, p2: 0 } })
    const after = makeState({
      rollSeq: 1,
      positions: { p1: 3, p2: 0 },
      log: [rollLog('Ana', [2, 3])],
    })

    const plan = planAnimations(after, snapshotSeen(before))
    expect(plan.kind).toBe('roll')
    if (plan.kind !== 'roll') return
    expect(plan.roll.steps).toEqual([47, 0, 1, 2, 3])
  })

  it('da el mismo plan si tira el anfitrión o un invitado', () => {
    const before = makeState({ rollSeq: 0, positions: { p1: 20, p2: 5 } })
    const after = makeState({
      rollSeq: 1,
      positions: { p1: 27, p2: 5 },
      log: [rollLog('Ana', [4, 3])],
    })

    // Dos clientes reciben la misma instantánea: no hay diferencia de rol.
    const hostPlan = planAnimations(after, snapshotSeen(before))
    const guestPlan = planAnimations(after, snapshotSeen(before))
    expect(hostPlan).toEqual(guestPlan)

    // Y también funciona cuando tira el segundo jugador (invitado).
    const guestRoll = makeState({
      rollSeq: 1,
      positions: { p1: 20, p2: 12 },
      log: [rollLog('Beto', [2, 5])],
    })
    const plan = planAnimations(guestRoll, snapshotSeen(before))
    expect(plan.kind).toBe('roll')
    if (plan.kind !== 'roll') return
    expect(plan.roll.playerId).toBe('p2')
    expect(plan.roll.from).toBe(5)
    expect(plan.roll.to).toBe(12)
  })

  it('no anima al entrar o reconectar', () => {
    const state = makeState({
      rollSeq: 7,
      positions: { p1: 33, p2: 12 },
      log: [rollLog('Ana', [5, 6], 6)],
    })
    expect(planAnimations(state, null)).toEqual({ kind: 'idle' })
  })

  it('solo la cárcel es un salto directo', () => {
    const before = makeState({ rollSeq: 0, positions: { p1: 34, p2: 0 } })
    const after = makeState({
      rollSeq: 1,
      positions: { p1: 12, p2: 0 },
      inJail: { p1: true },
      log: [rollLog('Ana', [1, 1])],
    })

    const plan = planAnimations(after, snapshotSeen(before))
    expect(plan.kind).toBe('roll')
    if (plan.kind !== 'roll') return
    expect(plan.roll.direct).toBe(true)
    expect(plan.roll.steps).toEqual([12])
  })

  it('un cambio de posición sin tirada no se anima', () => {
    const before = makeState({ rollSeq: 3, positions: { p1: 5, p2: 0 } })
    // Salto de ruta: la posición cambia pero rollSeq no.
    const after = makeState({ rollSeq: 3, positions: { p1: 17, p2: 0 } })
    expect(planAnimations(after, snapshotSeen(before))).toEqual({ kind: 'idle' })
  })
})
