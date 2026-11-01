import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Player } from '../../../types'
import type { CucupolyState } from '../engine'
import { pathBetween } from '../visual'
import { createEmojiTexture } from './textures'
import { HOP_HEIGHT, HOP_SECONDS, tileWorld } from './layout'

type AnimatingHandler = (playerId: string, animating: boolean) => void

const RING_FALLBACKS = ['#FFD166', '#06D6A0', '#118AB2', '#EF476F', '#8338EC', '#FB5607']

/** Asigna un color de anillo distinto a cada jugador, aunque repitan color de perfil. */
function assignRingColors(players: Player[]): string[] {
  const used = new Set<string>()
  return players.map((player, index) => {
    let color = player.color
    if (used.has(color.toLowerCase())) {
      color = RING_FALLBACKS.find((candidate) => !used.has(candidate.toLowerCase())) ?? RING_FALLBACKS[index % RING_FALLBACKS.length]
    }
    used.add(color.toLowerCase())
    return color
  })
}

type TokenProps = {
  player: Player
  target: number
  direct: boolean
  /** false mientras corren los dados: la ficha guarda el destino y espera. */
  gate: boolean
  slotIndex: number
  slotCount: number
  ringColor: string
  onAnimating: AnimatingHandler
}

type Hop = { from: number; to: number }

function Token({ player, target, direct, gate, slotIndex, slotCount, ringColor, onAnimating }: TokenProps) {
  const outer = useRef<THREE.Group>(null)
  const display = useRef(target)
  const queue = useRef<Hop[]>([])
  const elapsed = useRef(0)
  const active = useRef(false)
  const mounted = useRef(false)
  const busy = useRef(false)
  const pending = useRef<number | null>(null)

  const slot = useMemo(() => {
    if (slotCount <= 1) return { x: 0, z: 0 }
    const angle = (slotIndex / slotCount) * Math.PI * 2 + Math.PI / 2
    return { x: Math.cos(angle) * 0.25, z: Math.sin(angle) * 0.25 }
  }, [slotIndex, slotCount])

  useLayoutEffect(() => {
    if (mounted.current) return
    mounted.current = true
    display.current = target
    const [x, y, z] = tileWorld(target)
    outer.current?.position.set(x, y, z)
  }, [target])

  useEffect(() => {
    if (!mounted.current) return
    if (target === display.current && queue.current.length === 0 && pending.current === null) return

    // Orden dados → ficha: con la puerta cerrada solo se anota el destino.
    if (!gate) {
      pending.current = target
      return
    }
    pending.current = null

    const steps = direct ? [target] : pathBetween(display.current, target)
    if (steps.length === 0) return

    let from = display.current
    const hops = steps.map((to) => {
      const hop = { from, to }
      from = to
      return hop
    })

    queue.current = hops
    elapsed.current = 0

    if (!active.current) {
      active.current = true
      if (!busy.current) {
        busy.current = true
        onAnimating(player.id, true)
      }
    }
  }, [target, direct, gate, onAnimating, player.id])

  useEffect(
    () => () => {
      if (busy.current) {
        busy.current = false
        onAnimating(player.id, false)
      }
    },
    [onAnimating, player.id],
  )

  useFrame((_, delta) => {
    const group = outer.current
    if (!group) return

    if (!active.current) {
      const [x, y, z] = tileWorld(display.current)
      group.position.set(x, y, z)
      group.rotation.set(0, 0, 0)
      return
    }

    const hop = queue.current[0]
    if (!hop) {
      active.current = false
      return
    }

    elapsed.current += delta
    const progress = Math.min(1, elapsed.current / HOP_SECONDS)
    const [ax, ay, az] = tileWorld(hop.from)
    const [bx, by, bz] = tileWorld(hop.to)

    // Inclinación en la dirección del salto: la ficha "camina" en vez de deslizar.
    const dx = bx - ax
    const dz = bz - az
    const dominant = Math.max(Math.abs(dx), Math.abs(dz)) || 1
    const lean = Math.sin(Math.PI * progress) * 0.32
    group.position.set(
      ax + dx * progress,
      ay + (by - ay) * progress + Math.sin(Math.PI * progress) * HOP_HEIGHT,
      az + dz * progress,
    )
    group.rotation.set((lean * dz) / dominant, 0, (-lean * dx) / dominant)

    if (progress >= 1) {
      display.current = hop.to
      queue.current.shift()
      elapsed.current = 0
      group.rotation.set(0, 0, 0)

      if (queue.current.length === 0) {
        active.current = false
        group.position.set(bx, by, bz)
        if (busy.current) {
          busy.current = false
          onAnimating(player.id, false)
        }
      }
    }
  })

  return (
    <group ref={outer}>
      <group position={[slot.x, 0, slot.z]}>
        <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.17, 0.028, 10, 24]} />
          <meshStandardMaterial
            color={ringColor}
            emissive={ringColor}
            emissiveIntensity={0.35}
            roughness={0.45}
          />
        </mesh>
        <TokenFigure emoji={player.emoji} color={player.color} />
      </group>
    </group>
  )
}

