/**
 * Procedural infant-like articulated figure.
 *
 * This is intentionally built from three.js primitives, not a downloaded mesh.
 * It works with both three.js r149 (H5/App vendor build) and the older r108
 * runtime bundled by `threejs-miniprogram`, so only long-stable APIs are used.
 *
 * Coordinate convention (matches BodyFrameReconstructor):
 *   +X = head / forward, +Y = subject right, +Z = up
 * The baby lies supine on a soft support pad.
 *
 * Limitations: proportions are stylised; no skinning, no elbow/knee sensors,
 * and sensor mounting corrections are identity until hardware calibration.
 */

import { IDENTITY_QUATERNION } from './quaternion.js'
import { rigPoseToThreeArgs } from './poseMapping.js'

export const RIG_VERSION = 'procedural-infant-v1'

export const DEFAULT_RIG_OPTIONS = Object.freeze({
  skinColor: 0xf1c7a5,
  onesieColor: 0xa9d7e8,
  accentColor: 0x6fa8bd,
  supportColor: 0xe8eef2,
  showSupport: true
})

function material(THREE, color, options = {}) {
  const MaterialCtor = THREE.MeshStandardMaterial || THREE.MeshLambertMaterial
  const params = {
    color,
    roughness: options.roughness === undefined ? 0.82 : options.roughness,
    metalness: 0
  }
  if (!THREE.MeshStandardMaterial) {
    delete params.roughness
    delete params.metalness
  }
  return new MaterialCtor(params)
}

function trackMesh(rig, parent, geometry, mat, position, scale) {
  const mesh = new rig._THREE.Mesh(geometry, mat)
  if (position) mesh.position.set(position[0], position[1], position[2])
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2])
  mesh.name = `mesh_${rig._meshCount++}`
  parent.add(mesh)
  rig.geometries.push(geometry)
  rig.meshes.push(mesh)
  return mesh
}

function ellipsoid(rig, parent, materialRef, radius, scale, position) {
  const geometry = new rig._THREE.SphereGeometry(radius, 24, 18)
  return trackMesh(rig, parent, geometry, materialRef, position, scale)
}

function cylinder(rig, parent, materialRef, radiusTop, radiusBottom, height, position, rotation) {
  const geometry = new rig._THREE.CylinderGeometry(radiusTop, radiusBottom, height, 18)
  const mesh = trackMesh(rig, parent, geometry, materialRef, position)
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2])
  return mesh
}

function addJoint(THREE, parent, name, position) {
  const group = new THREE.Group()
  group.name = name
  group.position.set(position[0], position[1], position[2])
  parent.add(group)
  return group
}

function disposeMaterial(mat, counter) {
  if (!mat) return
  if (Array.isArray(mat)) {
    mat.forEach(item => disposeMaterial(item, counter))
    return
  }
  if (mat.map && typeof mat.map.dispose === 'function') {
    mat.map.dispose()
    counter.textures += 1
  }
  if (typeof mat.dispose === 'function') {
    mat.dispose()
    counter.materials += 1
  }
}

/**
 * @param {object} THREE three.js namespace (r108-compatible subset)
 * @param {object} [options]
 */
