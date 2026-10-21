/**
 * 温度分析器 - 独立处理三个部位的温度数据
 * 计算温度变化率、温差等，不与踢被检测器耦合
 */
export default class TemperatureAnalyzer {
  /**
   * @param {Object} options - 配置选项
   * @param {number} options.timeWindow - 计算变化率的时间窗口（秒），默认 3 秒
   */
  constructor(options = {}) {
    this.timeWindow = options.timeWindow || 3; // 秒
    this.history = []; // 历史数据缓存 { timestamp, temp1, temp2, temp3 }
  }

  /**
   * 添加新数据并返回分析结果
   * @param {Object} data - 当前帧数据
   * @param {number} data.timestamp - 时间戳（毫秒）
   * @param {number} data.temp1 - 腹部温度（℃）
   * @param {number} data.temp2 - 大腿温度（℃）
   * @param {number} data.temp3 - 脚踝温度（℃）
   * @returns {Object} 分析结果，包含温差、各部位变化率、平均温度等
   */
  analyze(data) {
    const now = data.timestamp;
    const temp1 = data.temp1;
    const temp2 = data.temp2;
    const temp3 = data.temp3;

    // 添加当前数据到历史
    this.history.push({
      timestamp: now,
      temp1, temp2, temp3
    });

    // 裁剪历史，只保留时间窗口内的数据
    const cutoff = now - this.timeWindow * 1000;
    this.history = this.history.filter(item => item.timestamp >= cutoff);

    // 默认返回对象（当数据不足时，变化率为 0）
    const result = {
      tempDiff: temp2 - temp1,          // 大腿与腹部温差
      tempRate1: 0,
      tempRate2: 0,
      tempRate3: 0,
      avgTemp1: temp1,
      avgTemp2: temp2,
      avgTemp3: temp3,
    };

    // 如果历史数据不足两帧，无法计算变化率，直接返回
    if (this.history.length < 2) {
      return result;
    }

    // 取窗口内最早和最晚的数据计算变化率（首尾差分）
    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    const timeSpanSec = (last.timestamp - first.timestamp) / 1000;

    // 避免除零
    if (timeSpanSec < 0.001) {
      return result;
    }

    result.tempRate1 = (last.temp1 - first.temp1) / timeSpanSec;
    result.tempRate2 = (last.temp2 - first.temp2) / timeSpanSec;
    result.tempRate3 = (last.temp3 - first.temp3) / timeSpanSec;

    // 计算窗口内的平均温度
    const sum = this.history.reduce((acc, item) => {
      acc.temp1 += item.temp1;
      acc.temp2 += item.temp2;
      acc.temp3 += item.temp3;
      return acc;
    }, { temp1: 0, temp2: 0, temp3: 0 });

    const count = this.history.length;
    result.avgTemp1 = sum.temp1 / count;
    result.avgTemp2 = sum.temp2 / count;
    result.avgTemp3 = sum.temp3 / count;

    return result;
  }

  /**
   * 重置历史缓存
   */
  reset() {
    this.history = [];
  }
}