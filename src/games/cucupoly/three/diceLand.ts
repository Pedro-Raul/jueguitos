/**
 * Matemática pura del aterrizaje de dados (sin three). El BoxGeometry usa las
 * caras [+X, -X, +Y, -Y, +Z, -Z] con los valores DIE_FACES; `landRotation`
 * devuelve la matriz de rotación (fila a fila) que deja el valor correcto
 * boca arriba (+Y del mundo), y `spinFor` los parámetros de giro guionado.
 */
export type Vec3 = readonly [number, number, number]
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

/** Valor de cada cara según el orden de materiales de BoxGeometry. */
export const DIE_FACES: readonly number[] = [1, 6, 2, 5, 3, 4]

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const UP: Vec3 = [0, 1, 0]
const FACE_VECTORS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

export function faceNormal(value: number): Vec3 {
  const index = DIE_FACES.indexOf(value)
  return index < 0 ? UP : FACE_VECTORS[index]
}

export function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length === 0) return [0, 0, 1]
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Rota `vector` por `matrix` (filas). */
export function apply(matrix: Mat3, vector: Vec3): Vec3 {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ]
}

/** Matriz de rotación por eje-ángulo (Rodrigues). */
export function axisAngle(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = normalize(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

/** Rotación que deja la cara `value` mirando hacia arriba. */
export function landRotation(value: number): Mat3 {
  const normal = faceNormal(value)
  const dot = normal[0] * UP[0] + normal[1] * UP[1] + normal[2] * UP[2]
  if (dot > 0.999) return IDENTITY
  if (dot < -0.999) return axisAngle([1, 0, 0], Math.PI)
  return axisAngle(normalize(cross(normal, UP)), Math.PI / 2)
}

/**
 * Parámetros de vuelo de cada dado, deterministas solo con (valor, índice):
 * todos los clientes reproducen exactamente la misma animación.
 */
export function spinFor(value: number, index: number): { axis: Vec3; turns: number } {
  const axis = normalize([0.55 + (value % 3) * 0.3, 0.85, -0.6 + (index % 2 === 0 ? 0.15 : -0.35)])
  return { axis, turns: 3 + ((value + index) % 2) * 0.5 }
}
