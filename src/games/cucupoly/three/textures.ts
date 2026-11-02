import * as THREE from 'three'
import type { Tile } from '../board'
import { tileColor, tileIcon, tileTextColor } from '../visual'
import {
  TILE_TEXTURE_SIZE,
  tileTextureLayout,
  type TextMeasure,
} from './tileTextureLayout'

const FONT_STACK =
  '"Segoe UI", ui-sans-serif, system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif'
const EMOJI_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite dibujar texturas 2D.')
  return { canvas, ctx }
}

/** Anisotropía máxima del renderer; BoardScene la fija al arrancar. */
let maxAnisotropy = 1

export function setMaxAnisotropy(value: number): void {
  const next = Math.floor(value)
  maxAnisotropy = Number.isFinite(next) && next > 1 ? next : 1
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  texture.needsUpdate = true
  return texture
}

/** Medición real con canvas para el autoajuste del nombre. */
function canvasMeasure(ctx: CanvasRenderingContext2D): TextMeasure {
  return (text, fontPx, weight) => {
    ctx.font = `${weight} ${fontPx}px ${FONT_STACK}`
    return ctx.measureText(text).width
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

/** Textura de la cara superior de una casilla. */
export function createTileTexture(tile: Tile): THREE.CanvasTexture {
  const size = TILE_TEXTURE_SIZE
  const { canvas, ctx } = makeCanvas(size)
  const background = tileColor(tile)
  const foreground = tileTextColor(tile)
  const icon = tileIcon(tile)
  const layout = tileTextureLayout(tile, Boolean(icon), canvasMeasure(ctx))

  ctx.fillStyle = background
  ctx.fillRect(0, 0, size, size)

  // Bisel interior para que cada casilla se lea como una pieza de cartón.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.lineWidth = 16
  ctx.strokeRect(8, 8, size - 16, size - 16)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.lineWidth = 6
  ctx.strokeRect(22, 22, size - 44, size - 44)

  ctx.fillStyle = foreground
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (icon && layout.icon) {
    ctx.font = `${layout.icon.fontPx}px ${EMOJI_STACK}`
    ctx.fillText(icon, size / 2, layout.icon.y)
  }

  ctx.font = `800 ${layout.name.fontPx}px ${FONT_STACK}`
  const count = layout.name.lines.length
  layout.name.lines.forEach((line, index) => {
    const y = layout.name.centerY + (index - (count - 1) / 2) * layout.name.lineHeightPx
    ctx.fillText(line, size / 2, y)
  })

  if (layout.price) {
    ctx.font = `900 ${layout.price.fontPx}px ${FONT_STACK}`
    const text =
      tile.price !== undefined ? `$${tile.price}` : tile.tax !== undefined ? `-$${tile.tax}` : ''
    ctx.fillText(text, size / 2, layout.price.y)
  }

  ctx.font = `700 ${layout.index.fontPx}px ${FONT_STACK}`
  ctx.textAlign = 'left'
  ctx.globalAlpha = 0.55
  ctx.fillText(String(tile.index), layout.index.x, layout.index.y)
  ctx.globalAlpha = 1

  return toTexture(canvas)
}

/** Cartel central con el logo CUCUPOLY. */
export function createCenterTexture(): THREE.CanvasTexture {
  const size = 1024
  const { canvas, ctx } = makeCanvas(size)

  const gradient = ctx.createRadialGradient(size / 2, size * 0.42, 60, size / 2, size / 2, size * 0.7)
  gradient.addColorStop(0, '#FFFDF4')
  gradient.addColorStop(0.7, '#F8ECD2')
  gradient.addColorStop(1, '#EBD9B4')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = '#2F7A52'
  ctx.lineWidth = 22
  roundedRect(ctx, 40, 40, size - 80, size - 80, 46)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(47, 122, 82, 0.35)'
  ctx.lineWidth = 6
  roundedRect(ctx, 78, 78, size - 156, size - 156, 30)
  ctx.stroke()

  // Puntos decorativos en las esquinas.
  ctx.fillStyle = 'rgba(47, 122, 82, 0.16)'
  for (let x = 120; x < size - 100; x += 48) {
    for (let y = 120; y < size - 100; y += 48) {
      if (x > 260 && x < size - 260 && y > 260 && y < size - 260) continue
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#1D5136'
  ctx.font = `900 132px ${FONT_STACK}`
  ctx.fillText('CUCUPOLY', size / 2, size * 0.4)

  ctx.fillStyle = '#6F685B'
  ctx.font = `800 40px ${FONT_STACK}`
  ctx.fillText('MONOPOLY CUCUTEÑO', size / 2, size * 0.5)

  ctx.strokeStyle = 'rgba(47, 122, 82, 0.4)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(size * 0.28, size * 0.57)
  ctx.lineTo(size * 0.72, size * 0.57)
  ctx.stroke()

  ctx.fillStyle = '#8A7F6B'
  ctx.font = `700 30px ${FONT_STACK}`
  ctx.fillText('48 CASILLAS · 2 A 6 JUGADORES', size / 2, size * 0.63)

  // Dos dados decorativos.
  const drawDie = (cx: number, cy: number, value: number) => {
    const die = 118
    ctx.fillStyle = '#FFFDF6'
    ctx.strokeStyle = '#1D5136'
    ctx.lineWidth = 7
    roundedRect(ctx, cx - die / 2, cy - die / 2, die, die, 22)
    ctx.fill()
    ctx.stroke()

    const pips: Record<number, number[][]> = {
      1: [[0, 0]],
      2: [[-1, -1], [1, 1]],
      3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    }
    const gap = 30
    ctx.fillStyle = '#1D5136'
    for (const [px, py] of pips[value] ?? []) {
      ctx.beginPath()
      ctx.arc(cx + px * gap, cy + py * gap, 10, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawDie(size * 0.42, size * 0.77, 5)
  drawDie(size * 0.58, size * 0.77, 3)

  return toTexture(canvas)
}

/** Emoji flotante para los avatares sin modelo 3D propio. */
export function createEmojiTexture(emoji: string): THREE.CanvasTexture {
  const size = 128
  const { canvas, ctx } = makeCanvas(size)
  ctx.clearRect(0, 0, size, size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `96px ${EMOJI_STACK}`
  ctx.fillText(emoji, size / 2, size / 2 + 6)
  return toTexture(canvas)
}

/** Puntos de cada cara del dado, en coordenadas de cuadrícula 3×3. */
const DIE_PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
}

/** Cara de dado con puntos; se reutiliza una textura por valor. */
export function createDieFaceTexture(value: number): THREE.CanvasTexture {
  const size = 128
  const { canvas, ctx } = makeCanvas(size)

  ctx.fillStyle = '#FBF6E8'
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = '#4A4135'
  ctx.lineWidth = 7
  roundedRect(ctx, 4, 4, size - 8, size - 8, 26)
  ctx.stroke()

  ctx.fillStyle = '#23211C'
  const gap = 36
  for (const [px, py] of DIE_PIPS[value] ?? []) {
    ctx.beginPath()
    ctx.arc(size / 2 + px * gap, size / 2 + py * gap, 12, 0, Math.PI * 2)
    ctx.fill()
  }

  return toTexture(canvas)
}
