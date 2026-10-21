import test from 'node:test'
import assert from 'node:assert/strict'

import { createPose3DRuntime } from '../../src/utils/pose3d/pose3dRuntime.js'
import { createIdentityPoseFrame } from '../../src/utils/pose3d/poseFrame.js'
import { quaternionAngleDegrees, quaternionFromAxisAngle } from '../../src/utils/pose3d/quaternion.js'
import { DIAGNOSTIC_CODES } from '../../src/utils/pose3d/diagnostics.js'
import {
  createFakeCanvas,
  createFakeThree,
  Quaternion
} from './helpers/fakeThree.mjs'

const ID = { w: 1, x: 0, y: 0, z: 0 }
const qZ90 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2)

function makeRuntime(overrides = {}) {
  const diagnostics = []
  const canvas = createFakeCanvas()
  const runtime = createPose3DRuntime(createFakeThree(), canvas, {
    width: 320,
    height: 300,
    pixelRatio: 2,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    ...overrides
  })
  return { runtime, canvas, diagnostics }
}

test('runtime builds a scene, renders once, and reports no false dispose', () => {
  const { runtime } = makeRuntime()
  assert.equal(runtime.renderer.renderCalls, 1)
  assert.equal(runtime.rig.root.name, 'babyband_infant_root')
  assert.ok(runtime.rig.meshes.length > 10)
  assert.ok(runtime.rig.joints.waist)
  assert.ok(runtime.rig.joints.rightArm)
  assert.ok(runtime.rig.joints.rightLeg)
  const state = runtime.getState()
  assert.equal(state.disposed, false)
  assert.equal(state.hasValidPose, false)
  assert.equal(state.width, 320)
  assert.equal(state.height, 300)
  assert.equal(runtime.rig.disposed, false)
})

test('valid update is applied, timestamp recorded, and scene rendered', () => {
  const { runtime, diagnostics } = makeRuntime()
  const frame = createIdentityPoseFrame(1000, true)
  assert.equal(runtime.update(frame), true)
  const state = runtime.getState()
  assert.equal(state.hasValidPose, true)
  assert.equal(state.lastValidTimestamp, 1000)
  assert.equal(state.framesApplied, 1)
  assert.equal(state.invalidFrames, 0)
  assert.equal(diagnostics.length, 0)
})

test('invalid update does not throw, holds last valid time, and emits one diagnostic', () => {
  const { runtime, diagnostics } = makeRuntime()
  runtime.update(createIdentityPoseFrame(1000, true))
  const invalid = {
    timestamp: 2000,
    rotations: {
      q0: { w: NaN, x: 0, y: 0, z: 0 },
      q1: { w: 1, x: 0, y: 0, z: 0 },
      q2: { w: 1, x: 0, y: 0, z: 0 }
    },
    valid: true
  }
  assert.doesNotThrow(() => runtime.update(invalid))
  assert.equal(runtime.update(invalid), false)
  const state = runtime.getState()
  assert.equal(state.lastValidTimestamp, 1000)
  assert.equal(state.invalidFrames, 2)
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].code, DIAGNOSTIC_CODES.INVALID_POSE)
})

test('invalid input before first valid frame renders a neutral rest pose', () => {
  const { runtime } = makeRuntime()
  assert.equal(runtime.update(null), false)
  assert.equal(runtime.getState().hasValidPose, false)
  assert.ok(runtime.renderer.renderCalls >= 2)
})

test('rotation update moves the driven arm relative to its rest pose', () => {
  const { runtime } = makeRuntime()
  const rest = runtime.rig.rest.rightArm.clone()
  runtime.update({
    timestamp: 1,
    rotations: { q0: ID, q1: qZ90, q2: ID },
    valid: true
  })
  const angle = rest.angleTo(runtime.rig.joints.rightArm.quaternion)
  assert.ok(Math.abs(angle * 180 / Math.PI - 90) < 1e-5)

  const waistAngle = new Quaternion().angleTo(runtime.rig.joints.waist.quaternion)
  assert.ok(waistAngle < 1e-9)
})

test('resize updates camera and renderer; invalid size reports a diagnostic', () => {
  const { runtime, diagnostics } = makeRuntime()
  const before = runtime.camera.projectionUpdates
  assert.equal(runtime.resize(400, 200, true), true)
  assert.equal(runtime.getState().width, 400)
  assert.equal(runtime.getState().height, 200)
  assert.equal(runtime.camera.aspect, 2)
  assert.ok(runtime.camera.projectionUpdates > before)
  assert.equal(runtime.resize(0, 0), false)
  assert.equal(diagnostics[0].code, DIAGNOSTIC_CODES.RESIZE_FAILED)
})

test('dispose is idempotent and frees geometry/material/renderer resources', () => {
  const { runtime, canvas } = makeRuntime()
  runtime.update(createIdentityPoseFrame(1, true))
  const result = runtime.dispose()
  assert.equal(result.alreadyDisposed, false)
  assert.ok(result.geometries > 0)
  assert.ok(result.materials > 0)
  assert.equal(runtime.rig.disposed, true)
  assert.equal(runtime.rig.root, null)
  assert.equal(runtime.renderer.disposed, true)
  assert.equal(runtime.renderer.contextLossForced, true)
  assert.equal(canvas.listeners.has('webglcontextlost'), false)

  const second = runtime.dispose()
  assert.equal(second.alreadyDisposed, true)
  assert.equal(second.geometries, 0)
})

test('update after dispose returns false and reports DISPOSED', () => {
  const { runtime, diagnostics } = makeRuntime()
  runtime.dispose()
  assert.equal(runtime.update(createIdentityPoseFrame(1, true)), false)
  assert.ok(diagnostics.some(item => item.code === DIAGNOSTIC_CODES.DISPOSED))
})

test('context loss is surfaced as a diagnostic and listener prevents default', () => {
  const { runtime, canvas, diagnostics } = makeRuntime()
  let prevented = false
  canvas.emit('webglcontextlost', {
    preventDefault() {
      prevented = true
    }
  })
  assert.equal(prevented, true)
  assert.ok(diagnostics.some(item => item.code === DIAGNOSTIC_CODES.CONTEXT_LOST))
  runtime.dispose()
})

test('missing THREE, missing canvas, and renderer failure throw explicit errors', () => {
  assert.throws(() => createPose3DRuntime(null, createFakeCanvas()), /THREE namespace/)
  assert.throws(
    () => createPose3DRuntime(createFakeThree(), null),
    /requires a canvas/
  )
  const canvas = createFakeCanvas()
  canvas.__failRenderer = true
  assert.throws(
    () => createPose3DRuntime(createFakeThree(), canvas, {}),
    /RENDERER_CREATE_FAILED/
  )
})

test('preflight rejects a canvas without WebGL', () => {
  const canvas = createFakeCanvas()
  canvas.getContext = () => null
  const THREEFake = createFakeThree()
  assert.throws(
    () => createPose3DRuntime(THREEFake, canvas, { preflightWebGL: true }),
    /WEBGL_UNAVAILABLE/
  )
})
