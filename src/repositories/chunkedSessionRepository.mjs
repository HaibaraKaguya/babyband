/**
 * Chunked, quota-aware local session repository.
 *
 * Layout (all values are JSON strings):
 *   <prefix>:index
 *     { version: 2, updatedAt, sessionIds: string[] }
 *   <prefix>:session:<id>:meta
 *     { version, id, startTs, endTs, createdAt, updatedAt, finalized,
 *       sampleCount, eventCount, sampleChunks, eventChunks,
 *       sampleChunkSizes: number[], eventChunkSizes: number[], meta }
 *   <prefix>:session:<id>:samples:<n>
 *   <prefix>:session:<id>:events:<n>
 *     JSON arrays with at most `maxChunkChars` characters per key.
 *
 * Safety properties:
 * - Chunks are written before metadata; the index is written last on create.
 * - Metadata is authoritative for counts. If a tail chunk write succeeds but a
 *   later metadata write fails, the extra records are ignored on reload and
 *   truncated before the next append. Previously stored samples are preserved.
 * - Every write can be read back and verified. Quota and write failures are
 *   surfaced as typed errors instead of silently losing data.
 * - Legacy `baby_band_last_session_v1` JSON is never modified by migration.
 */

import { assertKeyValueStorage } from './keyValueStorage.mjs'
import {
  StorageCorruptionError,
  StorageError,
  StorageQuotaError,
  StorageValidationError,
  StorageWriteError,
  isQuotaError
} from './storageErrors.mjs'
import { isFiniteNumber, isPlainObject } from '../types/quaternion.mjs'

export const SESSION_SCHEMA_VERSION = 2
export const DEFAULT_PREFIX = 'babyband.session.v2'
export const DEFAULT_LEGACY_SESSION_KEY = 'baby_band_last_session_v1'
export const DEFAULT_MAX_CHUNK_CHARS = 128 * 1024

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PREFIX_RE = /^[A-Za-z0-9._-]+$/

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function absent(value) {
  return value === undefined || value === null || value === ''
}

function assertSessionId(id) {
  if (!isNonEmptyString(id) || !SESSION_ID_RE.test(id)) {
    throw new StorageValidationError(
      'session id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}',
      { field: 'id' }
    )
  }
}

function assertArray(value, field) {
  if (!Array.isArray(value)) {
    throw new StorageValidationError(`${field} must be an array`, { field })
  }
}

/**
 * Split records into JSON-array chunks whose serialized form does not exceed
 * `maxChars` (except when a single record alone is larger).
 *
 * @param {unknown[]} records
 * @param {number} maxChars
 * @returns {Array<{ json: string, count: number }>}
 */
export function splitRecordsIntoChunks(records, maxChars = DEFAULT_MAX_CHUNK_CHARS) {
  assertArray(records, 'records')
  if (!Number.isInteger(maxChars) || maxChars < 32) {
    throw new StorageValidationError('maxChars must be an integer >= 32', { field: 'maxChars' })
  }

  /** @type {Array<{ json: string, count: number }>} */
  const chunks = []
  let current = []
  let currentChars = 2 // []

  const flush = () => {
    if (current.length === 0) return
    let json
    try {
      json = JSON.stringify(current)
    } catch (error) {
      throw new StorageValidationError('records are not JSON-serializable', { cause: error })
    }
    chunks.push({ json, count: current.length })
    current = []
    currentChars = 2
  }

  for (const record of records) {
    let recordJson
    try {
      recordJson = JSON.stringify(record)
    } catch (error) {
      throw new StorageValidationError('record is not JSON-serializable', { cause: error })
    }
    if (recordJson === undefined) {
      throw new StorageValidationError('record is not JSON-serializable (undefined)')
    }

    const addedChars = recordJson.length + (current.length > 0 ? 1 : 0)
    if (current.length > 0 && currentChars + addedChars > maxChars) {
      flush()
    }

    current.push(record)
    currentChars += recordJson.length + (current.length > 1 ? 1 : 0)

    // A single oversized record is kept as its own chunk; splitting a record
    // would corrupt the stored value.
    if (currentChars > maxChars) {
      flush()
    }
  }

  flush()
  return chunks
}

