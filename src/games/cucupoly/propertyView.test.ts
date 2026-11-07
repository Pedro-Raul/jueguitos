import { describe, expect, it } from 'vitest'
import { BOARD } from './board'
import { HOTEL_LEVEL } from './buildings'
import { RULES } from './rules.config'
import {
  groupProperties,
  levelIcons,
  levelLabel,
  ownedProperties,
  propertyBandIcon,
  propertyBuildCost,
  propertyGroupLabel,
  rentRowsFor,
} from './propertyView'
import { TILE_COLORS } from './visual'

const owners: Record<number, string | null> = {
  1: 'ana',
  3: 'ana',
  6: 'ana',
  15: 'ana',
  8: 'beto',
}

describe('visor de propiedades', () => {
  it('devuelve solo las casillas compradas por el jugador', () => {
    const tiles = ownedProperties(owners, 'ana')
    expect(tiles.map((tile) => tile.index)).toEqual([1, 3, 6, 15])
    expect(ownedProperties(owners, 'beto').map((tile) => tile.index)).toEqual([8])
    expect(ownedProperties(owners, 'nadie')).toEqual([])
  })

  it('agrupa por color y separa busetas y servicios con estilos neutros', () => {
    const groups = groupProperties(ownedProperties(owners, 'ana'))
    expect(groups.map((group) => group.key)).toEqual([
      `color:${TILE_COLORS[1]}`,
      'type:bus',
      'type:service',
    ])
    expect(groups[0].label).toBe('Marrón')
    expect(groups[0].tiles.map((tile) => tile.index)).toEqual([1, 3])
    expect(groups[1].color).toBeNull()
    expect(groups[2].color).toBeNull()
  })

  it('deriva la tabla de alquiler de las reglas existentes', () => {
    const rows = rentRowsFor(BOARD[1])
    expect(rows).toHaveLength(6)
    expect(rows[0]).toEqual({
      label: 'Base',
      value: `$${Math.round((BOARD[1].price ?? 0) * RULES.propertyRentRates[0])}`,
    })
    expect(rows[5]).toEqual({
      label: 'Hotel',
      value: `$${Math.round((BOARD[1].price ?? 0) * RULES.propertyRentRates[HOTEL_LEVEL])}`,
    })
  })

  it('usa las tablas de busetas y servicios sin inventar datos', () => {
    const busRows = rentRowsFor(BOARD[6])
    expect(busRows).toHaveLength(RULES.busRents.length)
    expect(busRows[0].value).toBe(`$${RULES.busRents[0]}`)
    expect(busRows[3].label).toBe('4 busetas')

    const serviceRows = rentRowsFor(BOARD[15])
    expect(serviceRows).toHaveLength(RULES.serviceMultipliers.length)
    expect(serviceRows[0].value).toBe(`${RULES.serviceMultipliers[0]}× dados`)
    expect(rentRowsFor(BOARD[0])).toEqual([])
  })

  it('describe el nivel con iconos y texto', () => {
    expect(levelLabel(0)).toBe('Sin casas')
    expect(levelLabel(1)).toBe('1 casa')
    expect(levelLabel(3)).toBe('3 casas')
    expect(levelLabel(HOTEL_LEVEL)).toBe('Hotel')
    expect(levelIcons(0)).toBe('')
    expect(levelIcons(2)).toBe('🏠🏠')
    expect(levelIcons(HOTEL_LEVEL)).toBe('🏨')
  })

  it('expone grupo, icono y costo solo cuando existen', () => {
    expect(propertyGroupLabel(BOARD[1])).toBe('Marrón')
    expect(propertyGroupLabel(BOARD[6])).toBe('Busetas')
    expect(propertyGroupLabel(BOARD[15])).toBe('Servicios')
    expect(propertyBandIcon(BOARD[1])).toBeNull()
    expect(propertyBandIcon(BOARD[6])).toBe('🚌')
    expect(propertyBuildCost(BOARD[1])).toBe(50)
    expect(propertyBuildCost(BOARD[6])).toBeNull()
  })
})
