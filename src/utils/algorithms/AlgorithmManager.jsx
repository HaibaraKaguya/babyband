// utils/algorithms/AlgorithmManager.jsx
import BodyFrameReconstructor from './BodyFrameReconstructor.js'
import Quaternion from './Quaternion.js'
import KickDetector from './KickDetector.js'
import TemperatureAnalyzer from './TemperatureAnalyzer.js' 
import DHModel from './DHParameters.js'

/**
 * 算法管理器 - 负责协调所有算法模块，与主界面解耦
 */
export default class AlgorithmManager {
  constructor() {
    this.bodyReconstructor = new BodyFrameReconstructor()
    this.isAligned = false
    this.dhModel = new DHModel()
    this.bodyFrame = {
      X: [1, 0, 0],
      Y: [0, 1, 0],
      Z: [0, 0, 1]
    }

    this.alignmentStatus = {
      isCalibrating: false,
      progress: 0,
      totalSamples: 100,
      collectedSamples: 0
    }

    this.sensorDataHistory = []
    this.maxHistoryLength = 1000

    this.coordinateTransformTests = []
    this.coordinateTransformResults = {
      ankle: { vector: [0, 0, 0], transformed: [0, 0, 0] },
      wrist: { vector: [0, 0, 0], transformed: [0, 0, 0] }
    }

    // 踢被检测器（可传入自定义阈值）
    this.kickDetector = new KickDetector({
    })
	
	// ===== 新增：温度分析器 =====
    this.tempAnalyzer = new TemperatureAnalyzer({
      timeWindow: 3 // 可根据需要调整
    })

    console.log('算法管理器初始化完成')
  }

  /**
   * 处理新的传感器数据（核心方法）
   * @param {Object} sample - 协议解析后的数据样本
   * @returns {Object} 处理结果
   */
  processSensorData(sample) {
    // 1. 存储历史数据（用于回放）
    this.addToHistory(sample)

    // 2. 提取四元数
    const ankleQuat = sample.q2 || [0.9981, 0.0615, 0.0017, 0.0008]
    const wristQuat = sample.q1 || [0.9981, 0.0615, 0.0017, 0.0008]

    // 3. 如果正在进行对齐校准，收集样本
    if (this.alignmentStatus.isCalibrating) {
      this.addCalibrationSample(ankleQuat, wristQuat)
      return {
        type: 'calibration',
        status: this.alignmentStatus
      }
    }

    // 4. 应用对齐校准
    let wristQuatAdjusted = wristQuat
    if (this.isAligned && this.bodyReconstructor.alignmentQuat) {
      const qAlign = Quaternion.fromArray(this.bodyReconstructor.alignmentQuat)
      const qWrist = Quaternion.fromArray(wristQuat)
      wristQuatAdjusted = qAlign.multiply(qWrist).toArray()
    }

    // 5. 反推身体坐标系
    const bodyFrame = this.bodyReconstructor.reconstructBodyFrame(
      ankleQuat,
      wristQuatAdjusted
    )

    // 6. 保存当前身体坐标系
    this.bodyFrame = {
      X: bodyFrame.X,
      Y: bodyFrame.Y,
      Z: bodyFrame.Z
    }

    // 7. 更新DH模型关节角度
    this.dhModel.updateJointAngles(
      {
        ankle: ankleQuat,
        wrist: wristQuatAdjusted,
        waist: sample.q0 || [0.9981, 0.0615, 0.0017, 0.0008]
      },
      this.bodyFrame
    )

    // 8. 更新坐标变换结果
    this.updateCoordinateTransformResults()

    // 9. 验证坐标系有效性
    const validation = this.bodyReconstructor.validateBodyFrame()

    // 10. 获取关节角度和末端位置
    const jointAngles = this.dhModel.getJointAngles()
    const endEffectorPos = this.dhModel.getEndEffectorPositions()

	
    const tempAnalysis = this.tempAnalyzer.analyze({
      timestamp: sample.ts || Date.now(),
      temp1: sample.temp1,
      temp2: sample.temp2,
      temp3: sample.temp3
    })
	
	const kickResult = this.kickDetector.detect({
	  timestamp: sample.ts || Date.now(),
	  hip: jointAngles.hip,
	  knee: jointAngles.knee,
	  temp1: sample.temp1,
	  temp2: sample.temp2,
	  temp3: sample.temp3,
	  tempRate1: tempAnalysis.tempRate1,
	  tempRate2: tempAnalysis.tempRate2,
	  tempRate3: tempAnalysis.tempRate3,
	  tempDiff: tempAnalysis.tempDiff
	});

    return {
      type: 'bodyFrame',
      bodyFrame: bodyFrame,
      validation: validation,
      sensorData: {
        ankle: ankleQuat,
        wrist: wristQuatAdjusted,
        isAligned: this.isAligned
      },
      jointAngles: jointAngles,
      coordinateTransforms: {
        ankle: this.coordinateTransformResults.ankle,
        wrist: this.coordinateTransformResults.wrist
      },
      endEffectorPositions: endEffectorPos,
      kickDetected: kickResult, // ✅ 新增字段
	  temperatureAnalysis: tempAnalysis 
    }
  }

