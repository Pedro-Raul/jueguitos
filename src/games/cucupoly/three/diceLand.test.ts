import { describe, expect, it } from 'vitest'
import {
  DIE_FACES,
  apply,
  faceNormal,
  landRotation,
  spinFor,
  type Mat3,
  type Vec3,
} from './diceLand'

const UP: Vec3 = [0, 1, 0]
const TAU = Math.PI * 2

function toClose(actual: Vec3, expected: Vec3): void {
  actual.forEach((component, index) => {
    expect(component).toBeCloseTo(expected[index], 6)
  })
}

function determinant(matrix: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = matrix
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

describe('caras del dado', () => {
  it('mantiene las caras opuestas sumando 7', () => {
    for (let side = 0; side < 3; side += 1) {
      expect((DIE_FACES[side * 2] ?? 0) + (DIE_FACES[side * 2 + 1] ?? 0)).toBe(7)
    }
    expect(DIE_FACES).toHaveLength(6)
  })

  it('conoce el vector normal de cada valor', () => {
    expect(faceNormal(1)).toEqual([1, 0, 0])
    expect(faceNormal(6)).toEqual([-1, 0, 0])
    expect(faceNormal(2)).toEqual([0, 1, 0])
    expect(faceNormal(5)).toEqual([0, -1, 0])
    expect(faceNormal(3)).toEqual([0, 0, 1])
    expect(faceNormal(4)).toEqual([0, 0, -1])
  })
})

describe('orientación final de cada cara del dado', () => {
  for (const value of [1, 2, 3, 4, 5, 6]) {
    it(`deja el ${value} boca arriba al aterrizar`, () => {
      const rotation = landRotation(value)
      toClose(apply(rotation, faceNormal(value)), UP)
    })
  }

  it('produce matrices de rotación válidas (ortonormales, det 1)', () => {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      const matrix = landRotation(value)
      const rows: Vec3[] = [
        [matrix[0], matrix[1], matrix[2]],
        [matrix[3], matrix[4], matrix[5]],
        [matrix[6], matrix[7], matrix[8]],
      ]
      expect(determinant(matrix)).toBeCloseTo(1, 6)
      for (const row of rows) {
        expect(Math.hypot(...row)).toBeCloseTo(1, 6)
      }
    }
  })

  it('no rota cuando el 2 ya está arriba', () => {
    expect(landRotation(2)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
})

describe('giro guionado por dado', () => {
  it('es determinista: mismos valores, mismo vuelo en todos los clientes', () => {
    expect(spinFor(4, 1)).toEqual(spinFor(4, 1))
    expect(spinFor(2, 0)).toEqual(spinFor(2, 0))
  })

  it('varía el vuelo entre dados distintos', () => {
    expect(spinFor(1, 0)).not.toEqual(spinFor(3, 1))
  })

  it('devuelve ejes normalizados y un número entero o medio de vueltas', () => {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      for (const index of [0, 1, 2]) {
        const { axis, turns } = spinFor(value, index)
        expect(Math.hypot(...axis)).toBeCloseTo(1, 6)
        expect(turns).toBeGreaterThanOrEqual(3)
        expect(turns * 2).toBe(Math.round(turns * 2))
      }
    }
  })

  it('con vueltas completas el ángulo total recorre múltiplos de 2π', () => {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      const { turns } = spinFor(value, 0)
      expect((turns * TAU) % Math.PI).toBeCloseTo(0, 9)
    }
  })
})
