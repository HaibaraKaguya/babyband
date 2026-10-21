/**
 * BabyBand data contracts (documentation-only module).
 *
 * This file intentionally contains no runtime code. It is the single source of
 * truth for the shapes exchanged between BLE/protocol, algorithms, storage and
 * the body renderer. Keep it in sync with the JSDoc typedefs below.
 *
 * IMPORTANT
 * - Parsed quaternions (`q0`, `q1`, `q2`) are plain objects `{ w, x, y, z }`.
 *   Do NOT change this public representation to arrays. Math code that needs
 *   arrays must convert explicitly with `quaternionToArray()` from
 *   `src/types/quaternion.mjs`.
 * - A `PoseFrame` is the only shape the renderer should consume. When
 *   `valid === false`, `rotations` contains identity placeholders and must not
 *   be trusted as sensor data.
 */

/**
 * A normalized quaternion in the public object representation.
 *
 * @typedef {Object} Quaternion
 * @property {number} w Scalar component.
 * @property {number} x X component.
 * @property {number} y Y component.
 * @property {number} z Z component.
 */

/**
 * One parsed sensor frame.
 *
 * The canonical protocol-facing names are `q0`/`q1`/`q2`, `tWaist`/`tThigh`/
 * `tAnkle`. The `temp1`/`temp2`/`temp3` properties are legacy aliases kept for
 * the existing pages and stored sessions; they mirror `tWaist`/`tThigh`/
 * `tAnkle` respectively.
 *
 * @typedef {Object} SensorSample
 * @property {number} ts Client receipt time in milliseconds since the Unix epoch.
 * @property {number} [deviceMs] Device uptime in milliseconds, from the frame.
 * @property {number} [frameSeq] Monotonic device frame sequence number.
 * @property {number} [sys] Raw system status bit field.
 * @property {boolean} [tempValid] Derived from `sys` bit 0 by the protocol parser.
 * @property {boolean} [attitudeValid] Derived from `sys` bit 1 by the protocol parser.
 * @property {Quaternion} [q0] Waist quaternion.
 * @property {Quaternion} [q1] Wrist quaternion.
 * @property {Quaternion} [q2] Ankle quaternion.
 * @property {number} [tWaist] Abdomen/waist temperature in degrees Celsius.
 * @property {number} [tThigh] Thigh temperature in degrees Celsius.
 * @property {number} [tAnkle] Ankle temperature in degrees Celsius.
 * @property {number} [temp1] Legacy alias of `tWaist`.
 * @property {number} [temp2] Legacy alias of `tThigh`.
 * @property {number} [temp3] Legacy alias of `tAnkle`.
 * @property {number|null} [battery] Battery percentage, or null when unknown.
 * @property {boolean} [crcOk] Result of the protocol CRC check.
 * @property {'modbus'|'ccitt_false'|'unknown'} [crcAlg] CRC algorithm that matched.
 * @property {string} [parseError] Present only on synthetic parse-failure samples.
 */

/**
 * Renderer-facing pose frame.
 *
 * `timestamp` is a number (milliseconds since the Unix epoch by convention).
 * All three rotations are always present. Missing or invalid source data is
 * replaced with identity quaternions and `valid` becomes false, so the
 * renderer can render a safe fallback without branching on undefined.
 *
 * @typedef {Object} PoseFrame
 * @property {number} timestamp
 * @property {{ q0: Quaternion, q1: Quaternion, q2: Quaternion }} rotations
 * @property {boolean} valid
 */

/**
 * One stored alarm/replay event.
 *
 * Existing page data uses `{ time, drop }`; new integrations may add more
 * fields without breaking replay (unknown fields are preserved).
 *
 * @typedef {Object} StoredEvent
 * @property {string} [time] Human-readable local time string.
 * @property {string|number} [drop] Temperature drop in degrees Celsius.
 * @property {number} [timestamp] Machine-readable event time (ms epoch).
 * @property {string} [type] Event type, e.g. `temperature_drop`.
 */

/**
 * A recorded sleep session.
 *
 * The top-level `startTs`, `endTs`, `samples` and `events` fields are
 * deliberately identical to the legacy `baby_band_last_session_v1` JSON shape,
 * so the history page can be switched to this object without a data migration.
 *
 * @typedef {Object} Session
 * @property {string} id Stable session identifier.
 * @property {number} startTs Session start time (ms epoch).
 * @property {number|null} endTs Session end time, or null while recording.
 * @property {number} [createdAt] Storage creation time (ms epoch).
 * @property {number} [updatedAt] Last append/finalize time (ms epoch).
 * @property {boolean} [finalized] True once recording has stopped.
 * @property {SensorSample[]} samples Samples in capture order.
 * @property {StoredEvent[]} events Events in capture order.
 * @property {Object} [meta] Caller-owned metadata (never interpreted by storage).
 */

/**
 * Lightweight session listing record.
 *
 * @typedef {Object} SessionSummary
 * @property {string} id
 * @property {number} startTs
 * @property {number|null} endTs
 * @property {number} sampleCount
 * @property {number} eventCount
 * @property {number} updatedAt
 * @property {boolean} finalized
 */

/**
 * Minimal synchronous key/value storage port.
 *
 * Adapters wrap a platform API. `get` returns `undefined`, `null` or `''` for
 * a missing key. `set` and `remove` may throw; the repository classifies quota
 * and other failures.
 *
 * @typedef {Object} KeyValueStorage
 * @property {(key: string) => (string|Object|undefined|null)} get
 * @property {(key: string, value: string) => void} set
 * @property {(key: string) => void} remove
 */

/**
 * Storage port required by the application layer.
 *
 * `ChunkedSessionRepository` implements this contract for local synchronous
 * storage. An App SQLite implementation must implement the same methods so
 * pages/services do not depend on a specific persistence backend.
 *
 * @typedef {Object} SessionStore
 * @property {(input: Object) => Session} createSession
 * @property {(id: string, sample: SensorSample) => Object} appendSample
 * @property {(id: string, event: StoredEvent) => Object} appendEvent
 * @property {(id: string, options?: Object) => Session} finalizeSession
 * @property {(id: string) => (Session|null)} loadSession
 * @property {() => SessionSummary[]} listSessions
 * @property {(legacy: (string|Object), options?: Object) => Object} migrateLegacySession
 */

/**
 * Asynchronous variant for the App SQLite adapter.
 *
 * `plus.sqlite` is callback-based, so the App implementation must not pretend
 * to be synchronous. Pages/services can `await` either an `AsyncSessionStore`
 * or a thin Promise wrapper around the local `SessionStore`.
 *
 * @typedef {Object} AsyncSessionStore
 * @property {(input: Object) => Promise<Session>} createSession
 * @property {(id: string, sample: SensorSample) => Promise<Object>} appendSample
 * @property {(id: string, samples: SensorSample[]) => Promise<Object>} appendSamples
 * @property {(id: string, event: StoredEvent) => Promise<Object>} appendEvent
 * @property {(id: string, options?: Object) => Promise<Object>} finalizeSession
 * @property {(id: string) => Promise<Session|null>} loadSession
 * @property {() => Promise<SessionSummary[]>} listSessions
 * @property {(legacy: (string|Object), options?: Object) => Promise<Object>} migrateLegacySession
 */

export {}
