/**
 * Sensor sample validation/normalization and PoseFrame construction.
 *
 * Design rules:
 * - The public quaternion representation stays `{ w, x, y, z }`.
 * - Normalization never mutates the input and never throws for bad data.
 * - Invalid quaternions remain in the sample (for diagnostics/storage) but are
 *   replaced with identity placeholders in the generated PoseFrame.
 * - Legacy `temp1/temp2/temp3` aliases are kept in sync with
 *   `tWaist/tThigh/tAnkle` so existing pages and stored sessions keep working.
 */

import {
  IDENTITY_QUATERNION,
  isFiniteNumber,
  isPlainObject,
  normalizeQuaternion
} from './quaternion.mjs'

/** @typedef {import('./dataContracts.js').SensorSample} SensorSample */
/** @typedef {import('./dataContracts.js').PoseFrame} PoseFrame */
/** @typedef {import('./dataContracts.js').Quaternion} Quaternion */

export const QUATERNION_FIELDS = Object.freeze(['q0', 'q1', 'q2'])
export const TEMPERATURE_ALIASES = Object.freeze([
  Object.freeze({ canonical: 'tWaist', legacy: 'temp1', label: 'waist' }),
  Object.freeze({ canonical: 'tThigh', legacy: 'temp2', label: 'thigh' }),
  Object.freeze({ canonical: 'tAnkle', legacy: 'temp3', label: 'ankle' })
])

function resolveNow(now) {
  if (typeof now === 'function') {
    const value = now()
    return isFiniteNumber(value) ? value : Date.now()
  }
  return isFiniteNumber(now) ? now : Date.now()
}

function issue(code, message, field) {
  return field ? { code, message, field } : { code, message }
}

function identityRotations() {
  return {
    q0: { ...IDENTITY_QUATERNION },
    q1: { ...IDENTITY_QUATERNION },
    q2: { ...IDENTITY_QUATERNION }
  }
}

/**
 * Validate and normalize one parsed sensor sample.
 *
 * Fatal errors (non-object input) return `ok: false`. Recoverable data problems
 * (missing/invalid quaternion, non-finite temperature, CRC failure) are
 * returned as `warnings` while `ok` remains true, because downstream storage
 * should still be able to retain the raw frame for diagnostics.
 *
 * @param {unknown} raw
 * @param {{ now?: number|(() => number), allowLegacyArrayQuaternions?: boolean }} [options]
 * @returns {{
 *   ok: boolean,
 *   sample: SensorSample|null,
 *   warnings: Array<{code: string, message: string, field?: string}>,
 *   errors: Array<{code: string, message: string, field?: string}>,
 *   quaternionStates: Record<string, {valid: boolean, status: 'valid'|'normalized'|'missing'|'invalid', code?: string, message?: string}>
 * }}
 */
export function normalizeSensorSample(raw, options = {}) {
  const { now, allowLegacyArrayQuaternions = false } = options
  const warnings = []
  const errors = []
  const quaternionStates = {}

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      sample: null,
      warnings,
      errors: [issue('NOT_OBJECT', 'sensor sample must be a non-null object')],
      quaternionStates
    }
  }

  const sample = { ...raw }

  if (!isFiniteNumber(sample.ts)) {
    sample.ts = resolveNow(now)
    warnings.push(issue('MISSING_TIMESTAMP', 'sample.ts is missing or not finite; using receipt time', 'ts'))
  }

  for (const field of QUATERNION_FIELDS) {
    const value = sample[field]
    const result = normalizeQuaternion(value, {
      allowArray: allowLegacyArrayQuaternions,
      field
    })

    if (result.ok) {
      sample[field] = result.value
      if (result.normalized) {
        warnings.push(issue('QUATERNION_NORMALIZED', `${field} was normalized to unit length`, field))
        quaternionStates[field] = { valid: true, status: 'normalized' }
      } else {
        quaternionStates[field] = { valid: true, status: 'valid' }
      }
    } else if (value === undefined || value === null) {
      quaternionStates[field] = {
        valid: false,
        status: 'missing',
        code: result.code,
        message: result.message
      }
      warnings.push(issue('QUATERNION_MISSING', `${field} is missing`, field))
    } else {
      quaternionStates[field] = {
        valid: false,
        status: 'invalid',
        code: result.code,
        message: result.message
      }
      warnings.push(issue('QUATERNION_INVALID', `${field} is invalid: ${result.message}`, field))
    }
  }

  for (const { canonical, legacy, label } of TEMPERATURE_ALIASES) {
    const canonicalValue = sample[canonical]
    const legacyValue = sample[legacy]
    const canonicalFinite = isFiniteNumber(canonicalValue)
    const legacyFinite = isFiniteNumber(legacyValue)

    if (canonicalFinite) {
      if (legacyFinite && Math.abs(canonicalValue - legacyValue) > 1e-6) {
        warnings.push(
          issue(
            'TEMPERATURE_ALIAS_MISMATCH',
            `${canonical} and ${legacy} differ; ${canonical} is canonical (${label})`,
            canonical
          )
        )
      }
      sample[legacy] = canonicalValue
    } else if (legacyFinite) {
      sample[canonical] = legacyValue
    } else if (canonicalValue !== undefined || legacyValue !== undefined) {
      warnings.push(
        issue('TEMPERATURE_INVALID', `${canonical}/${legacy} is not a finite number (${label})`, canonical)
      )
    }
  }

  if (sample.crcOk === false) {
    warnings.push(issue('CRC_FAILED', 'sample CRC check failed', 'crcOk'))
  }

  if (sample.sys !== undefined && !isFiniteNumber(sample.sys)) {
    warnings.push(issue('SYS_INVALID', 'sample.sys must be a finite number', 'sys'))
  }

  if (sample.attitudeValid === false) {
    warnings.push(issue('ATTITUDE_INVALID', 'device reports invalid attitude', 'attitudeValid'))
  }

  if (sample.tempValid === false) {
    warnings.push(issue('TEMPERATURE_FLAG_INVALID', 'device reports invalid temperature', 'tempValid'))
  }

  return { ok: true, sample, warnings, errors, quaternionStates }
}

