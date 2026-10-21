// utils/algorithms/Quaternion.js

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Convert a quaternion-like value to a 4-element math array [w, x, y, z].
 *
 * Public protocol samples expose quaternions as `{ w, x, y, z }`. Math code
 * (matrix/serialization helpers) requires arrays. This is the single explicit
 * boundary between the two representations.
 *
 * @param {object|Array|Quaternion} value
 * @returns {number[]|null} array, or null when the value is not a valid quaternion
 */
export function quaternionToArray(value) {
  if (!value) return null

  let parts
  if (Array.isArray(value)) {
    parts = value
  } else if (value instanceof Quaternion) {
    parts = [value.w, value.x, value.y, value.z]
  } else if (typeof value === 'object') {
    parts = [value.w, value.x, value.y, value.z]
  } else {
    return null
  }

  if (parts.length < 4 || !parts.slice(0, 4).every(finite)) return null
  return [parts[0], parts[1], parts[2], parts[3]]
}

export default class Quaternion {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * True when every component is finite and the quaternion has a usable norm.
   */
  isValid() {
    return [this.w, this.x, this.y, this.z].every(finite) &&
      Math.hypot(this.w, this.x, this.y, this.z) > 1e-8
  }

  /**
   * Build from `{ w, x, y, z }`, `[w, x, y, z]`, or another Quaternion.
   * Returns null for invalid input so callers can enforce validity explicitly.
   */
  static fromQuaternionLike(value) {
    const parts = quaternionToArray(value)
    if (!parts) return null
    return new Quaternion(parts[0], parts[1], parts[2], parts[3])
  }

  /**
   * Public representation used by samples and PoseFrame.
   */
  toObject() {
    return { w: this.w, x: this.x, y: this.y, z: this.z }
  }

  /**
   * Normalized copy. Returns identity when the quaternion has no usable norm.
   */
  normalized() {
    if (!this.isValid()) return new Quaternion()
    const len = Math.hypot(this.w, this.x, this.y, this.z)
    return new Quaternion(this.w / len, this.x / len, this.y / len, this.z / len)
  }

  // 四元数旋转向量（世界坐标系到传感器坐标系）
  rotateVector(v) {
    const [x, y, z] = v;
    const [qw, qx, qy, qz] = [this.w, this.x, this.y, this.z];
    
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    
    return [
      x + qw * tx + (qy * tz - qz * ty),
      y + qw * ty + (qz * tx - qx * tz),
      z + qw * tz + (qx * ty - qy * tx)
    ];
  }
  
  // 向量旋转（传感器坐标系到世界坐标系）
  rotateVectorInverse(v) {
    const qConj = this.conjugate();
    return qConj.rotateVector(v);
  }

  // 共轭（传感器坐标系到世界坐标系）
  conjugate() {
    return new Quaternion(this.w, -this.x, -this.y, -this.z);
  }

  // 四元数乘法：q * p
  multiply(p) {
    const q = this;
    const w = q.w * p.w - q.x * p.x - q.y * p.y - q.z * p.z;
    const x = q.w * p.x + q.x * p.w + q.y * p.z - q.z * p.y;
    const y = q.w * p.y - q.x * p.z + q.y * p.w + q.z * p.x;
    const z = q.w * p.z + q.x * p.y - q.y * p.x + q.z * p.w;
    return new Quaternion(w, x, y, z);
  }
  
    // 四元数转旋转矩阵（3x3）
  toRotationMatrix() {
    const [qw, qx, qy, qz] = [this.w, this.x, this.y, this.z];
    
    // 第一行
    const r00 = 1 - 2 * (qy * qy + qz * qz);
    const r01 = 2 * (qx * qy - qw * qz);
    const r02 = 2 * (qx * qz + qw * qy);
    
    // 第二行
    const r10 = 2 * (qx * qy + qw * qz);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r12 = 2 * (qy * qz - qw * qx);
    
    // 第三行
    const r20 = 2 * (qx * qz - qw * qy);
    const r21 = 2 * (qy * qz + qw * qx);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    
    return [
      [r00, r01, r02],
      [r10, r11, r12],
      [r20, r21, r22]
    ];
  }

  // 从旋转矩阵创建四元数
  static fromRotationMatrix(m) {
    const [m00, m01, m02] = m[0];
    const [m10, m11, m12] = m[1];
    const [m20, m21, m22] = m[2];
    
    const trace = m00 + m11 + m22;
    
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      const w = 0.25 / s;
      const x = (m21 - m12) * s;
      const y = (m02 - m20) * s;
      const z = (m10 - m01) * s;
      return new Quaternion(w, x, y, z);
    } else if (m00 > m11 && m00 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
      const w = (m21 - m12) / s;
      const x = 0.25 * s;
      const y = (m01 + m10) / s;
      const z = (m02 + m20) / s;
      return new Quaternion(w, x, y, z);
    } else if (m11 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
      const w = (m02 - m20) / s;
      const x = (m01 + m10) / s;
      const y = 0.25 * s;
      const z = (m12 + m21) / s;
      return new Quaternion(w, x, y, z);
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
      const w = (m10 - m01) / s;
      const x = (m02 + m20) / s;
      const y = (m12 + m21) / s;
      const z = 0.25 * s;
      return new Quaternion(w, x, y, z);
    }
  }

  
  // 转换为数组
  toArray() {
    return [this.w, this.x, this.y, this.z];
  }

  // 计算四元数之间的差异（角度）
  static angleBetween(q1, q2) {
    if (!q1 || !q2) return 0
    const dot = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
    if (!Number.isFinite(dot)) return 0
    const angle = 2 * Math.acos(Math.min(Math.abs(dot), 1.0));
    return angle * 180 / Math.PI; // 转换为角度
  }
  
  /**
   * Legacy array constructor. Accepts [w, x, y, z] and never returns NaN:
   * invalid input falls back to identity. Prefer fromQuaternionLike() when
   * callers need to detect invalid sensor data.
   */
  static fromArray(arr) {
    return Quaternion.fromQuaternionLike(arr) || new Quaternion();
  }
  
  // 四元数转欧拉角（roll: X轴, pitch: Y轴, yaw: Z轴）
  toEulerAngles() {
    if (!this.isValid()) {
      return { roll: 0, pitch: 0, yaw: 0 };
    }

    const { w, x, y, z } = this;
  
    // 计算roll (x-axis rotation)
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
  
    // 计算pitch (y-axis rotation)
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 
      ? Math.sign(sinp) * Math.PI / 2 
      : Math.asin(sinp);
  
    // 计算yaw (z-axis rotation)
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
  
    return { roll, pitch, yaw };
  }
  
}

export { Quaternion }
