/**
 * 踢被检测器（增强版）
 * 基于关节角度、三个部位温度值、温度变化率及温差进行综合判断
 */
export default class KickDetector {
  constructor(options = {}) {
    // 可配置阈值
    this.thresholds = {
      // 关节角度变化阈值（度）
      jointAngleChange: options.jointAngleChange || 45,

      // 温度绝对值阈值（℃）：任一部位低于此值可能踢被
      tempAbsMin: options.tempAbsMin || 34.5,

      // 温度下降速率阈值（℃/s）：脚踝温度下降速率超过此值（负值表示下降）
      tempDropRate: options.tempDropRate || -0.15, // 下降速率应小于此值

      // 大腿-腹部温差阈值（℃）：正值表示大腿比腹部低超过此值，
      // 可能踢被（与 TemperatureAnalyzer 的 tempDiff = temp1 - temp2 一致）
      tempDiffThresh: options.tempDiffThresh || 0.5,

      // 时间窗口（秒），用于计算关节角度变化（与温度分析器一致，避免混淆）
      timeWindow: options.timeWindow || 3,
    };

    // 历史数据缓存（用于计算关节角度变化率，与温度分析器独立）
    this.history = []; // 存储 { timestamp, hip, knee }
  }

  /**
   * 综合踢被检测
   * @param {Object} data - 当前帧数据
   * @param {number} data.timestamp - 时间戳（毫秒）
   * @param {number} data.hip - 髋关节角度（度）
   * @param {number} data.knee - 膝关节角度（度）
   * @param {number} data.temp1 - 腹部温度（℃）
   * @param {number} data.temp2 - 大腿温度（℃）
   * @param {number} data.temp3 - 脚踝温度（℃）
   * @param {number} data.tempRate1 - 腹部温度变化率（℃/s）
   * @param {number} data.tempRate2 - 大腿温度变化率（℃/s）
   * @param {number} data.tempRate3 - 脚踝温度变化率（℃/s）
   * @param {number} data.tempDiff - 腹部-大腿温差（℃），正值表示大腿更冷
   * @returns {Object} { detected: boolean, reason?: string, details?: any }
   */
  detect(data) {
    const input = data && typeof data === 'object' ? data : {};
    const now = input.timestamp;
    const { hip, knee, temp1, temp2, temp3, tempRate1, tempRate2, tempRate3, tempDiff } = input;
    const { jointAngleChange, tempAbsMin, tempDropRate, tempDiffThresh, timeWindow } = this.thresholds;

    // 传感器标志或数值无效时直接跳过，不写入历史，也不产生报警。
    if (input.tempValid === false || input.attitudeValid === false) {
      return { detected: false, skipped: true, reason: 'sensor invalid' };
    }

    const numericInputs = [now, hip, knee, temp1, temp2, temp3, tempRate1, tempRate2, tempRate3, tempDiff];
    if (!numericInputs.every(value => typeof value === 'number' && Number.isFinite(value))) {
      return { detected: false, skipped: true, reason: 'invalid input' };
    }

    // 1. 关节角度变化计算（使用历史数据）
    this.history.push({ timestamp: now, hip, knee });
    const cutoff = now - timeWindow * 1000;
    this.history = this.history.filter(item => item.timestamp >= cutoff);

    let maxJointChange = 0;
    if (this.history.length >= 2) {
      // 计算窗口内髋/膝角度的最大变化
      const first = this.history[0];
      const last = this.history[this.history.length - 1];
      const hipChange = Math.abs(last.hip - first.hip);
      const kneeChange = Math.abs(last.knee - first.knee);
      maxJointChange = Math.max(hipChange, kneeChange);
    }

    // 2. 收集触发条件
    const reasons = [];

    // 条件1：任一部位温度过低
    if (temp1 < tempAbsMin || temp2 < tempAbsMin || temp3 < tempAbsMin) {
      reasons.push('温度过低');
    }

    // 条件2：关节角度变化剧烈且脚踝温度下降快
    if (maxJointChange > jointAngleChange && tempRate3 < tempDropRate) {
      reasons.push('剧烈运动+脚踝降温');
    }

    // 条件3：关节角度变化剧烈且大腿-腹部温差大（大腿更冷）
    if (maxJointChange > jointAngleChange && tempDiff > tempDiffThresh) {
      reasons.push('剧烈运动+大腿暴露');
    }

    // 条件4：脚踝温度下降快且大腿-腹部温差大（可能已踢开被子）
    if (tempRate3 < tempDropRate && tempDiff > tempDiffThresh) {
      reasons.push('脚踝降温+大腿暴露');
    }

    // 综合判断：只要满足任一条件即可报警（可根据实际调整，比如需要同时满足多个）
    if (reasons.length > 0) {
      return {
        detected: true,
        skipped: false,
        reason: reasons.join('; '),
        details: { maxJointChange, tempRate3, tempDiff, temps: [temp1, temp2, temp3] }
      };
    }

    return { detected: false, skipped: false };
  }

  /**
   * 重置历史缓存
   */
  reset() {
    this.history = [];
  }
}