export function createProceduralInfantRig(THREE, options = {}) {
  if (!THREE) throw new Error('createProceduralInfantRig requires a THREE namespace')
  const required = ['Group', 'Mesh', 'SphereGeometry', 'CylinderGeometry', 'BoxGeometry', 'Quaternion']
  required.forEach(key => {
    if (!THREE[key]) throw new Error(`THREE.${key} is required by the procedural rig`)
  })

  const settings = { ...DEFAULT_RIG_OPTIONS, ...options }
  const materials = {
    skin: material(THREE, settings.skinColor),
    onesie: material(THREE, settings.onesieColor),
    accent: material(THREE, settings.accentColor),
    support: material(THREE, settings.supportColor)
  }

  const rig = {
    version: RIG_VERSION,
    _THREE: THREE,
    _meshCount: 0,
    root: new THREE.Group(),
    geometries: [],
    materials: Object.values(materials),
    meshes: [],
    disposed: false,
    joints: {},
    rest: {}
  }
  rig.root.name = 'babyband_infant_root'

  const pelvis = new THREE.Group()
  pelvis.name = 'pelvis'
  pelvis.position.set(0, 0, 0.055)
  rig.root.add(pelvis)

  if (settings.showSupport) {
    const supportGeometry = new THREE.BoxGeometry(0.78, 0.44, 0.035)
    const support = trackMesh(
      rig,
      rig.root,
      supportGeometry,
      materials.support,
      [0.02, 0, -0.005]
    )
    support.name = 'support_pad'
  }

  // ---- torso (driven by q0) -------------------------------------------------
  const waist = new THREE.Group()
  waist.name = 'waist_joint'
  pelvis.add(waist)
  rig.joints.waist = waist

  const torso = ellipsoid(
    rig,
    waist,
    materials.onesie,
    1,
    [0.155, 0.115, 0.068],
    [0.065, 0, 0.02]
  )
  torso.name = 'torso'
  ellipsoid(rig, waist, materials.skin, 0.045, [1, 1, 0.9], [0.155, 0, 0.025]).name = 'neck'

  // ---- head -----------------------------------------------------------------
  const headJoint = addJoint(THREE, waist, 'head_joint', [0.225, 0, 0.035])
  ellipsoid(rig, headJoint, materials.skin, 0.083, [1.0, 0.92, 0.96], [0.034, 0, 0.01]).name = 'head'
  ellipsoid(rig, headJoint, materials.skin, 0.022, [0.7, 1, 1], [0.01, -0.078, 0.005]).name = 'ear_left'
  ellipsoid(rig, headJoint, materials.skin, 0.022, [0.7, 1, 1], [0.01, 0.078, 0.005]).name = 'ear_right'

  const eyeMat = material(THREE, 0x3a2b28)
  rig.materials.push(eyeMat)
  ellipsoid(rig, headJoint, eyeMat, 0.008, [1, 1, 1], [0.07, -0.03, 0.082]).name = 'eye_left'
  ellipsoid(rig, headJoint, eyeMat, 0.008, [1, 1, 1], [0.07, 0.03, 0.082]).name = 'eye_right'
  ellipsoid(rig, headJoint, materials.accent, 0.006, [1, 1, 1], [0.095, 0, 0.075]).name = 'nose'

  // ---- arms -----------------------------------------------------------------
  const armRestRight = tubeRest(THREE, 0)
  const armRestLeft = tubeRest(THREE, 0)
  const rightArm = addJoint(THREE, waist, 'right_arm_joint', [0.135, 0.118, 0.015])
  // Arm tubes are built along local +Y. The right arm points +Y, left -Y.
  armRestRight.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.08)
  armRestLeft.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI + 0.08)
  rightArm.quaternion.copy(armRestRight)
  rig.joints.rightArm = rightArm
  rig.rest.rightArm = armRestRight.clone()

  buildArm(rig, rightArm, materials, 1)
  const leftArm = addJoint(THREE, waist, 'left_arm_joint', [0.135, -0.118, 0.015])
  leftArm.quaternion.copy(armRestLeft)
  buildArm(rig, leftArm, materials, -1)
  rig.joints.leftArm = leftArm

  // ---- legs -----------------------------------------------------------------
  const legRestRight = tubeRest(THREE, Math.PI / 2)
  const legRestLeft = tubeRest(THREE, Math.PI / 2)
  const rightLeg = addJoint(THREE, pelvis, 'right_leg_joint', [-0.075, 0.058, 0.01])
  rightLeg.quaternion.copy(legRestRight)
  rig.joints.rightLeg = rightLeg
  rig.rest.rightLeg = legRestRight.clone()

  buildLeg(rig, rightLeg, materials)
  const leftLeg = addJoint(THREE, pelvis, 'left_leg_joint', [-0.075, -0.058, 0.01])
  leftLeg.quaternion.copy(legRestLeft)
  buildLeg(rig, leftLeg, materials)
  rig.joints.leftLeg = leftLeg

  rig.rest.waist = new THREE.Quaternion(0, 0, 0, 1)

  return rig
}

function tubeRest(THREE, zRotation) {
  return new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    zRotation
  )
}

