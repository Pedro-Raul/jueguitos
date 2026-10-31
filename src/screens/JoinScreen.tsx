import { useState, type FormEvent } from 'react'
import { isValidRoomCode, normalizeRoomCode } from '../roomCode'

type Props = {
  onJoin: (code: string) => void
  onBack: () => void
}

export function JoinScreen({ onJoin, onBack }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) {
      setError('El código tiene 5 caracteres: letras (sin I ni O) y números del 2 al 9.')
      return
    }
    setError(null)
    onJoin(normalized)
  }

  return (
    <main className="screen">
      <header className="topbar">
        <button className="ghost" type="button" onClick={onBack}>
          ← Volver
        </button>
        <span className="brand">Jueguitos</span>
      </header>

      <form className="card" onSubmit={handleSubmit}>
        <h2>Unirse a una sala</h2>
        <p className="muted">Pide el código de 5 caracteres al anfitrión.</p>

        <label className="field">
          <span>Código de sala</span>
          <input
            className="code-input"
            type="text"
            value={code}
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC23"
            onChange={(event) => {
              setCode(event.target.value.toUpperCase())
              setError(null)
            }}
          />
        </label>

        {error ? <p className="alert">{error}</p> : null}

        <div className="actions">
          <button className="primary" type="submit">
            Entrar
          </button>
        </div>
      </form>
    </main>
  )
}
