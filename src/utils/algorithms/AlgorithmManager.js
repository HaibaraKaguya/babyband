// utils/algorithms/AlgorithmManager.js
import BodyFrameReconstructor from './BodyFrameReconstructor.js'
import Quaternion from './Quaternion.js'
import KickDetector from './KickDetector.js'
import TemperatureAnalyzer from './TemperatureAnalyzer.js'
import DHModel from './DHParameters.js'
import { buildPoseFrame } from '../poseFrame.js'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeTimestamp(sample) {
  return isFiniteNumber(sample && sample.ts) ? sample.ts : Date.now()
}

function invalidValidation(reason) {
  return {
    valid: false,
    reason,
    isOrthogonal: false,
    isRightHanded: false,
    zUpward: false,
    unitVectors: false,
    score: 0,
    bodyZVertical: '0.000'
  }
}

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

    // ===== 温度分析器 =====
    this.tempAnalyzer = new TemperatureAnalyzer({
      timeWindow: 3 // 可根据需要调整
    })

    console.log('算法管理器初始化完成')
  }

  /**
   * 处理新的传感器数据（核心方法）
   *
   * Output shape is stable for parent/page integration. When attitude or
   * temperature flags are invalid the corresponding computation is skipped
   * (never fed NaN) and the result says so explicitly.
   *
   * @param {Object} sample - 协议解析后的数据样本（q0/q1/q2 为 {w,x,y,z}）
   * @returns {Object} 处理结果
   */
  processSensorData(sample) {
    const source = sample && typeof sample === 'object' ? sample : {}
    const timestamp = safeTimestamp(source)

    // 1. 存储历史数据（用于回放）
    this.addToHistory(source)

    // 2. 提取四元数：协议公开表示是 {w,x,y,z}，数学层显式转数组
    const q0 = Quaternion.fromQuaternionLike(source.q0)
    const q1 = Quaternion.fromQuaternionLike(source.q1)
    const q2 = Quaternion.fromQuaternionLike(source.q2)
    const quatsValid = !!(q0 && q1 && q2 && q0.isValid() && q1.isValid() && q2.isValid())
    const attitudeValid = source.attitudeValid !== false && quatsValid

    const identity = new Quaternion().toObject()
    const waistObject = q0 ? q0.toObject() : identity
    const wristObject = q1 ? q1.toObject() : identity
    const ankleObject = q2 ? q2.toObject() : identity

    const poseFrame = buildPoseFrame({
      ts: timestamp,
      q0: q0 ? waistObject : null,
      q1: q1 ? wristObject : null,
      q2: q2 ? ankleObject : null,
      attitudeValid
    }, { now: timestamp })

    // 3. 如果正在进行对齐校准，收集样本
    if (this.alignmentStatus.isCalibrating) {
      if (attitudeValid) this.addCalibrationSample(ankleObject, wristObject)
      return {
        type: 'calibration',
        valid: attitudeValid,
        attitudeValid,
        tempValid: source.tempValid !== false,
        poseFrame,
        status: { ...this.alignmentStatus }
      }
    }

    // 4. 应用对齐校准（仅在姿态有效时）
    let wristQuatAdjusted = wristObject
    if (attitudeValid && this.isAligned && this.bodyReconstructor.alignmentQuat) {
      const qAlign = Quaternion.fromQuaternionLike(this.bodyReconstructor.alignmentQuat)
      const qWrist = Quaternion.fromQuaternionLike(wristObject)
      if (qAlign && qAlign.isValid() && qWrist) {
        wristQuatAdjusted = qAlign.multiply(qWrist).normalized().toObject()
      }
    }

    // 5. 反推身体坐标系
    const bodyFrame = attitudeValid
      ? this.bodyReconstructor.reconstructBodyFrame(ankleObject, wristQuatAdjusted)
      : this.bodyReconstructor.createInvalidBodyFrame()

    // 6. 保存当前身体坐标系
    this.bodyFrame = {
      X: bodyFrame.X,
      Y: bodyFrame.Y,
      Z: bodyFrame.Z
    }

    // 7. 更新DH模型关节角度
    let jointAngles = null
    let endEffectorPositions = null
    let validation
    if (attitudeValid) {
      this.dhModel.updateJointAngles(
        {
          ankle: ankleObject,
          wrist: wristQuatAdjusted,
          waist: waistObject
        },
        this.bodyFrame
      )
      jointAngles = this.dhModel.getJointAngles()
      endEffectorPositions = this.dhModel.getEndEffectorPositions()
      this.updateCoordinateTransformResults()
      validation = this.bodyReconstructor.validateBodyFrame()
    } else {
      // 不把占位的单位四元数当成真实姿态
      validation = invalidValidation(
        source.attitudeValid === false ? 'attitude flag invalid' : 'invalid quaternion'
      )
    }

    // 8. 温度分析（分析器自身也会拒绝无效标志/非有限值）
    const temperatureAnalysis = this.tempAnalyzer.analyze({
      timestamp,
      temp1: source.temp1,
      temp2: source.temp2,
      temp3: source.temp3,
      tempValid: source.tempValid !== false
    })

    // 9. 踢被检测：姿态或温度无效时跳过，避免 NaN 比较产生假报警
    let kickResult
    if (attitudeValid && temperatureAnalysis.valid && jointAngles) {
      kickResult = this.kickDetector.detect({
        timestamp,
        hip: jointAngles.hip,
        knee: jointAngles.knee,
        temp1: source.temp1,
        temp2: source.temp2,
        temp3: source.temp3,
        tempRate1: temperatureAnalysis.tempRate1,
        tempRate2: temperatureAnalysis.tempRate2,
        tempRate3: temperatureAnalysis.tempRate3,
        tempDiff: temperatureAnalysis.tempDiff,
        tempValid: source.tempValid !== false,
        attitudeValid
      })
    } else {
      kickResult = {
        detected: false,
        skipped: true,
        reason: !attitudeValid
          ? 'attitude invalid'
          : (!temperatureAnalysis.valid ? 'temperature invalid' : 'analysis unavailable')
      }
    }

    return {
      type: 'bodyFrame',
      valid: attitudeValid,
      attitudeValid,
      tempValid: temperatureAnalysis.valid,
      poseFrame,
      bodyFrame: bodyFrame,
      validation: validation,
      sensorData: {
        ankle: ankleObject,
        wrist: wristQuatAdjusted,
        isAligned: this.isAligned
      },
      jointAngles: jointAngles,
      coordinateTransforms: {
        ankle: this.coordinateTransformResults.ankle,
        wrist: this.coordinateTransformResults.wrist
      },
      endEffectorPositions: endEffectorPositions,
      kickDetected: kickResult,
      temperatureAnalysis: temperatureAnalysis
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
    if (!Quaternion.fromQuaternionLike(ankleQuat) || !Quaternion.fromQuaternionLike(wristQuat)) return
    this.alignmentStatus.collectedSamples++
    this.alignmentStatus.progress =
      (this.alignmentStatus.collectedSamples / this.alignmentStatus.totalSamples) * 100
    if (this.alignmentStatus.collectedSamples >= this.alignmentStatus.totalSamples) {
      this.finishAlignmentCalibration(ankleQuat, wristQuat)
    }
  }

  finishAlignmentCalibration(ankleQuat, wristQuat) {
    const qAnkle = Quaternion.fromQuaternionLike(ankleQuat)
    const qWrist = Quaternion.fromQuaternionLike(wristQuat)
    if (!qAnkle || !qWrist || !qAnkle.isValid() || !qWrist.isValid()) {
      return false
    }
    const qAlignment = qAnkle.conjugate().multiply(qWrist).normalized()
    this.bodyReconstructor.alignmentQuat = qAlignment.toArray()
    this.isAligned = true
    this.alignmentStatus.isCalibrating = false
    this.alignmentStatus.progress = 100
    console.log('对齐校准完成，对齐四元数:', qAlignment.toArray())
    this.saveAlignmentToStorage()
    return true
  }

  saveAlignmentToStorage() {
    if (typeof uni === 'undefined') return
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
    if (typeof uni === 'undefined') return
    try {
      const alignmentKey = 'baby_band_alignment_v1'
      const stored = uni.getStorageSync(alignmentKey)
      if (stored) {
        const data = JSON.parse(stored)
        const qAlignment = Quaternion.fromQuaternionLike(data.alignmentQuat)
        if (!qAlignment || !qAlignment.isValid()) {
          console.warn('本地对齐数据无效，已忽略')
          return
        }
        this.bodyReconstructor.alignmentQuat = qAlignment.toArray()
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
    if (typeof uni === 'undefined') return
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
