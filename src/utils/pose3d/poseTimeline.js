/**
 * Bounded, timestamp-aware buffer for live view and replay.
 *
 * The renderer itself is stateless with respect to time: the parent pushes a
 * PoseFrame. This helper is optional for replay pages that need to seek or
 * interpolate between stored samples.
 */

import { slerpQuaternions } from './quaternion.js'
import { createIdentityPoseFrame, normalizePoseFrame } from './poseFrame.js'

export class PoseTimeline {
  /**
   * @param {{capacity?:number, interpolate?:boolean}} [options]
   */
  constructor(options = {}) {
    this.capacity = Number.isFinite(options.capacity)
      ? Math.max(1, Math.floor(options.capacity))
      : 600
    this.interpolate = options.interpolate !== false
    this._frames = []
  }

  get size() {
    return this._frames.length
  }

  get duration() {
    if (this._frames.length < 2) return 0
    return this._frames[this._frames.length - 1].timestamp - this._frames[0].timestamp
  }

  /**
   * Insert or replace one frame. Returns false for frames without a usable
   * timestamp so replay pages do not silently insert frame 0.
   */
  push(frame, options = {}) {
    if (!frame || !Number.isFinite(Number(frame.timestamp))) {
      return false
    }
    const normalized = normalizePoseFrame(frame, {
      fallbackTimestamp: Number(frame.timestamp)
    })

    let index = this._lowerBound(normalized.timestamp)
    if (
      index < this._frames.length &&
      this._frames[index].timestamp === normalized.timestamp
    ) {
      this._frames[index] = normalized
    } else {
      this._frames.splice(index, 0, normalized)
    }

    if (this._frames.length > this.capacity) {
      this._frames.splice(0, this._frames.length - this.capacity)
    }
    return true
  }

  latest() {
    return this._frames.length ? this._frames[this._frames.length - 1] : null
  }

  latestValid() {
    for (let i = this._frames.length - 1; i >= 0; i--) {
      if (this._frames[i].valid) return this._frames[i]
    }
    return null
  }

  clear() {
    this._frames = []
  }

  /**
   * @param {number} timestamp
   * @returns {object|null} normalized PoseFrame
   */
  sampleAt(timestamp) {
    const t = Number(timestamp)
    if (!Number.isFinite(t) || this._frames.length === 0) return null

    const first = this._frames[0]
    const last = this._frames[this._frames.length - 1]
    if (t <= first.timestamp) return this._copyFrame(first, t)
    if (t >= last.timestamp) return this._copyFrame(last, t)

    const nextIndex = this._lowerBound(t)
    const before = this._frames[nextIndex - 1]
    const after = this._frames[nextIndex]

    if (before.timestamp === t) return this._copyFrame(before, t)
    if (after.timestamp === t) return this._copyFrame(after, t)

    if (this.interpolate && before.valid && after.valid) {
      const span = after.timestamp - before.timestamp
      const ratio = span > 0 ? (t - before.timestamp) / span : 0
      return {
        timestamp: t,
        rotations: {
          q0: slerpQuaternions(before.rotations.q0, after.rotations.q0, ratio) || before.rotations.q0,
          q1: slerpQuaternions(before.rotations.q1, after.rotations.q1, ratio) || before.rotations.q1,
          q2: slerpQuaternions(before.rotations.q2, after.rotations.q2, ratio) || before.rotations.q2
        },
        valid: true,
        issues: [{ code: 'interpolated', message: '时间轴插值帧', severity: 'info' }]
      }
    }

    const replacement = before.valid ? before : after.valid ? after : null
    if (replacement) {
      const copied = this._copyFrame(replacement, t)
      copied.issues = copied.issues.concat({
        code: 'held_neighbor_frame',
        message: '相邻帧无效，保持最近有效姿态',
        severity: 'warning'
      })
      return copied
    }

    return {
      ...createIdentityPoseFrame(t, false),
      issues: [{ code: 'no_valid_frame', message: '该时间点附近没有有效姿态', severity: 'error' }]
    }
  }

  _copyFrame(frame, timestamp) {
    return {
      ...frame,
      timestamp,
      rotations: {
        q0: { ...frame.rotations.q0 },
        q1: { ...frame.rotations.q1 },
        q2: { ...frame.rotations.q2 }
      },
      issues: frame.issues.map(item => ({ ...item }))
    }
  }

  _lowerBound(timestamp) {
    let low = 0
    let high = this._frames.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (this._frames[mid].timestamp < timestamp) low = mid + 1
      else high = mid
    }
    return low
  }
}

export default PoseTimeline