export function Tokens({
  state,
  players,
  gate,
  onAnimating,
}: {
  state: CucupolyState
  players: Player[]
  gate: boolean
  onAnimating: AnimatingHandler
}) {
  const previous = useRef<CucupolyState | null>(null)
  const prev = previous.current

  useEffect(() => {
    previous.current = state
  }, [state])

  const occupants = useMemo(() => {
    const map = new Map<number, Player[]>()
    for (const player of players) {
      if (state.bankrupt.includes(player.id)) continue
      const tile = state.positions[player.id] ?? 0
      const list = map.get(tile) ?? []
      list.push(player)
      map.set(tile, list)
    }
    return map
  }, [players, state.bankrupt, state.positions])

  const ringColors = useMemo(() => assignRingColors(players), [players])

  return (
    <>
      {players.map((player, index) => {
        if (state.bankrupt.includes(player.id)) return null

        const target = state.positions[player.id] ?? 0
        const before = prev?.positions[player.id]
        const direct =
          !prev ||
          before === undefined ||
          before === target ||
          prev.phase === 'bus-move' ||
          (prev.inJail[player.id] !== true && state.inJail[player.id] === true)

        const group = occupants.get(target) ?? [player]
        const slotIndex = Math.max(
          0,
          group.findIndex((candidate) => candidate.id === player.id),
        )

        return (
          <Token
            key={player.id}
            player={player}
            target={target}
            direct={direct}
            gate={gate}
            slotIndex={slotIndex}
            slotCount={group.length}
            ringColor={ringColors[index]}
            onAnimating={onAnimating}
          />
        )
      })}
    </>
  )
}

/* ---------- Modelos procedurales ---------- */

function Panda() {
  return (
    <group>
      <mesh position={[0, 0.17, 0]} scale={[1, 1, 0.92]} castShadow>
        <sphereGeometry args={[0.15, 18, 14]} />
        <meshStandardMaterial color="#F7F4EC" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <sphereGeometry args={[0.14, 18, 14]} />
        <meshStandardMaterial color="#F7F4EC" roughness={0.85} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`ear-${side}`} position={[side * 0.105, 0.455, -0.01]} castShadow>
          <sphereGeometry args={[0.058, 12, 10]} />
          <meshStandardMaterial color="#23211C" roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`patch-${side}`} position={[side * 0.055, 0.385, 0.115]} castShadow>
          <sphereGeometry args={[0.042, 12, 10]} />
          <meshStandardMaterial color="#23211C" roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`eye-${side}`} position={[side * 0.052, 0.392, 0.152]}>
          <sphereGeometry args={[0.016, 8, 8]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`arm-${side}`} position={[side * 0.145, 0.19, 0.01]} scale={[0.7, 1.1, 0.7]} castShadow>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshStandardMaterial color="#23211C" roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`leg-${side}`} position={[side * 0.08, 0.055, 0.03]} scale={[0.8, 0.9, 0.8]} castShadow>
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshStandardMaterial color="#23211C" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function Penguin() {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} scale={[1, 1.25, 0.95]} castShadow>
        <sphereGeometry args={[0.14, 18, 14]} />
        <meshStandardMaterial color="#23211C" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.19, 0.075]} scale={[0.75, 1.05, 0.55]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color="#F7F4EC" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <sphereGeometry args={[0.11, 16, 12]} />
        <meshStandardMaterial color="#23211C" roughness={0.75} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`eye-${side}`} position={[side * 0.045, 0.42, 0.09]}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`pupil-${side}`} position={[side * 0.045, 0.42, 0.111]}>
          <sphereGeometry args={[0.011, 8, 8]} />
          <meshStandardMaterial color="#1C1A16" />
        </mesh>
      ))}
      <mesh position={[0, 0.385, 0.13]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.035, 0.09, 10]} />
        <meshStandardMaterial color="#F2A03D" roughness={0.6} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`foot-${side}`} position={[side * 0.055, 0.025, 0.075]} castShadow>
          <boxGeometry args={[0.075, 0.035, 0.13]} />
          <meshStandardMaterial color="#F2A03D" roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

