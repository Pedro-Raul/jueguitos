import { BOARD, type Tile } from './board'
import {
  HOTEL_LEVEL,
  buildCostFor,
  buildableColor,
  rentRateFor,
} from './buildings'
import { RULES } from './rules.config'
import { groupNameFor, tileIcon } from './visual'

export type PropertyGroup = {
  key: string
  label: string
  color: string | null
  tiles: Tile[]
}

export type RentRow = {
  label: string
  value: string
}

/** Casillas compradas por un jugador, en el orden del tablero. */
export function ownedProperties(
  owners: Record<number, string | null>,
  playerId: string,
): Tile[] {
  return BOARD.filter(
    (tile) => tile.price !== undefined && owners[tile.index] === playerId,
  )
}

/**
 * Agrupa por color solo las propiedades edificables. Busetas y servicios no
 * tienen grupo de color y conservan una sección neutra con el mismo formato.
 */
export function groupProperties(tiles: Tile[]): PropertyGroup[] {
  const groups = new Map<string, PropertyGroup>()

  for (const tile of tiles) {
    const color = buildableColor(tile.index)
    let key: string
    let label: string

    if (color) {
      key = `color:${color}`
      label = groupNameFor(tile)
    } else if (tile.type === 'bus') {
      key = 'type:bus'
      label = 'Busetas'
    } else if (tile.type === 'service') {
      key = 'type:service'
      label = 'Servicios'
    } else {
      key = 'type:other'
      label = 'Otras'
    }

    const existing = groups.get(key)
    if (existing) {
      existing.tiles.push(tile)
    } else {
      groups.set(key, { key, label, color, tiles: [tile] })
    }
  }

  return [...groups.values()]
}

/**
 * Filas de alquiler construidas únicamente con los datos existentes en
 * `BOARD` + `RULES`. Si una casilla no tiene precio, no inventa una tabla.
 */
export function rentRowsFor(tile: Tile): RentRow[] {
  const price = tile.price
  if (price === undefined) return []

  if (tile.type === 'property') {
    const labels = ['Base', '1 casa', '2 casas', '3 casas', '4 casas', 'Hotel']
    return labels.map((label, level) => ({
      label,
      value: `$${Math.round(price * rentRateFor(level))}`,
    }))
  }

  if (tile.type === 'bus') {
    return RULES.busRents.map((rent, index) => ({
      label: `${index + 1} ${index === 0 ? 'buseta' : 'busetas'}`,
      value: `$${rent}`,
    }))
  }

  if (tile.type === 'service') {
    return RULES.serviceMultipliers.map((multiplier, index) => ({
      label: `${index + 1} ${index === 0 ? 'servicio' : 'servicios'}`,
      value: `${multiplier}× dados`,
    }))
  }

  return []
}

export function levelLabel(level: number): string {
  if (level >= HOTEL_LEVEL) return 'Hotel'
  if (level <= 0) return 'Sin casas'
  return `${level} ${level === 1 ? 'casa' : 'casas'}`
}

export function levelIcons(level: number): string {
  if (level >= HOTEL_LEVEL) return '🏨'
  return '🏠'.repeat(Math.max(0, Math.min(HOTEL_LEVEL - 1, level)))
}

export function propertyGroupLabel(tile: Tile): string {
  if (buildableColor(tile.index)) return groupNameFor(tile)
  if (tile.type === 'bus') return 'Busetas'
  if (tile.type === 'service') return 'Servicios'
  return groupNameFor(tile)
}

export function propertyBandIcon(tile: Tile): string | null {
  return buildableColor(tile.index) ? null : tileIcon(tile)
}

export function propertyBuildCost(tile: Tile): number | null {
  return buildCostFor(tile.index)
}
