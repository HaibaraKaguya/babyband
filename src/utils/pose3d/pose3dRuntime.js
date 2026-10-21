/**
 * Three.js runtime for the pose-driven body view.
 *
 * The runtime is injected with a THREE namespace and a canvas so the exact
 * same scene code runs on:
 *   - H5 / App-vue: three.js r149 vendored UMD build, DOM canvas
 *   - WeChat:       threejs-miniprogram r108 scoped THREE, native canvas
 *
 * No rendering loop is started: frames are rendered on update, which matches
 * the ~1 Hz BabyBand sample rate and avoids a permanent RAF battery cost.
 */

import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  diagnosticFromError
} from './diagnostics.js'
import { normalizePoseFrame } from './poseFrame.js'
import { mapPoseToRig } from './poseMapping.js'
import {
  RIG_VERSION,
  applyRigPose,
  createProceduralInfantRig,
  disposeProceduralRig,
  resetRigPose
} from './proceduralRig.js'

const DEFAULTS = Object.freeze({
  width: 320,
  height: 300,
  pixelRatio: 1,
  background: 0xf4f7f9,
  cameraFov: 32,
  cameraPosition: [0.86, 0.90, 1.12],
  cameraTarget: [0.015, 0, 0.03],
  antialias: true,
  preflightWebGL: false,
  rigOptions: {},
  mappingOptions: {}
})

function safeNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function hasWebGLContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return true
  // Probe with a throw-away canvas so the real canvas keeps the attributes
  // requested by three.js (antialias, alpha, ...) instead of being locked to
  // the attribute set used by this preflight call.
  const target =
    typeof document !== 'undefined' && typeof document.createElement === 'function'
      ? document.createElement('canvas')
      : canvas
  try {
    const context =
      target.getContext('webgl2') ||
      target.getContext('webgl') ||
      target.getContext('experimental-webgl')
    return Boolean(context)
  } catch (error) {
    return false
  }
}

/**
 * @param {object} THREE
 * @param {object} canvas DOM canvas or WeChat canvas node
 * @param {object} [options]
 */
