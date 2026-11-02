import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BOARD, gridPosition, type Tile } from '../board'
import type { CucupolyState } from '../engine'
import type { Player } from '../../../types'
import type { RollPlan } from '../planAnimations'
import { tileColor } from '../visual'
import { createCenterTexture, createTileTexture, setMaxAnisotropy } from './textures'
import { computeFraming } from './framing'
import { CELL, TILE_TOP } from './layout'
import { Dice, type DiceRoll } from './Dice'
import { Tokens } from './Tokens'

type BoardSceneProps = {
  state: CucupolyState
  players: Player[]
  /** Última tirada a animar; null si no hay ninguna en juego. */
  roll: DiceRoll | null
  /** Plan de la tirada (qué ficha camina y por dónde). */
  walk: RollPlan | null
  /** false mientras corren los dados: las fichas esperan para caminar. */
  tokenGate: boolean
  onSelectTile: (index: number) => void
  onBusyChange: (busy: boolean) => void
}

/** ~62°: las casillas lejanas se leen mejor sin perder la sensación 3D. */
const TILT = (62 * Math.PI) / 180
const FOV = 42

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function CameraRig() {
  const { camera, size } = useThree()

  useLayoutEffect(() => {
    const framing = computeFraming(size.width, size.height, { tilt: TILT, fov: FOV })
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = framing.fov
    perspective.near = 0.1
    perspective.far = framing.distance * 3 + 60
    perspective.position.set(
      0,
      framing.targetZ + framing.distance * Math.sin(framing.tilt),
      framing.targetZ + framing.distance * Math.cos(framing.tilt),
    )
    perspective.lookAt(0, 0, framing.targetZ)
    perspective.updateProjectionMatrix()
  }, [camera, size.height, size.width])

  return null
}

/** Fija la anisotropía máxima del renderer antes de crear las texturas. */
function RendererSetup() {
  const gl = useThree((state) => state.gl)
  setMaxAnisotropy(gl.capabilities.getMaxAnisotropy())
  return null
}

function OwnerFlag({ color }: { color: string }) {
  return (
    <group position={[0.29, TILE_TOP, -0.29]}>
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.2, 8]} />
        <meshStandardMaterial color="#3B3327" roughness={0.7} />
      </mesh>
      <mesh position={[0.07, 0.19, 0]} castShadow>
        <boxGeometry args={[0.14, 0.09, 0.02]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.55} />
      </mesh>
    </group>
  )
}

function TileMesh({
  tile,
  ownerColor,
  onSelect,
}: {
  tile: Tile
  ownerColor: string | null
  onSelect: (index: number) => void
}) {
  const texture = useMemo(() => createTileTexture(tile), [tile])
  const [hovered, setHovered] = useState(false)
  useEffect(() => () => texture.dispose(), [texture])

  const { column, row } = gridPosition(tile.index)
  const x = (column - 7) * CELL
  const z = (row - 7) * CELL
  const color = tileColor(tile)

  return (
    <group
      position={[x, hovered ? 0.045 : 0, z]}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(tile.index)
      }}
      onPointerOver={() => {
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = ''
      }}
    >
      <mesh position={[0, 0.11, 0]} receiveShadow>
        <boxGeometry args={[0.96, 0.22, 0.96]} />
        <meshStandardMaterial
          color={color}
          roughness={0.92}
          metalness={0.02}
          emissive={hovered ? color : '#000000'}
          emissiveIntensity={hovered ? 0.28 : 0}
        />
      </mesh>
      <mesh position={[0, TILE_TOP + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[0.94, 0.94]} />
        <meshStandardMaterial
          map={texture}
          roughness={0.88}
          emissive="#FFFFFF"
          emissiveIntensity={hovered ? 0.1 : 0}
        />
      </mesh>
      {ownerColor ? <OwnerFlag color={ownerColor} /> : null}
    </group>
  )
}

function CenterLogo() {
  const texture = useMemo(() => createCenterTexture(), [])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
      <planeGeometry args={[10.7, 10.7]} />
      <meshStandardMaterial map={texture} roughness={0.95} />
    </mesh>
  )
}

function Board({
  state,
  players,
  onSelectTile,
}: {
  state: CucupolyState
  players: Player[]
  onSelectTile: (index: number) => void
}) {
  return (
    <group>
      <mesh position={[0, -0.18, 0]} receiveShadow>
        <boxGeometry args={[13.6, 0.36, 13.6]} />
        <meshStandardMaterial color="#2F4A39" roughness={0.9} metalness={0.05} />
      </mesh>

      <CenterLogo />

      {BOARD.map((tile) => {
        const ownerId = state.owners[tile.index]
        const owner = ownerId ? players.find((player) => player.id === ownerId) : undefined
        return (
          <TileMesh
            key={tile.index}
            tile={tile}
            ownerColor={owner?.color ?? null}
            onSelect={onSelectTile}
          />
        )
      })}
    </group>
  )
}

export default function BoardScene({
  state,
  players,
  roll,
  walk,
  tokenGate,
  onSelectTile,
  onBusyChange,
}: BoardSceneProps) {
  const webgl = useMemo(supportsWebGL, [])
  const animating = useRef(new Set<string>())
  const [busy, setBusy] = useState(false)

  const handleAnimating = useCallback((playerId: string, active: boolean) => {
    if (active) animating.current.add(playerId)
    else animating.current.delete(playerId)
    setBusy(animating.current.size > 0)
  }, [])

  // Layout: el padre deshabilita las acciones antes de pintar el fotograma en
  // el que arranca la caminata.
  useLayoutEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])

  useLayoutEffect(() => () => onBusyChange(false), [onBusyChange])

  if (!webgl) {
    return (
      <div className="cp-webgl">
        <strong>Tu navegador no soporta WebGL.</strong>
        <p>Activa la aceleración por hardware o prueba con otro navegador para ver el tablero 3D.</p>
      </div>
    )
  }

  return (
    <Canvas
      dpr={[1, 2]}
      shadows="soft"
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: FOV, near: 0.1, far: 200, position: [0, 18, 13] }}
    >
      <CameraRig />
      <RendererSetup />
      <hemisphereLight args={['#E8F3E4', '#13251B', 0.8]} />
      <directionalLight
        position={[7, 14, 9]}
        intensity={1.25}
        color="#FFF6E3"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-radius={4}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-6, 7, -8]} intensity={0.35} color="#FBD9A0" />

      <Board state={state} players={players} onSelectTile={onSelectTile} />
      <Tokens
        state={state}
        players={players}
        walk={walk}
        gate={tokenGate}
        onAnimating={handleAnimating}
      />
      <Dice roll={roll} />
    </Canvas>
  )
}
