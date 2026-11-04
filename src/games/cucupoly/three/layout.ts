import { gridPosition } from '../board'
import { DICE_SECONDS, HOP_SECONDS } from '../timing'

// Los tiempos viven en `timing.ts`; se reexportan para las escenas 3D.
export { DICE_SECONDS, HOP_SECONDS }

/** Lado de una casilla en unidades del mundo. */
export const CELL = 1
/** Altura de la cara superior de las casillas. */
export const TILE_TOP = 0.22
/** Desplazamiento del tablero para dejar aire arriba y abajo. */
export const BOARD_OFFSET_Z = 0
/** Altura del arco de cada salto. */
export const HOP_HEIGHT = 0.45

export function tileWorld(index: number): [number, number, number] {
  const { column, row } = gridPosition(index)
  return [(column - 7) * CELL, TILE_TOP, (row - 7) * CELL + BOARD_OFFSET_Z]
}