function Fox() {
  return (
    <group>
      <mesh position={[0, 0.16, 0]} scale={[1, 0.95, 0.9]} castShadow>
        <sphereGeometry args={[0.14, 16, 12]} />
        <meshStandardMaterial color="#E8743B" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.35, 0]} castShadow>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color="#E8743B" roughness={0.8} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`ear-${side}`} position={[side * 0.085, 0.47, -0.01]} rotation={[0, 0, side * -0.18]} castShadow>
          <coneGeometry args={[0.05, 0.13, 8]} />
          <meshStandardMaterial color="#C9541F" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.335, 0.13]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.052, 0.11, 10]} />
        <meshStandardMaterial color="#F7F4EC" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.335, 0.195]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#23211C" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`eye-${side}`} position={[side * 0.05, 0.385, 0.105]}>
          <sphereGeometry args={[0.017, 8, 8]} />
          <meshStandardMaterial color="#23211C" />
        </mesh>
      ))}
      <mesh position={[0, 0.09, 0.1]} scale={[0.7, 0.8, 0.5]} castShadow>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshStandardMaterial color="#F7F4EC" roughness={0.85} />
      </mesh>
    </group>
  )
}

function Frog() {
  return (
    <group>
      <mesh position={[0, 0.17, 0]} scale={[1.1, 0.95, 1]} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color="#5FA84F" roughness={0.75} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`eye-${side}`} position={[side * 0.07, 0.32, 0.06]} castShadow>
          <sphereGeometry args={[0.052, 12, 10]} />
          <meshStandardMaterial color="#F7F4EC" roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`pupil-${side}`} position={[side * 0.07, 0.325, 0.105]}>
          <sphereGeometry args={[0.024, 10, 8]} />
          <meshStandardMaterial color="#1C1A16" />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`leg-${side}`} position={[side * 0.13, 0.06, 0.02]} scale={[0.9, 0.7, 1]} castShadow>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshStandardMaterial color="#4A8A3D" roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function EmojiSprite({ emoji, y }: { emoji: string; y: number }) {
  const texture = useMemo(() => createEmojiTexture(emoji), [emoji])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <sprite position={[0, y, 0]} scale={[0.36, 0.36, 0.36]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  )
}

function Pawn({ color, emoji }: { color: string; emoji: string }) {
  const dark = useMemo(() => new THREE.Color(color).multiplyScalar(0.72).getStyle(), [color])

  return (
    <group>
      <mesh position={[0, 0.035, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.17, 0.07, 20]} />
        <meshStandardMaterial color={dark} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.17, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.125, 0.2, 20]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.33, 0]} castShadow>
        <sphereGeometry args={[0.105, 18, 14]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <EmojiSprite emoji={emoji} y={0.58} />
    </group>
  )
}

function TokenFigure({ emoji, color }: { emoji: string; color: string }) {
  switch (emoji) {
    case '🐼':
      return <Panda />
    case '🐧':
      return <Penguin />
    case '🦊':
      return <Fox />
    case '🐸':
      return <Frog />
    default:
      return <Pawn color={color} emoji={emoji} />
  }
}
