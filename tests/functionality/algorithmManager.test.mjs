import test from 'node:test'
import assert from 'node:assert/strict'
import AlgorithmManager from '../../src/utils/algorithms/AlgorithmManager.js'
import { assertFiniteDeep } from './helpers/frames.mjs'

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 }
const X30 = { w: Math.cos(Math.PI / 12), x: Math.sin(Math.PI / 12), y: 0, z: 0 }
const Y45 = { w: Math.cos(Math.PI / 8), x: 0, y: Math.sin(Math.PI / 8), z: 0 }

function validSample(overrides = {}) {
  return {
    ts: 1000,
    q0: IDENTITY,
    q1: X30,
    q2: Y45,
    temp1: 36.4,
    temp2: 36.2,
    temp3: 35.9,
    tempValid: true,
    attitudeValid: true,
    frameSeq: 1,
    ...overrides
  }
}

test('valid object quaternions produce finite, consistent algorithm output', () => {
  const manager = new AlgorithmManager()
  const result = manager.processSensorData(validSample())

  assert.deepEqual(Object.keys(result).sort(), [
    'attitudeValid',
    'bodyFrame',
    'coordinateTransforms',
    'endEffectorPositions',
    'jointAngles',
    'kickDetected',
    'poseFrame',
    'sensorData',
    'tempValid',
    'temperatureAnalysis',
    'type',
    'valid',
    'validation'
  ])

  assert.equal(result.type, 'bodyFrame')
  assert.equal(result.valid, true)
  assert.equal(result.attitudeValid, true)
  assert.equal(result.tempValid, true)
  assert.equal(result.poseFrame.valid, true)
  assert.equal(result.bodyFrame.valid, true)
  assert.equal(result.validation.valid, true)

  assert.ok(result.jointAngles)
  assert.ok(result.endEffectorPositions)
  assertFiniteDeep(result.jointAngles)
  assertFiniteDeep(result.endEffectorPositions)
  assertFiniteDeep(result.bodyFrame)
  assertFiniteDeep(result.poseFrame)
  assertFiniteDeep(result.temperatureAnalysis)

  assert.ok(Math.abs(result.temperatureAnalysis.tempDiff - 0.2) < 1e-9)
  assert.equal(result.kickDetected.detected, false)
  assert.equal(result.kickDetected.skipped, false)
})

test('attitudeValid=false skips pose math but still reports temperature', () => {
  const manager = new AlgorithmManager()
  const result = manager.processSensorData(validSample({ attitudeValid: false }))

  assert.equal(result.valid, false)
  assert.equal(result.attitudeValid, false)
  assert.equal(result.poseFrame.valid, false)
  assert.equal(result.bodyFrame.valid, false)
  assert.equal(result.validation.valid, false)
  assert.equal(result.jointAngles, null)
  assert.equal(result.endEffectorPositions, null)
  assert.equal(result.kickDetected.skipped, true)
  assert.match(result.kickDetected.reason, /attitude invalid/)
  assert.equal(result.temperatureAnalysis.valid, true)
  assert.equal(result.tempValid, true)
  assertFiniteDeep(result.poseFrame)
})

test('a missing or non-finite quaternion is treated as invalid attitude', () => {
  const manager = new AlgorithmManager()
  const result = manager.processSensorData(validSample({ q2: { w: NaN, x: 0, y: 0, z: 0 } }))

  assert.equal(result.valid, false)
  assert.equal(result.poseFrame.valid, false)
  assert.equal(result.jointAngles, null)
  assert.equal(result.validation.valid, false)
  assert.match(result.validation.reason, /invalid quaternion/)
})

test('tempValid=false suppresses temperature analysis and kick detection', () => {
  const manager = new AlgorithmManager()
  const result = manager.processSensorData(validSample({ tempValid: false }))

  assert.equal(result.attitudeValid, true)
  assert.equal(result.tempValid, false)
  assert.equal(result.jointAngles !== null, true)
  assert.equal(result.temperatureAnalysis.valid, false)
  assert.equal(result.temperatureAnalysis.tempDiff, null)
  assert.equal(result.kickDetected.skipped, true)
  assert.match(result.kickDetected.reason, /temperature invalid/)
  assertFiniteDeep(result.jointAngles)
})

test('non-finite temperature fields cannot create a false alarm', () => {
  const manager = new AlgorithmManager()
  const result = manager.processSensorData(validSample({ temp2: NaN }))

  assert.equal(result.tempValid, false)
  assert.equal(result.temperatureAnalysis.valid, false)
  assert.equal(result.kickDetected.detected, false)
  assert.equal(result.kickDetected.skipped, true)
})

test('malformed input returns a stable shape instead of throwing or producing NaN', () => {
  const manager = new AlgorithmManager()
  const result = manager.processSensorData(null)

  assert.equal(result.type, 'bodyFrame')
  assert.equal(result.valid, false)
  assert.equal(result.poseFrame.valid, false)
  assert.equal(result.jointAngles, null)
  assert.equal(result.kickDetected.skipped, true)
  assertFiniteDeep(result.poseFrame)
  assert.equal(result.temperatureAnalysis.valid, false)
})

test('alignment calibration accepts object quaternions and stores a finite array', () => {
  const manager = new AlgorithmManager()
  const ok = manager.finishAlignmentCalibration(IDENTITY, X30)

  assert.equal(ok, true)
  assert.equal(manager.isAligned, true)
  assert.equal(manager.bodyReconstructor.alignmentQuat.length, 4)
  assertFiniteDeep(manager.bodyReconstructor.alignmentQuat)

  assert.equal(manager.finishAlignmentCalibration(IDENTITY, { w: NaN, x: 0, y: 0, z: 0 }), false)
})