  // 以下所有原有方法保持不变
  updateCoordinateTransformResults() {
    const gravityInSensor = [0, 0, -1]
    const gravityInBodyFromAnkle = this.transformSensorToBody('ankle', gravityInSensor)
    const gravityInBodyFromWrist = this.transformSensorToBody('wrist', gravityInSensor)

    this.coordinateTransformResults.ankle = {
      vector: gravityInSensor,
      transformed: gravityInBodyFromAnkle,
      description: '脚踝传感器重力向量 → 身体坐标系'
    }
    this.coordinateTransformResults.wrist = {
      vector: gravityInSensor,
      transformed: gravityInBodyFromWrist,
      description: '手腕传感器重力向量 → 身体坐标系'
    }
  }

  transformSensorToBody(sensorType, vectorInSensor) {
    return this.bodyReconstructor.transformSensorToBody(sensorType, vectorInSensor)
  }

  transformBodyToSensor(sensorType, vectorInBody) {
    return this.bodyReconstructor.transformBodyToSensor(sensorType, vectorInBody)
  }

  getSensorOrientationInBody(sensorType) {
    return this.bodyReconstructor.getSensorOrientationInBody(sensorType)
  }

  runCoordinateTransformTests() {
    this.coordinateTransformTests = this.bodyReconstructor.validateCoordinateTransform()
    return this.coordinateTransformTests
  }

  testVectorTransform(testVector, description = '测试向量') {
    const results = {
      description,
      original: testVector,
      ankle: {
        toBody: this.transformSensorToBody('ankle', testVector),
        toSensor: this.transformBodyToSensor('ankle', testVector),
        orientation: this.getSensorOrientationInBody('ankle')
      },
      wrist: {
        toBody: this.transformSensorToBody('wrist', testVector),
        toSensor: this.transformBodyToSensor('wrist', testVector),
        orientation: this.getSensorOrientationInBody('wrist')
      }
    }
    return results
  }

  startAlignmentCalibration() {
    this.alignmentStatus = {
      isCalibrating: true,
      progress: 0,
      totalSamples: 100,
      collectedSamples: 0
    }
    console.log('开始对齐校准，需要采集100个样本...')
  }

  addCalibrationSample(ankleQuat, wristQuat) {
    if (!this.alignmentStatus.isCalibrating) return
    this.alignmentStatus.collectedSamples++
    this.alignmentStatus.progress =
      (this.alignmentStatus.collectedSamples / this.alignmentStatus.totalSamples) * 100
    if (this.alignmentStatus.collectedSamples >= this.alignmentStatus.totalSamples) {
      this.finishAlignmentCalibration(ankleQuat, wristQuat)
    }
  }

  finishAlignmentCalibration(ankleQuat, wristQuat) {
    const qAnkle = Quaternion.fromArray(ankleQuat)
    const qWrist = Quaternion.fromArray(wristQuat)
    const qAlignment = qAnkle.conjugate().multiply(qWrist)
    this.bodyReconstructor.alignmentQuat = qAlignment.toArray()
    this.isAligned = true
    this.alignmentStatus.isCalibrating = false
    this.alignmentStatus.progress = 100
    console.log('对齐校准完成，对齐四元数:', qAlignment.toArray())
    this.saveAlignmentToStorage()
  }

  saveAlignmentToStorage() {
    try {
      const alignmentKey = 'baby_band_alignment_v1'
      const alignmentData = {
        alignmentQuat: this.bodyReconstructor.alignmentQuat,
        calibratedAt: Date.now()
      }
      uni.setStorageSync(alignmentKey, JSON.stringify(alignmentData))
      console.log('对齐数据已保存到本地存储')
    } catch (e) {
      console.error('保存对齐数据失败:', e)
    }
  }

  loadAlignmentFromStorage() {
    try {
      const alignmentKey = 'baby_band_alignment_v1'
      const stored = uni.getStorageSync(alignmentKey)
      if (stored) {
        const data = JSON.parse(stored)
        this.bodyReconstructor.alignmentQuat = data.alignmentQuat
        this.isAligned = true
        console.log('从本地存储加载对齐数据成功')
      }
    } catch (e) {
      console.error('加载对齐数据失败:', e)
    }
  }

  resetAlignment() {
    this.bodyReconstructor.alignmentQuat = null
    this.isAligned = false
    this.alignmentStatus.isCalibrating = false
    this.alignmentStatus.progress = 0
    this.alignmentStatus.collectedSamples = 0
    try {
      uni.removeStorageSync('baby_band_alignment_v1')
    } catch (e) {
      console.error('清除存储失败:', e)
    }
    console.log('对齐校准已重置')
  }

  addToHistory(sample) {
    const timestamp = Date.now()
    this.sensorDataHistory.push({
      timestamp,
      sample,
      bodyFrame: { ...this.bodyFrame }
    })
    if (this.sensorDataHistory.length > this.maxHistoryLength) {
      this.sensorDataHistory.shift()
    }
  }

  getHistoryData(startTime, endTime) {
    return this.sensorDataHistory.filter(item =>
      item.timestamp >= startTime && item.timestamp <= endTime
    )
  }

  getCurrentBodyFrame() {
    return this.bodyFrame
  }

  getAlignmentStatus() {
    return {
      isAligned: this.isAligned,
      ...this.alignmentStatus
    }
  }

  getJointAngles() {
    return this.dhModel.getJointAngles()
  }

  getEndEffectorPositions() {
    return this.dhModel.getEndEffectorPositions()
  }
}