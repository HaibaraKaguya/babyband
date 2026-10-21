// utils/algorithms/DHParameters.js
import Quaternion from './Quaternion.js';

/**
 * DH运动学模型 - 针对婴儿身体关节（腰、手腕、脚踝）
 * DH参数：[a, α, d, θ]
 * a: 连杆长度, α: 连杆扭转角, d: 连杆偏移, θ: 关节角
 */
export default class DHModel {
  constructor() {
    // DH参数定义（单位：长度m，角度rad）
    this.dhParams = {
      waistToThigh: { a: 0.1, alpha: 0, d: 0, theta: 0 },   // 腰→大腿（髋关节）
      thighToAnkle: { a: 0.2, alpha: 0, d: 0, theta: 0 },   // 大腿→脚踝（膝关节）
      waistToArm:   { a: 0.1, alpha: 0, d: 0, theta: 0 },   // 腰→上臂（肩关节）
      armToWrist:   { a: 0.15, alpha: 0, d: 0, theta: 0 }   // 上臂→手腕（肘关节）
    };

    // 关节角度缓存（最终输出：单位°）
    this.jointAngles = {
      hip: 0,      // 髋关节（腰-大腿）
      knee: 0,     // 膝关节（大腿-脚踝）
      shoulder: 0, // 肩关节（腰-手臂）  
      elbow: 0,    // 肘关节（手臂-手腕）
      ankle: { roll: 0, pitch: 0, yaw: 0 }, // 脚踝三轴角度
      wrist: { roll: 0, pitch: 0, yaw: 0 }  // 手腕三轴角度
    };

    // 缓存末端位置（可选）
    this.lastEndEffector = { anklePos: [0,0,0], wristPos: [0,0,0] };
  }

  /**
   * 计算DH变换矩阵
   * @param {Object} params - DH参数 {a, alpha, d, theta}
   * @returns {Array} 4x4齐次变换矩阵
   */
  computeDHMatrix(params) {
    const { a, alpha, d, theta } = params;
    const cosθ = Math.cos(theta);
    const sinθ = Math.sin(theta);
    const cosα = Math.cos(alpha);
    const sinα = Math.sin(alpha);

    // DH齐次变换矩阵公式
    return [
      [cosθ, -sinθ * cosα, sinθ * sinα, a * cosθ],
      [sinθ, cosθ * cosα, -cosθ * sinα, a * sinθ],
      [0, sinα, cosα, d],
      [0, 0, 0, 1]
    ];
  }

