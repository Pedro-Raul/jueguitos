import { useState, type FormEvent } from 'react'
import { Ficha } from '../components/Ficha'
import { AVATAR_COLORS, AVATAR_EMOJIS, createProfile, fichaName } from '../profile'
import type { Profile } from '../types'

type Props = {
  initial: Profile | null
  onSave: (profile: Profile) => void
  onDelete?: () => void
  onCancel?: () => void
}

export function ProfileScreen({ initial, onSave, onDelete, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? AVATAR_EMOJIS[0])
  const [color, setColor] = useState(initial?.color ?? AVATAR_COLORS[0])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const canSave = name.trim().length > 0

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    if (initial) {
      // Keep the same id when editing so seats and game state stay linked.
      onSave({ ...initial, name: name.trim(), emoji, color })
    } else {
      onSave(createProfile({ name, emoji, color }))
    }
  }

  return (
    <main className="screen">
      <header className="hero">
        <h1>Jueguitos</h1>
        <p>Juegos entre amigos. Sin cuentas, sin servidores, sin instalar nada.</p>
      </header>

      <form className="card" onSubmit={handleSubmit}>
        <h2>{initial ? 'Editar perfil' : 'Crea tu perfil'}</h2>

        <div className="avatar-preview" style={{ backgroundColor: color }} aria-hidden="true">
          <Ficha emoji={emoji} />
        </div>

        <label className="field">
          <span>Nombre</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Tu nombre"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <fieldset className="field">
          <legend>Ficha</legend>
          <p className="muted small">Elige la ficha con la que te verán en la sala.</p>
          <div className="emoji-grid" role="group" aria-label="Lobby de fichas">
            {AVATAR_EMOJIS.map((option) => (
              <button
                key={option}
                type="button"
                className={`emoji-option${option === emoji ? ' is-selected' : ''}`}
                aria-pressed={option === emoji}
                aria-label={`Ficha ${fichaName(option)}`}
                title={`Ficha ${fichaName(option)}`}
                onClick={() => setEmoji(option)}
              >
                <Ficha emoji={option} />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Color</legend>
          <div className="color-grid">
            {AVATAR_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className={`color-option${option === color ? ' is-selected' : ''}`}
                style={{ backgroundColor: option }}
                aria-pressed={option === color}
                aria-label={`Color ${option}`}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </fieldset>

        <div className="actions">
          <button className="primary" type="submit" disabled={!canSave}>
            {initial ? 'Guardar cambios' : 'Entrar'}
          </button>
          {onCancel ? (
            <button className="ghost" type="button" onClick={onCancel}>
              Cancelar
            </button>
          ) : null}
        </div>

        {initial && onDelete ? (
          <div className="danger-zone">
            {confirmingDelete ? (
              <div className="actions">
                <button className="danger" type="button" onClick={onDelete}>
                  Sí, borrar perfil
                </button>
                <button className="ghost" type="button" onClick={() => setConfirmingDelete(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button className="link-danger" type="button" onClick={() => setConfirmingDelete(true)}>
                Borrar perfil
              </button>
            )}
            <p className="muted small">El perfil solo existe en este navegador.</p>
          </div>
        ) : null}
      </form>
    </main>
  )
}