/**
 * Chunked local repository implementing the `SessionStore` contract.
 */
export class ChunkedSessionRepository {
  /**
   * @param {{
   *   storage: import('../types/dataContracts.js').KeyValueStorage,
   *   prefix?: string,
   *   maxChunkChars?: number,
   *   now?: () => number,
   *   legacySessionKey?: string,
   *   verifyWrites?: boolean
   * }} options
   */
  constructor(options = {}) {
    const {
      storage,
      prefix = DEFAULT_PREFIX,
      maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
      now = Date.now,
      legacySessionKey = DEFAULT_LEGACY_SESSION_KEY,
      verifyWrites = true
    } = options

    this.storage = assertKeyValueStorage(storage)
    if (!isNonEmptyString(prefix) || !PREFIX_RE.test(prefix)) {
      throw new TypeError('prefix must match [A-Za-z0-9._-]+')
    }
    if (!Number.isInteger(maxChunkChars) || maxChunkChars < 32) {
      throw new TypeError('maxChunkChars must be an integer >= 32')
    }
    if (typeof now !== 'function') {
      throw new TypeError('now must be a function returning milliseconds')
    }

    this.prefix = prefix
    this.maxChunkChars = maxChunkChars
    this.now = now
    this.legacySessionKey = legacySessionKey
    this.verifyWrites = verifyWrites !== false
  }

  _now() {
    const value = this.now()
    return isFiniteNumber(value) ? value : Date.now()
  }

  _indexKey() {
    return `${this.prefix}:index`
  }

  _metaKey(id) {
    return `${this.prefix}:session:${id}:meta`
  }

  _chunkKey(id, kind, index) {
    return `${this.prefix}:session:${id}:${kind}:${index}`
  }

  _read(key) {
    try {
      return this.storage.get(key)
    } catch (error) {
      throw new StorageError(`failed to read storage key "${key}"`, {
        code: 'READ_FAILED',
        key,
        cause: error
      })
    }
  }

  _readJson(key) {
    const value = this._read(key)
    if (absent(value)) return null

    if (isPlainObject(value) || Array.isArray(value)) {
      return value
    }

    if (typeof value !== 'string') {
      throw new StorageCorruptionError(`storage key "${key}" is not a JSON string`, { key })
    }

    try {
      return JSON.parse(value.replace(/^\uFEFF/, ''))
    } catch (error) {
      throw new StorageCorruptionError(`storage key "${key}" contains invalid JSON`, {
        key,
        cause: error
      })
    }
  }

  _write(key, value) {
    if (typeof value !== 'string') {
      throw new TypeError('storage values must be strings')
    }

    try {
      this.storage.set(key, value)
    } catch (error) {
      const message = `failed to write storage key "${key}"`
      if (isQuotaError(error)) {
        throw new StorageQuotaError(message, { key, cause: error })
      }
      throw new StorageWriteError(message, {
        code: 'WRITE_FAILED',
        key,
        cause: error
      })
    }

    if (this.verifyWrites) {
      let stored
      try {
        stored = this.storage.get(key)
      } catch (error) {
        throw new StorageWriteError(`failed to verify storage key "${key}"`, {
          code: 'VERIFY_FAILED',
          key,
          cause: error
        })
      }
      if (stored !== value) {
        throw new StorageWriteError(`storage key "${key}" failed read-back verification`, {
          code: 'VERIFY_FAILED',
          key
        })
      }
    }
  }

  _removeQuiet(keys) {
    for (const key of keys) {
      try {
        this.storage.remove(key)
      } catch {
        // Cleanup is best-effort; the original error is more actionable.
      }
    }
  }

