import { BabyBandStreamParser } from '../protocol/babyBandProtocol.js'
import { createSampleGuard } from '../sampleGuard.js'

function errorMessage(err, fallback) {
  if (err instanceof Error && err.message) return err.message
  if (err && err.errMsg) return err.errMsg
  return fallback
}

export default class BluetoothManager {
  constructor(options = {}) {
    this.deviceId = null
    this.serviceId = '0000FFE0-0000-1000-8000-00805F9B34FB'
    this.characteristicId = '0000FFE1-0000-1000-8000-00805F9B34FB'
    this.parser = new BabyBandStreamParser()
    this.sampleGuard = options.sampleGuard || createSampleGuard()
    this.onDataReceived = null
    this.onSampleRejected = null
    this.isConnected = false
    this.isNotifying = false
    this._listenerAttached = false
  }

  // 初始化蓝牙模块（修复版：移除不兼容的requestPermissions）
  async init() {
    return new Promise((resolve, reject) => {
      uni.openBluetoothAdapter({
        success: () => {
          console.log('蓝牙模块初始化成功')
          resolve()
        },
        fail: (err) => {
          console.error('蓝牙模块初始化失败', err)
          reject(err)
        }
      })
    })
  }

  // 扫描设备
  startScan(onDeviceFound) {
    uni.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: () => {
        console.log('开始扫描蓝牙设备')
        uni.onBluetoothDeviceFound((res) => {
          const devices = (res && res.devices) || []
          devices.forEach(device => {
            if (device.deviceId && (device.name?.includes('HC') || device.name?.includes('BT') || !device.name)) {
              onDeviceFound(device)
            }
          })
        })
      },
      fail: (err) => {
        console.error('扫描失败', err)
      }
    })
  }

  // 停止扫描
  stopScan() {
    uni.stopBluetoothDevicesDiscovery({
      success: () => console.log('停止扫描'),
      fail: (err) => console.error('停止扫描失败', err)
    })
  }

  /**
   * Connect and enable notifications.
   *
   * Resolves only when BLE is connected AND notifications are active. A failed
   * notifyBLECharacteristicValueChange must not look like a successful
   * connection, because no samples would ever arrive.
   */
  async connect(deviceId) {
    this.deviceId = deviceId
    this.isConnected = false
    this.isNotifying = false
    this.resetIngestionState()

    return new Promise((resolve, reject) => {
      let settled = false

      const finishWithError = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.isConnected = false
        this.isNotifying = false
        this._closeQuietly()
        reject(err instanceof Error ? err : new Error(errorMessage(err, '蓝牙连接失败')))
      }

      const timeout = setTimeout(() => {
        finishWithError(new Error('连接超时，请检查设备是否上电'))
      }, 10000)

      uni.createBLEConnection({
        deviceId,
        success: async () => {
          try {
            await this.discoverServices()
            await this.startNotify()
            if (settled) {
              // The 10s connect timeout won the race; do not leave a listener
              // attached for a connection the app considers failed.
              this.isNotifying = false
              this._detachListener()
              return
            }
            settled = true
            clearTimeout(timeout)
            this.isConnected = true
            console.log('蓝牙连接成功')
            resolve()
          } catch (err) {
            finishWithError(err)
          }
        },
        fail: (err) => {
          console.error('连接失败', err)
          finishWithError(new Error(errorMessage(err, '蓝牙连接失败')))
        }
      })
    })
  }

  // 发现蓝牙服务
  async discoverServices() {
    return new Promise((resolve, reject) => {
      uni.getBLEDeviceServices({
        deviceId: this.deviceId,
        success: (res) => {
          console.log('发现服务', res.services)
          const services = (res && res.services) || []
          const service = services.find(s => s.uuid && s.uuid.toLowerCase() === this.serviceId.toLowerCase())
          if (!service) {
            reject(new Error('未找到HC-08串口服务，请确认设备型号'))
            return
          }
          resolve()
        },
        fail: (err) => {
          reject(new Error(errorMessage(err, '获取蓝牙服务失败')))
        }
      })
    })
  }

  /**
   * Enable characteristic notifications.
   * @returns {Promise<void>} rejects when the platform reports failure.
   */
  startNotify() {
    if (!this.deviceId) {
      return Promise.reject(new Error('未连接蓝牙设备'))
    }

    return new Promise((resolve, reject) => {
      uni.notifyBLECharacteristicValueChange({
        deviceId: this.deviceId,
        serviceId: this.serviceId,
        characteristicId: this.characteristicId,
        state: true,
        success: () => {
          this.isNotifying = true
          console.log('开启数据通知成功')
          this.listenForData()
          resolve()
        },
        fail: (err) => {
          this.isNotifying = false
          console.error('开启通知失败', err)
          reject(new Error(`开启数据通知失败: ${errorMessage(err, '未知错误')}`))
        }
      })
    })
  }

  // 监听数据
  listenForData() {
    if (this._listenerAttached) return
    this._listenerAttached = true

    uni.onBLECharacteristicValueChange((res) => {
      if (!res || !res.characteristicId || !res.value) return
      if (res.deviceId !== this.deviceId) return
      if (res.characteristicId.toLowerCase() !== this.characteristicId.toLowerCase()) return

      let frames = []
      try {
        frames = this.parser.push(new Uint8Array(res.value))
      } catch (err) {
        console.error('解析蓝牙数据失败', err)
        return
      }

      frames.forEach(frame => {
        if (!frame || !frame.ok) {
          if (this.onSampleRejected) this.onSampleRejected(frame)
          return
        }

        const decision = this.sampleGuard.check(frame.sample)
        if (!decision.accept) {
          if (this.onSampleRejected) {
            this.onSampleRejected({ ok: false, error: decision.reason, sample: frame.sample })
          }
          return
        }

        if (this.onDataReceived) this.onDataReceived(frame.sample)
      })
    })
  }

  resetIngestionState() {
    this.parser = new BabyBandStreamParser()
    this.sampleGuard.reset()
  }

  _closeQuietly() {
    if (!this.deviceId || typeof uni === 'undefined' || !uni.closeBLEConnection) return
    const deviceId = this.deviceId
    uni.closeBLEConnection({
      deviceId,
      complete: () => {
        this.deviceId = null
      }
    })
  }

  // 断开连接
  disconnect() {
    const deviceId = this.deviceId
    this.isConnected = false
    this.isNotifying = false
    this.resetIngestionState()

    if (!deviceId) {
      this.deviceId = null
      this._detachListener()
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      uni.closeBLEConnection({
        deviceId,
        success: () => {
          console.log('蓝牙已断开')
        },
        fail: (err) => {
          console.error('断开连接失败', err)
        },
        complete: () => {
          this.deviceId = null
          this._detachListener()
          resolve()
        }
      })
    })
  }

  _detachListener() {
    this._listenerAttached = false
    if (typeof uni === 'undefined') return
    if (uni.offBLECharacteristicValueChange) uni.offBLECharacteristicValueChange()
    if (uni.offBluetoothDeviceFound) uni.offBluetoothDeviceFound()
  }
}
