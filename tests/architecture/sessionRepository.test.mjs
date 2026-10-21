import test from 'node:test'
import assert from 'node:assert/strict'

import { ChunkedSessionRepository } from '../../src/repositories/chunkedSessionRepository.mjs'
import {
  assertKeyValueStorage,
  createUniKeyValueStorage
} from '../../src/repositories/keyValueStorage.mjs'
import {
  StorageCorruptionError,
  StorageQuotaError,
  StorageWriteError
} from '../../src/repositories/storageErrors.mjs'
import { MemoryStorage, makeSample } from './helpers.mjs'

function createRepo(storage, overrides = {}) {
  return new ChunkedSessionRepository({
    storage,
    now: () => 1_000,
    ...overrides
  })
}

test('repository: create, append, reload and list preserve sample/event order', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)

  const first = makeSample({ ts: 100 })
  const second = makeSample({ ts: 200, frameSeq: 8 })
  const event = { time: '10:00:00', drop: '0.88', extra: 'kept' }

  const created = repo.createSession({ id: 'session-a', startTs: 100, samples: [first] })
  assert.equal(created.id, 'session-a')
  assert.equal(created.samples.length, 1)

  const afterSample = repo.appendSample('session-a', second)
  assert.equal(afterSample.sampleCount, 2)

  const afterEvent = repo.appendEvent('session-a', event)
  assert.equal(afterEvent.eventCount, 1)

  const loaded = repo.loadSession('session-a')
  assert.deepEqual(loaded.samples, [first, second])
  assert.deepEqual(loaded.events, [event])
  assert.equal(loaded.startTs, 100)
  assert.equal(loaded.endTs, null)

  const summaries = repo.listSessions()
  assert.equal(summaries.length, 1)
  assert.deepEqual(summaries[0], {
    id: 'session-a',
    startTs: 100,
    endTs: null,
    sampleCount: 2,
    eventCount: 1,
    updatedAt: 1_000,
    finalized: false
  })
})

test('repository: chunked persistence reloads across multiple chunks', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage, { maxChunkChars: 96 })

  const samples = Array.from({ length: 12 }, (_, index) =>
    makeSample({ ts: index, frameSeq: index, deviceMs: index * 1_000 })
  )
  repo.createSession({ id: 'chunked', startTs: 0, samples })

  const loaded = repo.loadSession('chunked')
  assert.deepEqual(loaded.samples, samples)
  assert.ok(loaded.meta !== undefined)

  const metaKey = [...storage.keys()].find((key) => key.endsWith(':chunked:meta'))
  const meta = JSON.parse(storage.get(metaKey))
  assert.ok(meta.sampleChunks > 1, 'expected more than one sample chunk')
  assert.equal(meta.sampleChunkSizes.reduce((sum, n) => sum + n, 0), samples.length)
})

test('repository: append rewrites only the tail and keeps order', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage, { maxChunkChars: 96 })

  const initial = Array.from({ length: 5 }, (_, index) => makeSample({ ts: index }))
  repo.createSession({ id: 'tail', startTs: 0, samples: initial })

  const writesBefore = storage.writes.length
  repo.appendSample('tail', makeSample({ ts: 5 }))
  const appendWrites = storage.writes.slice(writesBefore)

  assert.ok(appendWrites.some((key) => key.endsWith(':tail:samples:4')))
  assert.ok(appendWrites.some((key) => key.endsWith(':tail:meta')))
  assert.equal(appendWrites.some((key) => key.endsWith(':tail:samples:0')), false)

  const loaded = repo.loadSession('tail')
  assert.deepEqual(loaded.samples.map((sample) => sample.ts), [0, 1, 2, 3, 4, 5])
})

test('repository: quota failure during create leaves no visible session', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage, { maxChunkChars: 64 })
  storage.failSet = (key) =>
    key.includes(':samples:1') ? Object.assign(new Error('exceed storage limit'), { errMsg: 'exceed storage limit' }) : null

  assert.throws(
    () => repo.createSession({
      id: 'quota',
      startTs: 1,
      samples: [makeSample(), makeSample(), makeSample()]
    }),
    (error) => error instanceof StorageQuotaError && error.code === 'QUOTA_EXCEEDED'
  )

  assert.deepEqual(repo.listSessions(), [])
  assert.equal(storage.keys().some((key) => key.includes(':quota:')), false)
  assert.equal(storage.keys().some((key) => key.endsWith(':index')), false)
})

test('repository: silent write failures are caught by read-back verification', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)
  storage.dropSet = (key) => key.includes(':verify:meta')

  assert.throws(
    () => repo.createSession({ id: 'verify', startTs: 1, samples: [makeSample()] }),
    (error) => error instanceof StorageWriteError && error.code === 'VERIFY_FAILED'
  )

  assert.deepEqual(repo.listSessions(), [])
})

