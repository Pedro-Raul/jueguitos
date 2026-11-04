/**
 * Avisos temporales de Cucupoly.
 *
 * No son un historial: viven en el estado como una cola corta con un id
 * creciente (`noticeSeq`). Cada cliente muestra cada id una sola vez, así que
 * reconectar o entrar tarde no reproduce avisos viejos. El reducer sigue puro:
 * `pushNotice` solo muta la copia que ya creó `reduce`.
 */
export type NoticeKind = 'money' | 'rule' | 'event'

export type Notice = {
  /** Id creciente; también es la clave de render. */
  id: number
  kind: NoticeKind
  text: string
  /** Solo en avisos de dinero: quién paga (null si el dinero no viene de otro jugador). */
  from?: string
  /** Solo en avisos de dinero: quién recibe. */
  to?: string
  /** Solo en avisos de dinero: importe efectivamente transferido. */
  amount?: number
}

/** Forma mínima del estado que necesitan los avisos. */
export type NoticeCarrier = {
  notices: Notice[]
  noticeSeq: number
}

/** Suficiente para que la cola nunca crezca sin límite en una partida larga. */
export const MAX_NOTICES = 20

export function pushNotice(state: NoticeCarrier, notice: Omit<Notice, 'id'>): Notice {
  state.noticeSeq += 1
  const full: Notice = { ...notice, id: state.noticeSeq }
  state.notices.push(full)
  if (state.notices.length > MAX_NOTICES) {
    state.notices.splice(0, state.notices.length - MAX_NOTICES)
  }
  return full
}

export function pushRuleNotice(state: NoticeCarrier, text: string): Notice {
  return pushNotice(state, { kind: 'rule', text })
}

export function pushEventNotice(state: NoticeCarrier, text: string): Notice {
  return pushNotice(state, { kind: 'event', text })
}

type PaymentNotice = {
  /** null cuando el dinero sale del banco o de un pozo común. */
  from: string | null
  to: string
  amount: number
  /** Motivo visible, siempre obligatorio. */
  reason: string
  /** Aclaración opcional al final de la frase. */
  detail?: string
}

/** Aviso estándar de un pago entre jugadores (o de un premio que recibe uno). */
export function pushMoneyNotice(
  state: NoticeCarrier,
  names: Record<string, string>,
  payment: PaymentNotice,
): Notice {
  const payer = payment.from ? names[payment.from] ?? payment.from : null
  const payee = names[payment.to] ?? payment.to
  const detail = payment.detail ? ` ${payment.detail}` : ''
  const text = payer
    ? `${payer} le pagó $${payment.amount} a ${payee} (${payment.reason}).${detail}`
    : `${payee} recibió $${payment.amount} (${payment.reason}).${detail}`

  return pushNotice(state, {
    kind: 'money',
    text,
    from: payment.from ?? undefined,
    to: payment.to,
    amount: payment.amount,
  })
}