  _readIndex() {
    const value = this._readJson(this._indexKey())
    if (value === null) {
      return { version: SESSION_SCHEMA_VERSION, updatedAt: 0, sessionIds: [] }
    }
    if (!isPlainObject(value) || !Array.isArray(value.sessionIds)) {
      throw new StorageCorruptionError('session index is malformed', { key: this._indexKey() })
    }
    for (const id of value.sessionIds) {
      assertSessionId(id)
    }
    return {
      version: SESSION_SCHEMA_VERSION,
      updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : 0,
      sessionIds: [...value.sessionIds]
    }
  }

  _writeIndex(index) {
    const payload = {
      version: SESSION_SCHEMA_VERSION,
      updatedAt: this._now(),
      sessionIds: [...index.sessionIds]
    }
    this._write(this._indexKey(), JSON.stringify(payload))
  }

  _readMeta(id) {
    assertSessionId(id)
    const value = this._readJson(this._metaKey(id))
    if (value === null) return null

    if (!isPlainObject(value)) {
      throw new StorageCorruptionError('session metadata is not an object', {
        key: this._metaKey(id)
      })
    }
    if (value.id !== undefined && value.id !== id) {
      throw new StorageCorruptionError('session metadata id does not match its key', {
        key: this._metaKey(id)
      })
    }

    for (const field of ['sampleCount', 'eventCount', 'sampleChunks', 'eventChunks']) {
      if (!Number.isInteger(value[field]) || value[field] < 0) {
        throw new StorageCorruptionError(`session metadata field "${field}" is invalid`, {
          key: this._metaKey(id)
        })
      }
    }
    for (const field of ['sampleChunkSizes', 'eventChunkSizes']) {
      if (!Array.isArray(value[field]) || value[field].some((n) => !Number.isInteger(n) || n < 0)) {
        throw new StorageCorruptionError(`session metadata field "${field}" is invalid`, {
          key: this._metaKey(id)
        })
      }
    }
    if (value.sampleChunkSizes.length !== value.sampleChunks) {
      throw new StorageCorruptionError('sampleChunkSizes does not match sampleChunks', {
        key: this._metaKey(id)
      })
    }
    if (value.eventChunkSizes.length !== value.eventChunks) {
      throw new StorageCorruptionError('eventChunkSizes does not match eventChunks', {
        key: this._metaKey(id)
      })
    }
    if (value.sampleChunkSizes.reduce((a, b) => a + b, 0) !== value.sampleCount) {
      throw new StorageCorruptionError('sampleChunkSizes does not sum to sampleCount', {
        key: this._metaKey(id)
      })
    }
    if (value.eventChunkSizes.reduce((a, b) => a + b, 0) !== value.eventCount) {
      throw new StorageCorruptionError('eventChunkSizes does not sum to eventCount', {
        key: this._metaKey(id)
      })
    }

    return {
      version: SESSION_SCHEMA_VERSION,
      id,
      startTs: isFiniteNumber(value.startTs) ? value.startTs : 0,
      endTs: isFiniteNumber(value.endTs) ? value.endTs : null,
      createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : 0,
      updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : 0,
      finalized: value.finalized === true,
      sampleCount: value.sampleCount,
      eventCount: value.eventCount,
      sampleChunks: value.sampleChunks,
      eventChunks: value.eventChunks,
      sampleChunkSizes: [...value.sampleChunkSizes],
      eventChunkSizes: [...value.eventChunkSizes],
      meta: isPlainObject(value.meta) ? value.meta : {}
    }
  }

  _writeMeta(meta) {
    this._write(this._metaKey(meta.id), JSON.stringify(meta))
  }

  _summary(meta) {
    return {
      id: meta.id,
      startTs: meta.startTs,
      endTs: meta.endTs,
      sampleCount: meta.sampleCount,
      eventCount: meta.eventCount,
      updatedAt: meta.updatedAt,
      finalized: meta.finalized
    }
  }

