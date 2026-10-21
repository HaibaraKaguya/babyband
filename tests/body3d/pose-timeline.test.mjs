import test from 'node:test'
import assert from 'node:assert/strict'

import { PoseTimeline } from '../../src/utils/pose3d/poseTimeline.js'
import { quaternionAngleDegrees, quaternionFromAxisAngle } from '../../src/utils/pose3d/quaternion.js'

const ID = { w: 1, x: 0, y: 0, z: 0 }
const qZ180 = quaternionFromAxisAngle([0, 0, 1], Math.PI)
const qZ90 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2)

function frame(timestamp, q0 = ID, valid = true) {
  return {
    timestamp,
    rotations: { q0: { ...q0 }, q1: { ...ID }, q2: { ...ID } },
    valid
  }
}

test('timeline rejects frames without numeric timestamp', () => {
  const timeline = new PoseTimeline()
  assert.equal(timeline.push(null), false)
  assert.equal(timeline.push({ timestamp: 'nope' }), false)
  assert.equal(timeline.push({ timestamp: 1 }), true)
  assert.equal(timeline.size, 1)
})

test('timeline replaces duplicate timestamps and keeps sorted order', () => {
  const timeline = new PoseTimeline()
  timeline.push(frame(300))
  timeline.push(frame(100))
  timeline.push(frame(200))
  timeline.push(frame(200, qZ180))
  assert.equal(timeline.size, 3)
  assert.ok(quaternionAngleDegrees(timeline.sampleAt(200).rotations.q0, qZ180) < 1e-6)
  assert.equal(timeline.latest().timestamp, 300)
})

test('timeline interpolates quaternions at a requested replay time', () => {
  const timeline = new PoseTimeline()
  timeline.push(frame(1000))
  timeline.push(frame(2000, qZ180))
  const sampled = timeline.sampleAt(1500)
  assert.equal(sampled.valid, true)
  assert.ok(Math.abs(quaternionAngleDegrees(sampled.rotations.q0, qZ90)) < 1e-5)
  assert.ok(sampled.issues.some(item => item.code === 'interpolated'))
  assert.equal(sampled.timestamp, 1500)
})

test('timeline clamps before first and after last frame', () => {
  const timeline = new PoseTimeline()
  timeline.push(frame(1000))
  timeline.push(frame(2000, qZ180))
  const before = timeline.sampleAt(0)
  assert.equal(before.timestamp, 0)
  assert.ok(quaternionAngleDegrees(before.rotations.q0, ID) < 1e-6)
  const after = timeline.sampleAt(9000)
  assert.equal(after.timestamp, 9000)
  assert.ok(quaternionAngleDegrees(after.rotations.q0, qZ180) < 1e-6)
})

test('invalid neighbor frames are skipped with a held-pose warning', () => {
  const timeline = new PoseTimeline()
  timeline.push(frame(1000, ID, true))
  timeline.push(frame(1500, ID, false))
  timeline.push(frame(2000, qZ180, true))
  const sampled = timeline.sampleAt(1700)
  assert.equal(sampled.valid, true)
  assert.ok(sampled.issues.some(item => item.code === 'held_neighbor_frame'))
  assert.ok(Math.abs(quaternionAngleDegrees(sampled.rotations.q0, qZ180)) < 1e-6)
})

test('all-invalid range returns identity invalid frame', () => {
  const timeline = new PoseTimeline()
  timeline.push(frame(1000, ID, false))
  timeline.push(frame(2000, ID, false))
  const sampled = timeline.sampleAt(1500)
  assert.equal(sampled.valid, false)
  assert.ok(sampled.issues.some(item => item.code === 'no_valid_frame'))
})

test('capacity drops oldest frames and clear resets state', () => {
  const timeline = new PoseTimeline({ capacity: 2 })
  timeline.push(frame(1))
  timeline.push(frame(2))
  timeline.push(frame(3, qZ180))
  assert.equal(timeline.size, 2)
  assert.ok(quaternionAngleDegrees(timeline.sampleAt(2).rotations.q0, ID) < 1e-6)
  assert.equal(timeline.duration, 1)
  timeline.clear()
  assert.equal(timeline.size, 0)
  assert.equal(timeline.latest(), null)
  assert.equal(timeline.sampleAt(1), null)
})
