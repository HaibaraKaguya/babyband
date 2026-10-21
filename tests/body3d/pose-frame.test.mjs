import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clonePoseFrame,
  createIdentityPoseFrame,
  normalizePoseFrame,
  poseFrameFromSensorSample,
  summarizePoseFrame
} from '../../src/utils/pose3d/poseFrame.js'
import { areQuaternionsEquivalent, quaternionFromAxisAngle } from '../../src/utils/pose3d/quaternion.js'

const ID = { w: 1, x: 0, y: 0, z: 0 }

test('valid identity frame stays valid and keeps timestamp', () => {
  const frame = normalizePoseFrame({
    timestamp: 1234,
    rotations: { q0: ID, q1: ID, q2: ID },
    valid: true
  })
  assert.equal(frame.timestamp, 1234)
  assert.equal(frame.valid, true)
  assert.deepEqual(frame.issues, [])
  assert.ok(areQuaternionsEquivalent(frame.rotations.q0, ID))
})

test('missing rotation is replaced with identity and invalidates frame', () => {
  const frame = normalizePoseFrame({
    timestamp: 10,
    rotations: { q0: ID, q2: ID }
  })
  assert.equal(frame.valid, false)
  assert.ok(areQuaternionsEquivalent(frame.rotations.q1, ID))
  assert.ok(frame.issues.some(item => item.code === 'missing_q1'))
  assert.equal(summarizePoseFrame(frame).valid, false)
})

test('NaN, zero, and non-object quaternions are handled without throwing', () => {
  const qNaN = normalizePoseFrame({
    timestamp: 1,
    rotations: {
      q0: { w: NaN, x: 0, y: 0, z: 0 },
      q1: { w: 0, x: 0, y: 0, z: 0 },
      q2: 'not-a-quaternion'
    }
  })
  assert.equal(qNaN.valid, false)
  assert.ok(qNaN.issues.some(item => item.code === 'invalid_q0'))
  assert.ok(qNaN.issues.some(item => item.code === 'zero_q1'))
  assert.ok(qNaN.issues.some(item => item.code === 'invalid_q2'))

  const nullFrame = normalizePoseFrame(null, { fallbackTimestamp: 77 })
  assert.equal(nullFrame.timestamp, 77)
  assert.equal(nullFrame.valid, false)
  assert.ok(nullFrame.issues.some(item => item.code === 'frame_missing'))
})

test('non-unit finite quaternion is normalized with a warning but remains valid', () => {
  const frame = normalizePoseFrame({
    timestamp: 3,
    rotations: {
      q0: { w: 2, x: 0, y: 0, z: 0 },
      q1: ID,
      q2: ID
    }
  })
  assert.equal(frame.valid, true)
  assert.ok(Math.abs(frame.rotations.q0.w - 1) < 1e-12)
  const warning = frame.issues.find(item => item.code === 'non_unit_q0')
  assert.equal(warning.severity, 'warning')
})

test('missing timestamp invalidates a frame even when quaternions are usable', () => {
  const frame = normalizePoseFrame({
    rotations: { q0: ID, q1: ID, q2: ID },
    valid: true
  })
  assert.equal(frame.timestamp, 0)
  assert.equal(frame.valid, false)
  assert.ok(frame.issues.some(item => item.code === 'timestamp_invalid'))
})

test('explicit upstream invalid flag wins even with usable quaternions', () => {
  const frame = normalizePoseFrame({
    timestamp: 9,
    rotations: { q0: ID, q1: ID, q2: ID },
    valid: false
  })
  assert.equal(frame.valid, false)
  assert.ok(frame.issues.some(item => item.code === 'frame_marked_invalid'))
})

test('array [w,x,y,z] input is accepted and normalized to object output', () => {
  const frame = normalizePoseFrame({
    timestamp: 2,
    rotations: { q0: [2, 0, 0, 0], q1: [1, 0, 0, 0], q2: [1, 0, 0, 0] }
  })
  assert.equal(frame.valid, true)
  assert.equal(frame.rotations.q0.w, 1)
  assert.equal(frame.rotations.q0.x, 0)
})

test('sensor sample maps q0/q1/q2 {w,x,y,z} and flags CRC/attitude failures', () => {
  const q = quaternionFromAxisAngle([0, 0, 1], Math.PI / 3)
  const sample = {
    ts: 5000,
    deviceMs: 1200,
    q0: q,
    q1: ID,
    q2: ID,
    attitudeValid: false,
    crcOk: true
  }
  const frame = poseFrameFromSensorSample(sample)
  assert.equal(frame.timestamp, 5000)
  assert.equal(frame.valid, false)
  assert.ok(frame.issues.some(item => item.code === 'attitude_invalid'))
  assert.equal(frame.rotations.q0.w, q.w)
  assert.equal(frame.rotations.q0.z, q.z)

  const badCrc = poseFrameFromSensorSample({ ...sample, ts: 5001, attitudeValid: true, crcOk: false })
  assert.equal(badCrc.valid, false)
  assert.ok(badCrc.issues.some(item => item.code === 'crc_invalid'))

  const noTs = poseFrameFromSensorSample({
    deviceMs: 42,
    q0: ID,
    q1: ID,
    q2: ID,
    attitudeValid: true,
    crcOk: true
  })
  assert.equal(noTs.timestamp, 42)
  assert.equal(noTs.valid, true)

  const noTime = poseFrameFromSensorSample({
    q0: ID,
    q1: ID,
    q2: ID,
    attitudeValid: true,
    crcOk: true
  })
  assert.equal(noTime.timestamp, 0)
  assert.equal(noTime.valid, false)
  assert.ok(noTime.issues.some(item => item.code === 'timestamp_invalid'))
})

test('poseFrameFromSensorSample handles parse errors and null samples', () => {
  const parseError = poseFrameFromSensorSample({ parseError: 'bad frame' })
  assert.equal(parseError.valid, false)
  assert.ok(parseError.issues.some(item => item.code === 'sample_parse_error'))

  const nullSample = poseFrameFromSensorSample(null, { timestamp: 6 })
  assert.equal(nullSample.timestamp, 6)
  assert.equal(nullSample.valid, false)
})

test('clonePoseFrame is detached from the source object', () => {
  const source = {
    timestamp: 1,
    rotations: { q0: { w: 1, x: 0, y: 0, z: 0 }, q1: { w: 1, x: 0, y: 0, z: 0 }, q2: { w: 1, x: 0, y: 0, z: 0 } },
    valid: true
  }
  const copy = clonePoseFrame(source)
  copy.rotations.q0.w = 0.5
  assert.equal(source.rotations.q0.w, 1)
  assert.equal(createIdentityPoseFrame(2, true).valid, true)
})
