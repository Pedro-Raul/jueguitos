import type { Tile } from './board'

/** Color exacto de cada casilla según el xlsx original. */
export const TILE_COLORS: Record<number, string> = {
  1: '#85200C',
  3: '#85200C',
  8: '#9FC5E8',
  10: '#9FC5E8',
  11: '#9FC5E8',
  13: '#FF00FF',
  14: '#FF00FF',
  16: '#FF00FF',
  20: '#FF9900',
  22: '#FF9900',
  23: '#FF9900',
  25: '#FF0000',
  26: '#FF0000',
  28: '#FF0000',
  32: '#FFFF00',
  33: '#FFFF00',
  35: '#FFFF00',
  38: '#93C47D',
  39: '#93C47D',
  40: '#93C47D',
  44: '#0000FF',
  46: '#0000FF',
  5: '#CCCCCC',
  17: '#CCCCCC',
  30: '#CCCCCC',
  42: '#CCCCCC',
  12: '#F3F3F3',
  36: '#F3F3F3',
}

/** Fondo crema para casillas que el xlsx deja sin color. */
export const NEUTRAL_TILE_COLOR = '#F7E8C8'

const GROUP_NAMES: Record<string, string> = {
  '#85200C': 'Marrón',
  '#9FC5E8': 'Azul claro',
  '#FF00FF': 'Magenta',
  '#FF9900': 'Naranja',
  '#FF0000': 'Rojo',
  '#FFFF00': 'Amarillo',
  '#93C47D': 'Verde',
  '#0000FF': 'Azul',
  '#CCCCCC': 'Busetas',
  '#F3F3F3': 'Cárcel',
}

export function tileColor(tile: Tile): string {
  return TILE_COLORS[tile.index] ?? NEUTRAL_TILE_COLOR
}

export function groupNameFor(tile: Tile): string {
  return GROUP_NAMES[tileColor(tile)] ?? 'Especial'
}

function channelToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** Luminancia relativa (WCAG) de un color #RGB o #RRGGBB. */
export function relativeLuminance(hex: string): number {
  let value = hex.replace('#', '').trim()
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return 1

  const r = channelToLinear(parseInt(value.slice(0, 2), 16) / 255)
  const g = channelToLinear(parseInt(value.slice(2, 4), 16) / 255)
  const b = channelToLinear(parseInt(value.slice(4, 6), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Blanco sobre fondos oscuros, casi negro sobre fondos claros. */
export function textColorFor(hex: string): string {
  return relativeLuminance(hex) < 0.5 ? '#FFFFFF' : '#1C1A16'
}

export function tileTextColor(tile: Tile): string {
  return textColorFor(tileColor(tile))
}

/** Emoji de ícono para las casillas sin color de grupo. */
export function tileIcon(tile: Tile): string | null {
  switch (tile.type) {
    case 'go':
      return '🏁'
    case 'treasury':
      return '💰'
    case 'tax':
      return '💸'
    case 'chance':
      return '❓'
    case 'park':
      return '🌳'
    case 'parking':
      return '🅿️'
    case 'betting':
      return '🎰'
    case 'jail':
      return '🔒'
    case 'go-to-jail':
      return '👮'
    case 'bus':
      return '🚌'
    case 'service':
      if (tile.service === 'water') return '💧'
      if (tile.service === 'electricity') return '⚡'
      return '📞'
    default:
      return null
  }
}

export function isPurchasable(tile: Tile): boolean {
  return tile.price !== undefined
}

/**
 * Camino en sentido de avance entre dos casillas, sin incluir el origen.
 * `pathBetween(46, 3)` devuelve [47, 0, 1, 2, 3].
 */
export function pathBetween(from: number, to: number): number[] {
  const steps: number[] = []
  let current = from
  while (current !== to && steps.length < 48) {
    current = (current + 1) % 48
    steps.push(current)
  }
  return steps
}
