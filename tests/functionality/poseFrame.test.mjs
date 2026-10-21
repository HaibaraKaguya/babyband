import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPoseFrame,
  sanitizePoseFrame,
  sanitizeRotation,
  identityRotation
} from '../../src/utils/poseFrame.js'
import { assertFiniteDeep } from './helpers/frames.mjs'

const rotation = (w, x, y, z) => ({ w, x, y, z })

test('buildPoseFrame returns the renderer contract and normalizes rotations', () => {
  const frame = buildPoseFrame({
    ts: 1234,
    attitudeValid: true,
    q0: rotation(2, 0, 0, 0),
    q1: rotation(0, 2, 0, 0),
    q2: rotation(0, 0, 0, 2)
  })

  assert.deepEqual(Object.keys(frame).sort(), ['rotations', 'timestamp', 'valid'])
  assert.equal(frame.timestamp, 1234)
  assert.equal(frame.valid, true)
  assert.deepEqual(frame.rotations.q0, rotation(1, 0, 0, 0))
  assert.deepEqual(frame.rotations.q1, rotation(0, 1, 0, 0))
  assert.deepEqual(frame.rotations.q2, rotation(0, 0, 0, 1))
  assertFiniteDeep(frame)
})

test('invalid attitude flag marks the frame invalid but still renderable', () => {
  const frame = buildPoseFrame({
    ts: 10,
    attitudeValid: false,
    q0: rotation(1, 0, 0, 0),
    q1: rotation(1, 0, 0, 0),
    q2: rotation(1, 0, 0, 0)
  })

  assert.equal(frame.valid, false)
  assert.deepEqual(frame.rotations.q0, rotation(1, 0, 0, 0))
})

test('missing and non-finite rotations fall back to finite identity values', () => {
  const missing = buildPoseFrame({ ts: 1 })
  assert.equal(missing.valid, false)
  assert.deepEqual(missing.rotations, {
    q0: identityRotation(),
    q1: identityRotation(),
    q2: identityRotation()
  })
  assertFiniteDeep(missing)

  const broken = buildPoseFrame({
    ts: 2,
    attitudeValid: true,
    q0: rotation(NaN, 0, 0, 0),
    q1: undefined,
    q2: { w: 0, x: 0, y: 0, z: 0 }
  })
  assert.equal(broken.valid, false)
  assert.deepEqual(broken.rotations.q0, identityRotation())
  assert.deepEqual(broken.rotations.q2, identityRotation())
  assertFiniteDeep(broken)
})

test('sanitizeRotation rejects zero-norm quaternions', () => {
  assert.deepEqual(sanitizeRotation({ w: 0, x: 0, y: 0, z: 0 }), {
    rotation: identityRotation(),
    valid: false
  })
})

test('sanitizePoseFrame tolerates undefined, primitives, partial frames and invalid frames', () => {
  const fromUndefined = sanitizePoseFrame(undefined, { now: 123 })
  assert.deepEqual(fromUndefined, {
    timestamp: 123,
    rotations: {
      q0: identityRotation(),
      q1: identityRotation(),
      q2: identityRotation()
    },
    valid: false
  })

  const fromString = sanitizePoseFrame('garbage', { now: 0 })
  assert.equal(fromString.valid, false)
  assertFiniteDeep(fromString)

  const partial = sanitizePoseFrame({
    timestamp: 50,
    rotations: { q0: rotation(1, 0, 0, 0) }
  })
  assert.equal(partial.timestamp, 50)
  assert.equal(partial.valid, false)
  assert.deepEqual(partial.rotations.q1, identityRotation())

  const declaredInvalid = sanitizePoseFrame({
    timestamp: 60,
    valid: false,
    rotations: {
      q0: rotation(1, 0, 0, 0),
      q1: rotation(1, 0, 0, 0),
      q2: rotation(1, 0, 0, 0)
    }
  })
  assert.equal(declaredInvalid.valid, false)
})

test('sanitizePoseFrame accepts an already built pose frame', () => {
  const built = buildPoseFrame({
    ts: 77,
    attitudeValid: true,
    q0: rotation(1, 0, 0, 0),
    q1: rotation(1, 0, 0, 0),
    q2: rotation(1, 0, 0, 0)
  })

  assert.deepEqual(sanitizePoseFrame(built), built)
})
