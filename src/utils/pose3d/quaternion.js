/**
 * Quaternion helpers for the pose3d renderer.
 *
 * Public BabyBand representation is always `{ w, x, y, z }` (matching
 * `parseBabyBandFrame`). Renderer / math code uses explicit conversions so a
 * caller can never accidentally pass `{w,x,y,z}` where `[x,y,z,w]` is expected.
 *
 * No three.js import here: this module is safe on every platform and in Node
 * tests.
 */

export const IDENTITY_QUATERNION = Object.freeze({ w: 1, x: 0, y: 0, z: 0 })

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Accepts either the public `{ w, x, y, z }` object or a `[w, x, y, z]` array.
 * Returns a new frozen object, or null when the value cannot be interpreted.
 *
 * @param {{w:number,x:number,y:number,z:number}|number[]} value
 * @returns {{w:number,x:number,y:number,z:number}|null}
 */
export function toQuaternionObject(value) {
  if (Array.isArray(value)) {
    if (value.length !== 4) return null
    const [w, x, y, z] = value
    if (![w, x, y, z].every(Number.isFinite)) return null
    return { w, x, y, z }
  }
  if (isPlainObject(value)) {
    const { w, x, y, z } = value
    if (![w, x, y, z].every(Number.isFinite)) return null
    return { w, x, y, z }
  }
  return null
}

/**
 * Explicit public-object -> `[w, x, y, z]` conversion for math code.
 * @returns {[number,number,number,number]|null}
 */
export function toQuaternionArray(value) {
  const q = toQuaternionObject(value)
  return q ? [q.w, q.x, q.y, q.z] : null
}

/** Explicit `{w,x,y,z}` -> three.js constructor order `{x,y,z,w}`. */
export function toThreeQuaternionArgs(value) {
  const q = toQuaternionObject(value)
  return q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null
}

export function cloneQuaternion(value) {
  const q = toQuaternionObject(value)
  return q ? { w: q.w, x: q.x, y: q.y, z: q.z } : null
}

export function quaternionNorm(value) {
  const q = toQuaternionObject(value)
  if (!q) return NaN
  return Math.hypot(q.w, q.x, q.y, q.z)
}

/**
 * Normalize a quaternion. Returns null for missing/non-finite/zero quaternions.
 */
export function normalizeQuaternion(value) {
  const q = toQuaternionObject(value)
  if (!q) return null
  const length = Math.hypot(q.w, q.x, q.y, q.z)
  if (!Number.isFinite(length) || length < 1e-9) return null
  return {
    w: q.w / length,
    x: q.x / length,
    y: q.y / length,
    z: q.z / length
  }
}

/**
 * A usable orientation needs finite components and a non-zero norm. It does
 * not need to be perfectly unit length: firmware / transport noise is
 * normalized by `normalizeQuaternion`.
 */
export function isUsableQuaternion(value) {
  return normalizeQuaternion(value) !== null
}

export function isNearUnitQuaternion(value, tolerance = 0.05) {
  const length = quaternionNorm(value)
  return Number.isFinite(length) && Math.abs(length - 1) <= tolerance
}

export function areQuaternionsEquivalent(a, b, tolerance = 1e-4) {
  const qa = normalizeQuaternion(a)
  const qb = normalizeQuaternion(b)
  if (!qa || !qb) return false
  const dot = Math.abs(
    qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z
  )
  return Math.abs(1 - dot) <= tolerance
}

/** Hamilton product a * b, both in public object form. */
export function multiplyQuaternions(a, b) {
  const qa = toQuaternionObject(a)
  const qb = toQuaternionObject(b)
  if (!qa || !qb) return null
  return {
    w: qa.w * qb.w - qa.x * qb.x - qa.y * qb.y - qa.z * qb.z,
    x: qa.w * qb.x + qa.x * qb.w + qa.y * qb.z - qa.z * qb.y,
    y: qa.w * qb.y - qa.x * qb.z + qa.y * qb.w + qa.z * qb.x,
    z: qa.w * qb.z + qa.x * qb.y - qa.y * qb.x + qa.z * qb.w
  }
}

export function conjugateQuaternion(value) {
  const q = toQuaternionObject(value)
  if (!q) return null
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z }
}

/**
 * Orientation of `child` relative to `parent`: conjugate(parent) * child.
 * Both must share the same reference frame (for BabyBand: device/world frame).
 */
export function relativeQuaternion(parent, child) {
  const qp = normalizeQuaternion(parent)
  const qc = normalizeQuaternion(child)
  if (!qp || !qc) return null
  return normalizeQuaternion(multiplyQuaternions(conjugateQuaternion(qp), qc))
}

/**
 * Spherical interpolation, shortest path. `t` is clamped to [0, 1].
 */
export function slerpQuaternions(a, b, t) {
  const qa = normalizeQuaternion(a)
  const qb = normalizeQuaternion(b)
  if (!qa || !qb) return null
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))

  let dot = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z
  let target = qb
  if (dot < 0) {
    dot = -dot
    target = { w: -qb.w, x: -qb.x, y: -qb.y, z: -qb.z }
  }

  if (dot > 0.9995) {
    return normalizeQuaternion({
      w: qa.w + (target.w - qa.w) * clamped,
      x: qa.x + (target.x - qa.x) * clamped,
      y: qa.y + (target.y - qa.y) * clamped,
      z: qa.z + (target.z - qa.z) * clamped
    })
  }

  const theta = Math.acos(Math.min(1, Math.max(-1, dot)))
  const sinTheta = Math.sin(theta)
  const wa = Math.sin((1 - clamped) * theta) / sinTheta
  const wb = Math.sin(clamped * theta) / sinTheta
  return normalizeQuaternion({
    w: qa.w * wa + target.w * wb,
    x: qa.x * wa + target.x * wb,
    y: qa.y * wa + target.y * wb,
    z: qa.z * wa + target.z * wb
  })
}

/** Smallest angle between two orientations, degrees. */
export function quaternionAngleDegrees(a, b) {
  const qa = normalizeQuaternion(a)
  const qb = normalizeQuaternion(b)
  if (!qa || !qb) return NaN
  const dot = Math.abs(
    qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z
  )
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI
}

export function quaternionFromAxisAngle(axis, angleRadians) {
  if (!Array.isArray(axis) || axis.length !== 3) return null
  if (!axis.every(Number.isFinite) || !Number.isFinite(angleRadians)) return null
  const length = Math.hypot(axis[0], axis[1], axis[2])
  if (length < 1e-9) return null
  const half = angleRadians / 2
  const s = Math.sin(half) / length
  return {
    w: Math.cos(half),
    x: axis[0] * s,
    y: axis[1] * s,
    z: axis[2] * s
  }
}
