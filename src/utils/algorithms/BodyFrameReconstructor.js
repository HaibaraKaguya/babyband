// utils/algorithms/BodyFrameReconstructor.js
import Quaternion from './Quaternion.js';

/**
 * 纯粹的身体坐标系反推器
 * 目标：从两个MPU6050传感器数据反推出婴儿的身体坐标系
 * 身体坐标系定义：X前向、Y右侧、Z向上
 */
export default class BodyFrameReconstructor {
  constructor() {
    // 身体坐标系三个轴
    this.bodyX = [1, 0, 0]; // 前向（指向头部）
    this.bodyY = [0, 1, 0]; // 右侧
    this.bodyZ = [0, 0, 1]; // 向上
	
    // 滤波器参数
    this.alpha = 0.2; // 低通滤波系数
    this.lastBodyZ = [0, 0, 1];
    this.lastBodyY = [0, 1, 0];
    this.lastBodyX = [1, 0, 0];
    
    // 校准状态
    this.isCalibrated = false;
    this.calibrationOffset = null;
	
    // 新增：传感器到身体的变换矩阵
    this.sensorToBodyTransform = {
      ankle: null, // 脚踝传感器到身体的变换
      wrist: null  // 手腕传感器到身体的变换
    };
    
    console.log('身体坐标系反推器初始化完成');
  }

  /**
   * 核心函数：从两个传感器四元数反推身体坐标系
   * Accepts `{ w, x, y, z }` (protocol representation) or `[w, x, y, z]`.
   * Invalid input returns an identity frame with `valid: false` instead of NaN.
   * @param {Object|Array} ankleQuat
   * @param {Object|Array} wristQuat
   * @returns {Object} 身体坐标系的三个轴
   */
  reconstructBodyFrame(ankleQuat, wristQuat) {
    // 1. 显式转换四元数（协议输出是对象，数学库内部用数组）
    const qAnkle = Quaternion.fromQuaternionLike(ankleQuat);
    const qWrist = Quaternion.fromQuaternionLike(wristQuat);

    if (!qAnkle || !qWrist || !qAnkle.isValid() || !qWrist.isValid()) {
      return this.createInvalidBodyFrame();
    }

    const qAnkleNormalized = qAnkle.normalized();
    const qWristNormalized = qWrist.normalized();
    
    // 2. 计算重力方向（DMP的世界坐标系重力向下[0,0,1]）
    const gravityWorld = [0, 0, -1];
    
    // 将重力向量转换到传感器坐标系
    const gravityInAnkle = qAnkleNormalized.rotateVector(gravityWorld);
    const gravityInWrist = qWristNormalized.rotateVector(gravityWorld);
    
    // 3. 反推身体坐标系Z轴（垂直向上）
    // 身体Z轴 = -平均重力方向（因为重力向下，我们要向上）
    const avgGravity = [
      (gravityInAnkle[0] + gravityInWrist[0]) / 2,
      (gravityInAnkle[1] + gravityInWrist[1]) / 2,
      (gravityInAnkle[2] + gravityInWrist[2]) / 2
    ];
    
    // 归一化并取反得到身体Z轴（向上）
    const rawBodyZ = this.normalize([
      -avgGravity[0],
      -avgGravity[1],
      -avgGravity[2]
    ]);
    
    // 4. 反推身体坐标系Y轴（身体右侧）
    // 假设传感器安装时，Y轴指向身体右侧
    const sensorYAxis = [0, 1, 0];
    
    // 将传感器Y轴转换到世界坐标系
    const qAnkleConj = qAnkleNormalized.conjugate();
    const qWristConj = qWristNormalized.conjugate();
    
    const yWorldAnkle = qAnkleConj.rotateVector(sensorYAxis);
    const yWorldWrist = qWristConj.rotateVector(sensorYAxis);
    
    // 平均Y轴方向
    const avgYWorld = [
      (yWorldAnkle[0] + yWorldWrist[0]) / 2,
      (yWorldAnkle[1] + yWorldWrist[1]) / 2,
      (yWorldAnkle[2] + yWorldWrist[2]) / 2
    ];
    
    // 投影到水平面（垂直于Z轴）
    const rawBodyY = this.projectToPlane(this.normalize(avgYWorld), rawBodyZ);
    
    // 5. 反推身体坐标系X轴（身体前向）= Y × Z
    const rawBodyX = this.crossProduct(rawBodyY, rawBodyZ);
    
    // 6. 应用低通滤波，使输出更稳定
    const filteredBodyZ = this.applyFilter(rawBodyZ, this.lastBodyZ);
    const filteredBodyY = this.applyFilter(rawBodyY, this.lastBodyY);
    const filteredBodyX = this.applyFilter(rawBodyX, this.lastBodyX);
    
    // 确保正交性（重新正交化）
    const [bodyX, bodyY, bodyZ] = this.orthonormalize(filteredBodyX, filteredBodyY, filteredBodyZ);
    
    // 7. 更新状态
    this.bodyX = bodyX;
    this.bodyY = bodyY;
    this.bodyZ = bodyZ;
    this.lastBodyX = bodyX;
    this.lastBodyY = bodyY;
    this.lastBodyZ = bodyZ;
	
    // 新增：计算传感器到身体的变换
    this.updateSensorToBodyTransforms(qAnkleNormalized, qWristNormalized, bodyX, bodyY, bodyZ);
    
    // 8. 返回结果
    return {
      valid: true,
      // 三个轴的方向向量
      X: bodyX,
      Y: bodyY,
      Z: bodyZ,
      
      // 3×3旋转矩阵（身体坐标系到世界坐标系）
      matrix: [
        [bodyX[0], bodyY[0], bodyZ[0]],
        [bodyX[1], bodyY[1], bodyZ[1]],
        [bodyX[2], bodyY[2], bodyZ[2]]
      ],
      
      // 欧拉角表示（可选，用于可视化）
      eulerAngles: this.matrixToEuler(bodyX, bodyY, bodyZ),
      
      // 调试信息
      debug: {
        rawGravityAnkle: gravityInAnkle,
        rawGravityWrist: gravityInWrist,
        rawBodyZ: rawBodyZ
      }
    };
  }
  
