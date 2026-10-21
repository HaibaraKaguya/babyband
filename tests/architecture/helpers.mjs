/**
 * Test helpers only. Not executed by `node --test`.
 */

export class MemoryStorage {
  constructor() {
    this.map = new Map()
    this.writes = []
    this.removes = []
    /** @type {null | ((key: string, value: string) => Error|null)} */
    this.failSet = null
    this.dropSet = null
  }

  get(key) {
    return this.map.has(key) ? this.map.get(key) : ''
  }

  set(key, value) {
    if (this.failSet) {
      const error = this.failSet(key, value)
      if (error) throw error
    }
    this.writes.push(key)
    if (this.dropSet && this.dropSet(key, value)) {
      return
    }
    this.map.set(key, value)
  }

  remove(key) {
    this.removes.push(key)
    this.map.delete(key)
  }

  keys() {
    return [...this.map.keys()]
  }
}

export function makeQuaternion(w = 1, x = 0, y = 0, z = 0) {
  return { w, x, y, z }
}

export function makeSample(overrides = {}) {
  return {
    ts: 1_700_000_000_000,
    deviceMs: 12_345,
    frameSeq: 7,
    sys: 0x03,
    tempValid: true,
    attitudeValid: true,
    q0: makeQuaternion(1, 0, 0, 0),
    q1: makeQuaternion(0.9238795, 0.3826834, 0, 0),
    q2: makeQuaternion(0.9981, 0.0615, 0.0017, 0.0008),
    tWaist: 36.4,
    tThigh: 36.2,
    tAnkle: 35.9,
    temp1: 36.4,
    temp2: 36.2,
    temp3: 35.9,
    battery: 90,
    crcOk: true,
    crcAlg: 'modbus',
    ...overrides
  }
}
