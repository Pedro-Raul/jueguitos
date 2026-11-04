import { describe, expect, it } from 'vitest'
import { BOARD, BUS_TILES, gridPosition, type Tile } from './board'
import { TILE_COLORS } from './visual'

type Side = 'bottom' | 'left' | 'top' | 'right'

const SIDES: Side[] = ['bottom', 'left', 'top', 'right']

const CORNERS = [0, 12, 24, 36]

function sideOf(tile: Tile): Side | null {
  if (CORNERS.includes(tile.index)) return null
  const { column, row } = gridPosition(tile.index)
  if (row === 13) return 'bottom'
  if (column === 1) return 'left'
  if (row === 1) return 'top'
  return 'right'
}

function tileAt(column: number, row: number): Tile | undefined {
  return BOARD.find((tile) => {
    const position = gridPosition(tile.index)
    return position.column === column && position.row === row
  })
}

/** Distancia en casillas al cruce de esquina más cercano. */
function distanceToNearestCorner(index: number): number {
  const corners = [0, 12, 24, 36]
  return Math.min(
    ...corners.map((corner) => {
      const direct = Math.abs(index - corner)
      return Math.min(direct, BOARD.length - direct)
    }),
  )
}

describe('geometría del tablero', () => {
  it('tiene 48 casillas y el índice coincide con la posición', () => {
    expect(BOARD).toHaveLength(48)
    BOARD.forEach((tile, position) => {
      expect(tile.index).toBe(position)
    })
  })

  it('cada lado tiene 11 casillas entre esquinas', () => {
    for (const side of SIDES) {
      expect(BOARD.filter((tile) => sideOf(tile) === side)).toHaveLength(11)
    }
  })

  it('coloca exactamente una buseta en el centro exacto de cada lado', () => {
    expect([...BUS_TILES]).toEqual([6, 18, 30, 42])

    for (const side of SIDES) {
      const buses = BOARD.filter((tile) => sideOf(tile) === side && tile.type === 'bus')
      expect(buses).toHaveLength(1)
    }

    const centers = [
      { column: 7, row: 13 }, // 6
      { column: 1, row: 7 }, // 18
      { column: 7, row: 1 }, // 30
      { column: 13, row: 7 }, // 42
    ]
    BUS_TILES.forEach((index, position) => {
      expect(gridPosition(index)).toEqual(centers[position])
    })
  })

  it('deja los cuatro parques simétricos respecto a los dos ejes', () => {
    const parks = BOARD.filter((tile) => tile.type === 'park').map((tile) => tile.index)
    expect(parks.sort((a, b) => a - b)).toEqual([5, 7, 29, 31])

    for (const index of parks) {
      const { column, row } = gridPosition(index)
      const horizontalMirror = tileAt(column, 14 - row)
      const verticalMirror = tileAt(14 - column, row)
      expect(horizontalMirror?.type).toBe('park')
      expect(verticalMirror?.type).toBe('park')
    }
  })

  it('sitúa cada parque a la misma distancia de su esquina más cercana', () => {
    const parks = BOARD.filter((tile) => tile.type === 'park').map((tile) => tile.index)
    expect(parks.map(distanceToNearestCorner)).toEqual([5, 5, 5, 5])
  })

  it('conserva nombre y precio de todas las propiedades', () => {
    const properties = BOARD.filter((tile) => tile.type === 'property').map((tile) => ({
      index: tile.index,
      name: tile.name,
      price: tile.price,
    }))

    expect(properties).toEqual([
      { index: 1, name: 'Fortaleza', price: 60 },
      { index: 3, name: 'Los Estoraques', price: 60 },
      { index: 8, name: 'Belisario', price: 100 },
      { index: 10, name: 'Nidia', price: 100 },
      { index: 11, name: 'Ceci', price: 120 },
      { index: 13, name: 'Minuto de dios', price: 140 },
      { index: 14, name: 'Pastora', price: 140 },
      { index: 16, name: 'Belen', price: 160 },
      { index: 20, name: 'Las Americas', price: 180 },
      { index: 22, name: 'Villas del Tejar', price: 180 },
      { index: 23, name: 'El trigal del norte', price: 200 },
      { index: 25, name: 'La playa', price: 220 },
      { index: 26, name: 'Lleras Restrepo', price: 220 },
      { index: 28, name: 'El rosal', price: 240 },
      { index: 32, name: 'Caobos', price: 260 },
      { index: 33, name: 'La rivera', price: 260 },
      { index: 35, name: 'San Luis', price: 280 },
      { index: 38, name: 'Colsag', price: 300 },
      { index: 39, name: 'Niza', price: 300 },
      { index: 40, name: 'Prados del Norte', price: 320 },
      { index: 44, name: 'Prados del Este', price: 350 },
      { index: 46, name: 'San Mateo', price: 400 },
    ])
  })

  it('pinta de gris solo las cuatro busetas', () => {
    const grayTiles = Object.entries(TILE_COLORS)
      .filter(([, color]) => color === '#CCCCCC')
      .map(([index]) => Number(index))
      .sort((a, b) => a - b)

    expect(grayTiles).toEqual([...BUS_TILES])
  })
})