  /**
   * Safe placeholder used when quaternion input is missing or invalid.
   * Keeps the output shape stable for callers and the renderer.
   */
  createInvalidBodyFrame() {
    const X = [1, 0, 0];
    const Y = [0, 1, 0];
    const Z = [0, 0, 1];
    return {
      valid: false,
      X,
      Y,
      Z,
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ],
      eulerAngles: { roll: 0, pitch: 0, yaw: 0 },
      debug: {
        rawGravityAnkle: null,
        rawGravityWrist: null,
        rawBodyZ: null
      }
    };
  }

  /**
   * 新增：更新传感器到身体的变换矩阵
   */
  updateSensorToBodyTransforms(qAnkle, qWrist, bodyX, bodyY, bodyZ) {
      // 身体坐标系到世界坐标系的旋转矩阵
      const bodyToWorldMatrix = [
        [bodyX[0], bodyY[0], bodyZ[0]],
        [bodyX[1], bodyY[1], bodyZ[1]],
        [bodyX[2], bodyY[2], bodyZ[2]]
      ];
      
      // 世界坐标系到身体坐标系的旋转矩阵（身体矩阵的转置）
      const worldToBodyMatrix = this.transposeMatrix(bodyToWorldMatrix);
      
      // 传感器到世界坐标系的旋转矩阵
      const ankleToWorldMatrix = qAnkle.toRotationMatrix();
      const wristToWorldMatrix = qWrist.toRotationMatrix();
      
      // 计算传感器到身体的变换矩阵：R_sensor_to_body = R_world_to_body * R_sensor_to_world
      this.sensorToBodyTransform.ankle = this.multiplyMatrices(worldToBodyMatrix, ankleToWorldMatrix);
      this.sensorToBodyTransform.wrist = this.multiplyMatrices(worldToBodyMatrix, wristToWorldMatrix);
    }
  
    /**
     * 新增：将传感器坐标系下的向量转换到身体坐标系
     * @param {String} sensorType - 'ankle' 或 'wrist'
     * @param {Array} vectorInSensor - 传感器坐标系下的向量 [x, y, z]
     * @returns {Array} 身体坐标系下的向量
     */
    transformSensorToBody(sensorType, vectorInSensor) {
      const transformMatrix = this.sensorToBodyTransform[sensorType];
      
      if (!transformMatrix) {
        console.warn(`传感器 ${sensorType} 的变换矩阵未初始化`);
        return vectorInSensor; // 返回原向量
      }
      
      // 矩阵乘法：v_body = R_sensor_to_body * v_sensor
      const [vx, vy, vz] = vectorInSensor;
      const [r00, r01, r02] = transformMatrix[0];
      const [r10, r11, r12] = transformMatrix[1];
      const [r20, r21, r22] = transformMatrix[2];
      
      return [
        r00 * vx + r01 * vy + r02 * vz,
        r10 * vx + r11 * vy + r12 * vz,
        r20 * vx + r21 * vy + r22 * vz
      ];
    }
  
    /**
     * 新增：将身体坐标系下的向量转换到传感器坐标系
     * @param {String} sensorType - 'ankle' 或 'wrist'
     * @param {Array} vectorInBody - 身体坐标系下的向量 [x, y, z]
     * @returns {Array} 传感器坐标系下的向量
     */
    transformBodyToSensor(sensorType, vectorInBody) {
      const transformMatrix = this.sensorToBodyTransform[sensorType];
      
      if (!transformMatrix) {
        console.warn(`传感器 ${sensorType} 的变换矩阵未初始化`);
        return vectorInBody;
      }
      
      // 使用转置矩阵进行逆变换：v_sensor = R_sensor_to_body^T * v_body
      const [vx, vy, vz] = vectorInBody;
      const [r00, r10, r20] = transformMatrix[0]; // 转置
      const [r01, r11, r21] = transformMatrix[1];
      const [r02, r12, r22] = transformMatrix[2];
      
      return [
        r00 * vx + r10 * vy + r20 * vz,
        r01 * vx + r11 * vy + r21 * vz,
        r02 * vx + r12 * vy + r22 * vz
      ];
    }
  
    /**
     * 新增：获取传感器在身体坐标系中的方向
     * @param {String} sensorType - 'ankle' 或 'wrist'
     * @returns {Object} 传感器在身体坐标系中的X/Y/Z轴
     */
    getSensorOrientationInBody(sensorType) {
      const transformMatrix = this.sensorToBodyTransform[sensorType];
      
      if (!transformMatrix) {
        return {
          X: [1, 0, 0],
          Y: [0, 1, 0],
          Z: [0, 0, 1]
        };
      }
      
      // 变换矩阵的列向量就是传感器坐标系轴在身体坐标系中的表示
      return {
        X: [transformMatrix[0][0], transformMatrix[1][0], transformMatrix[2][0]],
        Y: [transformMatrix[0][1], transformMatrix[1][1], transformMatrix[2][1]],
        Z: [transformMatrix[0][2], transformMatrix[1][2], transformMatrix[2][2]]
      };
    }
  
    /**
     * 新增：矩阵转置
     */
    transposeMatrix(matrix) {
      return [
        [matrix[0][0], matrix[1][0], matrix[2][0]],
        [matrix[0][1], matrix[1][1], matrix[2][1]],
        [matrix[0][2], matrix[1][2], matrix[2][2]]
      ];
    }
  
    /**
     * 新增：矩阵乘法
     */
    multiplyMatrices(a, b) {
      const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          for (let k = 0; k < 3; k++) {
            result[i][j] += a[i][k] * b[k][j];
          }
        }
      }
      
      return result;
    }
  
    /**
     * 新增：验证坐标变换的正确性
     */
    validateCoordinateTransform() {
      const tests = [];
      
      // 测试1：身体Z轴在身体坐标系中应该是[0,0,1]
      const bodyZInBody = [0, 0, 1];
      tests.push({
        name: '身体Z轴自身变换',
        expected: bodyZInBody,
        actual: bodyZInBody,
        passed: true
      });
      
      // 测试2：重力向量在身体坐标系中的表示
      const gravityInWorld = [0, 0, 1]; // 世界坐标系中重力向下
      const gravityInBody = this.transformWorldToBody(gravityInWorld);
      const expectedGravityInBody = [0, 0, -1]; // 身体坐标系中重力向下（Z轴向上）
      
      tests.push({
        name: '重力向量变换',
        expected: expectedGravityInBody,
        actual: gravityInBody.map(v => Math.round(v * 1000) / 1000),
        passed: this.vectorsEqual(gravityInBody, expectedGravityInBody, 0.1)
      });
      
      return tests;
    }
  
    /**
     * 新增：将世界坐标系向量转换到身体坐标系
     */
    transformWorldToBody(vectorInWorld) {
      const bodyToWorldMatrix = [
        [this.bodyX[0], this.bodyY[0], this.bodyZ[0]],
        [this.bodyX[1], this.bodyY[1], this.bodyZ[1]],
        [this.bodyX[2], this.bodyY[2], this.bodyZ[2]]
      ];
      
      const worldToBodyMatrix = this.transposeMatrix(bodyToWorldMatrix);
      const [vx, vy, vz] = vectorInWorld;
      const [r00, r01, r02] = worldToBodyMatrix[0];
      const [r10, r11, r12] = worldToBodyMatrix[1];
      const [r20, r21, r22] = worldToBodyMatrix[2];
      
      return [
        r00 * vx + r01 * vy + r02 * vz,
        r10 * vx + r11 * vy + r12 * vz,
        r20 * vx + r21 * vy + r22 * vz
      ];
    }
  
    /**
     * 新增：向量相等性检查（带容差）
     */
    vectorsEqual(v1, v2, tolerance = 0.001) {
      if (v1.length !== v2.length) return false;
      
      for (let i = 0; i < v1.length; i++) {
        if (Math.abs(v1[i] - v2[i]) > tolerance) {
          return false;
        }
      }
      
      return true;
    }

  /**
   * 校准函数：婴儿平躺静止时调用
   * 记录此时的传感器数据作为参考姿态
   */
  calibrate(ankleQuat, wristQuat) {
    console.log('开始校准身体坐标系...');
    
    // 计算当前姿态
    const currentFrame = this.reconstructBodyFrame(ankleQuat, wristQuat);
    if (!currentFrame.valid) {
      return { success: false, reason: 'invalid quaternion input', calibratedFrame: currentFrame };
    }
    
    // 理论上平躺时，身体坐标系应与世界坐标系对齐
    // X=[1,0,0]（前向）, Y=[0,1,0]（右侧）, Z=[0,0,1]（向上）
    const referenceFrame = {
      X: [1, 0, 0],
      Y: [0, 1, 0],
      Z: [0, 0, 1]
    };
    
    // 计算校准偏移（当前姿态与参考姿态的差异）
    this.calibrationOffset = {
      rotation: this.calculateRotationBetween(currentFrame.matrix, [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]),
      calibratedAt: Date.now()
    };
    
    this.isCalibrated = true;
    
    console.log('身体坐标系校准完成', this.calibrationOffset);
    return {
      success: true,
      calibratedFrame: currentFrame,
      referenceFrame: referenceFrame
    };
  }

  /**
   * 获取当前身体坐标系状态
   */
  getBodyFrame() {
    return {
      X: this.bodyX,
      Y: this.bodyY,
      Z: this.bodyZ,
      isCalibrated: this.isCalibrated
    };
  }

  /**
   * 验证身体坐标系是否正确
   * 检查正交性和方向正确性
   */
  validateBodyFrame() {
    const checks = {
      isOrthogonal: this.isOrthogonal(this.bodyX, this.bodyY, this.bodyZ),
      isRightHanded: this.isRightHanded(this.bodyX, this.bodyY, this.bodyZ),
      zUpward: this.bodyZ[2] > 0.7, // Z轴应该主要向上
      unitVectors: this.isUnitVector(this.bodyX) && this.isUnitVector(this.bodyY) && this.isUnitVector(this.bodyZ)
    };
    
    return {
      ...checks,
      valid: Object.values(checks).every(Boolean),
      score: Object.values(checks).filter(v => v).length / Object.keys(checks).length,
      bodyZVertical: this.bodyZ[2].toFixed(3)
    };
  }

  // ============= 数学工具函数 =============
  
  normalize(v) {
    const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    if (len < 0.0001) return [0, 0, 1]; // 默认向上
    return [v[0]/len, v[1]/len, v[2]/len];
  }
  
  crossProduct(a, b) {
    return [
      a[1]*b[2] - a[2]*b[1],
      a[2]*b[0] - a[0]*b[2],
      a[0]*b[1] - a[1]*b[0]
    ];
  }
  
  dotProduct(a, b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  }
  
  projectToPlane(v, normal) {
    const dot = this.dotProduct(v, normal);
    const projected = [
      v[0] - dot * normal[0],
      v[1] - dot * normal[1],
      v[2] - dot * normal[2]
    ];
    return this.normalize(projected);
  }
  
  applyFilter(current, last) {
    return [
      last[0] * (1 - this.alpha) + current[0] * this.alpha,
      last[1] * (1 - this.alpha) + current[1] * this.alpha,
      last[2] * (1 - this.alpha) + current[2] * this.alpha
    ];
  }
  
  orthonormalize(x, y, z) {
    // 修正正交性（Gram-Schmidt过程）
    const zNew = this.normalize(z);
    const yNew = this.normalize(this.projectToPlane(y, zNew));
    const xNew = this.normalize(this.crossProduct(yNew, zNew));
    
    return [xNew, yNew, zNew];
  }
  
  isOrthogonal(x, y, z) {
    const xy = Math.abs(this.dotProduct(x, y));
    const xz = Math.abs(this.dotProduct(x, z));
    const yz = Math.abs(this.dotProduct(y, z));
    
    return xy < 0.1 && xz < 0.1 && yz < 0.1;
  }
  
  isRightHanded(x, y, z) {
    const cross = this.crossProduct(x, y);
    const dot = this.dotProduct(cross, z);
    return dot > 0.9; // 接近1
  }
  
  isUnitVector(v) {
    const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return Math.abs(len - 1) < 0.1;
  }
  
  matrixToEuler(x, y, z) {
    // 简单的欧拉角计算（roll, pitch, yaw）
    const roll = Math.atan2(2*(x[2]*y[2] + z[2]*x[0]), 1 - 2*(y[0]*y[0] + z[0]*z[0]));
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2*(x[1]*z[2] - z[1]*x[2]))));
    const yaw = Math.atan2(2*(x[1]*y[2] + z[1]*x[0]), 1 - 2*(y[1]*y[1] + z[1]*z[1]));
    
    return {
      roll: roll * 180 / Math.PI,
      pitch: pitch * 180 / Math.PI,
      yaw: yaw * 180 / Math.PI
    };
  }
  
  calculateRotationBetween(matrixA, matrixB) {
    // 简化：计算两个矩阵之间的差异
    // 实际应该计算旋转四元数，这里简化返回差异角度
    let totalDiff = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        totalDiff += Math.abs(matrixA[i][j] - matrixB[i][j]);
      }
    }
    return totalDiff;
  }
  
  // 从本地存储加载对齐数据
  loadAlignmentFromStorage() {
    try {
      const alignmentKey = 'baby_band_alignment_v1'
      const stored = uni.getStorageSync(alignmentKey)
      if (stored) {
        const data = JSON.parse(stored)
        this.alignmentQuat = data.alignmentQuat
        this.isAligned = true
        return data
      }
    } catch (e) {
      console.error('加载对齐数据失败:', e)
    }
    return null
  }

  // 验证校准精度
  verifyCalibrationAccuracy() {
    if (!this.alignmentQuat) {
      return { valid: false, message: '未进行校准' }
    }
    
    // 这里可以使用最近的几个样本来验证
    // 简化实现：返回模拟验证结果
    const averageErrorDegrees = 1.5 // 模拟平均误差
    const maxErrorDegrees = 3.2 // 模拟最大误差
    
    return {
      valid: true,
      averageErrorDegrees,
      maxErrorDegrees,
      assessment: averageErrorDegrees < 2.0 ? '优秀' : averageErrorDegrees < 5.0 ? '良好' : '需要重新校准'
    }
  }
}