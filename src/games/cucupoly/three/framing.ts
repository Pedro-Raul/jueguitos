/**
 * Encuadre de cámara del tablero. Es una función pura (sin three) para poder
 * probar el criterio medible: las cuatro esquinas del tablero, proyectadas,
 * deben ocupar al menos el 94 % de la dimensión menor del viewport.
 */

export type Vec3 = [number, number, number]

export type ScreenBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type FramingOptions = {
  /** Inclinación de la cámara en radianes (0 = cenital). */
  tilt?: number
  /** Campo de visión vertical en grados. */
  fov?: number
  /** Fracción de la dimensión menor que debe ocupar el tablero. */
  fill?: number
  /** Media anchura del tablero en unidades del mundo. */
  halfSize?: number
}

export type Framing = {
  distance: number
  tilt: number
  fov: number
  /** Altura del punto al que mira la cámara; centra el tablero en pantalla. */
  targetZ: number
  bounds: ScreenBounds
  /** Cobertura real de la dimensión menor (0–1). */
  fill: number
}

type Basis = {
  eye: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
}

const DEG = Math.PI / 180

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** Base de la cámara mirando al punto (0, 0, targetZ) desde la distancia dada. */
export function cameraBasis(distance: number, tilt: number, targetZ: number): Basis {
  const target: Vec3 = [0, 0, targetZ]
  const eye: Vec3 = [
    0,
    targetZ + distance * Math.sin(tilt),
    targetZ + distance * Math.cos(tilt),
  ]
  const forward = normalize(sub(target, eye))
  const right = normalize(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  return { eye, forward, right, up }
}

/** Proyecta un punto del mundo a píxeles del viewport. */
export function projectPoint(
  point: Vec3,
  basis: Basis,
  fov: number,
  width: number,
  height: number,
): { x: number; y: number; depth: number } {
  const v = sub(point, basis.eye)
  const depth = dot(v, basis.forward)
  const tan = Math.tan((fov / 2) * DEG)
  const aspect = width / Math.max(1, height)
  const ndcX = dot(v, basis.right) / depth / (tan * aspect)
  const ndcY = dot(v, basis.up) / depth / tan
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
    depth,
  }
}

/** Las cuatro esquinas del tablero (cara superior) en el mundo. */
export function boardCorners(halfSize: number): Vec3[] {
  return [
    [-halfSize, 0, -halfSize],
    [halfSize, 0, -halfSize],
    [halfSize, 0, halfSize],
    [-halfSize, 0, halfSize],
  ]
}

function boundsAt(
  width: number,
  height: number,
  distance: number,
  tilt: number,
  fov: number,
  targetZ: number,
  halfSize: number,
): ScreenBounds {
  const basis = cameraBasis(distance, tilt, targetZ)
  const points = boardCorners(halfSize).map((corner) =>
    projectPoint(corner, basis, fov, width, height),
  )
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function coverage(bounds: ScreenBounds, width: number, height: number): number {
  return width >= height
    ? (bounds.maxY - bounds.minY) / Math.max(1, height)
    : (bounds.maxX - bounds.minX) / Math.max(1, width)
}

/** Elige targetZ para que la caja proyectada quede centrada en vertical. */
function centerTargetZ(
  width: number,
  height: number,
  distance: number,
  tilt: number,
  fov: number,
  halfSize: number,
): number {
  let lo = -halfSize
  let hi = halfSize
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    const bounds = boundsAt(width, height, distance, tilt, fov, mid, halfSize)
    const center = (bounds.minY + bounds.maxY) / 2
    if (center > height / 2) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Calcula la distancia y el punto de mira para que el tablero ocupe `fill`
 * (0.94 por defecto) de la dimensión menor del viewport, sin recortar ninguna
 * esquina. Se recalcula con cada cambio de tamaño del canvas.
 */
export function computeFraming(
  width: number,
  height: number,
  options: FramingOptions = {},
): Framing {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const tilt = options.tilt ?? 62 * DEG
  const fov = options.fov ?? 42
  const halfSize = options.halfSize ?? 6.8
  const targetFill = options.fill ?? 0.94

  const measure = (distance: number) => {
    const targetZ = centerTargetZ(safeWidth, safeHeight, distance, tilt, fov, halfSize)
    const bounds = boundsAt(safeWidth, safeHeight, distance, tilt, fov, targetZ, halfSize)
    return { targetZ, bounds, fill: coverage(bounds, safeWidth, safeHeight) }
  }

  // Más distancia ⇒ tablero más pequeño. Buscamos el mayor tablero que no
  // pase del objetivo de cobertura.
  let lo = 1
  let hi = 1000
  for (let i = 0; i < 70; i += 1) {
    const mid = (lo + hi) / 2
    if (measure(mid).fill > targetFill) lo = mid
    else hi = mid
  }
  let distance = (lo + hi) / 2
  let result = measure(distance)

  // En aspect ratios extremos la otra dimensión podría recortar esquinas:
  // alejamos la cámara hasta que las cuatro estén dentro del viewport.
  for (let i = 0; i < 80; i += 1) {
    const { bounds } = result
    const fits =
      bounds.minX >= 0 &&
      bounds.maxX <= safeWidth &&
      bounds.minY >= 0 &&
      bounds.maxY <= safeHeight
    if (fits) break
    distance *= 1.02
    result = measure(distance)
  }

  return {
    distance,
    tilt,
    fov,
    targetZ: result.targetZ,
    bounds: result.bounds,
    fill: result.fill,
  }
}

/**
 * Tamaño en píxeles de una casilla horizontal (plano de `side` unidades)
 * centrada en `center`. Sirve para medir la legibilidad del texto en pantalla.
 */
export function projectedTileSize(
  center: Vec3,
  framing: Framing,
  width: number,
  height: number,
  side = 0.94,
): { width: number; height: number } {
  const basis = cameraBasis(framing.distance, framing.tilt, framing.targetZ)
  const half = side / 2
  const corners: Vec3[] = [
    [center[0] - half, center[1], center[2] - half],
    [center[0] + half, center[1], center[2] - half],
    [center[0] + half, center[1], center[2] + half],
    [center[0] - half, center[1], center[2] + half],
  ]
  const points = corners.map((corner) => projectPoint(corner, basis, framing.fov, width, height))
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)
  return {
    width: (distance(points[0], points[1]) + distance(points[3], points[2])) / 2,
    height: (distance(points[0], points[3]) + distance(points[1], points[2])) / 2,
  }
}
