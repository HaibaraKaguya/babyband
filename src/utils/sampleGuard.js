// utils/sampleGuard.js
//
// Pure duplicate/stale sample guard for parent integration.
//
// `evaluateSample(sample, state, options)` does not mutate state and has no
// clock access. `createSampleGuard()` wraps it with a small stateful counter
// for ingestion pipelines.

export const EMPTY_GUARD_STATE = Object.freeze({
  lastFrameSeq: null,
  lastDeviceMs: null,
  lastTs: null,
  acceptedCount: 0,
  duplicateCount: 0,
  staleCount: 0
})

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * @typedef {Object} GuardOptions
 * @property {number|null} [maxAgeMs] Reject samples whose `ts` is older than this
 *   when a `now` value is supplied. Disabled by default.
 */

/**
 * Evaluate one sample against a guard state.
 *
 * @param {Object} sample
 * @param {Object} [state]
 * @param {GuardOptions} [options]
 * @param {number} [now] Current wall-clock time in ms; only used for maxAgeMs.
 * @returns {{accept:boolean, reason:string|null, state:Object}}
 */
export function evaluateSample(sample, state = EMPTY_GUARD_STATE, options = {}, now = null) {
  const current = { ...EMPTY_GUARD_STATE, ...(state || {}) }

  if (!sample || typeof sample !== 'object') {
    return reject('invalid-sample', current, 'duplicate')
  }

  // Age check is opt-in because replay/history data may legitimately be old.
  if (
    isFiniteNumber(options.maxAgeMs) &&
    isFiniteNumber(now) &&
    isFiniteNumber(sample.ts) &&
    now - sample.ts > options.maxAgeMs
  ) {
    return reject('expired', current, 'stale')
  }

  // frameSeq is the strongest ordering key when present.
  if (isFiniteNumber(sample.frameSeq)) {
    if (current.lastFrameSeq != null) {
      if (sample.frameSeq === current.lastFrameSeq) {
        return reject('duplicate-frame', current, 'duplicate')
      }
      if (sample.frameSeq < current.lastFrameSeq) {
        return reject('stale-frame', current, 'stale')
      }
    }
    return accept(current, {
      lastFrameSeq: sample.frameSeq,
      lastDeviceMs: isFiniteNumber(sample.deviceMs) ? sample.deviceMs : current.lastDeviceMs,
      lastTs: isFiniteNumber(sample.ts) ? sample.ts : current.lastTs
    })
  }

  // Fall back to device uptime milliseconds.
  if (isFiniteNumber(sample.deviceMs)) {
    if (current.lastDeviceMs != null) {
      if (sample.deviceMs === current.lastDeviceMs) {
        return reject('duplicate-device-ms', current, 'duplicate')
      }
      if (sample.deviceMs < current.lastDeviceMs) {
        return reject('stale-device-ms', current, 'stale')
      }
    }
    return accept(current, {
      lastDeviceMs: sample.deviceMs,
      lastTs: isFiniteNumber(sample.ts) ? sample.ts : current.lastTs
    })
  }

  // Last resort: host timestamp.
  if (isFiniteNumber(sample.ts)) {
    if (current.lastTs != null) {
      if (sample.ts === current.lastTs) {
        return reject('duplicate-timestamp', current, 'duplicate')
      }
      if (sample.ts < current.lastTs) {
        return reject('stale-timestamp', current, 'stale')
      }
    }
    return accept(current, { lastTs: sample.ts })
  }

  // No ordering information: accept without advancing the guard.
  return { accept: true, reason: null, state: { ...current } }
}

function accept(state, patch) {
  return {
    accept: true,
    reason: null,
    state: {
      ...state,
      ...patch,
      acceptedCount: state.acceptedCount + 1
    }
  }
}

function reject(reason, state, kind) {
  return {
    accept: false,
    reason,
    state: {
      ...state,
      duplicateCount: state.duplicateCount + (kind === 'duplicate' ? 1 : 0),
      staleCount: state.staleCount + (kind === 'stale' ? 1 : 0)
    }
  }
}

/**
 * Stateful wrapper for real ingestion. Reset after a reconnect or device reboot,
 * because both frameSeq and deviceMs restart from zero.
 */
export function createSampleGuard(options = {}) {
  let state = { ...EMPTY_GUARD_STATE }

  return {
    check(sample, now = Date.now()) {
      const result = evaluateSample(sample, state, options, now)
      state = result.state
      return { accept: result.accept, reason: result.reason }
    },
    reset() {
      state = { ...EMPTY_GUARD_STATE }
    },
    getState() {
      return { ...state }
    }
  }
}
