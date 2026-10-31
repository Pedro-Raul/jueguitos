export type TileType =
  | 'go'
  | 'property'
  | 'bus'
  | 'service'
  | 'treasury'
  | 'tax'
  | 'chance'
  | 'jail'
  | 'parking'
  | 'go-to-jail'
  | 'park'
  | 'betting'

export type ServiceKind = 'water' | 'electricity' | 'telephone'

export type Tile = {
  index: number
  name: string
  type: TileType
  /** Precio de compra. Solo en casillas comprables. */
  price?: number
  /** Importe del impuesto. Solo en casillas de impuesto. */
  tax?: number
  /** Habilidad asociada. Solo en servicios. */
  service?: ServiceKind
}

/**
 * Tablero de 48 casillas en sentido de avance (0..47).
 * El índice 0 es GO; 12 es la cárcel/visita; 36 envía a la cárcel.
 */
export const BOARD: Tile[] = [
  { index: 0, name: 'GO', type: 'go' },
  { index: 1, name: 'Fortaleza', type: 'property', price: 60 },
  { index: 2, name: 'Tesoreria', type: 'treasury' },
  { index: 3, name: 'Los Estoraques', type: 'property', price: 60 },
  { index: 4, name: 'Impuesto', type: 'tax', tax: 50 },
  { index: 5, name: 'Buseta Comicro', type: 'bus', price: 200 },
  { index: 6, name: 'Ser. Agua', type: 'service', price: 200, service: 'water' },
  { index: 7, name: 'Parque lineal', type: 'park' },
  { index: 8, name: 'Belisario', type: 'property', price: 100 },
  { index: 9, name: 'Sorpresa', type: 'chance' },
  { index: 10, name: 'Nidia', type: 'property', price: 100 },
  { index: 11, name: 'Ceci', type: 'property', price: 120 },
  { index: 12, name: 'Carcel (visita)', type: 'jail' },
  { index: 13, name: 'Minuto de dios', type: 'property', price: 140 },
  { index: 14, name: 'Pastora', type: 'property', price: 140 },
  { index: 15, name: 'Ser. Luz', type: 'service', price: 200, service: 'electricity' },
  { index: 16, name: 'Belen', type: 'property', price: 160 },
  { index: 17, name: 'Buseta Tonchala', type: 'bus', price: 200 },
  { index: 18, name: 'Tesoreria', type: 'treasury' },
  { index: 19, name: 'Parque Mercedez', type: 'park' },
  { index: 20, name: 'Las Americas', type: 'property', price: 180 },
  { index: 21, name: 'Sorpresa', type: 'chance' },
  { index: 22, name: 'Villas del Tejar', type: 'property', price: 180 },
  { index: 23, name: 'El trigal del norte', type: 'property', price: 200 },
  { index: 24, name: 'Estacionamiento', type: 'parking' },
  { index: 25, name: 'La playa', type: 'property', price: 220 },
  { index: 26, name: 'Lleras Restrepo', type: 'property', price: 220 },
  { index: 27, name: 'Tesoreria', type: 'treasury' },
  { index: 28, name: 'El rosal', type: 'property', price: 240 },
  { index: 29, name: 'Parque Nacional', type: 'park' },
  { index: 30, name: 'Buseta Trasan', type: 'bus', price: 200 },
  { index: 31, name: 'Sorpresa', type: 'chance' },
  { index: 32, name: 'Caobos', type: 'property', price: 260 },
  { index: 33, name: 'La rivera', type: 'property', price: 260 },
  { index: 34, name: 'Ser. Tel', type: 'service', price: 200, service: 'telephone' },
  { index: 35, name: 'San Luis', type: 'property', price: 280 },
  { index: 36, name: 'Ir a la carcel', type: 'go-to-jail' },
  { index: 37, name: 'Tesoreria', type: 'treasury' },
  { index: 38, name: 'Colsag', type: 'property', price: 300 },
  { index: 39, name: 'Niza', type: 'property', price: 300 },
  { index: 40, name: 'Prados del Norte', type: 'property', price: 320 },
  { index: 41, name: 'Sitio de apuestas', type: 'betting' },
  { index: 42, name: 'Buseta', type: 'bus', price: 200 },
  { index: 43, name: 'Impuesto', type: 'tax', tax: 200 },
  { index: 44, name: 'Prados del Este', type: 'property', price: 350 },
  { index: 45, name: 'Sorpresa', type: 'chance' },
  { index: 46, name: 'San Mateo', type: 'property', price: 400 },
  { index: 47, name: 'Parque Santander', type: 'park' },
]

export const BUS_TILES = [5, 17, 30, 42] as const
export const SERVICE_TILES = [6, 15, 34] as const
export const WATER_TILE = 6
export const ELECTRICITY_TILE = 15
export const TELEPHONE_TILE = 34
export const JAIL_TILE = 12

/** Posición en el grid perimetral 13×13. */
export function gridPosition(index: number): { column: number; row: number } {
  if (index === 0) return { column: 13, row: 13 }
  if (index <= 11) return { column: 13 - index, row: 13 }
  if (index === 12) return { column: 1, row: 13 }
  if (index <= 23) return { column: 1, row: 25 - index }
  if (index === 24) return { column: 1, row: 1 }
  if (index <= 35) return { column: index - 23, row: 1 }
  if (index === 36) return { column: 13, row: 1 }
  return { column: 13, row: index - 35 }
}