  /**
   * 4x4矩阵乘法（A * B）
   */
  multiplyMatrices4x4(A, B) {
    const C = [
      [0,0,0,0],
      [0,0,0,0],
      [0,0,0,0],
      [0,0,0,0]
    ];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j] + A[i][3] * B[3][j];
      }
    }
    return C;
  }

  /**
   * 正运动学：基于当前关节角度计算末端位置
   * @returns {Object} { anklePos, wristPos } 身体坐标系下的位置 [x,y,z]
   */
  forwardKinematics() {
    // 下肢链：腰部 → 髋关节 → 膝关节 → 脚踝
    const T_hip = this.computeDHMatrix(this.dhParams.waistToThigh);   // 腰→大腿（髋）
    const T_knee = this.computeDHMatrix(this.dhParams.thighToAnkle);  // 大腿→小腿（膝）
    const T_waist_to_ankle = this.multiplyMatrices4x4(T_hip, T_knee);
    const anklePos = [
      T_waist_to_ankle[0][3],
      T_waist_to_ankle[1][3],
      T_waist_to_ankle[2][3]
    ];

    // 上肢链：腰部 → 肩关节 → 肘关节 → 手腕
    const T_shoulder = this.computeDHMatrix(this.dhParams.waistToArm);   // 腰→上臂（肩）
    const T_elbow = this.computeDHMatrix(this.dhParams.armToWrist);      // 上臂→前臂（肘）
    const T_waist_to_wrist = this.multiplyMatrices4x4(T_shoulder, T_elbow);
    const wristPos = [
      T_waist_to_wrist[0][3],
      T_waist_to_wrist[1][3],
      T_waist_to_wrist[2][3]
    ];

    this.lastEndEffector = { anklePos, wristPos };
    return { anklePos, wristPos };
  }

  /**
   * 获取末端位置（调用正运动学）
   */
  getEndEffectorPositions() {
    return this.forwardKinematics();
  }

  /**
   * 从四元数提取关节欧拉角（roll/pitch/yaw，单位°）
   * @param {Array} quat - 四元数 [qw, qx, qy, qz]
   * @returns {Object} {roll, pitch, yaw}
   */
  extractEulerAnglesFromQuat(quat) {
    const q = Quaternion.fromArray(quat);
    const euler = q.toEulerAngles(); // 需给Quaternion类扩展toEulerAngles方法
    return {
      roll: euler.roll * 180 / Math.PI,
      pitch: euler.pitch * 180 / Math.PI,
      yaw: euler.yaw * 180 / Math.PI
    };
  }

  /**
   * 基于传感器数据更新关节角度
   * @param {Object} sensorData - 传感器四元数 {ankle, wrist, waist}
   * @param {Object} bodyFrame - 身体坐标系 {X, Y, Z}
   */
  updateJointAngles(sensorData, bodyFrame) {
    // 1. 提取脚踝/手腕的三轴角度（直接从传感器四元数转换）
    this.jointAngles.ankle = this.extractEulerAnglesFromQuat(sensorData.ankle);
    this.jointAngles.wrist = this.extractEulerAnglesFromQuat(sensorData.wrist);

    // 2. 计算关节角（基于DH模型，结合身体坐标系）
    // 髋关节角度：腰->大腿的θ（简化：基于身体Z轴与大腿方向的夹角）
    const waistToAnkleDir = this.calculateVectorFromBodyFrame(bodyFrame, 'waistToAnkle');
    this.dhParams.waistToThigh.theta = this.calculateJointAngle(waistToAnkleDir, 'hip');
    this.jointAngles.hip = this.dhParams.waistToThigh.theta * 180 / Math.PI;

    // 膝关节角度：大腿->脚踝的θ
    this.dhParams.thighToAnkle.theta = this.calculateKneeAngle(sensorData.ankle, bodyFrame);
    this.jointAngles.knee = this.dhParams.thighToAnkle.theta * 180 / Math.PI;

    // 肩关节角度：腰->手臂的θ
    const waistToWristDir = this.calculateVectorFromBodyFrame(bodyFrame, 'waistToWrist');
    this.dhParams.waistToArm.theta = this.calculateJointAngle(waistToWristDir, 'shoulder');
    this.jointAngles.shoulder = this.dhParams.waistToArm.theta * 180 / Math.PI;

    // 肘关节角度：手臂->手腕的θ
    this.dhParams.armToWrist.theta = this.calculateElbowAngle(sensorData.wrist, bodyFrame);
    this.jointAngles.elbow = this.dhParams.armToWrist.theta * 180 / Math.PI;

    // 可选：更新末端位置（但通常外部调用 getEndEffectorPositions 时才计算）
    // 这里不自动计算，避免不必要的开销
  }

  /**
   * 辅助：从身体坐标系计算目标方向向量
   */
  calculateVectorFromBodyFrame(bodyFrame, type) {
    // 简化实现：根据身体坐标系轴向量推导关节方向
    const { X: bodyX, Y: bodyY, Z: bodyZ } = bodyFrame;
    if (type === 'waistToAnkle') {
      return [-bodyX[0] * 0.8 + bodyY[1] * 0.2, -bodyX[1] * 0.8 + bodyY[1] * 0.2, bodyZ[2] * 0.5];
    } else if (type === 'waistToWrist') {
      return [bodyX[0] * 0.8 + bodyY[1] * 0.2, bodyX[1] * 0.8 + bodyY[1] * 0.2, bodyZ[2] * 0.5];
    }
    return [0, 0, 0];
  }

  /**
   * 辅助：计算膝关节角度
   */
  calculateKneeAngle(ankleQuat, bodyFrame) {
    const q = Quaternion.fromArray(ankleQuat);
    const ankleZ = q.rotateVector([0, 0, 1]); // 脚踝传感器Z轴在世界坐标系的方向
    const dot = this.dotProduct(ankleZ, bodyFrame.Z);
    return Math.acos(Math.max(-1, Math.min(1, dot))); // 限制范围避免NaN
  }

  /**
   * 辅助：计算肘关节角度
   */
  calculateElbowAngle(wristQuat, bodyFrame) {
    const q = Quaternion.fromArray(wristQuat);
    const wristX = q.rotateVector([1, 0, 0]); // 手腕传感器X轴在世界坐标系的方向
    const dot = this.dotProduct(wristX, bodyFrame.X);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  /**
   * 辅助：计算关节角（通用）
   */
  calculateJointAngle(vector, jointType) {
    const len = Math.sqrt(vector[0]**2 + vector[1]**2 + vector[2]**2);
    if (len < 0.001) return 0;
    const normalized = [vector[0]/len, vector[1]/len, vector[2]/len];
    return jointType === 'hip' || jointType === 'shoulder' 
      ? Math.atan2(normalized[1], normalized[0]) 
      : Math.atan2(normalized[2], normalized[0]);
  }

  /**
   * 辅助：点积计算
   */
  dotProduct(a, b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  }

  /**
   * 获取最终关节角度
   */  
  getJointAngles() {
    return { ...this.jointAngles };
  }
}