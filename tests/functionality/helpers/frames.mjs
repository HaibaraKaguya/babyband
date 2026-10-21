import assert from 'node:assert/strict'
import { FRAME_LEN, crc16_modbus } from '../../../src/utils/protocol/babyBandProtocol.js'

export const IDENTITY = Object.freeze({ w: 1, x: 0, y: 0, z: 0 })

export function buildFrame(options = {}) {
  const {
    header = [0xAA, 0x55],
    deviceMs = 1000,
    sys = 0x03,
    q0 = IDENTITY,
    q1 = { w: 0.9659, x: 0.2588, y: 0, z: 0 },
    q2 = { w: 0.9239, x: 0, y: 0.3827, z: 0 },
    tWaist = 36.4,
    tThigh = 36.2,
    tAnkle = 35.9,
    frameSeq = 0,
    crcOverride = null
  } = options

  const buf = new ArrayBuffer(FRAME_LEN)
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  const LE = true

  bytes[0] = header[0]
  bytes[1] = header[1]
  view.setUint32(2, deviceMs >>> 0, LE)
  view.setUint8(6, sys)

  const quats = [q0, q1, q2]
  const starts = [7, 23, 39]
  quats.forEach((quat, index) => {
    const base = starts[index]
    view.setFloat32(base, quat.w, LE)
    view.setFloat32(base + 4, quat.x, LE)
    view.setFloat32(base + 8, quat.y, LE)
    view.setFloat32(base + 12, quat.z, LE)
  })

  view.setFloat32(55, tWaist, LE)
  view.setFloat32(59, tThigh, LE)
  view.setFloat32(63, tAnkle, LE)
  view.setUint32(67, frameSeq >>> 0, LE)
  view.setUint16(71, crcOverride == null ? crc16_modbus(bytes, 0, 71) : crcOverride, LE)

  return bytes
}

export function copyFrame(frame) {
  return new Uint8Array(frame)
}

export function flipByte(frame, index) {
  const copy = copyFrame(frame)
  copy[index] = copy[index] ^ 0xFF
  return copy
}

export function assertFiniteDeep(value, path = 'value') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteDeep(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertFiniteDeep(child, `${path}.${key}`)
    }
  }
}
