/**
 * Quaternion validation, normalization and explicit representation conversion.
 *
 * The public sensor representation is an object `{ w, x, y, z }`. Existing
 * math helpers (Quaternion.js, BodyFrameReconstructor.js) accept arrays in
 * `[w, x, y, z]` order. Conversion between the two is intentionally explicit:
 * call `quaternionToArray()` / `quaternionFromArray()` at the algorithm
 * boundary. Nothing in this module mutates its input.
 */

/** @typedef {import('./dataContracts.js').Quaternion} Quaternion */

export const DEFAULT_NORM_EPSILON = 1e-8

/** A frozen identity quaternion. */
export const IDENTITY_QUATERNION = Object.freeze({ w: 1, x: 0, y: 0, z: 0 })

const COMPONENTS = ['w', 'x', 'y', 'z']

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build a structured failure result.
 *
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
function failure(code, message, details = {}) {
  return { ok: false, code, message, ...details }
}

/**
 * Validate and normalize a quaternion to unit length.
 *
 * Accepted input is an object with finite `w`, `x`, `y`, `z` properties.
 * Arrays are rejected unless `allowArray` is explicitly true, in which case
 * they are interpreted as `[w, x, y, z]` (legacy math order). A quaternion with
 * near-zero norm is rejected; a valid but non-unit quaternion is normalized.
 *
 * @param {unknown} input
 * @param {{ allowArray?: boolean, epsilon?: number, field?: string }} [options]
 * @returns {{ ok: true, value: Quaternion, normalized: boolean, converted: boolean, norm: number, field?: string }
 *   | { ok: false, code: string, message: string, norm?: number, field?: string }}
 */
export function normalizeQuaternion(input, options = {}) {
  const { allowArray = false, epsilon = DEFAULT_NORM_EPSILON, field } = options

  let source = input
  let inputWasArray = false

  if (Array.isArray(input)) {
    if (!allowArray) {
      return failure(
        'NOT_OBJECT',
        'quaternion must be an object { w, x, y, z }; pass { allowArray: true } to accept legacy [w, x, y, z] input',
        field ? { field } : {}
      )
    }
    if (input.length !== 4) {
      return failure('INVALID_LENGTH', `legacy quaternion array must have 4 elements, got ${input.length}`, field ? { field } : {})
    }
    source = { w: input[0], x: input[1], y: input[2], z: input[3] }
    inputWasArray = true
  }

  if (!isPlainObject(source)) {
    return failure('NOT_OBJECT', 'quaternion must be a non-null object', field ? { field } : {})
  }

  for (const component of COMPONENTS) {
    if (!(component in source)) {
      return failure('MISSING_COMPONENT', `quaternion is missing component "${component}"`, field ? { field } : {})
    }
    if (!isFiniteNumber(source[component])) {
      return failure('NOT_FINITE', `quaternion component "${component}" must be a finite number`, field ? { field } : {})
    }
  }

  const { w, x, y, z } = source
  const norm = Math.hypot(w, x, y, z)

  if (!Number.isFinite(norm)) {
    return failure('NORM_INVALID', 'quaternion norm is not finite (component magnitude overflow)', {
      ...(field ? { field } : {}),
      norm
    })
  }
  if (norm <= epsilon) {
    return failure('ZERO_NORM', 'quaternion norm is zero or too small to normalize', {
      ...(field ? { field } : {}),
      norm
    })
  }

  const alreadyUnit = Math.abs(norm - 1) <= epsilon
  const value = alreadyUnit
    ? { w, x, y, z }
    : { w: w / norm, x: x / norm, y: y / norm, z: z / norm }

  return {
    ok: true,
    value,
    normalized: !alreadyUnit,
    converted: inputWasArray,
    norm,
    ...(field ? { field } : {})
  }
}

/**
 * Validate only, without changing component values. A quaternion is considered
 * valid when all components are finite and its norm is greater than epsilon.
 *
 * @param {unknown} input
 * @param {{ allowArray?: boolean, epsilon?: number }} [options]
 * @returns {boolean}
 */
export function isValidQuaternion(input, options = {}) {
  return normalizeQuaternion(input, options).ok
}

/**
 * Convert the public object representation to the legacy math array
 * `[w, x, y, z]`. Throws instead of returning NaN when the input is invalid,
 * because this is a math-boundary assertion.
 *
 * @param {Quaternion} quaternion
 * @param {string} [label]
 * @returns {[number, number, number, number]}
 */
export function quaternionToArray(quaternion, label = 'quaternion') {
  const result = normalizeQuaternion(quaternion, { field: label })
  if (!result.ok) {
    throw new TypeError(`${label}: ${result.message} (${result.code})`)
  }
  const { w, x, y, z } = result.value
  return [w, x, y, z]
}

/**
 * Convert a legacy math array `[w, x, y, z]` to the public object
 * representation. The array is normalized first, so algorithms always receive
 * a unit quaternion from sensor data.
 *
 * @param {unknown} array
 * @param {string} [label]
 * @returns {Quaternion}
 */
export function quaternionFromArray(array, label = 'quaternion') {
  const result = normalizeQuaternion(array, { allowArray: true, field: label })
  if (!result.ok) {
    throw new TypeError(`${label}: ${result.message} (${result.code})`)
  }
  return result.value
}

/**
 * Return a quaternion object, accepting either the public object form or a
 * legacy array. Useful for migration code; new sensor-facing code should use
 * `normalizeQuaternion()` and handle its result.
 *
 * @param {unknown} input
 * @param {string} [label]
 * @returns {Quaternion|null}
 */
export function coerceQuaternion(input, label = 'quaternion') {
  const result = normalizeQuaternion(input, { allowArray: true, field: label })
  return result.ok ? result.value : null
}
