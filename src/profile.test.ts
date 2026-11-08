import { describe, expect, it } from 'vitest'
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  CHILE_MORRON,
  fichaName,
  fichaText,
} from './profile'

describe('lobby de fichas', () => {
  it('incluye la paloma y la caricatura del chile morrón', () => {
    expect(AVATAR_EMOJIS).toContain('🕊️')
    expect(AVATAR_EMOJIS).toContain(CHILE_MORRON)
    // La caricatura no es el emoji realista del pimiento.
    expect(AVATAR_EMOJIS).not.toContain('🫑')
  })

  it('no repite fichas ni colores', () => {
    expect(new Set(AVATAR_EMOJIS).size).toBe(AVATAR_EMOJIS.length)
    expect(new Set(AVATAR_COLORS).size).toBe(AVATAR_COLORS.length)
  })

  it('traduce la ficha especial a texto donde no caben imágenes', () => {
    expect(fichaText(CHILE_MORRON)).toBe('🫑')
    expect(fichaText('🦊')).toBe('🦊')
  })

  it('da un nombre accesible a las fichas', () => {
    expect(fichaName(CHILE_MORRON)).toBe('Chile morrón')
    expect(fichaName('🕊️')).toBe('Paloma')
    expect(fichaName('🦊')).toBe('🦊')
  })
})