  /**
   * @param {{
   *   id?: string,
   *   startTs?: number,
   *   endTs?: number|null,
   *   samples?: unknown[],
   *   events?: unknown[],
   *   finalized?: boolean,
   *   meta?: Object
   * }} input
   * @returns {import('../types/dataContracts.js').Session}
   */
  createSession(input = {}) {
    if (!isPlainObject(input)) {
      throw new StorageValidationError('createSession input must be an object')
    }

    const id = input.id === undefined ? this._generateId() : input.id
    assertSessionId(id)

    const now = this._now()
    const startTs = input.startTs === undefined
      ? now
      : isFiniteNumber(input.startTs)
        ? input.startTs
        : null
    if (startTs === null) {
      throw new StorageValidationError('startTs must be a finite number', { field: 'startTs' })
    }

    const endTs = input.endTs === undefined || input.endTs === null
      ? null
      : isFiniteNumber(input.endTs)
        ? input.endTs
        : undefined
    if (endTs === undefined) {
      throw new StorageValidationError('endTs must be a finite number or null', { field: 'endTs' })
    }

    const samples = input.samples === undefined ? [] : input.samples
    const events = input.events === undefined ? [] : input.events
    assertArray(samples, 'samples')
    assertArray(events, 'events')
    if (input.meta !== undefined && !isPlainObject(input.meta)) {
      throw new StorageValidationError('meta must be a plain object', { field: 'meta' })
    }

    if (this._readMeta(id) !== null) {
      throw new StorageValidationError(`session "${id}" already exists`, {
        code: 'SESSION_EXISTS',
        field: 'id'
      })
    }

    const index = this._readIndex()
    if (index.sessionIds.includes(id)) {
      throw new StorageValidationError(`session "${id}" already exists in the index`, {
        code: 'SESSION_EXISTS',
        field: 'id'
      })
    }

    const sampleChunks = splitRecordsIntoChunks(samples, this.maxChunkChars)
    const eventChunks = splitRecordsIntoChunks(events, this.maxChunkChars)

    const meta = {
      version: SESSION_SCHEMA_VERSION,
      id,
      startTs,
      endTs,
      createdAt: now,
      updatedAt: now,
      finalized: input.finalized === true || endTs !== null,
      sampleCount: samples.length,
      eventCount: events.length,
      sampleChunks: sampleChunks.length,
      eventChunks: eventChunks.length,
      sampleChunkSizes: sampleChunks.map((chunk) => chunk.count),
      eventChunkSizes: eventChunks.map((chunk) => chunk.count),
      meta: input.meta || {}
    }

    const writtenKeys = []
    try {
      sampleChunks.forEach((chunk, i) => {
        const key = this._chunkKey(id, 'samples', i)
        writtenKeys.push(key)
        this._write(key, chunk.json)
      })
      eventChunks.forEach((chunk, i) => {
        const key = this._chunkKey(id, 'events', i)
        writtenKeys.push(key)
        this._write(key, chunk.json)
      })

      this._writeMeta(meta)
      writtenKeys.push(this._metaKey(id))

      index.sessionIds.push(id)
      this._writeIndex(index)

      return this._sessionFromMeta(meta, samples, events)
    } catch (error) {
      this._removeQuiet(writtenKeys)
      // The index write may have partially succeeded before verification
      // failed; remove the id if it landed.
      try {
        const current = this._readIndex()
        if (current.sessionIds.includes(id)) {
          current.sessionIds = current.sessionIds.filter((value) => value !== id)
          this._writeIndex(current)
        }
      } catch {
        // Best-effort rollback.
      }
      throw error
    }
  }

  _sessionFromMeta(meta, samples, events) {
    return {
      id: meta.id,
      startTs: meta.startTs,
      endTs: meta.endTs,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      finalized: meta.finalized,
      samples,
      events,
      meta: meta.meta
    }
  }

  _generateId() {
    const random = Math.random().toString(36).slice(2, 10)
    return `s-${Math.trunc(this._now())}-${random}`
  }

