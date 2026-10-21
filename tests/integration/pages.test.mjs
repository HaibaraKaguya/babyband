import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ChunkedSessionRepository } from '../../src/repositories/chunkedSessionRepository.mjs'
import { createUniKeyValueStorage } from '../../src/repositories/keyValueStorage.mjs'
import { createSampleGuard } from '../../src/utils/sampleGuard.js'

function loadHome() {
  const source = readFileSync(new URL('../../src/pages/index/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('BluetoothManager', 'createSampleGuard', 'ChunkedSessionRepository', 'createUniKeyValueStorage', 'HumanPose3D', script)(class {}, createSampleGuard, ChunkedSessionRepository, createUniKeyValueStorage, {})
  const state = options.data()
  for (const [key, method] of Object.entries(options.methods)) state[key] = method.bind(state)
  return { options, state }
}

function memoryUni() {
  const entries = new Map()
  let failed = false
  return {
    getStorageSync: key => entries.get(key) || '',
    setStorageSync(key, value) { if (failed) throw Error('quota exceeded'); entries.set(key, value) },
    removeStorageSync: key => entries.delete(key),
    showToast() {}, showModal() {},
    failWrites(value) { failed = value }
  }
}

test('connected timer cannot reprocess the cached real BLE sample', () => {
  const { state } = loadHome()
  state.isBluetoothConnected = true
  state.realDataSample = { ts: 1 }
  state.algorithmManager = { processSensorData() { throw Error('must not be called') } }
  state.updateSensorData()
})

test('recording persists multiple batches and reloads all samples', () => {
  globalThis.uni = memoryUni()
  const { state } = loadHome()
  state.sessionRepository = new ChunkedSessionRepository({ storage: createUniKeyValueStorage(uni) })
  state.startSession()
  const id = state.activeSessionId
  state.sessionSamples = Array.from({ length: 20 }, (_, ts) => ({ ts }))
  assert.equal(state.flushSessionSamples(), true)
  state.sessionSamples = [{ ts: 20 }]
  state.stopSession()
  const saved = state.sessionRepository.loadSession(id)
  assert.equal(saved.samples.length, 21)
  assert.equal(saved.finalized, true)
  assert.equal(state.activeSessionId, null)
})

test('quota failure keeps pending records and permits stop-save retry', () => {
  globalThis.uni = memoryUni()
  const { state } = loadHome()
  state.sessionRepository = new ChunkedSessionRepository({ storage: createUniKeyValueStorage(uni) })
  state.startSession()
  const id = state.activeSessionId
  state.sessionSamples = [{ ts: 42 }]
  uni.failWrites(true)
  assert.equal(state.flushSessionSamples(), false)
  assert.equal(state.recordingPaused, true)
  assert.equal(state.sessionSamples.length, 1)
  assert.equal(state.activeSessionId, id)
  uni.failWrites(false)
  state.stopSession()
  assert.equal(state.sessionRepository.loadSession(id).samples.length, 1)
})


test('hiding home cancels demo polling so replay is not interrupted by demo alerts', () => {
  const { options, state } = loadHome()
  const timer = setInterval(() => {}, 1000)
  state.pollingTimer = timer
  options.onHide.call(state)
  assert.equal(state.pollingTimer, null)
  assert.equal(timer._destroyed, true)
})
