/**
 * PoseFrame contract used by the 3D renderer.
 *
 * Public shape:
 *   {
 *     timestamp: number,
 *     rotations: {
 *       q0: { w, x, y, z },  // waist sensor (existing protocol.q0)
 *       q1: { w, x, y, z },  // wrist sensor (existing protocol.q1)
 *       q2: { w, x, y, z }   // ankle sensor (existing protocol.q2)
 *     },
 *     valid: boolean
 *   }
 *
 * `normalizePoseFrame` never throws and always returns that shape (identity
 * quaternions are substituted for missing values). Invalid input is reported
 * via `valid:false` plus `issues`, never via an exception.
 */

/**
 * @typedef {Object} PoseQuaternion
 * @property {number} w
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} PoseFrame
 * @property {number} timestamp Unix epoch ms or a consistent replay timestamp.
 * @property {{q0:PoseQuaternion,q1:PoseQuaternion,q2:PoseQuaternion}} rotations
 * @property {boolean} valid True only when all three quaternions and timestamp
 *   passed normalization; invalid frames are safe for the renderer to receive.
 */

/**
 * @typedef {Object} PoseIssue
 * @property {string} code
 * @property {string} message
 * @property {string} field
 * @property {'error'|'warning'} severity
 */

import {
  IDENTITY_QUATERNION,
  cloneQuaternion,
  isNearUnitQuaternion,
  normalizeQuaternion,
  toQuaternionObject
} from './quaternion.js'

const SEVERITY_ERROR = 'error'
const SEVERITY_WARNING = 'warning'

function issue(code, message, field, severity = SEVERITY_ERROR) {
  return { code, message, field, severity }
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readRotation(input, key) {
  if (!input || typeof input !== 'object') return undefined
  const rotations = input.rotations
  if (rotations && typeof rotations === 'object' && rotations[key] !== undefined) {
    return rotations[key]
  }
  return input[key]
}

/**
 * Normalize one quaternion and append diagnostics for common problems.
 * @returns {{value:{w:number,x:number,y:number,z:number}, ok:boolean}}
 */
function normalizeSlot(raw, key, issues) {
  if (raw === undefined || raw === null) {
    issues.push(issue(`missing_${key}`, `姿态帧缺少 ${key}`, key))
    return { value: { ...IDENTITY_QUATERNION }, ok: false }
  }

  const asObject = toQuaternionObject(raw)
  if (!asObject) {
    issues.push(
      issue(
        `invalid_${key}`,
        `${key} 不是有效的 {w,x,y,z} 四元数（存在非有限数值）`,
        key
      )
    )
    return { value: { ...IDENTITY_QUATERNION }, ok: false }
  }

  if (!isNearUnitQuaternion(asObject, 0.05)) {
    issues.push(
      issue(
        `non_unit_${key}`,
        `${key} 模长偏离 1，已归一化`,
        key,
        SEVERITY_WARNING
      )
    )
  }

  const normalized = normalizeQuaternion(asObject)
  if (!normalized) {
    issues.push(issue(`zero_${key}`, `${key} 模长为 0，无法归一化`, key))
    return { value: { ...IDENTITY_QUATERNION }, ok: false }
  }
  return { value: normalized, ok: true }
}

export function createIdentityPoseFrame(timestamp = 0, valid = false) {
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    rotations: {
      q0: { ...IDENTITY_QUATERNION },
      q1: { ...IDENTITY_QUATERNION },
      q2: { ...IDENTITY_QUATERNION }
    },
    valid: Boolean(valid),
    issues: []
  }
}

/**
 * Normalize arbitrary renderer input into the PoseFrame contract.
 *
 * @param {object|null|undefined} input
 * @param {{ fallbackTimestamp?: number, requireFlags?: boolean }} [options]
 * @returns {{timestamp:number, rotations:{q0:object,q1:object,q2:object}, valid:boolean, issues:Array}}
 */
