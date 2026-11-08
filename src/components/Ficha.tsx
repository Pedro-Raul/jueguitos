import chileMorronUrl from '../assets/chile-morron.svg'
import { CHILE_MORRON } from '../profile'

type Props = {
  /** Emoji o ficha especial guardada en el perfil. */
  emoji: string
}

/**
 * Pinta una ficha de jugador. Las fichas ilustradas se dibujan como imagen y el
 * resto sigue usando el emoji del sistema.
 */
export function Ficha({ emoji }: Props) {
  if (emoji === CHILE_MORRON) {
    return (
      <img
        className="ficha-img"
        src={chileMorronUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    )
  }

  return <>{emoji}</>
}
