import { describe, expect, it } from 'vitest'
import { BOARD } from '../board'
import { tileIcon } from '../visual'
import { computeFraming, projectedTileSize } from './framing'
import { tileWorld } from './layout'
import {
  NAME_CAP_RATIO,
  TILE_NAME_MAX_WIDTH,
  TILE_NAME_MAX_LINES,
  TILE_TEXTURE_SIZE,
  estimateMeasure,
  tileTextureLayout,
} from './tileTextureLayout'

const TILT = (62 * Math.PI) / 180

const LONG_NAMES = [
  { index: 40, name: 'Prados del Norte' },
  { index: 23, name: 'El trigal del norte' },
  { index: 26, name: 'Lleras Restrepo' },
  { index: 22, name: 'Villas del Tejar' },
]

type Measurement = {
  name: string
  index: number
  fontPx: number
  lines: string[]
  tileWidthPx: number
  tileHeightPx: number
  fontOnScreenPx: number
  capHeightPx: number
}

function measureAt(width: number, height: number): Measurement[] {
  const framing = computeFraming(width, height, { tilt: TILT })
  return LONG_NAMES.map(({ index, name }) => {
    const tile = BOARD[index]
    const layout = tileTextureLayout(tile, Boolean(tileIcon(tile)), estimateMeasure)
    const [x, y, z] = tileWorld(index)
    const tileSize = projectedTileSize([x, y, z], framing, width, height, 0.94)
    const fontOnScreenPx = (layout.name.fontPx / TILE_TEXTURE_SIZE) * tileSize.height
    return {
      name,
      index,
      fontPx: layout.name.fontPx,
      lines: layout.name.lines,
      tileWidthPx: tileSize.width,
      tileHeightPx: tileSize.height,
      fontOnScreenPx,
      capHeightPx: fontOnScreenPx * NAME_CAP_RATIO,
    }
  })
}

describe('legibilidad de los nombres largos', () => {
  it('autoajusta cada nombre a 3 líneas sin desbordar', () => {
    for (const { index, name } of LONG_NAMES) {
      const tile = BOARD[index]
      const layout = tileTextureLayout(tile, Boolean(tileIcon(tile)), estimateMeasure)
      expect(layout.name.lines.length).toBeLessThanOrEqual(TILE_NAME_MAX_LINES)
      expect(layout.name.lines.join(' ')).toBe(name.toUpperCase())
      for (const line of layout.name.lines) {
        expect(estimateMeasure(line, layout.name.fontPx, 800)).toBeLessThanOrEqual(
          TILE_NAME_MAX_WIDTH,
        )
      }
      const block = layout.name.lines.length * layout.name.lineHeightPx
      expect(block).toBeLessThanOrEqual(392)
    }
  })

  it('mide a 1366×768', () => {
    const rows = measureAt(1366, 768)
    for (const row of rows) {
      expect(row.tileWidthPx).toBeGreaterThan(0)
      expect(row.fontOnScreenPx).toBeGreaterThan(0)
    }
  })

  it('mide a 390×844', () => {
    const rows = measureAt(390, 844)
    for (const row of rows) {
      expect(row.tileWidthPx).toBeGreaterThan(0)
      expect(row.fontOnScreenPx).toBeGreaterThan(0)
    }
  })
})
