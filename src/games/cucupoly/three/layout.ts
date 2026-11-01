import { gridPosition } from '../board'

/** Lado de una casilla en unidades del mundo. */
export const CELL = 1
/** Altura de la cara superior de las casillas. */
export const TILE_TOP = 0.22
/** Desplazamiento del tablero para dejar aire arriba y abajo. */
export const BOARD_OFFSET_Z = 0
/** Duración de cada salto de ficha. */
export const HOP_SECONDS = 0.18
/** Altura del arco de cada salto. */
export const HOP_HEIGHT = 0.45
/** Duración de la animación de dados (igual en la escena y en el HUD). */
export const DICE_SECONDS = 1.2

export function tileWorld(index: number): [number, number, number] {
  const { column, row } = gridPosition(index)
  return [(column - 7) * CELL, TILE_TOP, (row - 7) * CELL + BOARD_OFFSET_Z]
}
