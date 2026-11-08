import type { Profile } from './types'

const STORAGE_KEY = 'jueguitos.profile'

/**
 * Ficha ilustrada (no es un emoji del sistema). Se guarda como cadena en el
 * perfil y se dibuja con el componente `Ficha`.
 */
export const CHILE_MORRON = ':chile-morron:'

export const AVATAR_EMOJIS = [
  '🐶', '🐱', '🦊', '🐼', '🐧', '🐸', '🐵', '🦁', '🐯',
  '🐨', '🐙', '🦄', '🐝', '🦉', '🐢', '🐳', '🦖',
  '🕊️', CHILE_MORRON,
]

/** Texto plano para contextos sin imágenes, como un `<option>`. */
export function fichaText(emoji: string): string {
  return emoji === CHILE_MORRON ? '🫑' : emoji
}

/** Nombre accesible de una ficha. */
export function fichaName(emoji: string): string {
  if (emoji === CHILE_MORRON) return 'Chile morrón'
  if (emoji === '🕊️') return 'Paloma'
  return emoji
}

export const AVATAR_COLORS = [
  '#e63946', '#f4a261', '#e9c46a', '#2a9d8f',
  '#457b9d', '#6d597a', '#ff6b6b', '#3a86ff',
]

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.emoji === 'string' &&
    typeof candidate.color === 'string'
  )
}

/** Returns null on missing or corrupt storage instead of throwing. */
export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isProfile(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

export function clearProfile(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** crypto.randomUUID needs a secure context; LAN http://192.168.x.x does not have one. */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createProfile(input: Pick<Profile, 'name' | 'emoji' | 'color'>): Profile {
  return {
    id: randomId(),
    name: input.name.trim(),
    emoji: input.emoji,
    color: input.color,
  }
}
