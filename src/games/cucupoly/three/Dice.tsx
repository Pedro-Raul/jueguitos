import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DIE_FACES, landRotation, spinFor } from './diceLand'
import { createDieFaceTexture } from './textures'
import { DICE_SECONDS, TILE_TOP } from './layout'

/**
 * Dados 3D con animación guionada (~1.2 s, sin física). El resultado ya viene
 * decidido por el reducer: la interpolación termina exactamente mostrando los
 * valores del estado, con orientación derivada de `landRotation`.
 */
export type DiceRoll = { values: number[]; total: number; seq: number }

const DIE_SIZE = 0.42
const REST_Y = TILE_TOP + DIE_SIZE / 2
const REST_Z = 1.35
const SPAN = 0.62
/** Fracción del tiempo en la que el dado vuela antes de botar. */
const FLIGHT_SHARE = 0.66
const LIFT = 2.4
const BOUNCE_HEIGHT = 0.34
const START_LIFT = 3.2

type DiePlan = {
  rest: THREE.Vector3
  start: THREE.Vector3
  end: THREE.Quaternion
  axis: THREE.Vector3
  radians: number
}

function easeOutCubic(p: number): number {
  return 1 - (1 - p) ** 3
}

function easeOutQuart(p: number): number {
  return 1 - (1 - p) ** 4
}

const tmpMatrix = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()

export function Dice({ roll }: { roll: DiceRoll | null }) {
  const groupRef = useRef<THREE.Group>(null)
  const dieRefs = useRef<Array<THREE.Mesh | null>>([])
  const plans = useRef<DiePlan[]>([])
  const play = useRef<{ seq: number; time: number } | null>(null)
  const seenSeq = useRef<number | null>(null)

  const values = roll?.values ?? []

  useEffect(() => {
    if (!roll || seenSeq.current === roll.seq) return
    seenSeq.current = roll.seq
    dieRefs.current.length = roll.values.length

    const count = roll.values.length
    plans.current = roll.values.map((value, index) => {
      const offset = (index - (count - 1) / 2) * SPAN
      const spin = spinFor(value, index)
      const rotation = landRotation(value)
      tmpMatrix.set(
        rotation[0], rotation[1], rotation[2], 0,
        rotation[3], rotation[4], rotation[5], 0,
        rotation[6], rotation[7], rotation[8], 0,
        0, 0, 0, 1,
      )
      return {
        rest: new THREE.Vector3(offset, REST_Y, REST_Z),
        start: new THREE.Vector3(offset * 2.2 + 3.4, START_LIFT, -3.8),
        end: new THREE.Quaternion().setFromRotationMatrix(tmpMatrix),
        axis: new THREE.Vector3(...spin.axis),
        radians: spin.turns * Math.PI * 2,
      }
    })

    play.current = { seq: roll.seq, time: 0 }
    if (groupRef.current) groupRef.current.visible = true
  }, [roll])

  useFrame((_, delta) => {
    const current = play.current
    const group = groupRef.current
    if (!group || !current) return

    current.time = Math.min(DICE_SECONDS, current.time + delta)
    const p = Math.min(1, current.time / DICE_SECONDS)
    const flightEnd = p >= FLIGHT_SHARE

    plans.current.forEach((plan, index) => {
      const die = dieRefs.current[index]
      if (!die) return

      let x: number
      let y: number
      let z: number
      if (!flightEnd) {
        const t = p / FLIGHT_SHARE
        const eased = easeOutCubic(t)
        x = plan.start.x + (plan.rest.x - plan.start.x) * eased
        y = plan.start.y + (plan.rest.y - plan.start.y) * eased + Math.sin(t * Math.PI) * LIFT
        z = plan.start.z + (plan.rest.z - plan.start.z) * eased
      } else {
        const q = (p - FLIGHT_SHARE) / (1 - FLIGHT_SHARE)
        x = plan.rest.x
        z = plan.rest.z
        y = plan.rest.y + Math.abs(Math.sin(q * Math.PI * 2.4)) * BOUNCE_HEIGHT * (1 - q) ** 2
      }
      die.position.set(x, y, z)

      // Q = Q_final · rot(eje, θ·(1-easeOutQuart(p))): termina exactamente en Q_final.
      const angle = plan.radians * (1 - easeOutQuart(p))
      tmpQuat.setFromAxisAngle(plan.axis, angle)
      die.quaternion.copy(plan.end).multiply(tmpQuat)
    })

    if (p >= 1) {
      plans.current.forEach((plan, index) => {
        const die = dieRefs.current[index]
        if (!die) return
        die.position.copy(plan.rest)
        die.quaternion.copy(plan.end)
      })
      play.current = null
    }
  })

  if (!roll) return null

  return (
    <group ref={groupRef} visible={false}>
      {values.map((_, index) => (
        <mesh
          key={`${roll.seq}-${index}`}
          ref={(mesh) => {
            dieRefs.current[index] = mesh
          }}
          castShadow
        >
          <boxGeometry args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]} />
          {DIE_FACES.map((face, faceIndex) => (
            <meshStandardMaterial
              key={faceIndex}
              attach={`material-${faceIndex}`}
              map={createDieFaceTexture(face)}
              roughness={0.4}
              metalness={0.05}
            />
          ))}
        </mesh>
      ))}
    </group>
  )
}
