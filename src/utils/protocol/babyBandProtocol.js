/**
 * Baby Band 数据协议解析
 *
 * 来自会议纪要：
 * - 帧头 uint16 固定 0xAA55（字节序可能为 AA 55 或 55 AA）
 * - 长度固定 73 字节（0..72）
 * - CRC16 覆盖字节 0..70，CRC 字段位于 71..72
 */

export const FRAME_LEN = 73

// -------------------- CRC16 --------------------
// 说明：会议纪要只写了“CRC16”，未写多项式/初值。
// 这里提供两种常见实现：MODBUS(IBM) 与 CCITT-FALSE。
// 默认使用 MODBUS；如果你们固件用的是别的，改成对应算法即可。

export function crc16_modbus(bytes, start = 0, endExclusive = bytes.length) {
  let crc = 0xFFFF
  for (let i = start; i < endExclusive; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) {
      const lsb = crc & 0x0001
      crc >>= 1
      if (lsb) crc ^= 0xA001
    }
  }
  return crc & 0xFFFF
}

export function crc16_ccitt_false(bytes, start = 0, endExclusive = bytes.length) {
  let crc = 0xFFFF
  for (let i = start; i < endExclusive; i++) {
    crc ^= (bytes[i] << 8)
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xFFFF
      else crc = (crc << 1) & 0xFFFF
    }
  }
  return crc & 0xFFFF
}

// -------------------- Frame Parsing --------------------

function readHeader(bytes) {
  if (bytes.length < 2) return { ok: false }
  const b0 = bytes[0], b1 = bytes[1]
  // 支持 AA 55 或 55 AA
  if (b0 === 0xAA && b1 === 0x55) return { ok: true, headerBytes: 'AA55' }
  if (b0 === 0x55 && b1 === 0xAA) return { ok: true, headerBytes: '55AA' }
  return { ok: false }
}

function getUint16BothEndian(view, offset) {
  return {
    le: view.getUint16(offset, true),
    be: view.getUint16(offset, false)
  }
}

/**
 * Accept ArrayBuffer / Uint8Array / other ArrayBuffer views (e.g. DataView).
 * Returns null for unsupported input instead of throwing.
 */
function toByteView(input) {
  if (input == null) return null
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  return null
}

/**
 * 解析单帧（73字节）
 * @param {Uint8Array|ArrayBuffer|DataView} input
 * @returns {{ok:boolean, error?:string, sample?:object, meta?:object}}
 */
