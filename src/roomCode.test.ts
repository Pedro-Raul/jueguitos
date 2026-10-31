import { describe, expect, it } from 'vitest'
import {
  PEER_ID_PREFIX,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  peerIdFor,
} from './roomCode'

const VALID_SHAPE = /^[A-HJ-NP-Z2-9]{5}$/

describe('alfabeto de códigos', () => {
  it('excluye I, O, 0 y 1 y tiene 32 símbolos únicos', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32)
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32)
    for (const forbidden of ['I', 'O', '0', '1']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(forbidden)
    }
    expect(ROOM_CODE_LENGTH).toBe(5)
  })
})

describe('generateRoomCode', () => {
  it('genera códigos de 5 caracteres dentro del alfabeto', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateRoomCode()
      expect(code).toMatch(VALID_SHAPE)
      expect(code).toHaveLength(5)
      expect(isValidRoomCode(code)).toBe(true)
    }
  })

  it('mapea los bytes recibidos de forma determinista', () => {
    const code = generateRoomCode((bytes) => {
      bytes.set([0, 1, 2, 3, 4])
    })
    expect(code).toBe('ABCDE')
  })

  it('usa el módulo del alfabeto, sin desbordarse', () => {
    const code = generateRoomCode((bytes) => {
      bytes.set([255, 254, 253, 252, 251])
    })
    expect(code).toHaveLength(5)
    for (const char of code) expect(ROOM_CODE_ALPHABET).toContain(char)
  })
})

describe('normalizeRoomCode', () => {
  it('pasa a mayúsculas y quita espacios y guiones', () => {
    expect(normalizeRoomCode(' ab-c2 3 ')).toBe('ABC23')
    expect(normalizeRoomCode('abc23')).toBe('ABC23')
  })
})

describe('isValidRoomCode', () => {
  it('acepta códigos válidos, normalizados o no', () => {
    expect(isValidRoomCode('ABC23')).toBe(true)
    expect(isValidRoomCode('abc-23')).toBe(true)
    expect(isValidRoomCode('  XYZ89 ')).toBe(true)
  })

  it('rechaza longitud incorrecta', () => {
    expect(isValidRoomCode('ABC2')).toBe(false)
    expect(isValidRoomCode('ABC234')).toBe(false)
    expect(isValidRoomCode('')).toBe(false)
  })

  it('rechaza caracteres ambiguos y símbolos', () => {
    expect(isValidRoomCode('ABI23')).toBe(false)
    expect(isValidRoomCode('ABO23')).toBe(false)
    expect(isValidRoomCode('AB023')).toBe(false)
    expect(isValidRoomCode('AB123')).toBe(false)
    expect(isValidRoomCode('AB!23')).toBe(false)
  })
})

describe('peerIdFor', () => {
  it('construye el id de PeerJS con el prefijo del juego', () => {
    expect(peerIdFor('abc23')).toBe(`${PEER_ID_PREFIX}ABC23`)
    expect(peerIdFor('ABC23')).toBe('jueguitos-ABC23')
  })
})