  /**
   * Append one sample. Convenience wrapper around `appendSamples()`.
   *
   * @param {string} id
   * @param {unknown} sample
   * @returns {import('../types/dataContracts.js').SessionSummary}
   */
  appendSample(id, sample) {
    return this.appendSamples(id, [sample])
  }

  /**
   * Append samples to a session, writing only the tail chunk and metadata.
   *
   * @param {string} id
   * @param {unknown[]} samples
   * @returns {import('../types/dataContracts.js').SessionSummary}
   */
  appendSamples(id, samples) {
    assertArray(samples, 'samples')
    return this._appendRecords(id, 'samples', samples)
  }

  /**
   * Append one stored event.
   *
   * @param {string} id
   * @param {unknown} event
   * @returns {import('../types/dataContracts.js').SessionSummary}
   */
  appendEvent(id, event) {
    return this.appendEvents(id, [event])
  }

  /**
   * @param {string} id
   * @param {unknown[]} events
   * @returns {import('../types/dataContracts.js').SessionSummary}
   */
  appendEvents(id, events) {
    assertArray(events, 'events')
    return this._appendRecords(id, 'events', events)
  }

  _appendRecords(id, kind, records) {
    assertSessionId(id)
    const meta = this._readMeta(id)
    if (meta === null) {
      throw new StorageValidationError(`session "${id}" does not exist`, {
        code: 'SESSION_NOT_FOUND',
        field: 'id'
      })
    }
    if (meta.finalized) {
      throw new StorageValidationError(`session "${id}" is finalized`, {
        code: 'SESSION_FINALIZED',
        field: 'id'
      })
    }
    if (records.length === 0) {
      return this._summary(meta)
    }

    const chunkCount = kind === 'samples' ? meta.sampleChunks : meta.eventChunks
    const chunkSizes = kind === 'samples' ? [...meta.sampleChunkSizes] : [...meta.eventChunkSizes]
    const totalCount = kind === 'samples' ? meta.sampleCount : meta.eventCount

    let combined = records
    if (chunkCount > 0) {
      const lastIndex = chunkCount - 1
      const lastKey = this._chunkKey(id, kind, lastIndex)
      const lastChunk = this._readJson(lastKey)
      if (!Array.isArray(lastChunk)) {
        throw new StorageCorruptionError(`chunk "${lastKey}" is missing or not an array`, {
          key: lastKey
        })
      }
      const expectedTailCount = chunkSizes[lastIndex]
      if (lastChunk.length < expectedTailCount) {
        throw new StorageCorruptionError(
          `chunk "${lastKey}" has ${lastChunk.length} records, expected at least ${expectedTailCount}`,
          { key: lastKey }
        )
      }
      // Ignore stale records from a previous append whose metadata write failed.
      combined = [...lastChunk.slice(0, expectedTailCount), ...records]
    }

    const chunks = splitRecordsIntoChunks(combined, this.maxChunkChars)
    const firstIndex = chunkCount > 0 ? chunkCount - 1 : 0
    const newKeys = []

    try {
      chunks.forEach((chunk, i) => {
        const key = this._chunkKey(id, kind, firstIndex + i)
        if (chunkCount === 0 || firstIndex + i >= chunkCount) {
          newKeys.push(key)
        }
        this._write(key, chunk.json)
      })

      const nextSizes = chunkCount > 0
        ? [...chunkSizes.slice(0, chunkCount - 1), ...chunks.map((chunk) => chunk.count)]
        : chunks.map((chunk) => chunk.count)
      const nextChunkCount = chunkCount > 0 ? chunkCount - 1 + chunks.length : chunks.length

      const nextMeta = {
        ...meta,
        updatedAt: this._now(),
        sampleCount: kind === 'samples' ? totalCount + records.length : meta.sampleCount,
        eventCount: kind === 'events' ? totalCount + records.length : meta.eventCount,
        sampleChunks: kind === 'samples' ? nextChunkCount : meta.sampleChunks,
        eventChunks: kind === 'events' ? nextChunkCount : meta.eventChunks,
        sampleChunkSizes: kind === 'samples' ? nextSizes : meta.sampleChunkSizes,
        eventChunkSizes: kind === 'events' ? nextSizes : meta.eventChunkSizes
      }

      this._writeMeta(nextMeta)
      return this._summary(nextMeta)
    } catch (error) {
      // New chunks beyond the old tail are never referenced by the unchanged
      // metadata; remove them. A rewritten tail may contain extra records, but
      // they are truncated using the old chunk size on the next load/append.
      this._removeQuiet(newKeys)
      throw error
    }
  }

