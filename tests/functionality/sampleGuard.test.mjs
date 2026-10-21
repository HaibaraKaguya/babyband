import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_GUARD_STATE,
  createSampleGuard,
  evaluateSample
} from '../../src/utils/sampleGuard.js'

test('duplicate frameSeq is rejected and higher frameSeq is accepted', () => {
  const first = evaluateSample({ frameSeq: 10, deviceMs: 1000, ts: 1 }, EMPTY_GUARD_STATE)
  assert.equal(first.accept, true)
  assert.equal(first.state.acceptedCount, 1)

  const duplicate = evaluateSample({ frameSeq: 10, deviceMs: 1000, ts: 2 }, first.state)
  assert.equal(duplicate.accept, false)
  assert.equal(duplicate.reason, 'duplicate-frame')
  assert.equal(duplicate.state.duplicateCount, 1)
  assert.equal(duplicate.state.lastFrameSeq, 10)

  const next = evaluateSample({ frameSeq: 11, deviceMs: 2000, ts: 3 }, duplicate.state)
  assert.equal(next.accept, true)
  assert.equal(next.state.acceptedCount, 2)
})

test('older frameSeq / deviceMs / timestamp values are stale', () => {
  const started = evaluateSample({ frameSeq: 5, deviceMs: 5000 }, EMPTY_GUARD_STATE)
  const staleFrame = evaluateSample({ frameSeq: 4, deviceMs: 6000 }, started.state)
  assert.equal(staleFrame.accept, false)
  assert.equal(staleFrame.reason, 'stale-frame')

  const deviceStart = evaluateSample({ deviceMs: 5000 }, EMPTY_GUARD_STATE)
  const duplicateDevice = evaluateSample({ deviceMs: 5000 }, deviceStart.state)
  assert.equal(duplicateDevice.reason, 'duplicate-device-ms')
  const staleDevice = evaluateSample({ deviceMs: 4000 }, duplicateDevice.state)
  assert.equal(staleDevice.reason, 'stale-device-ms')

  const timeStart = evaluateSample({ ts: 5000 }, EMPTY_GUARD_STATE)
  const duplicateTime = evaluateSample({ ts: 5000 }, timeStart.state)
  assert.equal(duplicateTime.reason, 'duplicate-timestamp')
  const staleTime = evaluateSample({ ts: 4000 }, duplicateTime.state)
  assert.equal(staleTime.reason, 'stale-timestamp')
})

test('evaluateSample is pure and does not mutate the supplied state', () => {
  const initial = Object.freeze({ ...EMPTY_GUARD_STATE })
  const first = evaluateSample({ frameSeq: 1, ts: 100 }, initial)
  const second = evaluateSample({ frameSeq: 1, ts: 100 }, initial)

  assert.deepEqual(initial, EMPTY_GUARD_STATE)
  assert.deepEqual(first, second)
  assert.equal(first.state.duplicateCount, 0)
})

test('optional maxAgeMs rejects expired wall-clock samples', () => {
  const result = evaluateSample(
    { frameSeq: 1, ts: 1000 },
    EMPTY_GUARD_STATE,
    { maxAgeMs: 5000 },
    7000
  )
  assert.equal(result.accept, false)
  assert.equal(result.reason, 'expired')
  assert.equal(result.state.staleCount, 1)

  const fresh = evaluateSample(
    { frameSeq: 2, ts: 6000 },
    EMPTY_GUARD_STATE,
    { maxAgeMs: 5000 },
    7000
  )
  assert.equal(fresh.accept, true)
})

test('createSampleGuard keeps state and resets across reconnects', () => {
  const guard = createSampleGuard()
  assert.deepEqual(guard.check({ frameSeq: 1, deviceMs: 100 }), { accept: true, reason: null })
  assert.deepEqual(guard.check({ frameSeq: 1, deviceMs: 100 }), {
    accept: false,
    reason: 'duplicate-frame'
  })
  assert.equal(guard.getState().acceptedCount, 1)
  assert.equal(guard.getState().duplicateCount, 1)

  guard.reset()
  assert.deepEqual(guard.check({ frameSeq: 1, deviceMs: 100 }), { accept: true, reason: null })
  assert.equal(guard.getState().acceptedCount, 1)
})

test('samples without ordering information are accepted without advancing state', () => {
  const result = evaluateSample({ temp1: 36.5 }, EMPTY_GUARD_STATE)
  assert.equal(result.accept, true)
  assert.deepEqual(result.state, EMPTY_GUARD_STATE)
})
