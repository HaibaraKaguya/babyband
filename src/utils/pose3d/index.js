export {
  IDENTITY_QUATERNION,
  toQuaternionObject,
  toQuaternionArray,
  toThreeQuaternionArgs,
  cloneQuaternion,
  quaternionNorm,
  normalizeQuaternion,
  isUsableQuaternion,
  isNearUnitQuaternion,
  areQuaternionsEquivalent,
  multiplyQuaternions,
  conjugateQuaternion,
  relativeQuaternion,
  slerpQuaternions,
  quaternionAngleDegrees,
  quaternionFromAxisAngle
} from './quaternion.js'

export {
  createIdentityPoseFrame,
  normalizePoseFrame,
  poseFrameFromSensorSample,
  clonePoseFrame,
  summarizePoseFrame
} from './poseFrame.js'

export {
  DEFAULT_POSE_MAPPING,
  mapPoseToRig,
  rigPoseToThreeArgs,
  identityRigPose
} from './poseMapping.js'

export { PoseTimeline } from './poseTimeline.js'

export {
  RIG_VERSION,
  DEFAULT_RIG_OPTIONS,
  createProceduralInfantRig,
  applyRigPose,
  resetRigPose,
  disposeProceduralRig
} from './proceduralRig.js'

export { createPose3DRuntime } from './pose3dRuntime.js'

export {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_LEVEL,
  createDiagnostic,
  formatDiagnostic,
  diagnosticFromError
} from './diagnostics.js'