  /**
   * Stop a recording session. Appending after finalization is rejected.
   *
   * @param {string} id
   * @param {{ endTs?: number, meta?: Object }} [options]
   * @returns {import('../types/dataContracts.js').SessionSummary}
   */
  finalizeSession(id, options = {}) {
    options = options || {}
    assertSessionId(id)
    const meta = this._readMeta(id)
    if (meta === null) {
      throw new StorageValidationError(`session "${id}" does not exist`, {
        code: 'SESSION_NOT_FOUND',
        field: 'id'
      })
    }
    if (options.meta !== undefined && !isPlainObject(options.meta)) {
      throw new StorageValidationError('meta must be a plain object', { field: 'meta' })
    }

    const endTs = options.endTs === undefined
      ? this._now()
      : isFiniteNumber(options.endTs)
        ? options.endTs
        : null
    if (endTs === null) {
      throw new StorageValidationError('endTs must be a finite number', { field: 'endTs' })
    }

    const nextMeta = {
      ...meta,
      endTs,
      finalized: true,
      updatedAt: this._now(),
      meta: options.meta === undefined ? meta.meta : { ...meta.meta, ...options.meta }
    }
    this._writeMeta(nextMeta)
    return this._summary(nextMeta)
  }

  _loadChunkRecords(id, kind, chunkCount, chunkSizes, totalCount) {
    const records = []
    for (let i = 0; i < chunkCount; i += 1) {
      const key = this._chunkKey(id, kind, i)
      const chunk = this._readJson(key)
      if (!Array.isArray(chunk)) {
        throw new StorageCorruptionError(`chunk "${key}" is missing or not an array`, { key })
      }
      const expected = chunkSizes[i]
      if (chunk.length < expected) {
        throw new StorageCorruptionError(
          `chunk "${key}" has ${chunk.length} records, expected at least ${expected}`,
          { key }
        )
      }
      records.push(...chunk.slice(0, expected))
    }
    if (records.length !== totalCount) {
      throw new StorageCorruptionError(
        `session "${id}" ${kind} count mismatch: ${records.length} != ${totalCount}`,
        { key: this._metaKey(id) }
      )
    }
    return records
  }

  /**
   * Load a complete session. Returns null when the id is unknown.
   *
   * @param {string} id
   * @returns {import('../types/dataContracts.js').Session|null}
   */
  loadSession(id) {
    const meta = this._readMeta(id)
    if (meta === null) return null

    const samples = this._loadChunkRecords(
      id,
      'samples',
      meta.sampleChunks,
      meta.sampleChunkSizes,
      meta.sampleCount
    )
    const events = this._loadChunkRecords(
      id,
      'events',
      meta.eventChunks,
      meta.eventChunkSizes,
      meta.eventCount
    )

    return this._sessionFromMeta(meta, samples, events)
  }

  /**
   * Non-throwing load wrapper for replay pages.
   *
   * @param {string} id
   * @returns {{ ok: true, session: import('../types/dataContracts.js').Session|null }
   *   | { ok: false, error: StorageError }}
   */
  tryLoadSession(id) {
    try {
      return { ok: true, session: this.loadSession(id) }
    } catch (error) {
      if (error instanceof StorageError) {
        return { ok: false, error }
      }
      throw error
    }
  }