export function normalizePoseFrame(input, options = {}) {
  const issues = []
  if (!input || typeof input !== 'object') {
    issues.push(
      issue('frame_missing', '没有可用的姿态帧（输入为空）', 'frame')
    )
    return {
      ...createIdentityPoseFrame(options.fallbackTimestamp || 0, false),
      issues
    }
  }

  let timestampValid = true
  let timestamp = toTimestamp(input.timestamp)
  if (timestamp === null) {
    timestamp = toTimestamp(options.fallbackTimestamp)
    if (timestamp === null) {
      timestamp = 0
      timestampValid = false
    }
    issues.push(
      issue('timestamp_invalid', '姿态帧 timestamp 无效，已回退', 'timestamp')
    )
  }

  const q0 = normalizeSlot(readRotation(input, 'q0'), 'q0', issues)
  const q1 = normalizeSlot(readRotation(input, 'q1'), 'q1', issues)
  const q2 = normalizeSlot(readRotation(input, 'q2'), 'q2', issues)

  let contractValid = q0.ok && q1.ok && q2.ok && timestampValid
  if (input.valid === false) {
    contractValid = false
    issues.push(
      issue('frame_marked_invalid', '上游已标记该姿态帧无效', 'valid')
    )
  } else if (input.valid !== undefined && input.valid !== true) {
    contractValid = false
    issues.push(
      issue('frame_valid_flag_invalid', 'valid 字段不是布尔值', 'valid')
    )
  }

  return {
    timestamp,
    rotations: { q0: q0.value, q1: q1.value, q2: q2.value },
    valid: contractValid,
    issues
  }
}

/**
 * Build a PoseFrame from a parsed BabyBand sample.
 *
 * q0/q1/q2 are already `{w,x,y,z}` in `babyBandProtocol.js`; they are passed
 * through unchanged after normalization. `deviceMs` is only used when no
 * epoch/relative `ts` is available.
 *
 * @param {object} sample parsed sample (`parseBabyBandFrame(...).sample`)
 * @param {{timestamp?:number, now?:number}} [options]
 */
export function poseFrameFromSensorSample(sample, options = {}) {
  if (!sample || typeof sample !== 'object') {
    return normalizePoseFrame(null, {
      fallbackTimestamp: toTimestamp(options.timestamp) ?? toTimestamp(options.now) ?? 0
    })
  }

  const issues = []
  if (sample.parseError) {
    issues.push(
      issue('sample_parse_error', `采样解析失败：${sample.parseError}`, 'sample')
    )
  }
  if (sample.attitudeValid === false) {
    issues.push(
      issue('attitude_invalid', '设备标记姿态数据无效', 'attitudeValid')
    )
  }
  if (sample.crcOk === false) {
    issues.push(issue('crc_invalid', 'CRC 校验失败', 'crcOk'))
  }

  const rawTimestamp =
    toTimestamp(options.timestamp) ??
    toTimestamp(sample.ts) ??
    toTimestamp(sample.deviceMs) ??
    toTimestamp(options.now)
  const timestamp = rawTimestamp === null ? 0 : rawTimestamp
  if (rawTimestamp === null) {
    issues.push(issue('timestamp_invalid', '采样缺少可用时间戳', 'timestamp'))
  }

  const frame = normalizePoseFrame(
    {
      timestamp,
      rotations: {
        q0: sample.q0,
        q1: sample.q1,
        q2: sample.q2
      },
      valid:
        rawTimestamp !== null &&
        sample.attitudeValid !== false &&
        sample.crcOk !== false &&
        !sample.parseError
    },
    { fallbackTimestamp: timestamp }
  )

  // Preserve device fields that help debugging without changing the contract.
  return {
    ...frame,
    deviceMs: Number.isFinite(sample.deviceMs) ? sample.deviceMs : null,
    frameSeq: Number.isFinite(sample.frameSeq) ? sample.frameSeq : null,
    issues: issues.concat(frame.issues)
  }
}

/**
 * Deep copy + normalize. Useful before handing a frame to the renderer so the
 * view layer cannot retain references into page data.
 */
export function clonePoseFrame(input) {
  const frame = normalizePoseFrame(input)
  return {
    timestamp: frame.timestamp,
    rotations: {
      q0: cloneQuaternion(frame.rotations.q0) || { ...IDENTITY_QUATERNION },
      q1: cloneQuaternion(frame.rotations.q1) || { ...IDENTITY_QUATERNION },
      q2: cloneQuaternion(frame.rotations.q2) || { ...IDENTITY_QUATERNION }
    },
    valid: frame.valid,
    issues: frame.issues.map(item => ({ ...item }))
  }
}

export function summarizePoseFrame(frame) {
  const normalized = normalizePoseFrame(frame)
  const firstError = normalized.issues.find(item => item.severity === SEVERITY_ERROR)
  return {
    timestamp: normalized.timestamp,
    valid: normalized.valid,
    error: firstError ? firstError.message : '',
    issueCount: normalized.issues.length
  }
}

export { IDENTITY_QUATERNION }
