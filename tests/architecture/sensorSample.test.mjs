import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizePoseFrame,
  normalizeSensorSample,
  toPoseFrame
} from '../../src/types/sensorSample.mjs'
import { ingestSample, toAlgorithmSample } from '../../src/services/sampleIngestion.mjs'
import { makeSample } from './helpers.mjs'

test('sensor sample: valid frame produces a valid PoseFrame with object quaternions', () => {
  const sample = makeSample()
  const result = normalizeSensorSample(sample, { now: 42 })

  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.sample.q0, { w: 1, x: 0, y: 0, z: 0 })
  assert.ok(Array.isArray(result.warnings))

  const pose = toPoseFrame(result.sample, { now: 42 })
  assert.deepEqual(Object.keys(pose).sort(), ['rotations', 'timestamp', 'valid'])
  assert.equal(pose.valid, true)
  assert.equal(pose.timestamp, sample.ts)
  assert.equal(Array.isArray(pose.rotations.q0), false)
  assert.deepEqual(pose.rotations.q0, { w: 1, x: 0, y: 0, z: 0 })
})

test('sensor sample: non-unit quaternions are normalized and warned', () => {
  const sample = makeSample({ q0: { w: 2, x: 0, y: 0, z: 0 } })
  const result = normalizeSensorSample(sample)

  assert.equal(result.ok, true)
  assert.deepEqual(result.sample.q0, { w: 1, x: 0, y: 0, z: 0 })
  assert.equal(result.quaternionStates.q0.status, 'normalized')
  assert.ok(result.warnings.some((warning) => warning.code === 'QUATERNION_NORMALIZED'))
})

test('sensor sample: invalid quaternion does not throw and invalidates the pose', () => {
  const sample = makeSample({ q1: { w: Number.NaN, x: 0, y: 0, z: 0 } })
  const result = normalizeSensorSample(sample)

  assert.equal(result.ok, true)
  assert.equal(result.quaternionStates.q1.valid, false)
  assert.ok(result.warnings.some((warning) => warning.code === 'QUATERNION_INVALID'))

  const pose = toPoseFrame(result.sample)
  assert.equal(pose.valid, false)
  assert.deepEqual(pose.rotations.q1, { w: 1, x: 0, y: 0, z: 0 })
})

test('sensor sample: missing quaternions produce identity placeholders', () => {
  const pose = toPoseFrame({ ts: 10, attitudeValid: true })
  assert.equal(pose.valid, false)
  assert.deepEqual(pose.rotations, {
    q0: { w: 1, x: 0, y: 0, z: 0 },
    q1: { w: 1, x: 0, y: 0, z: 0 },
    q2: { w: 1, x: 0, y: 0, z: 0 }
  })
  assert.equal(pose.timestamp, 10)
})

test('sensor sample: attitudeValid=false invalidates an otherwise valid pose', () => {
  const pose = toPoseFrame(makeSample({ attitudeValid: false }), { now: 5 })
  assert.equal(pose.valid, false)
})

test('sensor sample: legacy temp aliases are kept in sync both ways', () => {
  const fromCanonical = normalizeSensorSample(makeSample({ temp1: undefined, temp2: undefined, temp3: undefined }))
  assert.equal(fromCanonical.sample.temp1, 36.4)
  assert.equal(fromCanonical.sample.temp2, 36.2)
  assert.equal(fromCanonical.sample.temp3, 35.9)

  const fromLegacy = normalizeSensorSample({
    ts: 1,
    temp1: 36.6,
    temp2: 36.3,
    temp3: 36.0
  })
  assert.equal(fromLegacy.sample.tWaist, 36.6)
  assert.equal(fromLegacy.sample.tThigh, 36.3)
  assert.equal(fromLegacy.sample.tAnkle, 36.0)
})

test('sensor sample: canonical temperature wins with a mismatch warning', () => {
  const result = normalizeSensorSample(makeSample({ tWaist: 36.8, temp1: 35.0 }))
  assert.equal(result.sample.temp1, 36.8)
  assert.ok(result.warnings.some((warning) => warning.code === 'TEMPERATURE_ALIAS_MISMATCH'))
})

