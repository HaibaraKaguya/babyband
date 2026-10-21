<template>
  <view style="padding: 20px;">
    <text style="font-weight: bold; font-size: 16px;">婴幼儿智能睡眠监护系统</text>
	
	<!-- 在原有UI区域前添加蓝牙连接面板 -->
	<view style="margin-top: 20px; background: #e3f2fd; padding: 12px; border-radius: 8px;">
	  <text style="font-weight: bold; color: #1976d2;">蓝牙连接</text>
	  <view style="margin-top: 10px;">
	    <button size="mini" type="primary" @click="startBluetoothScan" :disabled="isBluetoothConnected">
	      扫描设备
	    </button>
	    <button size="mini" type="warn" @click="disconnectBluetooth" :disabled="!isBluetoothConnected">
	      断开连接
	    </button>
	  </view>
	  <view v-if="availableDevices.length > 0" style="margin-top: 10px;">
	    <text>可用设备：</text>
	    <view v-for="device in availableDevices" :key="device.deviceId" 
	          style="padding: 8px; background: #fff; border-radius: 4px; margin-top: 5px;"
	          @click="connectToDevice(device.deviceId)">
	      {{ device.name || '未知设备' }} ({{ device.deviceId }})
	    </view>
	  </view>
	  <view style="margin-top: 10px; color: #666;">
	    连接状态：<text :style="{color: isBluetoothConnected ? '#4caf50' : '#ff9800'}">
	      {{ isBluetoothConnected ? '已连接' : '未连接' }}
	    </text>
	  </view>
	</view>

    <view style="margin-top: 12px; color: #666;">
      数据来源：{{ isBluetoothConnected ? '蓝牙设备' : '演示数据' }} · 已拒绝样本：{{ rejectedSamples }}
      <view v-if="recordingPaused" style="color: #c62828;">记录已暂停，待保存数据仍保留，请点击停止记录重试。</view>
    </view>
    <!-- ===== 新增：算法状态显示区域 ===== -->
    <view style="margin-top: 20px; background: #f8f9fa; padding: 12px; border-radius: 8px;">
      <text style="font-weight: bold;">身体坐标系反推算法</text>
      
      <view style="margin-top: 10px;">
        <text style="font-weight: 600;">当前身体坐标系：</text>
        <view style="margin-top: 5px; font-family: monospace; font-size: 12px;">
          <view>X(前向): {{ bodyFrameDisplay.X }}</view>
          <view>Y(右侧): {{ bodyFrameDisplay.Y }}</view>
          <view>Z(向上): {{ bodyFrameDisplay.Z }}</view>
        </view>
      </view>
      
      <view style="margin-top: 10px;">
        <text style="font-weight: 600;">传感器对齐状态：</text>
        <view style="display: flex; align-items: center; margin-top: 5px;">
          <view :style="{
            width: '12px',
            height: '12px',
            borderRadius: '6px',
            backgroundColor: alignmentStatus.isAligned ? '#4caf50' : '#ff9800',
            marginRight: '8px'
          }"></view>
          <text>{{ alignmentStatus.isAligned ? '已对齐' : '未对齐' }}</text>
          <text v-if="alignmentStatus.isCalibrating" style="margin-left: 10px; color: #2196f3;">
            校准中... {{ alignmentStatus.progress.toFixed(0) }}%
          </text>
        </view>
      </view>
      
      <!-- 算法操作按钮 -->
      <view style="margin-top: 15px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button size="mini" type="primary" @click="startAlignmentCalibration">
          对齐校准
        </button>
        <button size="mini" type="warn" @click="testCalibrationQuick">
          快速测试
        </button>
        <button size="mini" @click="verifyCalibration">
          验证精度
        </button>
        <button size="mini" @click="resetAlignment">
          重置校准
        </button>
      </view>
    </view>
    
	    <!-- ===== 新增：坐标变换显示区域 ===== -->
    <view style="margin-top: 20px; background: #f0f7ff; padding: 12px; border-radius: 8px; border: 1px solid #d1e3ff;">
      <text style="font-weight: bold; color: #1976d2;">坐标变换结果</text>
      
      <!-- 脚踝传感器变换 -->
      <view style="margin-top: 10px;">
        <text style="font-weight: 600; color: #388e3c;">脚踝传感器：</text>
        <view style="margin-top: 5px; font-family: monospace; font-size: 12px;">
          <view>重力向量传感器系: {{ formatVector(coordinateTransforms.ankle.vector) }}</view>
          <view>→ 身体坐标系: {{ formatVector(coordinateTransforms.ankle.transformed) }}</view>
          <view style="font-size: 11px; color: #666; margin-top: 2px;">
            {{ coordinateTransforms.ankle.description }}
          </view>
        </view>
      </view>
      
      <!-- 手腕传感器变换 -->
      <view style="margin-top: 10px;">
        <text style="font-weight: 600; color: #d32f2f;">手腕传感器：</text>
        <view style="margin-top: 5px; font-family: monospace; font-size: 12px;">
          <view>重力向量传感器系: {{ formatVector(coordinateTransforms.wrist.vector) }}</view>
          <view>→ 身体坐标系: {{ formatVector(coordinateTransforms.wrist.transformed) }}</view>
          <view style="font-size: 11px; color: #666; margin-top: 2px;">
            {{ coordinateTransforms.wrist.description }}
          </view>
        </view>
      </view>
      
      <!-- 坐标变换操作按钮 -->
      <view style="margin-top: 15px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button size="mini" type="primary" @click="runTransformTests">
          验证变换
        </button>
        <button size="mini" type="warn" @click="testCustomVector">
          测试向量
        </button>
        <button size="mini" @click="showSensorOrientations">
          传感器方向
        </button>
      </view>
    </view>
	
    <view style="margin-top: 20px;">
      <text style="font-weight: bold;">实时人体姿态</text>
      <HumanPose3D :pose="currentPoseFrame" :height="320" />
      <text style="font-size: 12px; color: #666;">腰、腕、踝传感器驱动的简化人体示意；未测量关节为估计姿态。</text>
    </view>
    <!-- 设备原始数值 -->
    <view style="margin-top: 20px;">
      <text>设备数据：</text>
      <view style="margin-top: 10px; white-space: pre-line;">
        {{ dataText }}
      </view>
    </view>
    
    <!-- 原有操作按钮区域 -->
    <view style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap;">
      <button size="mini" @click="clearEvents">清空报警记录</button>
      <button size="mini" @click="forceAlarm">模拟一次报警</button>
      <button size="mini" type="primary" v-if="!isRecording" @click="startSession">
        开始记录
      </button>
      <button size="mini" type="warn" v-else @click="stopSession">
        停止记录
      </button>
      <button size="mini" @click="goHistory">查看回放</button>
    </view>
    
    <!-- 原有记录状态显示 -->
    <view style="margin-top: 10px; color:#555;">
      记录状态：<text :style="{color: isRecording ? '#d9534f' : '#666'}">
        {{ isRecording ? '录制中' : '未录制' }}
      </text>
      <view v-if="isRecording">已记录采样：{{ recordedSampleCount }} 条</view>
    </view>
    
    <!-- 原有报警记录 -->
    <view style="margin-top: 20px;">
      <text style="font-weight: bold;">报警记录（最近5条）：</text>
      <view v-if="events.length === 0" style="margin-top: 8px; color: #888;">
        暂无报警
      </view>
      <view v-for="(e, idx) in events" :key="idx" style="margin-top: 8px;">
        {{ idx + 1 }}. {{ e.time }} - {{ e.type === 'kick' ? '疑似踢被' : '温度变化 ' + e.drop + '℃' }}
      </view>
    </view>
  </view>
