import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BOARD, gridPosition, type Tile } from '../board'
import type { CucupolyState } from '../engine'
import type { Player } from '../../../types'
import { tileColor } from '../visual'
import { createCenterTexture, createTileTexture } from './textures'
import { CELL, TILE_TOP } from './layout'
import { Dice, type DiceRoll } from './Dice'
import { Tokens } from './Tokens'

type BoardSceneProps = {
  state: CucupolyState
  players: Player[]
  /** Última tirada a animar; null si no hay ninguna en juego. */
  roll: DiceRoll | null
  /** false mientras corren los dados: las fichas esperan para caminar. */
  tokenGate: boolean
  onSelectTile: (index: number) => void
  onBusyChange: (busy: boolean) => void
}

const TILT = (55 * Math.PI) / 180
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
    const aspect = size.width / Math.max(1, size.height)
    const tan = Math.tan((FOV / 2) * (Math.PI / 180))

    // Deja aire para la franja superior y la barra inferior.
    const availableWidth = Math.max(260, size.width - 24)
    const availableHeight = Math.max(240, size.height - 196)
    const fillWidth = Math.min(1, availableWidth / size.width)
    const fillHeight = Math.min(1, availableHeight / size.height)

    const boardWidth = 14.4
    const boardDepth = 14.4 * Math.sin(TILT)
    const distanceForWidth = boardWidth / (fillWidth * 2 * tan * aspect)
    const distanceForHeight = boardDepth / (fillHeight * 2 * tan)
    const distance = Math.max(distanceForWidth, distanceForHeight, 13)

    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = FOV
    perspective.near = 0.1
    perspective.far = distance * 3 + 60
    perspective.position.set(0, distance * Math.sin(TILT), distance * Math.cos(TILT))
    perspective.lookAt(0, 0, 0.6)
    perspective.updateProjectionMatrix()
  }, [camera, size.height, size.width])

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

  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])

  useEffect(() => () => onBusyChange(false), [onBusyChange])

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
      <Tokens state={state} players={players} gate={tokenGate} onAnimating={handleAnimating} />
      <Dice roll={roll} />
    </Canvas>
  )
}
