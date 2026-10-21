import test from 'node:test'
import assert from 'node:assert/strict'

import {
  IDENTITY_QUATERNION,
  areQuaternionsEquivalent,
  conjugateQuaternion,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionAngleDegrees,
  quaternionFromAxisAngle,
  relativeQuaternion,
  slerpQuaternions,
  toQuaternionArray,
  toQuaternionObject,
  toThreeQuaternionArgs
} from '../../src/utils/pose3d/quaternion.js'
import {
  identityRigPose,
  mapPoseToRig,
  rigPoseToThreeArgs
} from '../../src/utils/pose3d/poseMapping.js'

const Q_ID = { w: 1, x: 0, y: 0, z: 0 }
const qZ90 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2)
const qZ180 = quaternionFromAxisAngle([0, 0, 1], Math.PI)

function frame(q0 = Q_ID, q1 = Q_ID, q2 = Q_ID, timestamp = 1000) {
  return {
    timestamp,
    rotations: { q0: { ...q0 }, q1: { ...q1 }, q2: { ...q2 } },
    valid: true
  }
}

test('public {w,x,y,z} and math [w,x,y,z] conversions are explicit', () => {
  const source = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 }
  assert.deepEqual(toQuaternionArray(source), [0.5, 0.5, 0.5, 0.5])
  assert.deepEqual(toQuaternionObject([0.5, 0.5, 0.5, 0.5]), source)
  assert.deepEqual(toThreeQuaternionArgs(source), {
    x: 0.5,
    y: 0.5,
    z: 0.5,
    w: 0.5
  })
  assert.equal(toQuaternionObject([1, 0, 0]), null)
  assert.equal(toQuaternionObject({ w: 1, x: 0, y: 0 }), null)
  assert.equal(toQuaternionArray({ w: NaN, x: 0, y: 0, z: 0 }), null)
})

test('normalization rejects zero/NaN and normalizes small drift', () => {
  assert.equal(normalizeQuaternion({ w: 0, x: 0, y: 0, z: 0 }), null)
  assert.equal(normalizeQuaternion({ w: NaN, x: 0, y: 0, z: 0 }), null)
  const normalized = normalizeQuaternion({ w: 2, x: 0, y: 0, z: 0 })
  assert.equal(normalized.w, 1)
  assert.ok(areQuaternionsEquivalent(normalized, Q_ID))
})

test('identity sensor frame maps to identity rig joints', () => {
  const mapped = mapPoseToRig(frame())
  assert.equal(mapped.valid, true)
  assert.ok(areQuaternionsEquivalent(mapped.torso, Q_ID))
  assert.ok(areQuaternionsEquivalent(mapped.rightArm, Q_ID))
  assert.ok(areQuaternionsEquivalent(mapped.rightLeg, Q_ID))
})

test('wrist rotation drives only the arm and is relative to waist', () => {
  const mapped = mapPoseToRig(frame(Q_ID, qZ90, Q_ID))
  assert.ok(Math.abs(quaternionAngleDegrees(mapped.rightArm, qZ90)) < 1e-6)
  assert.ok(areQuaternionsEquivalent(mapped.torso, Q_ID))
  assert.ok(areQuaternionsEquivalent(mapped.rightLeg, Q_ID))
  assert.ok(Math.abs(quaternionAngleDegrees(mapped.rightArm, mapped.torso) - 90) < 1e-6)
})

test('equal waist and wrist orientation produces no relative limb rotation', () => {
  const mapped = mapPoseToRig(frame(qZ90, qZ90, qZ90))
  assert.ok(Math.abs(quaternionAngleDegrees(mapped.torso, qZ90)) < 1e-6)
  assert.ok(areQuaternionsEquivalent(mapped.rightArm, Q_ID))
  assert.ok(areQuaternionsEquivalent(mapped.rightLeg, Q_ID))
})

test('relative quaternion math is conjugate(parent) * child', () => {
  const relative = relativeQuaternion(qZ90, qZ180)
  assert.ok(Math.abs(quaternionAngleDegrees(relative, qZ90)) < 1e-6)
  const manual = normalizeQuaternion(
    multiplyQuaternions(conjugateQuaternion(qZ90), qZ180)
  )
  assert.ok(areQuaternionsEquivalent(relative, manual))
})

test('segment gain scales rotation without changing direction', () => {
  const mapped = mapPoseToRig(frame(Q_ID, qZ180, Q_ID), { armGain: 0.5 })
  assert.ok(Math.abs(quaternionAngleDegrees(mapped.rightArm, Q_ID) - 90) < 1e-5)
  const zero = mapPoseToRig(frame(Q_ID, qZ180, Q_ID), { armGain: 0 })
  assert.ok(areQuaternionsEquivalent(zero.rightArm, Q_ID))
})

test('invalid frame maps to identity joints and valid=false', () => {
  const mapped = mapPoseToRig({
    timestamp: 5,
    rotations: {
      q0: { w: 1, x: 0, y: 0, z: 0 },
      q1: { w: NaN, x: 0, y: 0, z: 0 },
      q2: { w: 1, x: 0, y: 0, z: 0 }
    },
    valid: true
  })
  assert.equal(mapped.valid, false)
  assert.ok(areQuaternionsEquivalent(mapped.torso, Q_ID))
  assert.ok(areQuaternionsEquivalent(mapped.rightArm, Q_ID))
  assert.ok(mapped.issues.some(item => item.code === 'invalid_q1'))
})

test('rig pose converts to three.js {x,y,z,w} order', () => {
  const args = rigPoseToThreeArgs({
    torso: { w: 1, x: 2, y: 3, z: 4 },
    rightArm: { w: 5, x: 6, y: 7, z: 8 },
    rightLeg: { w: 9, x: 10, y: 11, z: 12 }
  })
  assert.deepEqual(args.torso, { x: 2, y: 3, z: 4, w: 1 })
  assert.deepEqual(args.rightArm, { x: 6, y: 7, z: 8, w: 5 })
  assert.deepEqual(args.rightLeg, { x: 10, y: 11, z: 12, w: 9 })
  assert.equal(identityRigPose(3).valid, false)
  assert.equal(IDENTITY_QUATERNION.w, 1)
})

test('slerp follows shortest path at midpoint', () => {
  const mid = slerpQuaternions(Q_ID, qZ180, 0.5)
  assert.ok(Math.abs(quaternionAngleDegrees(mid, Q_ID) - 90) < 1e-5)
  const near = slerpQuaternions(Q_ID, qZ90, 0)
  assert.ok(areQuaternionsEquivalent(near, Q_ID))
  const far = slerpQuaternions(Q_ID, qZ90, 1)
  assert.ok(areQuaternionsEquivalent(far, qZ90))
  assert.equal(slerpQuaternions(null, qZ90, 0.5), null)
})
