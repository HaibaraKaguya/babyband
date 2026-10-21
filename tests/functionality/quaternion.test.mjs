import test from 'node:test'
import assert from 'node:assert/strict'
import Quaternion, { quaternionToArray } from '../../src/utils/algorithms/Quaternion.js'

test('converts protocol object quaternions to explicit math arrays', () => {
  const object = { w: 0.5, x: -0.5, y: 0.5, z: -0.5 }

  assert.deepEqual(quaternionToArray(object), [0.5, -0.5, 0.5, -0.5])

  const quat = Quaternion.fromQuaternionLike(object)
  assert.ok(quat)
  assert.deepEqual(quat.toArray(), [0.5, -0.5, 0.5, -0.5])
  assert.deepEqual(quat.toObject(), object)
})

test('accepts arrays and Quaternion instances at the conversion boundary', () => {
  const fromArray = Quaternion.fromQuaternionLike([0, 0, 1, 0])
  assert.ok(fromArray)
  assert.deepEqual(fromArray.toObject(), { w: 0, x: 0, y: 1, z: 0 })

  const fromInstance = Quaternion.fromQuaternionLike(new Quaternion(1, 0, 0, 0))
  assert.ok(fromInstance)
  assert.deepEqual(fromInstance.toArray(), [1, 0, 0, 0])
})

test('invalid quaternion input never produces NaN', () => {
  assert.equal(Quaternion.fromQuaternionLike(null), null)
  assert.equal(Quaternion.fromQuaternionLike({ w: 1, x: NaN, y: 0, z: 0 }), null)
  assert.equal(Quaternion.fromQuaternionLike([1, 0]), null)
  assert.equal(Quaternion.fromQuaternionLike('nope'), null)

  const fallback = Quaternion.fromArray({ w: 1, x: 0, y: 0, z: 0 })
  assert.deepEqual(fallback.toArray(), [1, 0, 0, 0])
  assert.deepEqual(fallback.toEulerAngles(), { roll: 0, pitch: 0, yaw: 0 })

  const invalid = new Quaternion(NaN, 0, 0, 0)
  assert.equal(invalid.isValid(), false)
  assert.deepEqual(invalid.toEulerAngles(), { roll: 0, pitch: 0, yaw: 0 })
})

test('normalization produces unit quaternions and safe identity for zero norm', () => {
  const normalized = new Quaternion(2, 0, 0, 0).normalized()
  assert.deepEqual(normalized.toArray(), [1, 0, 0, 0])

  const zero = new Quaternion(0, 0, 0, 0).normalized()
  assert.deepEqual(zero.toArray(), [1, 0, 0, 0])
  assert.equal(new Quaternion(0, 0, 0, 0).isValid(), false)
})

test('angleBetween tolerates missing or non-finite input', () => {
  assert.equal(Quaternion.angleBetween(null, new Quaternion()), 0)
  assert.equal(
    Quaternion.angleBetween(new Quaternion(1, 0, 0, 0), new Quaternion(1, 0, 0, 0)),
    0
  )
  const angle = Quaternion.angleBetween(
    new Quaternion(1, 0, 0, 0),
    new Quaternion(Math.SQRT1_2, Math.SQRT1_2, 0, 0)
  )
  assert.ok(Math.abs(angle - 90) < 1e-6)
})
