import { BabyBandStreamParser } from '@/utils/protocol/babyBandProtocol.js'

export default class BluetoothManager {
  constructor() {
    this.deviceId = null
    this.serviceId = '0000FFE0-0000-1000-8000-00805F9B34FB'
    this.characteristicId = '0000FFE1-0000-1000-8000-00805F9B34FB'
    this.parser = new BabyBandStreamParser()
    this.onDataReceived = null
    this.isConnected = false
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
          res.devices.forEach(device => {
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
      success: () => console.log('停止扫描')
    })
  }

  // 连接设备
  async connect(deviceId) {
    this.deviceId = deviceId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时，请检查设备是否上电'))
      }, 10000)

      uni.createBLEConnection({
        deviceId,
        success: () => {
          clearTimeout(timeout)
          this.isConnected = true
          console.log('蓝牙连接成功')
          this.discoverServices().then(() => {
            this.startNotify()
            resolve()
          }).catch(err => {
            reject(err)
          })
        },
        fail: (err) => {
          clearTimeout(timeout)
          this.isConnected = false
          console.error('连接失败', err)
          reject(err)
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
          const service = res.services.find(s => s.uuid.toLowerCase() === this.serviceId.toLowerCase())
          if (!service) {
            reject(new Error('未找到HC-08串口服务，请确认设备型号'))
            return
          }
          resolve()
        },
        fail: (err) => {
          reject(err)
        }
      })
    })
  }

  // 开启特征值通知
  startNotify() {
    uni.notifyBLECharacteristicValueChange({
      deviceId: this.deviceId,
      serviceId: this.serviceId,
      characteristicId: this.characteristicId,
      state: true,
      success: () => {
        console.log('开启数据通知成功')
        this.listenForData()
      },
      fail: (err) => {
        console.error('开启通知失败', err)
      }
    })
  }

  // 监听数据
  listenForData() {
    uni.onBLECharacteristicValueChange((res) => {
      if (res.deviceId === this.deviceId && res.characteristicId.toLowerCase() === this.characteristicId.toLowerCase()) {
        const uint8Array = new Uint8Array(res.value)
        const frames = this.parser.push(uint8Array)
        if (frames.length > 0 && this.onDataReceived) {
          frames.forEach(frame => {
            if (frame.ok) {
              this.onDataReceived(frame.sample)
            }
          })
        }
      }
    })
  }

  // 断开连接
  disconnect() {
    if (this.deviceId) {
      uni.closeBLEConnection({
        deviceId: this.deviceId,
        success: () => {
          this.isConnected = false
          this.deviceId = null
          uni.offBLECharacteristicValueChange()
          uni.offBluetoothDeviceFound()
          console.log('蓝牙已断开')
        }
      })
    }
  }
}