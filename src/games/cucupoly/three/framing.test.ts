import { describe, expect, it } from 'vitest'
import { boardCorners, computeFraming, projectPoint, cameraBasis } from './framing'

const TILT = (62 * Math.PI) / 180

describe('encuadre del tablero', () => {
  it('ocupa al menos el 94 % de la dimensión menor a 1366×768', () => {
    const framing = computeFraming(1366, 768, { tilt: TILT })
    expect(framing.fill).toBeGreaterThanOrEqual(0.94)
    expect(framing.fill).toBeLessThan(0.9505)
    expect(framing.bounds.minX).toBeGreaterThanOrEqual(0)
    expect(framing.bounds.maxX).toBeLessThanOrEqual(1366)
    expect(framing.bounds.minY).toBeGreaterThanOrEqual(0)
    expect(framing.bounds.maxY).toBeLessThanOrEqual(768)
  })

  it('ocupa al menos el 94 % de la dimensión menor a 390×844', () => {
    const framing = computeFraming(390, 844, { tilt: TILT })
    expect(framing.fill).toBeGreaterThanOrEqual(0.94)
    expect(framing.fill).toBeLessThan(0.9505)
    expect(framing.bounds.minX).toBeGreaterThanOrEqual(0)
    expect(framing.bounds.maxX).toBeLessThanOrEqual(390)
    expect(framing.bounds.minY).toBeGreaterThanOrEqual(0)
    expect(framing.bounds.maxY).toBeLessThanOrEqual(844)
  })

  it('cumple con el canvas real, ya descontada la franja lateral', () => {
    // 1366×768 con una franja de 156 px deja 1210×768 para el canvas.
    const framing = computeFraming(1210, 768, { tilt: TILT })
    expect(framing.fill).toBeGreaterThanOrEqual(0.94)
    expect(framing.fill).toBeLessThan(0.9505)
    expect(framing.bounds.minX).toBeGreaterThanOrEqual(0)
    expect(framing.bounds.maxX).toBeLessThanOrEqual(1210)
    expect(framing.bounds.minY).toBeGreaterThanOrEqual(0)
    expect(framing.bounds.maxY).toBeLessThanOrEqual(768)
  })

  it('se recalcula al cambiar de tamaño', () => {
    const wide = computeFraming(1600, 900, { tilt: TILT })
    const narrow = computeFraming(900, 1600, { tilt: TILT })
    expect(wide.distance).not.toBeCloseTo(narrow.distance, 3)
    expect(wide.fill).toBeGreaterThanOrEqual(0.94)
    expect(narrow.fill).toBeGreaterThanOrEqual(0.94)
  })

  it('proyecta las cuatro esquinas dentro del viewport', () => {
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
      [1920, 1080],
      [844, 390],
    ]) {
      const framing = computeFraming(width, height, { tilt: TILT })
      const basis = cameraBasis(framing.distance, framing.tilt, framing.targetZ)
      for (const corner of boardCorners(6.8)) {
        const point = projectPoint(corner, basis, framing.fov, width, height)
        expect(point.x).toBeGreaterThanOrEqual(-0.5)
        expect(point.x).toBeLessThanOrEqual(width + 0.5)
        expect(point.y).toBeGreaterThanOrEqual(-0.5)
        expect(point.y).toBeLessThanOrEqual(height + 0.5)
      }
    }
  })
})
