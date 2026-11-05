import { BOARD } from './board'
import { RULES } from './rules.config'
import { groupNameFor, TILE_COLORS } from './visual'

/** Casas por propiedad antes de poder montar el hotel. */
export const MAX_HOUSES = 4
/** Nivel que representa el hotel (5.º edificio). */
export const HOTEL_LEVEL = 5

/** Campos del estado que necesitan las reglas de construcción. */
export type BuildState = {
  owners: Record<number, string | null>
  buildings: Record<number, number>
}

export type BuildGroup = {
  color: string
  name: string
  cost: number
  tiles: number[]
}

/**
 * El xlsx no define hipotecas y el juego no las implementa, así que no hay
 * nada que comprobar por ese lado: el grupo solo debe estar completo.
 */
const BUILDING_COSTS = RULES.buildingCosts as Record<string, number>

/** Color de grupo edificable, o null si la casilla no admite edificios. */
export function buildableColor(tileId: number): string | null {
  const color = TILE_COLORS[tileId]
  return color && BUILDING_COSTS[color] !== undefined ? color : null
}

/** Todas las casillas del grupo de color de `tileId` (vacío si no es propiedad). */
export function groupTilesFor(tileId: number): number[] {
  const color = buildableColor(tileId)
  if (!color) return []
  return BOARD.filter((tile) => TILE_COLORS[tile.index] === color).map((tile) => tile.index)
}

/**
 * Costo de una casa/hotel. El multiplicador lo decide la fase final para que
 * el HUD y el cobro usen exactamente el mismo importe.
 */
export function buildCostFor(tileId: number, multiplier = 1): number | null {
  const color = buildableColor(tileId)
  if (!color) return null
  const base = BUILDING_COSTS[color]
  return base === undefined ? null : Math.round(base * multiplier)
}

export function buildingLevelFor(state: BuildState, tileId: number): number {
  return state.buildings[tileId] ?? 0
}

/** Múltiplo de alquiler según el nivel: 0..4 casas o 5 = hotel. */
export function rentRateFor(level: number): number {
  const clamped = Math.max(0, Math.min(HOTEL_LEVEL, Math.floor(level)))
  return RULES.propertyRentRates[clamped] ?? RULES.propertyRentRates[0]
}

/** Grupos de color completos del jugador, con su costo y nivel por casilla. */
export function completeGroupsFor(
  state: BuildState,
  playerId: string,
  multiplier = 1,
): BuildGroup[] {
  const seen = new Set<string>()
  const groups: BuildGroup[] = []

  for (const tile of BOARD) {
    const color = buildableColor(tile.index)
    if (!color || seen.has(color)) continue

    const tiles = groupTilesFor(tile.index)
    if (!tiles.every((id) => state.owners[id] === playerId)) continue

    seen.add(color)
    const base = BUILDING_COSTS[color] ?? 0
    groups.push({
      color,
      name: groupNameFor(tile),
      cost: Math.round(base * multiplier),
      tiles,
    })
  }

  return groups
}

/**
 * Motivo por el que el jugador no puede construir ese edificio, o null si es
 * legal. No mira fase, turno ni saldo: eso lo valida el reducer.
 */
export function buildRuleError(
  state: BuildState,
  tileId: number,
  playerId: string,
  kind: 'house' | 'hotel',
): string | null {
  const tile = BOARD[tileId]
  if (!tile || tile.type !== 'property') return 'Esa casilla no es una propiedad.'

  const tiles = groupTilesFor(tileId)
  if (tiles.length === 0) return 'Ese grupo no permite edificios.'
  if (state.owners[tileId] !== playerId) return 'No eres el dueño de esa propiedad.'
  if (!tiles.every((id) => state.owners[id] === playerId)) {
    return 'Necesitas el grupo de color completo para construir.'
  }

  const level = buildingLevelFor(state, tileId)
  if (kind === 'house') {
    if (level >= MAX_HOUSES) return 'Ya hay 4 casas; ahora toca montar el hotel.'
  } else {
    if (level < MAX_HOUSES) return 'Necesitas 4 casas antes de montar el hotel.'
    if (level >= HOTEL_LEVEL) return 'Esa propiedad ya tiene hotel.'
  }

  // Construcción pareja: solo se sube la propiedad con menos nivel del grupo.
  const lowest = Math.min(...tiles.map((id) => buildingLevelFor(state, id)))
  if (level > lowest) {
    return 'Construye de forma pareja: primero las propiedades con menos nivel.'
  }

  return null
}
