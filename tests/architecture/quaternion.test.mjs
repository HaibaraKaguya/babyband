import test from 'node:test'
import assert from 'node:assert/strict'

import {
  IDENTITY_QUATERNION,
  coerceQuaternion,
  isValidQuaternion,
  normalizeQuaternion,
  quaternionFromArray,
  quaternionToArray
} from '../../src/types/quaternion.mjs'

test('quaternion: accepts a unit object and does not mutate it', () => {
  const input = { w: 1, x: 0, y: 0, z: 0 }
  const result = normalizeQuaternion(input)

  assert.equal(result.ok, true)
  assert.equal(result.normalized, false)
  assert.deepEqual(result.value, { w: 1, x: 0, y: 0, z: 0 })
  assert.notEqual(result.value, input)
  assert.deepEqual(input, { w: 1, x: 0, y: 0, z: 0 })
})

test('quaternion: normalizes a finite non-unit object', () => {
  const result = normalizeQuaternion({ w: 2, x: 0, y: 0, z: 0 })

  assert.equal(result.ok, true)
  assert.equal(result.normalized, true)
  assert.equal(result.norm, 2)
  assert.deepEqual(result.value, { w: 1, x: 0, y: 0, z: 0 })
})

test('quaternion: accepts an already-unit arbitrary rotation', () => {
  const result = normalizeQuaternion({ w: 0.5, x: 0.5, y: 0.5, z: 0.5 })

  assert.equal(result.ok, true)
  assert.equal(result.normalized, false)
  assert.ok(Math.abs(Math.hypot(result.value.w, result.value.x, result.value.y, result.value.z) - 1) < 1e-12)
  assert.deepEqual(result.value, { w: 0.5, x: 0.5, y: 0.5, z: 0.5 })
})

test('quaternion: rejects NaN and Infinity components', () => {
  for (const input of [
    { w: Number.NaN, x: 0, y: 0, z: 0 },
    { w: 1, x: Infinity, y: 0, z: 0 },
    { w: 1, x: 0, y: 0, z: '0' }
  ]) {
    const result = normalizeQuaternion(input)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NOT_FINITE')
  }
})

test('quaternion: rejects missing components, zero norm, and non-objects', () => {
  assert.equal(normalizeQuaternion({ w: 1, x: 0, y: 0 }).code, 'MISSING_COMPONENT')
  assert.equal(normalizeQuaternion({ w: 0, x: 0, y: 0, z: 0 }).code, 'ZERO_NORM')
  assert.equal(normalizeQuaternion({ w: 1e-12, x: 0, y: 0, z: 0 }).code, 'ZERO_NORM')
  assert.equal(normalizeQuaternion({ w: 1e308, x: 1e308, y: 1e308, z: 1e308 }).code, 'NORM_INVALID')
  assert.equal(normalizeQuaternion(null).code, 'NOT_OBJECT')
  assert.equal(normalizeQuaternion('quaternion').code, 'NOT_OBJECT')
})

test('quaternion: array input is rejected by default and accepted explicitly', () => {
  const rejected = normalizeQuaternion([1, 0, 0, 0])
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'NOT_OBJECT')

  const accepted = normalizeQuaternion([2, 0, 0, 0], { allowArray: true })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.normalized, true)
  assert.deepEqual(accepted.value, { w: 1, x: 0, y: 0, z: 0 })

  assert.equal(normalizeQuaternion([1, 0, 0], { allowArray: true }).code, 'INVALID_LENGTH')
})

test('quaternion: explicit conversions preserve [w, x, y, z] order', () => {
  const object = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 }
  const array = quaternionToArray(object)
  assert.deepEqual(array, [0.5, 0.5, 0.5, 0.5])

  const roundTrip = quaternionFromArray(array)
  assert.deepEqual(roundTrip, { w: 0.5, x: 0.5, y: 0.5, z: 0.5 })
})

test('quaternion: conversion helpers throw instead of producing NaN', () => {
  assert.throws(() => quaternionToArray({ w: 1, x: NaN, y: 0, z: 0 }), /NOT_FINITE/)
  assert.throws(() => quaternionFromArray([0, 0, 0, 0]), /ZERO_NORM/)
})

test('quaternion: validation and coercion helpers', () => {
  assert.equal(isValidQuaternion(IDENTITY_QUATERNION), true)
  assert.equal(isValidQuaternion({ w: 0, x: 0, y: 0, z: 0 }), false)
  assert.deepEqual(coerceQuaternion([0, 0, 0, 2]), { w: 0, x: 0, y: 0, z: 1 })
  assert.equal(coerceQuaternion(null), null)
})
