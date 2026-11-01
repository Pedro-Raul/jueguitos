import { describe, expect, it } from 'vitest'
import { BOARD } from './board'
import {
  NEUTRAL_TILE_COLOR,
  TILE_COLORS,
  groupNameFor,
  pathBetween,
  relativeLuminance,
  textColorFor,
  tileColor,
  tileIcon,
  tileTextColor,
} from './visual'

describe('colores del tablero', () => {
  it('respeta los hex exactos del xlsx por grupo', () => {
    expect(TILE_COLORS[1]).toBe('#85200C')
    expect(TILE_COLORS[3]).toBe('#85200C')
    expect(TILE_COLORS[8]).toBe('#9FC5E8')
    expect(TILE_COLORS[10]).toBe('#9FC5E8')
    expect(TILE_COLORS[11]).toBe('#9FC5E8')
    expect(TILE_COLORS[13]).toBe('#FF00FF')
    expect(TILE_COLORS[14]).toBe('#FF00FF')
    expect(TILE_COLORS[16]).toBe('#FF00FF')
    expect(TILE_COLORS[20]).toBe('#FF9900')
    expect(TILE_COLORS[22]).toBe('#FF9900')
    expect(TILE_COLORS[23]).toBe('#FF9900')
    expect(TILE_COLORS[25]).toBe('#FF0000')
    expect(TILE_COLORS[26]).toBe('#FF0000')
    expect(TILE_COLORS[28]).toBe('#FF0000')
    expect(TILE_COLORS[32]).toBe('#FFFF00')
    expect(TILE_COLORS[33]).toBe('#FFFF00')
    expect(TILE_COLORS[35]).toBe('#FFFF00')
    expect(TILE_COLORS[38]).toBe('#93C47D')
    expect(TILE_COLORS[39]).toBe('#93C47D')
    expect(TILE_COLORS[40]).toBe('#93C47D')
    expect(TILE_COLORS[44]).toBe('#0000FF')
    expect(TILE_COLORS[46]).toBe('#0000FF')
    expect([5, 17, 30, 42].map((index) => TILE_COLORS[index])).toEqual([
      '#CCCCCC',
      '#CCCCCC',
      '#CCCCCC',
      '#CCCCCC',
    ])
    expect(TILE_COLORS[12]).toBe('#F3F3F3')
    expect(TILE_COLORS[36]).toBe('#F3F3F3')
  })

  it('usa el fondo crema en las casillas sin color', () => {
    for (const tile of BOARD) {
      if (TILE_COLORS[tile.index]) continue
      expect(tileColor(tile)).toBe(NEUTRAL_TILE_COLOR)
    }
  })

  it('agrupa las casillas por color', () => {
    expect(groupNameFor(BOARD[1])).toBe('Marrón')
    expect(groupNameFor(BOARD[8])).toBe('Azul claro')
    expect(groupNameFor(BOARD[13])).toBe('Magenta')
    expect(groupNameFor(BOARD[20])).toBe('Naranja')
    expect(groupNameFor(BOARD[25])).toBe('Rojo')
    expect(groupNameFor(BOARD[32])).toBe('Amarillo')
    expect(groupNameFor(BOARD[38])).toBe('Verde')
    expect(groupNameFor(BOARD[44])).toBe('Azul')
    expect(groupNameFor(BOARD[5])).toBe('Busetas')
    expect(groupNameFor(BOARD[12])).toBe('Cárcel')
    expect(groupNameFor(BOARD[0])).toBe('Especial')
  })
})

describe('contraste del texto', () => {
  it('calcula la luminancia relativa de fondos conocidos', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#FFFF00')).toBeCloseTo(0.9278, 3)
    expect(relativeLuminance('#FF0000')).toBeCloseTo(0.2126, 3)
    expect(relativeLuminance('#85200C')).toBeLessThan(0.1)
    expect(relativeLuminance('#F3F3F3')).toBeGreaterThan(0.8)
  })

  it('elige blanco sobre fondos oscuros y oscuro sobre fondos claros', () => {
    expect(textColorFor('#85200C')).toBe('#FFFFFF')
    expect(textColorFor('#FF0000')).toBe('#FFFFFF')
    expect(textColorFor('#0000FF')).toBe('#FFFFFF')
    expect(textColorFor('#FF00FF')).toBe('#FFFFFF')
    expect(textColorFor('#FF9900')).toBe('#FFFFFF')
    expect(textColorFor('#FFFF00')).toBe('#1C1A16')
    expect(textColorFor('#9FC5E8')).toBe('#1C1A16')
    expect(textColorFor('#93C47D')).toBe('#FFFFFF')
    expect(textColorFor('#F3F3F3')).toBe('#1C1A16')
    expect(textColorFor(NEUTRAL_TILE_COLOR)).toBe('#1C1A16')
  })

  it('aplica el contraste a cada casilla real', () => {
    expect(tileTextColor(BOARD[1])).toBe('#FFFFFF')
    expect(tileTextColor(BOARD[32])).toBe('#1C1A16')
    expect(tileTextColor(BOARD[9])).toBe('#1C1A16')
  })
})

describe('camino entre casillas', () => {
  it('da la vuelta al GO de la 46 a la 3', () => {
    expect(pathBetween(46, 3)).toEqual([47, 0, 1, 2, 3])
  })

  it('avanza sin vuelta cuando el destino está delante', () => {
    expect(pathBetween(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pathBetween(44, 46)).toEqual([45, 46])
  })

  it('no devuelve pasos si el origen y el destino coinciden', () => {
    expect(pathBetween(5, 5)).toEqual([])
    expect(pathBetween(0, 0)).toEqual([])
  })

  it('nunca pasa de 48 pasos', () => {
    expect(pathBetween(47, 47)).toEqual([])
    expect(pathBetween(10, 9)).toHaveLength(47)
  })
})

describe('íconos de casillas especiales', () => {
  it('asigna un emoji a cada tipo sin color de grupo', () => {
    expect(tileIcon(BOARD[0])).toBe('🏁')
    expect(tileIcon(BOARD[2])).toBe('💰')
    expect(tileIcon(BOARD[4])).toBe('💸')
    expect(tileIcon(BOARD[9])).toBe('❓')
    expect(tileIcon(BOARD[7])).toBe('🌳')
    expect(tileIcon(BOARD[24])).toBe('🅿️')
    expect(tileIcon(BOARD[41])).toBe('🎰')
    expect(tileIcon(BOARD[12])).toBe('🔒')
    expect(tileIcon(BOARD[36])).toBe('👮')
    expect(tileIcon(BOARD[5])).toBe('🚌')
    expect(tileIcon(BOARD[6])).toBe('💧')
    expect(tileIcon(BOARD[15])).toBe('⚡')
    expect(tileIcon(BOARD[34])).toBe('📞')
    expect(tileIcon(BOARD[1])).toBeNull()
  })
})
