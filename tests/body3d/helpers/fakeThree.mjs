/**
 * Minimal three.js stand-in for Node tests. It implements only the API surface
 * used by proceduralRig/pose3dRuntime, plus real quaternion math so rotation
 * mapping can be asserted numerically.
 */

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }

  set(x, y, z, w) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    return this
  }

  copy(q) {
    this.x = q.x
    this.y = q.y
    this.z = q.z
    this.w = q.w
    return this
  }

  clone() {
    return new Quaternion(this.x, this.y, this.z, this.w)
  }

  normalize() {
    const length = Math.hypot(this.x, this.y, this.z, this.w)
    if (length > 0) {
      this.x /= length
      this.y /= length
      this.z /= length
      this.w /= length
    }
    return this
  }

  setFromAxisAngle(axis, angle) {
    const half = angle / 2
    const s = Math.sin(half)
    this.x = axis.x * s
    this.y = axis.y * s
    this.z = axis.z * s
    this.w = Math.cos(half)
    return this.normalize()
  }

  multiply(q) {
    const { x, y, z, w } = this
    this.w = w * q.w - x * q.x - y * q.y - z * q.z
    this.x = w * q.x + x * q.w + y * q.z - z * q.y
    this.y = w * q.y - x * q.z + y * q.w + z * q.x
    this.z = w * q.z + x * q.y - y * q.x + z * q.w
    return this
  }

  angleTo(q) {
    const dot = Math.abs(this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w)
    return 2 * Math.acos(Math.min(1, dot))
  }
}

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  set(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
}

class Object3D {
  constructor() {
    this.children = []
    this.parent = null
    this.name = ''
    this.position = new Vector3()
    this.rotation = new Vector3()
    this.scale = new Vector3(1, 1, 1)
    this.quaternion = new Quaternion()
    this.visible = true
  }

  add(child) {
    child.parent = this
    this.children.push(child)
    return this
  }

  remove(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    if (child) child.parent = null
    return this
  }

  traverse(callback) {
    callback(this)
    this.children.slice().forEach(child => child.traverse(callback))
  }

  getObjectByName(name) {
    if (this.name === name) return this
    for (const child of this.children) {
      const found = child.getObjectByName(name)
      if (found) return found
    }
    return null
  }
}

export class Group extends Object3D {}

export class Scene extends Object3D {}

export class Mesh extends Object3D {
  constructor(geometry, material) {
    super()
    this.geometry = geometry
    this.material = material
  }
}

class Geometry {
  constructor(type) {
    this.type = type
    this.disposed = false
    this.disposeCalls = 0
  }

  dispose() {
    this.disposed = true
    this.disposeCalls += 1
  }
}

export class SphereGeometry extends Geometry {
  constructor(radius, widthSegments, heightSegments) {
    super('SphereGeometry')
    Object.assign(this, { radius, widthSegments, heightSegments })
  }
}

export class CylinderGeometry extends Geometry {
  constructor(radiusTop, radiusBottom, height, radialSegments) {
    super('CylinderGeometry')
    Object.assign(this, { radiusTop, radiusBottom, height, radialSegments })
  }
}

export class BoxGeometry extends Geometry {
  constructor(width, height, depth) {
    super('BoxGeometry')
    Object.assign(this, { width, height, depth })
  }
}

class Material {
  constructor(params) {
    Object.assign(this, params)
    this.disposed = false
    this.disposeCalls = 0
  }

  dispose() {
    this.disposed = true
    this.disposeCalls += 1
  }
}

export class MeshStandardMaterial extends Material {}

export class PerspectiveCamera extends Object3D {
  constructor(fov, aspect, near, far) {
    super()
    Object.assign(this, { fov, aspect, near, far })
    this.projectionUpdates = 0
  }

  lookAt() {
    return this
  }

  updateProjectionMatrix() {
    this.projectionUpdates += 1
  }
}

export class AmbientLight extends Object3D {
  constructor(color, intensity) {
    super()
    Object.assign(this, { color, intensity })
  }
}

export class DirectionalLight extends Object3D {
  constructor(color, intensity) {
    super()
    Object.assign(this, { color, intensity })
  }
}

export class WebGLRenderer {
  constructor({ canvas, antialias }) {
    if (canvas && canvas.__failRenderer) {
      throw new Error('simulated renderer failure')
    }
    this.canvas = canvas
    this.antialias = antialias
    this.disposed = false
    this.contextLossForced = false
    this.renderCalls = 0
    this.lastSize = null
    this.pixelRatio = 1
    this.clearColor = null
    this.info = { render: { calls: 0, triangles: 0 } }
  }

  setPixelRatio(value) {
    this.pixelRatio = value
  }

  setSize(width, height, updateStyle) {
    this.lastSize = { width, height, updateStyle }
    if (this.canvas) {
      this.canvas.width = Math.round(width * this.pixelRatio)
      this.canvas.height = Math.round(height * this.pixelRatio)
    }
  }

  setClearColor(color, alpha) {
    this.clearColor = { color, alpha }
  }

  render() {
    this.renderCalls += 1
    this.info.render.calls += 1
    this.info.render.triangles += 240
  }

  dispose() {
    this.disposed = true
  }

  forceContextLoss() {
    this.contextLossForced = true
  }
}

export function createFakeThree() {
  return {
    Group,
    Scene,
    Mesh,
    SphereGeometry,
    CylinderGeometry,
    BoxGeometry,
    MeshStandardMaterial,
    PerspectiveCamera,
    AmbientLight,
    DirectionalLight,
    WebGLRenderer,
    Quaternion,
    Vector3
  }
}

export function createFakeCanvas() {
  const listeners = new Map()
  return {
    width: 0,
    height: 0,
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    emit(type, event) {
      const handler = listeners.get(type)
      if (handler) handler(event)
    }
  }
}