</template>

<script>
import HumanPose3D from '@/components/HumanPose3D/HumanPose3D.vue'
import { genMockSample } from '@/mock/deviceData.js'
import AlgorithmManager from '@/utils/algorithms/AlgorithmManager.js'
import BluetoothManager from '@/utils/bluetooth/BluetoothManager.js' // 新增

import { createSampleGuard } from '@/utils/sampleGuard.js'

const EVENTS_KEY = 'baby_band_events_v1'
import { ChunkedSessionRepository } from '@/repositories/chunkedSessionRepository.mjs'
import { createUniKeyValueStorage } from '@/repositories/keyValueStorage.mjs'

export default {
  components: { HumanPose3D },
  data() {
    return {
      dataText: '暂无数据',
      historyT3: [],
      lastAlarmTs: 0,
      events: [],
      isRecording: false,
      recordingPaused: false,
      sessionStartTs: 0,
      sessionSamples: [],
      recordedSampleCount: 0,
      sessionRepository: null,
      activeSessionId: null,
      
      // ===== 新增：算法相关数据 =====
      algorithmManager: null,
      bodyFrameDisplay: {
        X: '[1.000, 0.000, 0.000]',
        Y: '[0.000, 1.000, 0.000]',
        Z: '[0.000, 0.000, 1.000]'
      },
      alignmentStatus: {
        isAligned: false,
        isCalibrating: false,
        progress: 0
      },
	  
      // ===== 新增：坐标变换数据 =====
      coordinateTransforms: {
        ankle: {
          vector: [0, 0, 0],
          transformed: [0, 0, 0],
          description: ''
        },
        wrist: {
          vector: [0, 0, 0],
          transformed: [0, 0, 0],
          description: ''
        }
      },
      transformTestResults: [],
      sensorOrientations: {
        ankle: { X: [0,0,0], Y: [0,0,0], Z: [0,0,0] },
        wrist: { X: [0,0,0], Y: [0,0,0], Z: [0,0,0] }
      },
	  bluetoothManager: new BluetoothManager(), // 新增
      isBluetoothConnected: false, // 新增
      availableDevices: [], // 新增，用于显示扫描到的设备列表
      realDataSample: null,
      pollingTimer: null,
      sampleGuard: null,
      currentPoseFrame: null,
      connectionStateHandler: null,
      rejectedSamples: 0,
    }
  },

  onLoad() {
    this.sessionRepository = new ChunkedSessionRepository({ storage: createUniKeyValueStorage(uni) })
    this.sampleGuard = createSampleGuard()
    this.loadEvents()
    
    // 初始化算法管理器
    this.algorithmManager = new AlgorithmManager()
    this.algorithmManager.loadAlignmentFromStorage()
    this.updateAlignmentStatus()

    // 初始化蓝牙管理器，并设置数据回调（关键修改：更新dataText）
    this.bluetoothManager.onDataReceived = (sample) => {
      if (sample.crcOk === false || !this.sampleGuard.check(sample).accept) return
      this.realDataSample = sample
      this.updateSensorData(sample)
    }

    this.bluetoothManager.onSampleRejected = () => { this.rejectedSamples += 1 }
    this.connectionStateHandler = (state) => {
      if (state.deviceId === this.bluetoothManager.deviceId && !state.connected) {
        this.isBluetoothConnected = false
        this.realDataSample = null
        this.sampleGuard.reset()
        this.bluetoothManager.disconnect()
      }
    }
    if (uni.onBLEConnectionStateChange) uni.onBLEConnectionStateChange(this.connectionStateHandler)

    // 启动蓝牙初始化
    this.initBluetooth()
  
    // 启动数据更新定时器
    this.pollingTimer = setInterval(() => {
      if (!this.isBluetoothConnected) this.updateSensorData()
    }, 1000)
  },

  onShow() {
    if (!this.pollingTimer) {
      this.pollingTimer = setInterval(() => {
        if (!this.isBluetoothConnected) this.updateSensorData()
      }, 1000)
    }
  },

  onHide() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
    if (this.isRecording) this.flushSessionSamples()
  },

  onUnload() {
    if (this.isRecording) this.stopSession()
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
    if (uni.offBLEConnectionStateChange && this.connectionStateHandler) {
      uni.offBLEConnectionStateChange(this.connectionStateHandler)
    }
    this.bluetoothManager.onDataReceived = null
    this.bluetoothManager.stopScan()
    if (this.bluetoothManager.isConnected) {
      this.bluetoothManager.disconnect()
    }
  },

  methods: {
	// 初始化蓝牙
	async initBluetooth() {
	  try {
	    await this.bluetoothManager.init()
	    uni.showToast({ title: '蓝牙初始化成功', icon: 'none' })
	  } catch (err) {
	    uni.showModal({
	      title: '蓝牙不可用',
	      content: '请检查蓝牙权限和设备状态',
	      showCancel: false
	    })
	  }
	},
	
	// 新增：扫描设备方法（按钮绑定的核心方法）
	startBluetoothScan() {
	  // 清空历史设备列表
	  this.availableDevices = []
	  uni.showToast({ title: '开始扫描蓝牙设备...', icon: 'none' })
	  
	  // 调用蓝牙管理器的扫描方法
	  this.bluetoothManager.startScan((device) => {
	    // 去重：避免重复添加同一个设备
	    if (!this.availableDevices.find(d => d.deviceId === device.deviceId)) {
	      this.availableDevices.push(device)
	    }
	  })
	},
	
	// 连接选中的设备
	async connectToDevice(deviceId) {
	  try {
	    uni.showLoading({ title: '连接中...' })
	    await this.bluetoothManager.connect(deviceId)
	    this.sampleGuard.reset()
    this.isBluetoothConnected = true
	    this.bluetoothManager.stopScan()
	    uni.hideLoading()
	    uni.showToast({ title: '连接成功', icon: 'success' })
	  } catch (err) {
	    uni.hideLoading()
	    uni.showToast({ title: '连接失败：' + err.message, icon: 'none' })
	  }
	},
	
	// 断开连接
	disconnectBluetooth() {
	  this.bluetoothManager.disconnect()
	  this.isBluetoothConnected = false
	  this.realDataSample = null
	  this.sampleGuard.reset()
	  uni.showToast({ title: '已断开蓝牙连接', icon: 'none' })
	},
	
    /**
     * 更新传感器数据（整合原有逻辑）
     */
    updateSensorData(incomingSample = null) {
       // BLE notifications drive real sampling; the timer only drives demo data.
       if (this.isBluetoothConnected && !incomingSample) return
       const s = incomingSample || genMockSample()
       if (s.crcOk === false) return
       const tsStr = new Date(s.ts).toLocaleTimeString()
      
      // 2. 处理传感器数据（调用算法管理器）
      const algorithmResult = this.algorithmManager.processSensorData(s)
      
      // 3. 更新算法显示
      this.currentPoseFrame = algorithmResult.poseFrame
      this.updateAlgorithmDisplay(algorithmResult)
      this.updateAlignmentStatus()
      
      // 4. 更新坐标变换显示
      if (algorithmResult.coordinateTransforms) {
        this.coordinateTransforms = algorithmResult.coordinateTransforms
      }
      
      // 5. 原有温度监测逻辑（完全不变）
      const batteryText = (s.battery == null) ? '-' : `${s.battery}%`
      const tempValidText = (s.tempValid == null) ? '-' : (s.tempValid ? '有效' : '无效')
      const attitudeValidText = (s.attitudeValid == null) ? '-' : (s.attitudeValid ? '有效' : '无效')

      this.dataText =
        `时间：${tsStr}\n` +
        `设备毫秒：${s.deviceMs ?? '-'}\n` +
        `帧序号：${s.frameSeq ?? '-'}\n` +
        `温度有效：${tempValidText}，姿态有效：${attitudeValidText}\n` +
        `腹部（腰）温度：${s.temp1} ℃\n` +
        `大腿温度：${s.temp2} ℃\n` +
        `脚踝温度：${s.temp3} ℃\n` +
        `电量：${batteryText}\n` +
        `CRC：${s.crcOk === false ? '错误' : (s.crcOk ? 'OK' : '-')}\n` +
        `身体坐标系：\n` +
        `  X(前向): ${this.formatVector(this.bodyFrameDisplay.X)}\n` +
        `  Y(右侧): ${this.formatVector(this.bodyFrameDisplay.Y)}\n` +
        `  Z(向上): ${this.formatVector(this.bodyFrameDisplay.Z)}\n` +
        `对齐状态：${this.alignmentStatus.isAligned ? '已对齐' : '未对齐'}`

      // 原有记录逻辑
      if (this.isRecording && !this.recordingPaused) {
        if (this.sessionSamples.length < 20) { this.sessionSamples.push(s); this.recordedSampleCount += 1 }
        if (this.sessionSamples.length >= 20) this.flushSessionSamples()
      }

      // Alarm wording follows the actual detector output rather than a temperature proxy.
      if (algorithmResult.kickDetected?.detected && s.ts - this.lastAlarmTs > 30000) {
        this.raiseAlarm(s.ts, null, 'kick')
      }

    },
    // ===== 新增：算法相关方法 =====
    updateAlgorithmDisplay(result) {
      if (result.type === 'bodyFrame') {
        // 更新身体坐标系显示
        const format = (v) => `[${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}]`
        this.bodyFrameDisplay = {
          X: format(result.bodyFrame.X),
          Y: format(result.bodyFrame.Y),
          Z: format(result.bodyFrame.Z)
        }
      } else if (result.type === 'calibration') {
        // 更新校准进度
        this.alignmentStatus.isCalibrating = result.status.isCalibrating
        this.alignmentStatus.progress = result.status.progress
      }
    },
    
    updateAlignmentStatus() {
      const status = this.algorithmManager.getAlignmentStatus()
      this.alignmentStatus = {
        isAligned: status.isAligned,
        isCalibrating: status.isCalibrating,
        progress: status.progress
      }
    },
    
    /**
     * 格式化向量显示
     */
    formatVector(vec) {
      if (Array.isArray(vec)) {
        return `[${vec[0].toFixed(3)}, ${vec[1].toFixed(3)}, ${vec[2].toFixed(3)}]`
      }
      return vec
    },
	
    // ===== 新增：坐标变换相关方法 =====
    
    /**
     * 运行坐标变换验证测试
     */
    runTransformTests() {
      const tests = this.algorithmManager.runCoordinateTransformTests()
      
      let message = '坐标变换验证结果：\n\n'
      tests.forEach((test, index) => {
        const status = test.passed ? '✅' : '❌'
        message += `${status} ${test.name}\n`
        message += `  期望: ${this.formatVector(test.expected)}\n`
        message += `  实际: ${this.formatVector(test.actual)}\n\n`
      })
      
      const allPassed = tests.every(test => test.passed)
      
      uni.showModal({
        title: allPassed ? '验证通过' : '验证失败',
        content: message,
        showCancel: false
      })
    },

    /**
     * 测试自定义向量变换
     */
    testCustomVector() {
      uni.showModal({
        title: '测试向量变换',
        content: '请输入测试向量（格式: x,y,z）',
        editable: true,
        placeholderText: '例如: 1,0,0',
        success: (res) => {
          if (res.confirm) {
            try {
              const parts = res.content.split(',').map(Number)
              if (parts.length === 3 && parts.every(n => !isNaN(n))) {
                const testVector = parts
                const result = this.algorithmManager.testVectorTransform(
                  testVector,
                  `测试向量: ${this.formatVector(testVector)}`
                )
                
                let message = `测试向量: ${this.formatVector(testVector)}\n\n`
                message += `脚踝传感器 → 身体坐标系:\n`
                message += `  ${this.formatVector(result.ankle.toBody)}\n\n`
                message += `手腕传感器 → 身体坐标系:\n`
                message += `  ${this.formatVector(result.wrist.toBody)}`
                
                uni.showModal({
                  title: '向量变换结果',
                  content: message,
                  showCancel: false
                })
              } else {
                uni.showToast({ title: '请输入有效的向量格式', icon: 'none' })
              }
            } catch (e) {
              uni.showToast({ title: '解析失败', icon: 'none' })
            }
          }
        }
      })
    },

    /**
     * 显示传感器方向
     */
    showSensorOrientations() {
      // 获取传感器在身体坐标系中的方向
      this.sensorOrientations.ankle = this.algorithmManager.getSensorOrientationInBody('ankle')
      this.sensorOrientations.wrist = this.algorithmManager.getSensorOrientationInBody('wrist')
      
      let message = '传感器在身体坐标系中的方向：\n\n'
      
      message += '脚踝传感器：\n'
      message += `  X轴: ${this.formatVector(this.sensorOrientations.ankle.X)}\n`
      message += `  Y轴: ${this.formatVector(this.sensorOrientations.ankle.Y)}\n`
      message += `  Z轴: ${this.formatVector(this.sensorOrientations.ankle.Z)}\n\n`
      
      message += '手腕传感器：\n'
      message += `  X轴: ${this.formatVector(this.sensorOrientations.wrist.X)}\n`
      message += `  Y轴: ${this.formatVector(this.sensorOrientations.wrist.Y)}\n`
      message += `  Z轴: ${this.formatVector(this.sensorOrientations.wrist.Z)}`
      
      uni.showModal({
        title: '传感器方向',
        content: message,
        showCancel: false
      })
    },
    
    // 对齐校准按钮
    startAlignmentCalibration() {
      this.algorithmManager.startAlignmentCalibration()
      this.updateAlignmentStatus()
      uni.showToast({ title: '开始对齐校准，请保持婴儿平躺静止', icon: 'none' })
    },
    
    // 快速校准测试（使用固定数据）
    testCalibrationQuick() {
      // 模拟脚踝四元数（基准）
      const ankleQuat = [0.9981, 0.0615, 0.0017, 0.0008]
      
      // 模拟手腕四元数（有30度旋转误差）
      const angle = 30 * Math.PI / 180
      const wristQuat = [
        Math.cos(angle/2),
        Math.sin(angle/2), // 绕X轴旋转30度
        0,
        0
      ]
      
      // 直接调用完成校准
      this.algorithmManager.finishAlignmentCalibration(ankleQuat, wristQuat)
      this.updateAlignmentStatus()
      
      uni.showToast({ 
        title: '快速校准完成（模拟30度误差已校正）', 
        icon: 'none' 
      })
    },
    
    // 验证校准结果
    verifyCalibration() {
      const validation = this.algorithmManager.bodyReconstructor.verifyCalibrationAccuracy()
      if (validation.valid) {
        uni.showModal({
          title: '校准验证',
          content: `平均误差：${validation.averageErrorDegrees.toFixed(1)}°\n` +
                   `最大误差：${validation.maxErrorDegrees.toFixed(1)}°\n` +
                   `评估：${validation.assessment}`,
          showCancel: false
        })
      } else {
        uni.showToast({ title: validation.message, icon: 'none' })
      }
    },
    
    // 重置校准
    resetAlignment() {
      this.algorithmManager.resetAlignment()
      this.updateAlignmentStatus()
      uni.showToast({ title: '对齐校准已重置', icon: 'none' })
    },
    
    // ===== 原有方法（完全不变） =====
    loadEvents() {
      try {
        const raw = uni.getStorageSync(EVENTS_KEY)
        if (raw) this.events = JSON.parse(raw)
      } catch (e) {
        this.events = []
      }
    },
    saveEvents() {
      try {
        uni.setStorageSync(EVENTS_KEY, JSON.stringify(this.events))
      } catch (e) {
        uni.showToast({ title: '提醒记录保存失败', icon: 'none' })
      }
    },

    raiseAlarm(now, drop, kind = 'temperature') {
      this.lastAlarmTs = now

      this.events.unshift({
        ts: now,
        type: kind,
        time: new Date(now).toLocaleTimeString(),
        drop: drop == null ? '-' : Number(drop).toFixed(2)
      })
      if (this.events.length > 5) this.events.pop()
      this.saveEvents()
      if (this.isRecording && this.activeSessionId) {
        try {
          this.sessionRepository.appendEvent(this.activeSessionId, this.events[0])
        } catch (error) {
          uni.showToast({ title: '告警归档失败，请检查存储空间', icon: 'none' })
        }
      }

      uni.showModal({
        title: kind === 'kick' ? '疑似踢被提醒' : '温度变化提醒',
        content: kind === 'kick' ? '姿态与温度联合规则触发，请查看宝宝状态。' : `检测到体表温度变化（约 ${Number(drop).toFixed(2)}℃），请查看宝宝状态。`,
        showCancel: false
      })
    },

    clearEvents() {
      this.events = []
      this.saveEvents()
      uni.showToast({ title: '已清空', icon: 'none' })
    },

    forceAlarm() {
      this.raiseAlarm(Date.now(), 0.88)
    },

    startSession() {
      try {
        const session = this.sessionRepository.createSession({
          startTs: Date.now(),
          meta: { source: this.isBluetoothConnected ? 'ble' : 'demo' }
        })
        this.activeSessionId = session.id
        this.sessionStartTs = session.startTs
        this.sessionSamples = []
        this.recordedSampleCount = 0
        this.isRecording = true
        this.recordingPaused = false
        uni.showToast({ title: '开始记录', icon: 'none' })
      } catch (error) {
        uni.showToast({ title: '无法创建记录，请检查存储空间', icon: 'none' })
      }
    },

    // Keep a small retryable buffer; chunked persistence avoids whole-night JSON writes.
    flushSessionSamples() {
      if (!this.activeSessionId || !this.sessionSamples.length) return true
      try {
        this.sessionRepository.appendSamples(this.activeSessionId, this.sessionSamples)
        this.sessionSamples = []
        return true
      } catch (error) {
        this.recordingPaused = true
        uni.showToast({ title: '记录暂停，请点击停止重试保存', icon: 'none' })
        return false
      }
    },

    stopSession() {
      if (!this.activeSessionId || !this.flushSessionSamples()) return
      try {
        this.sessionRepository.finalizeSession(this.activeSessionId, { endTs: Date.now() })
        this.isRecording = false
        this.activeSessionId = null
        uni.showToast({ title: '已保存本次记录', icon: 'none' })
      } catch (error) {
        uni.showToast({ title: '保存失败，请释放存储空间后重试', icon: 'none' })
      }
    },

    goHistory() {
      console.log('goHistory clicked')
      uni.navigateTo({
        url: '/pages/history/history',
        fail: (err) => {
          console.error('navigateTo fail:', err)
          uni.showToast({ title: '跳转失败，查看控制台', icon: 'none' })
        }
      })
    }
  }
}
</script>

<style>
</style>