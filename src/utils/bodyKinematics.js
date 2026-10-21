// utils/bodyKinematics.js

/**
 * 根据温度值返回颜色
 * 低温：蓝色，正常：绿色，高温：红色
 * @param {number} temp - 温度值
 * @returns {string} 颜色字符串
 */
export function tempToColor(temp) {
  if (!Number.isFinite(temp)) {
    return '#999999'; // 默认灰色
  }
  
  // 正常体温范围：36.0-37.5℃
  const normalMin = 36.0;
  const normalMax = 37.5;
  
  if (temp < normalMin) {
    // 低温：蓝色，温度越低越蓝
    const ratio = Math.min(1, (normalMin - temp) / 3); // 最大温差3度
    const blue = 255;
    const green = Math.floor(255 * (1 - ratio * 0.5));
    const red = Math.floor(255 * (1 - ratio));
    return `rgb(${red}, ${green}, ${blue})`;
  } else if (temp > normalMax) {
    // 高温：红色，温度越高越红
    const ratio = Math.min(1, (temp - normalMax) / 3);
    const red = 255;
    const green = Math.floor(255 * (1 - ratio));
    const blue = Math.floor(255 * (1 - ratio));
    return `rgb(${red}, ${green}, ${blue})`;
  } else {
    // 正常温度：绿色
    const ratio = (temp - normalMin) / (normalMax - normalMin);
    const green = 255;
    const red = Math.floor(100 + 155 * ratio); // 从浅绿到黄绿
    const blue = Math.floor(100 * (1 - ratio));
    return `rgb(${red}, ${green}, ${blue})`;
  }
}

/**
 * 根据身体坐标系计算2D关节位置
 * @param {object} sample - 数据样本
 * @returns {object} 关节坐标
 */
export function computeJoints2D(sample) {
  const baseJoints = getDefaultJoints();

  if (!sample || typeof sample !== 'object') {
    return baseJoints;
  }

  try {
    // 温度仅用于轻微调整姿势；只要存在非有限值就不参与计算，
    // 避免把 NaN 传给 canvas 导致整张人体图无法绘制。
    const temps = [sample.temp1, sample.temp2, sample.temp3];
    const hasValidTemps = temps.every(Number.isFinite);
    const avgTemp = hasValidTemps
      ? temps.reduce((sum, value) => sum + value, 0) / temps.length
      : null;
    const tempFactor = avgTemp == null
      ? 0
      : Math.max(-1, Math.min(1, (avgTemp - 36.5) / 2));

    // 根据温度调整关节位置
    return {
      head: {
        x: baseJoints.head.x,
        y: baseJoints.head.y + tempFactor * 0.1
      },
      waist: {
        x: baseJoints.waist.x,
        y: baseJoints.waist.y
      },
      ankle: {
        x: baseJoints.ankle.x,
        y: baseJoints.ankle.y - tempFactor * 0.2
      },
      wrist: {
        x: baseJoints.wrist.x + tempFactor * 0.15,
        y: baseJoints.wrist.y
      },
      tempPoints: {
        waist: {
          x: baseJoints.waist.x,
          y: baseJoints.waist.y + 0.1
        },
        thigh: {
          x: baseJoints.waist.x,
          y: (baseJoints.waist.y + baseJoints.ankle.y) / 2
        },
        ankle: {
          x: baseJoints.ankle.x,
          y: baseJoints.ankle.y + 0.1
        }
      }
    };
  } catch (error) {
    console.warn('计算关节位置失败:', error);
    return baseJoints;
  }
}

/**
 * 获取默认的人体关节位置
 */
function getDefaultJoints() {
  return {
    head: { x: 0, y: 1.2 },
    waist: { x: 0, y: 0 },
    ankle: { x: 0, y: -1.2 },
    wrist: { x: 0.8, y: 0.6 },
    tempPoints: {
      waist: { x: 0, y: 0.1 },
      thigh: { x: 0, y: -0.6 },
      ankle: { x: 0, y: -1.1 }
    }
  };
}

/**
 * 从身体坐标系计算关节角度（如果需要）
 */
export function computeJointAngles(bodyFrame) {
  // 简化的关节角度计算
  return {
    hipAngle: 180, // 髋关节角度
    kneeAngle: 160, // 膝关节角度
    shoulderAngle: 90 // 肩关节角度
  };
}

export default {
  tempToColor,
  computeJoints2D,
  computeJointAngles
};