  /**
   * List sessions newest-first. Counts come from per-session metadata, so the
   * index does not need rewriting on every append.
   *
   * @returns {import('../types/dataContracts.js').SessionSummary[]}
   */
  listSessions() {
    const index = this._readIndex()
    const summaries = []
    for (const id of index.sessionIds) {
      const meta = this._readMeta(id)
      if (meta === null) {
        throw new StorageCorruptionError(`session index references missing session "${id}"`, {
          key: this._indexKey()
        })
      }
      summaries.push(this._summary(meta))
    }
    summaries.sort((a, b) => b.startTs - a.startTs || a.id.localeCompare(b.id))
    return summaries
  }

  /**
   * Migrate one legacy session object (or its raw JSON string) into the chunked
   * store. The legacy storage key/value is never modified or removed.
   *
   * @param {string|Object} legacy
   * @param {{ id?: string }} [options]
   * @returns {{ ok: boolean, migrated: boolean, id: string|null, reason?: string, session?: import('../types/dataContracts.js').SessionSummary, error?: unknown }}
   */
  migrateLegacySession(legacy, options = {}) {
    options = options || {}
    let parsed = legacy
    if (typeof legacy === 'string') {
      try {
        parsed = JSON.parse(legacy.replace(/^\uFEFF/, ''))
      } catch (error) {
        return {
          ok: false,
          migrated: false,
          id: null,
          reason: 'INVALID_LEGACY_JSON',
          error
        }
      }
    }

    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        migrated: false,
        id: null,
        reason: 'INVALID_LEGACY_SESSION'
      }
    }
    if (parsed.samples !== undefined && !Array.isArray(parsed.samples)) {
      return {
        ok: false,
        migrated: false,
        id: null,
        reason: 'INVALID_LEGACY_SAMPLES'
      }
    }
    if (parsed.events !== undefined && !Array.isArray(parsed.events)) {
      return {
        ok: false,
        migrated: false,
        id: null,
        reason: 'INVALID_LEGACY_EVENTS'
      }
    }

    const startTs = isFiniteNumber(parsed.startTs)
      ? parsed.startTs
      : isFiniteNumber(parsed.samples?.[0]?.ts)
        ? parsed.samples[0].ts
        : 0
    const endTs = isFiniteNumber(parsed.endTs) ? parsed.endTs : null
    const id = options.id === undefined
      ? `legacy-${Math.trunc(startTs)}`
      : options.id

    assertSessionId(id)

    const existing = this._readMeta(id)
    if (existing !== null) {
      return {
        ok: true,
        migrated: false,
        id,
        reason: 'ALREADY_EXISTS',
        session: this._summary(existing)
      }
    }

    const session = this.createSession({
      id,
      startTs,
      endTs,
      samples: parsed.samples || [],
      events: parsed.events || [],
      finalized: true,
      meta: { migratedFrom: 'baby_band_last_session_v1' }
    })

    return {
      ok: true,
      migrated: true,
      id,
      session: this._summary({
        ...session,
        sampleCount: session.samples.length,
        eventCount: session.events.length
      })
    }
  }

  /**
   * Read and migrate the legacy page session key.
   *
   * @param {{ key?: string, id?: string }} [options]
   * @returns {ReturnType<ChunkedSessionRepository['migrateLegacySession']> & { legacyKey?: string }}
   */
  migrateLegacyFromStorage(options = {}) {
    options = options || {}
    const key = options.key || this.legacySessionKey
    const raw = this._read(key)
    if (absent(raw)) {
      return {
        ok: false,
        migrated: false,
        id: null,
        reason: 'NO_LEGACY_SESSION',
        legacyKey: key
      }
    }

    // Pass the raw value through so malformed legacy JSON is reported as a
    // migration result instead of being mistaken for repository corruption.
    const result = this.migrateLegacySession(raw, { id: options.id })
    return { ...result, legacyKey: key }
  }
}
