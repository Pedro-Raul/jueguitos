import { useState, type FormEvent } from 'react'
import { isValidRoomCode, normalizeRoomCode } from '../roomCode'

type Props = {
  onJoin: (code: string) => void
  onBack: () => void
}

export function JoinScreen({ onJoin, onBack }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const normalized = normalizeRoomCode(code)
  const valid = isValidRoomCode(normalized)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!valid) {
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

      <form className="card card-narrow" onSubmit={handleSubmit} noValidate>
        <h2>Unirse a una sala</h2>
        <p className="muted">Pide el código de 5 caracteres al anfitrión.</p>

        <label className="field">
          <span id="code-label">Código de sala</span>
          <input
            className={`code-input${valid ? ' is-valid' : ''}`}
            type="text"
            value={code}
            maxLength={5}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            enterKeyHint="go"
            spellCheck={false}
            placeholder="ABC23"
            aria-labelledby="code-label"
            aria-invalid={touched && !valid}
            aria-describedby="code-help"
            onChange={(event) => {
              setCode(normalizeRoomCode(event.target.value).slice(0, 5))
              setError(null)
              setTouched(true)
            }}
            onBlur={() => setTouched(true)}
          />
          <span id="code-help" className={`field-help${valid ? ' is-valid' : ''}`}>
            {valid
              ? '✓ Código listo'
              : '5 caracteres: letras (sin I ni O) y números del 2 al 9.'}
          </span>
        </label>

        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}

        <div className="actions">
          <button className="primary" type="submit" disabled={!valid}>
            Entrar
          </button>
        </div>
      </form>
    </main>
  )
}
