/**
 * Sensor-orientation -> articulated-figure mapping.
 *
 * This module deliberately contains no three.js code. It produces quaternions
 * in the public `{w,x,y,z}` form; the renderer converts them explicitly to
 * three.js `{x,y,z,w}`.
 *
 * Mapping assumptions (documented, NOT calibrated):
 *   q0 = waist / torso orientation
 *   q1 = wrist sensor orientation
 *   q2 = ankle sensor orientation
 *   limb orientation = conjugate(q0) * q(sensor)
 *
 * A single wrist/ankle sensor cannot observe elbow/knee flexion. The rig
 * therefore drives one shoulder chain and one hip chain as rigid segments. The
 * side (right by default) is configurable by the parent.
 */

import { IDENTITY_QUATERNION, multiplyQuaternions, normalizeQuaternion, relativeQuaternion, slerpQuaternions } from './quaternion.js'
import { normalizePoseFrame } from './poseFrame.js'

export const DEFAULT_POSE_MAPPING = Object.freeze({
  relativeToWaist: true,
  torsoGain: 1,
  armGain: 1,
  legGain: 1,
  drivenArm: 'right',
  drivenLeg: 'right',
  // Sensor mounting correction is identity until the firmware/mechanical
  // mounting is confirmed. Parents may pass calibration quaternions.
  mountQ0: IDENTITY_QUATERNION,
  mountQ1: IDENTITY_QUATERNION,
  mountQ2: IDENTITY_QUATERNION
})

function clampGain(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(1, numeric))
}

function mount(sensorQuat, mountQuat) {
  const q = normalizeQuaternion(sensorQuat)
  const m = normalizeQuaternion(mountQuat)
  if (!q) return { ...IDENTITY_QUATERNION }
  if (!m) return q
  return normalizeQuaternion(multiplyQuaternions(q, m)) || { ...IDENTITY_QUATERNION }
}

function applyGain(delta, gain) {
  if (!delta) return { ...IDENTITY_QUATERNION }
  if (gain >= 1) return delta
  if (gain <= 0) return { ...IDENTITY_QUATERNION }
  return (
    slerpQuaternions(IDENTITY_QUATERNION, delta, gain) || { ...IDENTITY_QUATERNION }
  )
}

/**
 * @param {object} poseFrame PoseFrame (normalized or raw)
 * @param {object} [options] overrides for DEFAULT_POSE_MAPPING
 * @returns {{
 *   timestamp:number,
 *   valid:boolean,
 *   torso:{w:number,x:number,y:number,z:number},
 *   rightArm:{w:number,x:number,y:number,z:number},
 *   rightLeg:{w:number,x:number,y:number,z:number},
 *   issues:Array
 * }}
 */
export function mapPoseToRig(poseFrame, options = {}) {
  const frame = normalizePoseFrame(poseFrame)
  const settings = { ...DEFAULT_POSE_MAPPING, ...options }
  const torsoGain = clampGain(settings.torsoGain, DEFAULT_POSE_MAPPING.torsoGain)
  const armGain = clampGain(settings.armGain, DEFAULT_POSE_MAPPING.armGain)
  const legGain = clampGain(settings.legGain, DEFAULT_POSE_MAPPING.legGain)
  const relativeToWaist = settings.relativeToWaist !== false

  const q0 = mount(frame.rotations.q0, settings.mountQ0)
  const q1 = mount(frame.rotations.q1, settings.mountQ1)
  const q2 = mount(frame.rotations.q2, settings.mountQ2)

  const torso = applyGain(q0, torsoGain)

  const armDelta = relativeToWaist ? relativeQuaternion(q0, q1) : q1
  const legDelta = relativeToWaist ? relativeQuaternion(q0, q2) : q2

  return {
    timestamp: frame.timestamp,
    valid: frame.valid,
    torso,
    rightArm: applyGain(armDelta, armGain),
    rightLeg: applyGain(legDelta, legGain),
    issues: frame.issues
  }
}

/**
 * Explicit conversion for `THREE.Quaternion.set(...)` / `.copy()`.
 * Public `{w,x,y,z}` -> three constructor `{x,y,z,w}`.
 */
export function rigPoseToThreeArgs(rigPose) {
  const source = rigPose || {}
  const torso = source.torso || IDENTITY_QUATERNION
  const rightArm = source.rightArm || IDENTITY_QUATERNION
  const rightLeg = source.rightLeg || IDENTITY_QUATERNION
  return {
    torso: { x: torso.x, y: torso.y, z: torso.z, w: torso.w },
    rightArm: { x: rightArm.x, y: rightArm.y, z: rightArm.z, w: rightArm.w },
    rightLeg: { x: rightLeg.x, y: rightLeg.y, z: rightLeg.z, w: rightLeg.w }
  }
}

export function identityRigPose(timestamp = 0) {
  return {
    timestamp,
    valid: false,
    torso: { ...IDENTITY_QUATERNION },
    rightArm: { ...IDENTITY_QUATERNION },
    rightLeg: { ...IDENTITY_QUATERNION },
    issues: []
  }
}
