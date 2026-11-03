import type { GameAction } from '../types'

/**
 * Canal local del anfitrión: cada acción que procesa `useHostRoom` se publica
 * aquí con su resultado. No forma parte del protocolo PeerJS ni se difunde a
 * los invitados; sirve para que el HUD del anfitrión guarde datos privados
 * (por ejemplo, las ofertas secretas) fuera del estado público.
 */
export type HostActionEvent = {
  action: GameAction
  playerId: string
  ok: boolean
}

const listeners = new Set<(event: HostActionEvent) => void>()

export function publishHostAction(event: HostActionEvent): void {
  for (const listener of listeners) listener(event)
}

export function subscribeHostActions(
  listener: (event: HostActionEvent) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