test('repository: metadata write failure after a tail append preserves old samples', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)

  repo.createSession({ id: 'rollback', startTs: 1, samples: [makeSample({ ts: 1 })] })

  storage.failSet = (key) =>
    key.endsWith(':rollback:meta') ? new Error('storage full') : null

  assert.throws(
    () => repo.appendSample('rollback', makeSample({ ts: 2 })),
    (error) => error instanceof StorageQuotaError
  )

  storage.failSet = null
  const loaded = repo.loadSession('rollback')
  assert.deepEqual(loaded.samples.map((sample) => sample.ts), [1])

  repo.appendSample('rollback', makeSample({ ts: 3 }))
  assert.deepEqual(repo.loadSession('rollback').samples.map((sample) => sample.ts), [1, 3])
})

test('repository: finalize closes the session and rejects later appends', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)
  repo.createSession({ id: 'closed', startTs: 1, samples: [makeSample()] })

  const summary = repo.finalizeSession('closed', { endTs: 2_000 })
  assert.equal(summary.finalized, true)
  assert.equal(summary.endTs, 2_000)

  assert.throws(
    () => repo.appendSample('closed', makeSample()),
    (error) => error.code === 'SESSION_FINALIZED'
  )

  assert.equal(repo.loadSession('closed').finalized, true)
})

test('repository: migrates the legacy session key without changing it', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)

  const legacy = {
    startTs: 1_000,
    endTs: 2_000,
    samples: [
      makeSample({ ts: 1_100, legacyOnlyField: 'preserve-me' }),
      makeSample({ ts: 1_200 })
    ],
    events: [{ time: '10:00:01', drop: '0.88' }]
  }
  const legacyJson = JSON.stringify(legacy)
  storage.set('baby_band_last_session_v1', legacyJson)

  const result = repo.migrateLegacyFromStorage()
  assert.equal(result.ok, true)
  assert.equal(result.migrated, true)
  assert.equal(result.id, 'legacy-1000')
  assert.equal(result.legacyKey, 'baby_band_last_session_v1')
  assert.equal(storage.get('baby_band_last_session_v1'), legacyJson)

  const loaded = repo.loadSession('legacy-1000')
  assert.deepEqual(loaded.samples, legacy.samples)
  assert.deepEqual(loaded.events, legacy.events)
  assert.equal(loaded.finalized, true)
  assert.equal(loaded.meta.migratedFrom, 'baby_band_last_session_v1')

  const again = repo.migrateLegacyFromStorage()
  assert.equal(again.ok, true)
  assert.equal(again.migrated, false)
  assert.equal(again.reason, 'ALREADY_EXISTS')
  assert.equal(repo.listSessions().length, 1)
})

test('repository: legacy migration reports missing or invalid data', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)

  const missing = repo.migrateLegacyFromStorage()
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'NO_LEGACY_SESSION')

  storage.set('baby_band_last_session_v1', '{not-json')
  const invalid = repo.migrateLegacyFromStorage()
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'INVALID_LEGACY_JSON')
})

test('repository: corrupted chunks fail loudly and have a safe wrapper', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)
  repo.createSession({ id: 'corrupt', startTs: 1, samples: [makeSample(), makeSample()] })

  const chunkKey = [...storage.keys()].find((key) => key.endsWith(':corrupt:samples:0'))
  storage.set(chunkKey, JSON.stringify([{ onlyOne: true }]))

  assert.throws(
    () => repo.loadSession('corrupt'),
    (error) => error instanceof StorageCorruptionError
  )

  const safe = repo.tryLoadSession('corrupt')
  assert.equal(safe.ok, false)
  assert.equal(safe.error.code, 'CORRUPT_DATA')
})

test('repository: sessions are listed newest-first', () => {
  const storage = new MemoryStorage()
  const repo = createRepo(storage)
  repo.createSession({ id: 'older', startTs: 100 })
  repo.createSession({ id: 'newer', startTs: 200 })

  assert.deepEqual(repo.listSessions().map((session) => session.id), ['newer', 'older'])
})

test('repository: uni sync adapter satisfies the storage port', () => {
  const map = new Map()
  const uniLike = {
    getStorageSync(key) {
      return map.has(key) ? map.get(key) : ''
    },
    setStorageSync(key, value) {
      map.set(key, value)
    },
    removeStorageSync(key) {
      map.delete(key)
    }
  }

  const storage = createUniKeyValueStorage(uniLike)
  assert.equal(assertKeyValueStorage(storage), storage)
  assert.throws(() => assertKeyValueStorage({ get() {} }), /missing method "set"/)

  const repo = createRepo(storage)
  repo.createSession({ id: 'uni', startTs: 1, samples: [makeSample()] })
  assert.equal(repo.loadSession('uni').samples.length, 1)
})