/**
 * Build a renderer-safe PoseFrame from a parsed sample.
 *
 * All three rotations are always present. Missing/invalid quaternions become
 * identity placeholders and force `valid: false`. `timestamp` is always a
 * finite number. `attitudeValid === false` also forces `valid: false`.
 *
 * @param {unknown} sample
 * @param {{ now?: number|(() => number), allowLegacyArrayQuaternions?: boolean }} [options]
 * @returns {PoseFrame}
 */
export function toPoseFrame(sample, options = {}) {
  const { now, allowLegacyArrayQuaternions = false } = options
  const timestamp = isPlainObject(sample) && isFiniteNumber(sample.ts)
    ? sample.ts
    : resolveNow(now)

  const rotations = identityRotations()
  let valid = isPlainObject(sample)

  if (isPlainObject(sample)) {
    for (const field of QUATERNION_FIELDS) {
      const result = normalizeQuaternion(sample[field], {
        allowArray: allowLegacyArrayQuaternions,
        field
      })
      if (result.ok) {
        rotations[field] = result.value
      } else {
        valid = false
      }
    }

    if (sample.attitudeValid === false) {
      valid = false
    }
  }

  return { timestamp, rotations, valid }
}

/**
 * Defensive PoseFrame normalizer for renderer boundaries.
 *
 * Accepts a PoseFrame, a SensorSample, null, or arbitrary junk. It never throws
 * and always returns the exact `{ timestamp, rotations, valid }` shape. This is
 * the recommended entry point for the body renderer so a malformed replay
 * record cannot crash the page.
 *
 * @param {unknown} input
 * @param {{ now?: number|(() => number), allowLegacyArrayQuaternions?: boolean }} [options]
 * @returns {PoseFrame}
 */
export function normalizePoseFrame(input, options = {}) {
  const { now } = options

  if (!isPlainObject(input)) {
    return { timestamp: resolveNow(now), rotations: identityRotations(), valid: false }
  }

  const timestamp = isFiniteNumber(input.timestamp)
    ? input.timestamp
    : isFiniteNumber(input.ts)
      ? input.ts
      : resolveNow(now)

  const rotationsSource = isPlainObject(input.rotations)
    ? input.rotations
    : isPlainObject(input.q0) || isPlainObject(input.q1) || isPlainObject(input.q2)
      ? input
      : null

  if (!rotationsSource) {
    return { timestamp, rotations: identityRotations(), valid: false }
  }

  const rotations = identityRotations()
  let rotationsValid = true

  for (const field of QUATERNION_FIELDS) {
    const result = normalizeQuaternion(rotationsSource[field], {
      allowArray: options.allowLegacyArrayQuaternions === true,
      field
    })
    if (result.ok) {
      rotations[field] = result.value
    } else {
      rotationsValid = false
    }
  }

  const declaredValid = input.valid !== false
  const valid = rotationsValid && declaredValid && input.attitudeValid !== false

  return { timestamp, rotations, valid }
}

export { identityRotations }
