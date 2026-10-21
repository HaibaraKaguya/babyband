// utils/poseFrame.js
//
// Renderer-facing pose data. Protocol samples keep quaternions in their public
// `{ w, x, y, z }` form; this module only normalizes and validates them.

import { Quaternion } from './algorithms/Quaternion.js'

export const POSE_SENSOR_KEYS = ['q0', 'q1', 'q2']

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function identityRotation() {
  return { w: 1, x: 0, y: 0, z: 0 }
}

/**
 * Normalize one rotation for rendering.
 * @returns {{rotation:{w:number,x:number,y:number,z:number}, valid:boolean}}
 */
export function sanitizeRotation(value) {
  const quat = Quaternion.fromQuaternionLike(value)
  if (!quat || !quat.isValid()) {
    return { rotation: identityRotation(), valid: false }
  }
  return { rotation: quat.normalized().toObject(), valid: true }
}

/**
 * Build the renderer contract from a parsed sample.
 *
 * PoseFrame: {
 *   timestamp: number,
 *   rotations: { q0: {w,x,y,z}, q1: {w,x,y,z}, q2: {w,x,y,z} },
 *   valid: boolean
 * }
 *
 * Invalid or missing rotations are replaced with identity rotations so a
 * renderer can always draw a frame; `valid` tells it whether to trust them.
 */
export function buildPoseFrame(sample, options = {}) {
  const source = sample && typeof sample === 'object' ? sample : {}
  const fallbackNow = isFiniteNumber(options.now) ? options.now : Date.now()
  const timestamp = isFiniteNumber(source.ts)
    ? source.ts
    : (isFiniteNumber(source.timestamp) ? source.timestamp : fallbackNow)

  const rotations = {}
  let rotationsValid = true
  for (const key of POSE_SENSOR_KEYS) {
    const result = sanitizeRotation(source[key])
    rotations[key] = result.rotation
    if (!result.valid) rotationsValid = false
  }

  const attitudeValid = source.attitudeValid !== false
  return {
    timestamp,
    rotations,
    valid: attitudeValid && rotationsValid
  }
}

/**
 * Renderer-safe entry point. Accepts a PoseFrame, a parsed sample, or nothing
 * at all and always returns a well-formed PoseFrame with finite numbers.
 */
export function sanitizePoseFrame(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const rotationsSource =
    source.rotations && typeof source.rotations === 'object'
      ? source.rotations
      : source

  const timestampCandidate = isFiniteNumber(source.timestamp)
    ? source.timestamp
    : source.ts
  const fallbackNow = isFiniteNumber(options.now) ? options.now : 0

  const frame = buildPoseFrame({
    ts: timestampCandidate,
    q0: rotationsSource.q0,
    q1: rotationsSource.q1,
    q2: rotationsSource.q2,
    attitudeValid: source.attitudeValid
  }, { now: fallbackNow })

  // An existing frame that already declared itself invalid stays invalid,
  // even if its placeholder rotations happen to be valid numbers.
  if (source.valid === false) frame.valid = false

  return frame
}