function buildArm(rig, joint, materials, side) {
  // Local +Y = away from shoulder.
  cylinder(rig, joint, materials.skin, 0.028, 0.03, 0.115, [0, 0.058, 0]).name =
    side > 0 ? 'right_upper_arm' : 'left_upper_arm'
  const elbow = new rig._THREE.Group()
  elbow.name = side > 0 ? 'right_elbow' : 'left_elbow'
  elbow.position.set(0, 0.115, 0)
  joint.add(elbow)
  cylinder(rig, elbow, materials.skin, 0.023, 0.026, 0.105, [0, 0.053, 0]).name =
    side > 0 ? 'right_forearm' : 'left_forearm'
  ellipsoid(rig, elbow, materials.skin, 0.03, [1, 0.9, 0.75], [0, 0.115, 0.002]).name =
    side > 0 ? 'right_hand' : 'left_hand'
}

function buildLeg(rig, joint, materials) {
  // Local +Y after the rest rotation maps to -X (towards the feet).
  cylinder(rig, joint, materials.onesie, 0.045, 0.055, 0.145, [0, 0.072, 0]).name = 'upper_leg'
  const knee = new rig._THREE.Group()
  knee.name = 'knee_joint'
  knee.position.set(0, 0.145, 0)
  joint.add(knee)
  cylinder(rig, knee, materials.skin, 0.034, 0.042, 0.135, [0, 0.068, 0]).name = 'lower_leg'
  ellipsoid(rig, knee, materials.skin, 0.043, [1.0, 1.35, 0.75], [0, 0.15, 0.01]).name = 'foot'
}

function applyOne(joint, rest, args) {
  const delta = new joint.quaternion.constructor(args.x, args.y, args.z, args.w)
  if (typeof delta.normalize === 'function') delta.normalize()
  joint.quaternion.copy(rest).multiply(delta)
}

/**
 * Apply mapped joint quaternions. Missing entries keep the rest pose; this
 * function does not validate frames (the runtime decides whether to apply).
 */
export function applyRigPose(rig, rigPose) {
  if (!rig || rig.disposed) return false
  const args = rigPoseToThreeArgs(rigPose || {})
  applyOne(rig.joints.waist, rig.rest.waist, args.torso)
  applyOne(rig.joints.rightArm, rig.rest.rightArm, args.rightArm)
  applyOne(rig.joints.rightLeg, rig.rest.rightLeg, args.rightLeg)
  return true
}

export function resetRigPose(rig) {
  if (!rig || rig.disposed) return false
  applyRigPose(rig, {
    torso: IDENTITY_QUATERNION,
    rightArm: IDENTITY_QUATERNION,
    rightLeg: IDENTITY_QUATERNION
  })
  return true
}

/**
 * Idempotent disposal. Returns counts for diagnostics/tests.
 */
export function disposeProceduralRig(rig) {
  const result = { geometries: 0, materials: 0, textures: 0, meshes: 0, alreadyDisposed: false }
  if (!rig) return result
  if (rig.disposed) {
    result.alreadyDisposed = true
    return result
  }

  if (rig.root) {
    if (rig.root.parent && typeof rig.root.parent.remove === 'function') {
      rig.root.parent.remove(rig.root)
    }
    const seenMaterials = new Set()
    const seenGeometries = new Set()
    rig.root.traverse(object => {
      if (
        object.geometry &&
        !seenGeometries.has(object.geometry) &&
        typeof object.geometry.dispose === 'function'
      ) {
        seenGeometries.add(object.geometry)
        object.geometry.dispose()
        result.geometries += 1
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : []
      materials.forEach(item => {
        if (item && !seenMaterials.has(item)) {
          seenMaterials.add(item)
          disposeMaterial(item, result)
        }
      })
    })
    while (rig.root.children && rig.root.children.length) {
      rig.root.remove(rig.root.children[0])
    }
  }

  result.meshes = rig.meshes.length
  rig.meshes = []
  rig.geometries = []
  rig.materials = []
  rig.joints = {}
  rig.rest = {}
  rig.disposed = true
  rig.root = null
  return result
}

export default {
  RIG_VERSION,
  createProceduralInfantRig,
  applyRigPose,
  resetRigPose,
  disposeProceduralRig
}