export function parseBabyBandFrame(input) {
  const bytes = toByteView(input)
  if (!bytes) {
    return { ok: false, error: 'frame input must be an ArrayBuffer or Uint8Array' }
  }
  if (bytes.length !== FRAME_LEN) {
    return { ok: false, error: `frame length invalid: ${bytes.length}, expected ${FRAME_LEN}` }
  }

  const header = readHeader(bytes)
  if (!header.ok) return { ok: false, error: 'bad frame header (expected 0xAA55)' }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // 先按 little-endian 解析（MCU 常见），同时做 CRC 校验。
  // CRC 本身对字节序无关，但 CRC 字段的读取可能有字节序。
  const crcCalc_modbus = crc16_modbus(bytes, 0, 71)
  const crcCalc_ccitt = crc16_ccitt_false(bytes, 0, 71)
  const crcField = getUint16BothEndian(view, 71)
  const crcOk_modbus = (crcField.le === crcCalc_modbus) || (crcField.be === crcCalc_modbus)
  const crcOk_ccitt = (crcField.le === crcCalc_ccitt) || (crcField.be === crcCalc_ccitt)

  const crcOk = crcOk_modbus || crcOk_ccitt
  const crcAlg = crcOk_modbus ? 'modbus' : (crcOk_ccitt ? 'ccitt_false' : 'unknown')
  const meta = {
    headerBytes: header.headerBytes,
    crcOk,
    crcAlg,
    crcField,
    crcCalc_modbus,
    crcCalc_ccitt
  }

  // A frame with a bad checksum is never a valid sample. Returning ok:true here
  // previously let corrupt payloads reach the algorithms and be persisted.
  if (!crcOk) {
    return { ok: false, error: 'crc mismatch', meta }
  }

  // 数据字段解析：默认按 little-endian。
  // 如果你们固件是 big-endian，把 true 改成 false。
  const LE = true

  const deviceMs = view.getUint32(2, LE)  // 系统上电后的毫秒数
  const sys = view.getUint8(6)

  const q0 = {
    w: view.getFloat32(7, LE),
    x: view.getFloat32(11, LE),
    y: view.getFloat32(15, LE),
    z: view.getFloat32(19, LE)
  }
  const q1 = {
    w: view.getFloat32(23, LE),
    x: view.getFloat32(27, LE),
    y: view.getFloat32(31, LE),
    z: view.getFloat32(35, LE)
  }
  const q2 = {
    w: view.getFloat32(39, LE),
    x: view.getFloat32(43, LE),
    y: view.getFloat32(47, LE),
    z: view.getFloat32(51, LE)
  }

  const tWaist = view.getFloat32(55, LE)
  const tThigh = view.getFloat32(59, LE)
  const tAnkle = view.getFloat32(63, LE)

  const frameSeq = view.getUint32(67, LE)

  // 兼容旧 UI：temp1/2/3
  const sample = {
    ts: Date.now(),

    // 设备侧时序字段
    deviceMs,
    frameSeq,

    // 系统状态位
    sys,
    tempValid: (sys & 0x01) !== 0,
    attitudeValid: (sys & 0x02) !== 0,

    // 姿态：腰/腕/踝
    q0, q1, q2,

    // 温度：腹(腰)/大腿/脚踝
    tWaist,
    tThigh,
    tAnkle,

    // 旧字段映射（避免 UI 全面改名）
    temp1: tWaist,
    temp2: tThigh,
    temp3: tAnkle,

    // 会议纪要里把 bit2~7 保留，可用于电池/报警等。
    // 这里先不假设电池字段来源。
    battery: null,

    // CRC
    crcOk: true,
    crcAlg
  }

  return {
    ok: true,
    sample,
    meta
  }
}

/**
 * 流式解析：处理 BLE notify / socket 等可能的分包
 */
export class BabyBandStreamParser {
  constructor() {
    this._buf = new Uint8Array(0)
  }

  /**
   * @param {ArrayBuffer|Uint8Array} chunk
   * @returns {Array<{ok:boolean, sample?:object, meta?:object, error?:string}>}
   */
  push(chunk) {
    const incoming = toByteView(chunk)
    if (!incoming) return []
    const merged = new Uint8Array(this._buf.length + incoming.length)
    merged.set(this._buf, 0)
    merged.set(incoming, this._buf.length)
    this._buf = merged

    const out = []

    // 在 buffer 中查找帧头，尽可能提取完整帧
    let i = 0
    while (i + 2 <= this._buf.length) {
      const b0 = this._buf[i]
      const b1 = this._buf[i + 1]
      const isHeader = (b0 === 0xAA && b1 === 0x55) || (b0 === 0x55 && b1 === 0xAA)
      if (!isHeader) { i += 1; continue }

      if (i + FRAME_LEN <= this._buf.length) {
        const frame = this._buf.slice(i, i + FRAME_LEN)
        const parsed = parseBabyBandFrame(frame)
        out.push(parsed)
        i += FRAME_LEN
      } else {
        // 头找到了但还不够一帧，等下一次 push
        break
      }
    }

    // 丢弃已消费部分
    this._buf = this._buf.slice(i)
    // 防止异常情况下 buffer 无限增长
    if (this._buf.length > FRAME_LEN * 10) {
      this._buf = this._buf.slice(-FRAME_LEN * 2)
    }

    return out
  }
}
