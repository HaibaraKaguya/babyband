/**
 * Ingestion facade: raw parsed frame -> normalized sample -> PoseFrame.
 *
 * This module is the recommended boundary for the BLE callback. It does not
 * talk to `uni`, perform BLE I/O, or run algorithms; it only applies explicit
 * validation policy and produces the two shapes the rest of the app needs.
 */

import {
  normalizeSensorSample,
  toPoseFrame
} from '../types/sensorSample.mjs'
import { quaternionToArray } from '../types/quaternion.mjs'

/** @typedef {import('../types/dataContracts.js').SensorSample} SensorSample */
/** @typedef {import('../types/dataContracts.js').PoseFrame} PoseFrame */

/**
 * @param {unknown} sample
 * @param {{ now?: number|(() => number), allowLegacyArrayQuaternions?: boolean, rejectCrcFailure?: boolean, rejectInvalidPose?: boolean }} [options]
 * @returns {{
 *   accepted: boolean,
 *   algorithmReady: boolean,
 *   sample: SensorSample|null,
 *   poseFrame: PoseFrame,
 *   warnings: Array<Object>,
 *   errors: Array<{code: string, message: string, field?: string}>,
 *   rejectedReason: string|null
 * }}
 */
export function ingestSample(sample, options = {}) {
  const { rejectCrcFailure = false, rejectInvalidPose = false } = options
  const normalized = normalizeSensorSample(sample, options)
  const poseFrame = toPoseFrame(normalized.sample, options)

  let accepted = normalized.ok
  let rejectedReason = null
  const errors = [...normalized.errors]

  if (accepted && rejectCrcFailure && normalized.sample && normalized.sample.crcOk === false) {
    accepted = false
    rejectedReason = 'CRC_FAILED'
    errors.push({ code: 'CRC_FAILED', message: 'sample rejected by CRC policy', field: 'crcOk' })
  }

  if (accepted && rejectInvalidPose && !poseFrame.valid) {
    accepted = false
    rejectedReason = 'INVALID_POSE'
    errors.push({
      code: 'INVALID_POSE',
      message: 'sample rejected because the pose is invalid (missing/invalid quaternion or attitude flag)',
      field: 'q0/q1/q2'
    })
  }

  return {
    accepted,
    algorithmReady: accepted && poseFrame.valid,
    sample: normalized.sample,
    poseFrame,
    warnings: normalized.warnings,
    errors,
    rejectedReason
  }
}

/**
 * Convert the public `{ w, x, y, z }` quaternion fields into the legacy math
 * arrays `[w, x, y, z]` expected by AlgorithmManager/BodyFrameReconstructor.
 *
 * The returned sample is a shallow copy; the stored sample is never mutated.
 * If any quaternion is missing or invalid, `ok` is false and that field is left
 * untouched so the caller can decide how to proceed.
 *
 * @param {SensorSample} sample
 * @returns {{ ok: boolean, sample: SensorSample, errors: Array<{code: string, message: string, field?: string}> }}
 */
export function toAlgorithmSample(sample) {
  const errors = []
  const copy = { ...sample }

  for (const field of ['q0', 'q1', 'q2']) {
    if (copy[field] === undefined || copy[field] === null) {
      errors.push({ code: 'QUATERNION_MISSING', message: `${field} is missing`, field })
      continue
    }
    try {
      copy[field] = quaternionToArray(copy[field], field)
    } catch (error) {
      errors.push({
        code: 'QUATERNION_INVALID',
        message: error instanceof Error ? error.message : String(error),
        field
      })
    }
  }

  return { ok: errors.length === 0, sample: copy, errors }
}