test('sensor sample: legacy array quaternions require an explicit opt-in', () => {
  const sample = makeSample({ q0: [1, 0, 0, 0], q1: [1, 0, 0, 0], q2: [1, 0, 0, 0] })

  const strict = normalizeSensorSample(sample)
  assert.equal(strict.quaternionStates.q0.valid, false)

  const legacy = normalizeSensorSample(sample, { allowLegacyArrayQuaternions: true })
  assert.equal(legacy.quaternionStates.q0.status, 'valid')
  assert.deepEqual(legacy.sample.q0, { w: 1, x: 0, y: 0, z: 0 })
})

test('sensor sample: normalizePoseFrame is defensive for null, junk and partial frames', () => {
  assert.deepEqual(normalizePoseFrame(null, { now: 99 }), {
    timestamp: 99,
    rotations: {
      q0: { w: 1, x: 0, y: 0, z: 0 },
      q1: { w: 1, x: 0, y: 0, z: 0 },
      q2: { w: 1, x: 0, y: 0, z: 0 }
    },
    valid: false
  })

  assert.equal(normalizePoseFrame('bad', { now: 1 }).valid, false)
  assert.equal(normalizePoseFrame({ rotations: { q0: { w: 1, x: 0, y: 0, z: 0 } } }, { now: 1 }).valid, false)
  assert.equal(
    normalizePoseFrame({ rotations: { q0: { w: 1, x: 0, y: 0, z: 0 }, q1: { w: 1, x: 0, y: 0, z: 0 }, q2: { w: 1, x: 0, y: 0, z: 0 } }, valid: false, timestamp: 3 }).valid,
    false
  )
})

test('sensor sample: normalizePoseFrame accepts a sensor-shaped input', () => {
  const pose = normalizePoseFrame(makeSample({ ts: 123 }))
  assert.equal(pose.timestamp, 123)
  assert.equal(pose.valid, true)
})

test('ingestion: CRC policy is explicit', () => {
  const sample = makeSample({ crcOk: false })

  const permissive = ingestSample(sample, { now: 1 })
  assert.equal(permissive.accepted, true)
  assert.equal(permissive.poseFrame.valid, true)
  assert.ok(permissive.warnings.some((warning) => warning.code === 'CRC_FAILED'))

  const strict = ingestSample(sample, { now: 1, rejectCrcFailure: true })
  assert.equal(strict.accepted, false)
  assert.equal(strict.rejectedReason, 'CRC_FAILED')
  assert.equal(strict.algorithmReady, false)
})

test('ingestion: fatal non-object input yields a safe invalid frame', () => {
  const result = ingestSample(null, { now: 7 })
  assert.equal(result.accepted, false)
  assert.equal(result.sample, null)
  assert.equal(result.poseFrame.timestamp, 7)
  assert.equal(result.poseFrame.valid, false)
})

test('ingestion: invalid pose policy is explicit and opt-in', () => {
  const sample = makeSample({ q1: { w: 0, x: 0, y: 0, z: 0 } })

  const permissive = ingestSample(sample, { now: 1 })
  assert.equal(permissive.accepted, true)
  assert.equal(permissive.algorithmReady, false)

  const strict = ingestSample(sample, { now: 1, rejectInvalidPose: true })
  assert.equal(strict.accepted, false)
  assert.equal(strict.rejectedReason, 'INVALID_POSE')
  assert.ok(strict.errors.some((error) => error.code === 'INVALID_POSE'))
})

test('ingestion: algorithm input conversion is explicit and non-mutating', () => {
  const sample = makeSample()
  const converted = toAlgorithmSample(sample)

  assert.equal(converted.ok, true)
  assert.deepEqual(converted.sample.q0, [1, 0, 0, 0])
  assert.equal(Array.isArray(sample.q0), false)
  assert.deepEqual(sample.q0, { w: 1, x: 0, y: 0, z: 0 })
})

test('ingestion: algorithm conversion reports missing/invalid quaternions', () => {
  const missing = toAlgorithmSample(makeSample({ q2: undefined }))
  assert.equal(missing.ok, false)
  assert.equal(missing.errors[0].code, 'QUATERNION_MISSING')

  const invalid = toAlgorithmSample(makeSample({ q0: { w: 0, x: 0, y: 0, z: 0 } }))
  assert.equal(invalid.ok, false)
  assert.equal(invalid.errors[0].code, 'QUATERNION_INVALID')
})
