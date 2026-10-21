// mock/deviceData.js
//
// ✅ 改为“按协议生成一帧二进制数据 → 再走解析器”，方便联调数据接收/解析层。
// 协议字段来自 1.24 会议纪要：帧头 0xAA55、3 处四元数、3 处温度、帧序列号、CRC16 等。

import { FRAME_LEN, crc16_modbus, parseBabyBandFrame } from '../utils/protocol/babyBandProtocol.js'


let tWaist = 36.4
let tThigh = 36.2
let tAnkle = 35.9
let battery = 90

let dropMode = false
let dropCount = 0

let bootMs = 0
let frameSeq = 0

function rand(min, max) {
  return min + Math.random() * (max - min)
}

function randomQuat() {
  // 简单生成一个接近单位四元数的小旋转（演示用）
  const ax = rand(-0.2, 0.2)
  const ay = rand(-0.2, 0.2)
  const az = rand(-0.2, 0.2)
  const angle = rand(-0.6, 0.6)
  const half = angle / 2
  const s = Math.sin(half)
  const w = Math.cos(half)
  const x = ax * s
  const y = ay * s
  const z = az * s
  const n = Math.hypot(w, x, y, z) || 1
  return { w: w / n, x: x / n, y: y / n, z: z / n }
}

export function genMockFrame() {
  // 每隔一段时间，进入“降温模式”持续 10 秒，模拟踢被
  if (!dropMode && Math.random() < 0.03) { // 大约每 30~40 秒触发一次
    dropMode = true
    dropCount = 10
  }

  const noise = () => (Math.random() - 0.5) * 0.06 // 小噪声

  if (dropMode) {
    tWaist -= 0.08
    tThigh -= 0.09
    tAnkle -= 0.12
    dropCount -= 1
    if (dropCount <= 0) dropMode = false
  } else {
    // 正常轻微波动
    tWaist += noise()
    tThigh += noise()
    tAnkle += noise()
  }

  // 电量缓慢下降（会议纪要里没给电量字段，这里只是 UI 演示）
  battery = Math.max(0, battery - 0.01)

  // 设备上电毫秒计数（演示：每秒 +1000）
  bootMs += 1000

  // 姿态（演示：随机）
  const q0 = randomQuat()
  const q1 = randomQuat()
  const q2 = randomQuat()

  // 组帧
  const buf = new ArrayBuffer(FRAME_LEN)
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)

  // 帧头：AA 55
  bytes[0] = 0xAA
  bytes[1] = 0x55

  const LE = true

  view.setUint32(2, bootMs >>> 0, LE)

  // 系统状态：bit0 温度有效，bit1 姿态有效
  view.setUint8(6, 0x03)

  // Q0 waist
  view.setFloat32(7, q0.w, LE)
  view.setFloat32(11, q0.x, LE)
  view.setFloat32(15, q0.y, LE)
  view.setFloat32(19, q0.z, LE)

  // Q1 wrist
  view.setFloat32(23, q1.w, LE)
  view.setFloat32(27, q1.x, LE)
  view.setFloat32(31, q1.y, LE)
  view.setFloat32(35, q1.z, LE)

  // Q2 ankle
  view.setFloat32(39, q2.w, LE)
  view.setFloat32(43, q2.x, LE)
  view.setFloat32(47, q2.y, LE)
  view.setFloat32(51, q2.z, LE)

  // 温度
  view.setFloat32(55, Number(tWaist.toFixed(2)), LE)
  view.setFloat32(59, Number(tThigh.toFixed(2)), LE)
  view.setFloat32(63, Number(tAnkle.toFixed(2)), LE)

  // 帧序列号
  view.setUint32(67, frameSeq >>> 0, LE)
  frameSeq += 1

  // CRC16（默认 MODBUS），覆盖 0..70
  const crc = crc16_modbus(new Uint8Array(buf), 0, 71)
  view.setUint16(71, crc, LE)

  return buf
}

export function genMockSample() {
  const frame = genMockFrame()
  const parsed = parseBabyBandFrame(frame)
  if (!parsed.ok) {
    return {
      ts: Date.now(),
      temp1: NaN,
      temp2: NaN,
      temp3: NaN,
      battery: Math.floor(battery),
      parseError: parsed.error || 'parse failed'
    }
  }

  // 给 UI 演示一个 battery
  parsed.sample.battery = Math.floor(battery)

  return parsed.sample
}
