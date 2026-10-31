/**
 * Room codes: exactly 5 chars from A-Z without I/O, plus 2-9.
 * 24 letters + 8 digits = 32 symbols, so `byte % 32` is unbiased.
 * The code doubles as the PeerJS peer id: `jueguitos-<CODE>`.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 5
export const PEER_ID_PREFIX = 'jueguitos-'

export function generateRoomCode(fill?: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH)
  if (fill) {
    fill(bytes)
  } else {
    crypto.getRandomValues(bytes)
  }

  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length]
  }
  return code
}

/** Uppercases and drops spaces/dashes so pasted codes like "ab-cd 2" work. */
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '')
}

export function isValidRoomCode(raw: string): boolean {
  const code = normalizeRoomCode(raw)
  if (code.length !== ROOM_CODE_LENGTH) return false
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false
  }
  return true
}

export function peerIdFor(code: string): string {
  return `${PEER_ID_PREFIX}${normalizeRoomCode(code)}`
}
