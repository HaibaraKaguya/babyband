import test from 'node:test'
import assert from 'node:assert/strict'
import TemperatureAnalyzer from '../../src/utils/algorithms/TemperatureAnalyzer.js'
import KickDetector from '../../src/utils/algorithms/KickDetector.js'

test('tempDiff is positive when the thigh is colder than the waist', () => {
  const analyzer = new TemperatureAnalyzer()
  const warmWaist = analyzer.analyze({
    timestamp: 1000,
    temp1: 36.5,
    temp2: 35.5,
    temp3: 35.0,
    tempValid: true
  })

  assert.equal(warmWaist.valid, true)
  assert.equal(warmWaist.tempDiff, 1)

  const coldWaist = analyzer.analyze({
    timestamp: 2000,
    temp1: 35.5,
    temp2: 36.5,
    temp3: 36.0,
    tempValid: true
  })
  assert.equal(coldWaist.tempDiff, -1)
})

test('temperature rates use first/last values in the window', () => {
  const analyzer = new TemperatureAnalyzer({ timeWindow: 10 })
  analyzer.analyze({ timestamp: 1000, temp1: 36.5, temp2: 36.5, temp3: 36.5, tempValid: true })
  const result = analyzer.analyze({
    timestamp: 2000,
    temp1: 36.2,
    temp2: 36.0,
    temp3: 35.5,
    tempValid: true
  })

  assert.ok(Math.abs(result.tempRate1 - (-0.3)) < 1e-9)
  assert.ok(Math.abs(result.tempRate2 - (-0.5)) < 1e-9)
  assert.ok(Math.abs(result.tempRate3 - (-1.0)) < 1e-9)
})

test('temperature analyzer rejects invalid flags and non-finite values', () => {
  const analyzer = new TemperatureAnalyzer()
  const flagged = analyzer.analyze({
    timestamp: 1000,
    temp1: 36.5,
    temp2: 36.0,
    temp3: 35.5,
    tempValid: false
  })

  assert.equal(flagged.valid, false)
  assert.equal(flagged.tempDiff, null)
  assert.equal(flagged.tempRate1, null)
  assert.equal(analyzer.history.length, 0)

  const nan = analyzer.analyze({
    timestamp: 1000,
    temp1: 36.5,
    temp2: NaN,
    temp3: 35.5,
    tempValid: true
  })
  assert.equal(nan.valid, false)
  assert.equal(analyzer.history.length, 0)
})

test('kick detector treats positive tempDiff as thigh exposure', () => {
  const detector = new KickDetector()
  detector.detect({
    timestamp: 1000,
    hip: 0,
    knee: 0,
    temp1: 36.5,
    temp2: 35.5,
    temp3: 35.5,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: 0,
    tempDiff: 1,
    tempValid: true,
    attitudeValid: true
  })

  const exposure = detector.detect({
    timestamp: 2000,
    hip: 60,
    knee: 10,
    temp1: 36.5,
    temp2: 35.5,
    temp3: 35.5,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: 0,
    tempDiff: 1,
    tempValid: true,
    attitudeValid: true
  })

  assert.equal(exposure.detected, true)
  assert.equal(exposure.skipped, false)
  assert.match(exposure.reason, /大腿暴露/)
})

test('kick detector does not fire when the thigh is warmer (negative tempDiff)', () => {
  const detector = new KickDetector()
  detector.detect({
    timestamp: 1000,
    hip: 0,
    knee: 0,
    temp1: 36.5,
    temp2: 36.5,
    temp3: 36.5,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: 0,
    tempDiff: 0,
    tempValid: true,
    attitudeValid: true
  })

  const result = detector.detect({
    timestamp: 2000,
    hip: 60,
    knee: 10,
    temp1: 35.5,
    temp2: 36.5,
    temp3: 36.5,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: 0,
    tempDiff: -1,
    tempValid: true,
    attitudeValid: true
  })

  assert.equal(result.detected, false)
  assert.equal(result.skipped, false)
})

test('ankle cooling plus positive tempDiff triggers the combined condition', () => {
  const detector = new KickDetector()
  const result = detector.detect({
    timestamp: 1000,
    hip: 0,
    knee: 0,
    temp1: 36.5,
    temp2: 35.5,
    temp3: 34.8,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: -0.5,
    tempDiff: 1,
    tempValid: true,
    attitudeValid: true
  })

  assert.equal(result.detected, true)
  assert.match(result.reason, /脚踝降温\+大腿暴露/)
})

test('kick detector skips invalid sensor flags and non-finite inputs', () => {
  const detector = new KickDetector()
  const flagged = detector.detect({
    timestamp: 1000,
    hip: 0,
    knee: 0,
    temp1: 36.5,
    temp2: 35.5,
    temp3: 34,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: -1,
    tempDiff: 1,
    tempValid: false
  })
  assert.deepEqual(flagged, { detected: false, skipped: true, reason: 'sensor invalid' })

  const nan = detector.detect({
    timestamp: 1000,
    hip: 0,
    knee: NaN,
    temp1: 36.5,
    temp2: 35.5,
    temp3: 34,
    tempRate1: 0,
    tempRate2: 0,
    tempRate3: -1,
    tempDiff: 1
  })
  assert.deepEqual(nan, { detected: false, skipped: true, reason: 'invalid input' })
})
