import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAME_LEN,
  BabyBandStreamParser,
  parseBabyBandFrame
} from '../../src/utils/protocol/babyBandProtocol.js'
import { buildFrame, flipByte } from './helpers/frames.mjs'

test('parses a valid frame with unchanged field offsets', () => {
  const frame = buildFrame({
    deviceMs: 123456,
    sys: 0x03,
    q0: { w: 1, x: 0, y: 0, z: 0 },
    q1: { w: 0.9659, x: 0.2588, y: 0, z: 0 },
    q2: { w: 0.9239, x: 0, y: 0.3827, z: 0 },
    tWaist: 36.4,
    tThigh: 36.2,
    tAnkle: 35.9,
    frameSeq: 42
  })

  const parsed = parseBabyBandFrame(frame)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.meta.crcOk, true)
  assert.equal(parsed.meta.crcAlg, 'modbus')
  assert.equal(parsed.sample.deviceMs, 123456)
  assert.equal(parsed.sample.frameSeq, 42)
  assert.equal(parsed.sample.tempValid, true)
  assert.equal(parsed.sample.attitudeValid, true)
  assert.deepEqual(parsed.sample.q0, { w: 1, x: 0, y: 0, z: 0 })
  assert.ok(Math.abs(parsed.sample.tWaist - 36.4) < 1e-5)
  assert.equal(parsed.sample.temp1, parsed.sample.tWaist)
  assert.equal(parsed.sample.crcOk, true)
})

test('rejects a frame whose payload was corrupted after CRC calculation', () => {
  const frame = buildFrame({ frameSeq: 7 })
  const corrupted = flipByte(frame, 30)

  const parsed = parseBabyBandFrame(corrupted)

  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /crc mismatch/)
  assert.equal(parsed.meta.crcOk, false)
  assert.equal(parsed.sample, undefined)
})

test('rejects a frame whose CRC field is wrong', () => {
  const frame = buildFrame({ crcOverride: 0x1234 })
  const parsed = parseBabyBandFrame(frame)

  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /crc mismatch/)
})

test('rejects bad header, bad length, and unsupported input without throwing', () => {
  const badHeader = buildFrame({ header: [0x12, 0x34] })
  assert.equal(parseBabyBandFrame(badHeader).ok, false)
  assert.match(parseBabyBandFrame(badHeader).error, /header/)

  const short = new Uint8Array(FRAME_LEN - 1)
  assert.equal(parseBabyBandFrame(short).ok, false)
  assert.match(parseBabyBandFrame(short).error, /length/)

  assert.equal(parseBabyBandFrame(null).ok, false)
  assert.equal(parseBabyBandFrame('not bytes').ok, false)
})

test('system status bits drive tempValid and attitudeValid flags', () => {
  const parsed = parseBabyBandFrame(buildFrame({ sys: 0x00 }))

  assert.equal(parsed.ok, true)
  assert.equal(parsed.sample.tempValid, false)
  assert.equal(parsed.sample.attitudeValid, false)

  const tempOnly = parseBabyBandFrame(buildFrame({ sys: 0x01 }))
  assert.equal(tempOnly.sample.tempValid, true)
  assert.equal(tempOnly.sample.attitudeValid, false)
})

test('accepts the reversed header and preserves the reported header metadata', () => {
  const frame = buildFrame({ header: [0x55, 0xAA] })
  const parsed = parseBabyBandFrame(frame)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.meta.headerBytes, '55AA')
})

test('stream parser reassembles split frames and rejects corrupt frames', () => {
  const parser = new BabyBandStreamParser()
  const first = buildFrame({ frameSeq: 1 })
  const corrupt = flipByte(buildFrame({ frameSeq: 2 }), 40)

  assert.deepEqual(parser.push(first.subarray(0, 30)), [])
  const firstOut = parser.push(first.subarray(30))
  assert.equal(firstOut.length, 1)
  assert.equal(firstOut[0].ok, true)
  assert.equal(firstOut[0].sample.frameSeq, 1)

  const secondOut = parser.push(corrupt)
  assert.equal(secondOut.length, 1)
  assert.equal(secondOut[0].ok, false)
  assert.match(secondOut[0].error, /crc mismatch/)
})

test('stream parser ignores unsupported chunks', () => {
  const parser = new BabyBandStreamParser()
  assert.deepEqual(parser.push(null), [])
  assert.deepEqual(parser.push('nope'), [])
})
