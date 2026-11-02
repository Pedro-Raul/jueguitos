/**
 * Reparto del texto dentro de la textura de una casilla. Es puro (la medición
 * se inyecta) para poder probar el autoajuste y calcular la altura real del
 * nombre en pantalla sin depender del canvas.
 */

export const TILE_TEXTURE_SIZE = 512
/** Altura de mayúscula aproximada de la fuente en negrita (fracción de em). */
export const NAME_CAP_RATIO = 0.72
export const TILE_NAME_MAX_LINES = 3
export const TILE_NAME_MAX_FONT = 128
export const TILE_NAME_MIN_FONT = 40
/** Ancho útil para el nombre dentro de la textura (deja libre el bisel). */
export const TILE_NAME_MAX_WIDTH = 468

export type TextMeasure = (text: string, fontPx: number, weight: number) => number

export type NameFitOptions = {
  maxWidth?: number
  maxLines?: number
  maxFontPx?: number
  minFontPx?: number
  /** Altura máxima del bloque de líneas (para no pisar ícono/precio). */
  maxBlockPx?: number
}

export type NameFit = {
  fontPx: number
  lineHeightPx: number
  lines: string[]
}

function wrapWords(
  words: string[],
  fontPx: number,
  maxWidth: number,
  measure: TextMeasure,
): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || measure(candidate, fontPx, 800) <= maxWidth) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}

function splitLongWord(word: string, fontPx: number, maxWidth: number, measure: TextMeasure): string[] {
  const parts: string[] = []
  let current = ''
  for (const char of word) {
    const candidate = current + char
    if (current && measure(candidate, fontPx, 800) > maxWidth) {
      parts.push(current)
      current = char
    } else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts
}

/**
 * Mayor tamaño de fuente (paso de 2 px) con el que el nombre cabe en `maxLines`
 * líneas sin desbordar. Si ni al mínimo cabe una palabra, se parte por letras
 * como último recurso (nunca se sale de la textura).
 */
export function fitTileName(
  name: string,
  measure: TextMeasure,
  options: NameFitOptions = {},
): NameFit {
  const maxWidth = options.maxWidth ?? TILE_NAME_MAX_WIDTH
  const maxLines = options.maxLines ?? TILE_NAME_MAX_LINES
  const maxFontPx = options.maxFontPx ?? TILE_NAME_MAX_FONT
  const minFontPx = options.minFontPx ?? TILE_NAME_MIN_FONT
  const maxBlockPx = options.maxBlockPx ?? Number.POSITIVE_INFINITY
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean)

  for (let fontPx = maxFontPx; fontPx >= minFontPx; fontPx -= 2) {
    const lineHeightPx = Math.round(fontPx * 1.04)
    const lines = wrapWords(words, fontPx, maxWidth, measure)
    const fits =
      lines.length <= maxLines &&
      lines.length * lineHeightPx <= maxBlockPx &&
      lines.every((line) => measure(line, fontPx, 800) <= maxWidth)
    if (fits) {
      return { fontPx, lineHeightPx, lines }
    }
  }

  const broken = words.flatMap((word) => splitLongWord(word, minFontPx, maxWidth, measure))
  const lines: string[] = []
  let current = ''
  for (const part of broken) {
    const candidate = current ? `${current} ${part}` : part
    if (!current || measure(candidate, minFontPx, 800) <= maxWidth) {
      current = candidate
    } else {
      lines.push(current)
      current = part
    }
  }
  if (current) lines.push(current)

  return {
    fontPx: minFontPx,
    lineHeightPx: Math.round(minFontPx * 1.04),
    lines: lines.slice(0, maxLines),
  }
}

/** Reparto vertical de la textura (512×512) para una casilla concreta. */
export type TileTextureLayout = {
  size: number
  icon: { fontPx: number; y: number } | null
  name: {
    fontPx: number
    lineHeightPx: number
    lines: string[]
    centerY: number
  }
  price: { fontPx: number; y: number } | null
  index: { fontPx: number; x: number; y: number }
}

export function tileTextureLayout(
  tile: { name: string; price?: number; tax?: number },
  hasIcon: boolean,
  measure: TextMeasure,
): TileTextureLayout {
  const size = TILE_TEXTURE_SIZE
  const icon = hasIcon ? { fontPx: 78, y: 76 } : null
  const priceText = tile.price !== undefined ? `$${tile.price}` : tile.tax !== undefined ? `-$${tile.tax}` : null
  const price = priceText ? { fontPx: 38, y: 474 } : null

  // Zona del nombre: debajo del ícono y encima del precio, con aire.
  const top = icon ? 126 : 56
  const bottom = price ? 448 : 492
  const name = fitTileName(tile.name, measure, {
    maxWidth: TILE_NAME_MAX_WIDTH,
    maxLines: TILE_NAME_MAX_LINES,
    maxBlockPx: bottom - top,
  })
  const centerY = (top + bottom) / 2

  return {
    size,
    icon,
    name: {
      fontPx: name.fontPx,
      lineHeightPx: name.lineHeightPx,
      lines: name.lines,
      centerY,
    },
    price,
    index: { fontPx: 24, x: 22, y: 30 },
  }
}

/**
 * Ancho estimado con una tabla de anchos por carácter (em) para Segoe UI Bold.
 * Se usa en tests y para reportar cifras; el navegador mide con canvas real.
 */
const CHAR_WIDTHS: Record<string, number> = {
  A: 0.7, B: 0.68, C: 0.66, D: 0.71, E: 0.59, F: 0.57, G: 0.72, H: 0.74,
  I: 0.3, J: 0.5, K: 0.67, L: 0.55, M: 0.89, N: 0.75, O: 0.76, P: 0.64,
  Q: 0.77, R: 0.67, S: 0.61, T: 0.6, U: 0.73, V: 0.68, W: 0.99, X: 0.65,
  Y: 0.63, Z: 0.6, ' ': 0.3, '.': 0.3, ',': 0.3, '-': 0.38, '&': 0.78,
  '0': 0.6, '1': 0.6, '2': 0.6, '3': 0.6, '4': 0.6, '5': 0.6, '6': 0.6,
  '7': 0.6, '8': 0.6, '9': 0.6,
}

export function estimateTextWidth(text: string, fontPx: number): number {
  let em = 0
  for (const char of text) em += CHAR_WIDTHS[char] ?? 0.62
  return em * fontPx
}

export const estimateMeasure: TextMeasure = (text, fontPx) =>
  estimateTextWidth(text, fontPx)
