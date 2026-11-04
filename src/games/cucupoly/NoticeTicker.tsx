import { useEffect, useRef, useState } from 'react'
import type { Notice } from './notices'
import { NOTICE_GAP_MS, NOTICE_VISIBLE_MS } from './timing'

export type NoticeQueue = {
  /** Aviso que se está mostrando ahora (null si la cola está en pausa o vacía). */
  current: Notice | null
  /** Avisos que esperan turno. */
  pending: number
}

/**
 * Cola de avisos de un cliente.
 *
 * - En el primer render marca `noticeSeq` como visto: reconectar o entrar tarde
 *   no reproduce avisos viejos.
 * - Muestra un aviso a la vez durante `NOTICE_VISIBLE_MS` y deja un aire de
 *   `NOTICE_GAP_MS` antes del siguiente.
 * - `paused` congela la cola mientras hay un anuncio grande en pantalla.
 */
export function useNoticeQueue(
  notices: Notice[],
  noticeSeq: number,
  paused = false,
): NoticeQueue {
  const [queue, setQueue] = useState<Notice[]>([])
  const [current, setCurrent] = useState<Notice | null>(null)
  const [gap, setGap] = useState(false)
  const seen = useRef<number | null>(null)

  if (seen.current === null) seen.current = noticeSeq

  useEffect(() => {
    if (seen.current === null) return
    if (noticeSeq <= seen.current) return
    const fresh = notices.filter((notice) => notice.id > (seen.current ?? 0))
    seen.current = noticeSeq
    if (fresh.length > 0) setQueue((previous) => [...previous, ...fresh])
  }, [notices, noticeSeq])

  useEffect(() => {
    if (current || gap || paused || queue.length === 0) return
    setCurrent(queue[0])
    setQueue((previous) => previous.slice(1))
  }, [current, gap, paused, queue])

  useEffect(() => {
    if (!current || paused) return
    const timer = window.setTimeout(() => {
      setCurrent(null)
      setGap(true)
    }, NOTICE_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [current, paused])

  useEffect(() => {
    if (!gap) return
    const timer = window.setTimeout(() => setGap(false), NOTICE_GAP_MS)
    return () => window.clearTimeout(timer)
  }, [gap])

  return { current, pending: queue.length }
}

const NOTICE_ICONS: Record<Notice['kind'], string> = {
  money: '💸',
  rule: '📜',
  event: '📣',
}

/** Hueco fijo en el HUD: evita que el tablero salte cuando no hay aviso. */
export function NoticeTicker({ notice }: { notice: Notice | null }) {
  return (
    <div className="cp-notice-slot" role="status" aria-live="polite" aria-atomic="true">
      {notice ? (
        <div key={notice.id} className={`cp-notice cp-notice-${notice.kind}`}>
          <span className="cp-notice-icon" aria-hidden="true">
            {NOTICE_ICONS[notice.kind]}
          </span>
          <span>{notice.text}</span>
        </div>
      ) : null}
    </div>
  )
}
