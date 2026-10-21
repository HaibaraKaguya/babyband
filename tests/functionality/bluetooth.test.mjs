import test from 'node:test'
import assert from 'node:assert/strict'
import BluetoothManager from '../../src/utils/bluetooth/BluetoothManager.js'
import { buildFrame, flipByte } from './helpers/frames.mjs'

const SERVICE_ID = '0000FFE0-0000-1000-8000-00805F9B34FB'
const CHARACTERISTIC_ID = '0000FFE1-0000-1000-8000-00805F9B34FB'

function installUniMock(options = {}) {
  const state = {
    listener: null,
    notifications: [],
    closed: [],
    offCharacteristic: 0,
    offDeviceFound: 0,
    connectionError: options.connectionError || null
  }

  globalThis.uni = {
    openBluetoothAdapter({ success }) {
      success()
    },
    startBluetoothDevicesDiscovery({ success }) {
      success()
    },
    onBluetoothDeviceFound() {},
    stopBluetoothDevicesDiscovery({ success }) {
      if (success) success()
    },
    createBLEConnection({ success, fail }) {
      if (state.connectionError) {
        fail(state.connectionError)
      } else {
        success()
      }
    },
    getBLEDeviceServices({ success }) {
      success({ services: [{ uuid: SERVICE_ID.toLowerCase() }] })
    },
    notifyBLECharacteristicValueChange(request) {
      state.notifications.push(request)
      if (options.notifyError) {
        request.fail(options.notifyError)
      } else {
        request.success()
      }
    },
    onBLECharacteristicValueChange(listener) {
      state.listener = listener
    },
    offBLECharacteristicValueChange() {
      state.offCharacteristic += 1
      state.listener = null
    },
    offBluetoothDeviceFound() {
      state.offDeviceFound += 1
    },
    closeBLEConnection({ success, complete }) {
      state.closed.push('closed')
      if (success) success()
      if (complete) complete()
    }
  }

  return state
}

function feed(state, frame) {
  assert.ok(state.listener, 'notification listener should be registered')
  state.listener({
    deviceId: 'device-1',
    characteristicId: CHARACTERISTIC_ID,
    value: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength)
  })
}

test('connect rejects when enabling notifications fails', async () => {
  const state = installUniMock({ notifyError: { errMsg: 'notify denied' } })
  const manager = new BluetoothManager()

  await assert.rejects(() => manager.connect('device-1'), /开启数据通知失败/)

  assert.equal(manager.isConnected, false)
  assert.equal(manager.isNotifying, false)
  assert.equal(state.listener, null)
  assert.equal(state.notifications.length, 1)
  assert.equal(state.closed.length, 1)
})

test('connect resolves only after notifications are active', async () => {
  const state = installUniMock()
  const manager = new BluetoothManager()

  await manager.connect('device-1')

  assert.equal(manager.isConnected, true)
  assert.equal(manager.isNotifying, true)
  assert.equal(typeof state.listener, 'function')
  assert.equal(state.notifications.length, 1)
  assert.equal(state.notifications[0].state, true)
})

test('startNotify rejects without a device and reports platform errors', async () => {
  const state = installUniMock({ notifyError: { errMsg: 'unsupported' } })
  const manager = new BluetoothManager()

  await assert.rejects(() => manager.startNotify(), /未连接蓝牙设备/)

  manager.deviceId = 'device-1'
  await assert.rejects(() => manager.startNotify(), /unsupported/)
  assert.equal(manager.isNotifying, false)
  assert.equal(state.listener, null)
})

test('notifications accept valid frames and reject duplicates, stale frames and bad CRC', async () => {
  const state = installUniMock()
  const manager = new BluetoothManager()
  const received = []
  const rejected = []
  manager.onDataReceived = (sample) => received.push(sample)
  manager.onSampleRejected = (info) => rejected.push(info)

  await manager.connect('device-1')

  feed(state, buildFrame({ frameSeq: 1, deviceMs: 1000 }))
  assert.equal(received.length, 1)
  assert.equal(received[0].frameSeq, 1)

  feed(state, buildFrame({ frameSeq: 1, deviceMs: 1000 }))
  assert.equal(received.length, 1)
  assert.equal(rejected.at(-1).error, 'duplicate-frame')

  feed(state, buildFrame({ frameSeq: 2, deviceMs: 2000 }))
  assert.equal(received.length, 2)

  feed(state, buildFrame({ frameSeq: 1, deviceMs: 3000 }))
  assert.equal(received.length, 2)
  assert.equal(rejected.at(-1).error, 'stale-frame')

  feed(state, flipByte(buildFrame({ frameSeq: 3 }), 20))
  assert.equal(received.length, 2)
  assert.match(rejected.at(-1).error, /crc mismatch/)

  await manager.disconnect()
  assert.equal(manager.isConnected, false)
  assert.equal(state.offCharacteristic, 1)
})

test('connect propagates BLE connection errors', async () => {
  installUniMock({ connectionError: { errMsg: 'connect failed' } })
  const manager = new BluetoothManager()

  await assert.rejects(() => manager.connect('device-1'), /connect failed/)
  assert.equal(manager.isConnected, false)
})