export function createPose3DRuntime(THREE, canvas, options = {}) {
  if (!THREE) throw new Error('createPose3DRuntime requires a THREE namespace')
  if (!canvas) throw new Error('createPose3DRuntime requires a canvas')

  const settings = {
    ...DEFAULTS,
    ...options,
    rigOptions: { ...DEFAULTS.rigOptions, ...(options.rigOptions || {}) },
    mappingOptions: {
      ...DEFAULTS.mappingOptions,
      ...(options.mappingOptions || {})
    }
  }
  const onDiagnostic =
    typeof settings.onDiagnostic === 'function' ? settings.onDiagnostic : () => {}

  let width = safeNumber(settings.width, DEFAULTS.width)
  let height = safeNumber(settings.height, DEFAULTS.height)
  let pixelRatio = safeNumber(settings.pixelRatio, DEFAULTS.pixelRatio)

  if (settings.preflightWebGL && !hasWebGLContext(canvas)) {
    throw new Error(DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE)
  }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    settings.cameraFov,
    width / height,
    0.01,
    10
  )
  camera.position.set(
    settings.cameraPosition[0],
    settings.cameraPosition[1],
    settings.cameraPosition[2]
  )
  if (typeof camera.lookAt === 'function') {
    camera.lookAt(
      settings.cameraTarget[0],
      settings.cameraTarget[1],
      settings.cameraTarget[2]
    )
  }

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.antialias
    })
  } catch (error) {
    throw new Error(`${DIAGNOSTIC_CODES.RENDERER_CREATE_FAILED}: ${error && error.message}`)
  }

  if (!renderer) throw new Error(DIAGNOSTIC_CODES.RENDERER_CREATE_FAILED)

  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height, false)
  if (typeof renderer.setClearColor === 'function') {
    renderer.setClearColor(settings.background, 1)
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.55)
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.55)
  keyLight.position.set(0.55, 0.35, 0.9)
  const fillLight = new THREE.DirectionalLight(0xdfeeff, 0.20)
  fillLight.position.set(-0.6, -0.45, 0.5)
  scene.add(ambient)
  scene.add(keyLight)
  scene.add(fillLight)

  const rig = createProceduralInfantRig(THREE, settings.rigOptions)
  scene.add(rig.root)

  const state = {
    disposed: false,
    hasValidPose: false,
    lastValidTimestamp: null,
    lastFrame: null,
    lastDiagnosticKey: '',
    mappingOptions: { ...settings.mappingOptions },
    framesApplied: 0,
    invalidFrames: 0
  }

  function emit(diagnostic, force = false) {
    const key = `${diagnostic.code}|${diagnostic.detail}`
    if (!force && key === state.lastDiagnosticKey) return
    state.lastDiagnosticKey = key
    onDiagnostic(diagnostic)
  }

  function renderScene() {
    if (state.disposed) return false
    try {
      renderer.render(scene, camera)
      return true
    } catch (error) {
      emit(diagnosticFromError(DIAGNOSTIC_CODES.RENDER_UPDATE_FAILED, error))
      return false
    }
  }

  function handleContextLost(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    emit(createDiagnostic(DIAGNOSTIC_CODES.CONTEXT_LOST))
  }

  if (typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('webglcontextlost', handleContextLost, false)
  }

  const runtime = {
    version: RIG_VERSION,
    scene,
    camera,
    renderer,
    rig,

    /**
     * Apply and render one PoseFrame. Invalid frames are ignored so the last
     * valid posture stays on screen; false is returned but nothing throws.
     */
    update(poseFrame) {
      if (state.disposed) {
        emit(createDiagnostic(DIAGNOSTIC_CODES.DISPOSED))
        return false
      }
      const normalized = normalizePoseFrame(poseFrame)
      state.lastFrame = normalized

      if (!normalized.valid) {
        state.invalidFrames += 1
        emit(
          createDiagnostic(
            DIAGNOSTIC_CODES.INVALID_POSE,
            normalized.issues.length ? normalized.issues[0].code : ''
          )
        )
        if (!state.hasValidPose) {
          resetRigPose(rig)
          renderScene()
        }
        return false
      }

      try {
        const mapped = mapPoseToRig(normalized, state.mappingOptions)
        applyRigPose(rig, mapped)
        state.hasValidPose = true
        state.lastValidTimestamp = normalized.timestamp
        state.framesApplied += 1
        state.lastDiagnosticKey = ''
        renderScene()
        return true
      } catch (error) {
        emit(diagnosticFromError(DIAGNOSTIC_CODES.RENDER_UPDATE_FAILED, error))
        return false
      }
    },

    setMappingOptions(mappingOptions) {
      state.mappingOptions = {
        ...state.mappingOptions,
        ...(mappingOptions || {})
      }
    },

    resize(nextWidth, nextHeight, updateStyle = false) {
      if (state.disposed) return false
      const w = safeNumber(nextWidth, 0)
      const h = safeNumber(nextHeight, 0)
      if (!w || !h) {
        emit(createDiagnostic(DIAGNOSTIC_CODES.RESIZE_FAILED, `${nextWidth}x${nextHeight}`))
        return false
      }
      width = w
      height = h
      try {
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize(width, height, updateStyle)
        camera.aspect = width / height
        if (typeof camera.updateProjectionMatrix === 'function') {
          camera.updateProjectionMatrix()
        }
        return renderScene()
      } catch (error) {
        emit(diagnosticFromError(DIAGNOSTIC_CODES.RESIZE_FAILED, error))
        return false
      }
    },

    setPixelRatio(nextPixelRatio) {
      if (state.disposed) return false
      const ratio = safeNumber(nextPixelRatio, pixelRatio)
      pixelRatio = Math.max(0.5, Math.min(3, ratio))
      try {
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize(width, height, false)
        return renderScene()
      } catch (error) {
        emit(diagnosticFromError(DIAGNOSTIC_CODES.RESIZE_FAILED, error))
        return false
      }
    },

    render() {
      return renderScene()
    },

    getState() {
      return {
        disposed: state.disposed,
        hasValidPose: state.hasValidPose,
        lastValidTimestamp: state.lastValidTimestamp,
        framesApplied: state.framesApplied,
        invalidFrames: state.invalidFrames,
        width,
        height,
        pixelRatio,
        rigVersion: RIG_VERSION,
        triangles: renderer.info && renderer.info.render ? renderer.info.render.triangles : null,
        drawCalls: renderer.info && renderer.info.render ? renderer.info.render.calls : null
      }
    },

    /** Idempotent teardown: DOM listener, GPU resources, rig, renderer. */
    dispose() {
      if (state.disposed) {
        return { alreadyDisposed: true, geometries: 0, materials: 0, textures: 0 }
      }
      state.disposed = true
      if (typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('webglcontextlost', handleContextLost, false)
      }
      const root = rig.root
      const rigResult = disposeProceduralRig(rig)
      if (scene && typeof scene.remove === 'function') {
        if (root) scene.remove(root)
        scene.remove(ambient)
        scene.remove(keyLight)
        scene.remove(fillLight)
      }
      try {
        if (typeof renderer.dispose === 'function') renderer.dispose()
        if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss()
      } catch (error) {
        /* disposal must never throw */
      }
      return {
        alreadyDisposed: false,
        geometries: rigResult.geometries,
        materials: rigResult.materials,
        textures: rigResult.textures
      }
    }
  }

  resetRigPose(rig)
  renderScene()
  return runtime
}

export default createPose3DRuntime
