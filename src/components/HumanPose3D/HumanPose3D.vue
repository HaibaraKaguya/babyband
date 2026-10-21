<template>
  <view class="hp3d" :style="rootStyle">
    <!-- #ifdef MP-WEIXIN -->
    <canvas
      v-if="!fatalError"
      :id="canvasId"
      :canvas-id="canvasId"
      type="webgl"
      class="hp3d-canvas"
    />
    <!-- #endif -->

    <!-- #ifdef H5 || APP-PLUS -->
    <view
      class="hp3d-host"
      :prop="bridge"
      :change:prop="hp3dRender.onBridgeChange"
    />
    <!-- #endif -->

    <view
      v-if="showFallback && (!ready || fatalError)"
      class="hp3d-fallback"
    >
      <slot name="fallback">
        <text class="hp3d-fallback-text">{{ fallbackText }}</text>
      </slot>
    </view>

    <view v-if="showDiagnostics && diagnosticText" class="hp3d-diagnostic">
      <text class="hp3d-diagnostic-text">{{ diagnosticText }}</text>
    </view>
  </view>
</template>

<script>
import { normalizePoseFrame } from '@/utils/pose3d/poseFrame.js'
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  diagnosticFromError,
  formatDiagnostic
} from '@/utils/pose3d/diagnostics.js'

// #ifdef MP-WEIXIN
import { createWeChatPose3DRuntime } from './wechatRuntime.js'
// #endif

let instanceCounter = 0

function nextCanvasId() {
  instanceCounter += 1
  return `hp3d-canvas-${instanceCounter}`
}

function styleSize(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`
  if (typeof value === 'string' && value.trim() !== '') return value
  return fallback
}

export default {
  name: 'HumanPose3D',
  props: {
    /**
     * PoseFrame: { timestamp, rotations:{q0,q1,q2}, valid }
     * Missing/invalid input never throws; the last valid posture is held.
     */
    pose: {
      type: Object,
      default: null
    },
    width: {
      type: [Number, String],
      default: '100%'
    },
    height: {
      type: [Number, String],
      default: 300
    },
    /** Segment gains 0..1: { torsoGain, armGain, legGain, relativeToWaist } */
    mapping: {
      type: Object,
      default: () => ({})
    },
    /** Procedural rig styling options. Applied at mount only. */
    rig: {
      type: Object,
      default: () => ({})
    },
    pixelRatio: {
      type: Number,
      default: 0
    },
    showFallback: {
      type: Boolean,
      default: true
    },
    showDiagnostics: {
      type: Boolean,
      default: true
    },
    fallbackText: {
      type: String,
      default: '3D 姿态视图不可用，已保留原有二维显示'
    }
  },
  emits: ['ready', 'error', 'diagnostic', 'pose-applied', 'pose-invalid'],
  data() {
    return {
      canvasId: nextCanvasId(),
      ready: false,
      fatalError: false,
      diagnostic: null,
      diagnosticText: '',
      pendingPose: null,
      lastInvalidKey: '',
      poseRevision: 0
    }
  },
  computed: {
    rootStyle() {
      return {
        width: styleSize(this.width, '100%'),
        height: styleSize(this.height, '300px')
      }
    },
    bridge() {
      return {
        pose: this.pose,
        poseRevision: this.poseRevision,
        mapping: this.mapping,
        rig: this.rig,
        pixelRatio: this.pixelRatio,
        width: this.width,
        height: this.height
      }
    }
  },
  watch: {
    pose: {
      immediate: true,
      deep: true,
      handler(value) {
        this.poseRevision += 1
        this.handlePoseChange(value)
      }
    }
  },
  mounted() {
    // #ifdef MP-WEIXIN
    this.initWeChat()
    // #endif

    // #ifndef H5
    // #ifndef APP-PLUS
    // #ifndef MP-WEIXIN
    this.setDiagnostic(
      createDiagnostic(DIAGNOSTIC_CODES.PLATFORM_UNSUPPORTED)
    )
    // #endif
    // #endif
    // #endif
  },
  beforeUnmount() {
    this.disposeRuntime()
  },
  methods: {
    handlePoseChange(value) {
      const frame = normalizePoseFrame(value)
      if (value && !frame.valid) {
        const key = frame.issues.length ? frame.issues[0].code : 'invalid'
        if (key !== this.lastInvalidKey) {
          this.lastInvalidKey = key
          this.$emit('pose-invalid', frame)
        }
      } else {
        this.lastInvalidKey = ''
      }

      // #ifdef MP-WEIXIN
      this.applyPoseToRuntime(value, frame)
      // #endif
    },

    applyPoseToRuntime(value, normalizedFrame) {
      // #ifdef MP-WEIXIN
      if (!this._runtime) {
        this.pendingPose = value
        return
      }
      const frame = normalizedFrame || normalizePoseFrame(value)
      if (!frame.valid) return
      const applied = this._runtime.update(value)
      if (applied) {
        this.clearInvalidPoseDiagnostic()
        this.$emit('pose-applied', {
          timestamp: frame.timestamp,
          valid: true
        })
      }
      // #endif
    },

    async initWeChat() {
      // #ifdef MP-WEIXIN
      try {
        this._runtime = await createWeChatPose3DRuntime({
          componentInstance: this,
          canvasId: this.canvasId,
          width: 320,
          height: 300,
          pixelRatio: this.pixelRatio || undefined,
          mappingOptions: this.mapping,
          onDiagnostic: diagnostic => this.setDiagnostic(diagnostic)
        })
        if (this.pendingPose) {
          this._runtime.update(this.pendingPose)
          this.pendingPose = null
        }
        this.ready = true
        this.fatalError = false
        this.clearDiagnostic()
        this.$emit('ready', this._runtime.getState())
        if (typeof uni !== 'undefined' && uni.onWindowResize) {
          this._resizeHandler = () => this.resizeWeChat()
          uni.onWindowResize(this._resizeHandler)
        }
      } catch (error) {
        this.ready = false
        this.fatalError = true
        const message = String((error && error.message) || error)
        let diagnostic
        if (message.includes(DIAGNOSTIC_CODES.WECHAT_ADAPTER_MISSING)) {
          diagnostic = createDiagnostic(
            DIAGNOSTIC_CODES.WECHAT_ADAPTER_MISSING,
            message
          )
        } else if (message.includes(DIAGNOSTIC_CODES.CANVAS_UNAVAILABLE)) {
          diagnostic = createDiagnostic(DIAGNOSTIC_CODES.CANVAS_UNAVAILABLE)
        } else if (message.includes('WEBGL')) {
          diagnostic = createDiagnostic(DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE, message)
        } else {
          diagnostic = diagnosticFromError(
            DIAGNOSTIC_CODES.RENDERER_CREATE_FAILED,
            error
          )
        }
        this.setDiagnostic(diagnostic)
      }
      // #endif
    },

    resizeWeChat() {
      // #ifdef MP-WEIXIN
      if (!this._runtime || !uni.createSelectorQuery) return
      const query = uni.createSelectorQuery().in(this)
      query
        .select(`#${this.canvasId}`)
        .boundingClientRect(rect => {
          if (rect && rect.width > 0 && rect.height > 0) {
            this._runtime.resize(rect.width, rect.height, false)
          }
        })
        .exec()
      // #endif
    },

    onRuntimeEvent(payload) {
      if (!payload || typeof payload !== 'object') return
      if (payload.event === 'ready') {
        this.ready = true
        this.fatalError = false
        this.clearDiagnostic()
        this.$emit('ready', payload.state || null)
        return
      }
      if (payload.event === 'applied') {
        this.clearInvalidPoseDiagnostic()
        this.$emit('pose-applied', payload.frame || null)
        return
      }
      if (payload.event === 'diagnostic' && payload.diagnostic) {
        if (payload.diagnostic.code === DIAGNOSTIC_CODES.INVALID_POSE) {
          this.$emit('pose-invalid', payload.diagnostic)
        }
        this.setDiagnostic(payload.diagnostic)
      }
    },

    setDiagnostic(diagnostic) {
      if (!diagnostic) return
      this.diagnostic = diagnostic
      this.diagnosticText = formatDiagnostic(diagnostic)
      const fatalCodes = [
        DIAGNOSTIC_CODES.PLATFORM_UNSUPPORTED,
        DIAGNOSTIC_CODES.THREE_MISSING,
        DIAGNOSTIC_CODES.WECHAT_ADAPTER_MISSING,
        DIAGNOSTIC_CODES.CANVAS_UNAVAILABLE,
        DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE,
        DIAGNOSTIC_CODES.RENDERER_CREATE_FAILED,
        DIAGNOSTIC_CODES.CONTEXT_LOST
      ]
      if (fatalCodes.includes(diagnostic.code)) {
        this.fatalError = true
        this.$emit('error', diagnostic)
      }
      this.$emit('diagnostic', diagnostic)
    },

    clearDiagnostic() {
      this.diagnostic = null
      this.diagnosticText = ''
    },

    clearInvalidPoseDiagnostic() {
      if (this.diagnostic && this.diagnostic.code === DIAGNOSTIC_CODES.INVALID_POSE) {
        this.clearDiagnostic()
      }
    },

    disposeRuntime() {
      if (typeof uni !== 'undefined' && uni.offWindowResize && this._resizeHandler) {
        uni.offWindowResize(this._resizeHandler)
        this._resizeHandler = null
      }
      if (this._runtime) {
        this._runtime.dispose()
        this._runtime = null
      }
      this.ready = false
    }
  }
}
</script>

<!-- #ifdef H5 || APP-PLUS -->
<script module="hp3dRender" lang="renderjs">
import { createPose3DRuntime } from '../../utils/pose3d/pose3dRuntime.js'
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  diagnosticFromError
} from '../../utils/pose3d/diagnostics.js'

function loadThreeGlobal() {
  if (typeof window !== 'undefined' && window.THREE) {
    return Promise.resolve(window.THREE)
  }
  if (this._threePromise) return this._threePromise

  const sources = []
  // #ifdef APP-PLUS
  sources.push('./static/models/vendor/three.min.js')
  sources.push('/static/models/vendor/three.min.js')
  // #endif
  // #ifdef H5
  sources.push('/static/models/vendor/three.min.js')
  sources.push('./static/models/vendor/three.min.js')
  // #endif

  this._threePromise = new Promise((resolve, reject) => {
    const tryNext = index => {
      if (index >= sources.length) {
        reject(new Error(DIAGNOSTIC_CODES.THREE_MISSING))
        return
      }
      if (typeof document === 'undefined') {
        reject(new Error(DIAGNOSTIC_CODES.PLATFORM_UNSUPPORTED))
        return
      }
      const script = document.createElement('script')
      script.src = sources[index]
      script.async = true
      script.onload = () => {
        if (window.THREE) resolve(window.THREE)
        else tryNext(index + 1)
      }
      script.onerror = () => {
        if (script.parentNode) script.parentNode.removeChild(script)
        tryNext(index + 1)
      }
      document.head.appendChild(script)
    }
    tryNext(0)
  })
  return this._threePromise
}

function mapCreateError(error) {
  const message = String((error && error.message) || error)
  if (message.includes(DIAGNOSTIC_CODES.THREE_MISSING)) {
    return createDiagnostic(DIAGNOSTIC_CODES.THREE_MISSING, message)
  }
  if (message.includes(DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE)) {
    return createDiagnostic(DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE, message)
  }
  return diagnosticFromError(DIAGNOSTIC_CODES.RENDERER_CREATE_FAILED, error)
}

export default {
  mounted() {
    this._onPageHide = () => this.teardown()
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this._onPageHide)
    }
    this.setup()
  },
  beforeDestroy() {
    this.teardown()
  },
  methods: {
    report(event, payload) {
      if (this.$ownerInstance && this.$ownerInstance.callMethod) {
        this.$ownerInstance.callMethod('onRuntimeEvent', {
          event,
          ...(payload || {})
        })
      }
    },

    reportDiagnostic(diagnostic) {
      this.report('diagnostic', { diagnostic })
    },

    async setup() {
      const host =
        (this.$el && this.$el.querySelector && this.$el.querySelector('.hp3d-host')) ||
        this.$el
      if (!host || typeof document === 'undefined') {
        this.reportDiagnostic(
          createDiagnostic(DIAGNOSTIC_CODES.CANVAS_UNAVAILABLE)
        )
        return
      }

      const rect = host.getBoundingClientRect
        ? host.getBoundingClientRect()
        : { width: 320, height: 300 }
      const canvas = document.createElement('canvas')
      canvas.className = 'hp3d-webgl-canvas'
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      host.appendChild(canvas)
      this._host = host
      this._canvas = canvas

      try {
        const THREE = await loadThreeGlobal.call(this)
        const bridge = this.bridge || this.prop || this._pendingBridge || {}
        const ratio =
          Number.isFinite(bridge.pixelRatio) && bridge.pixelRatio > 0
            ? bridge.pixelRatio
            : window.devicePixelRatio || 1
        this.runtime = createPose3DRuntime(THREE, canvas, {
          width: Math.max(1, Math.round(rect.width || 320)),
          height: Math.max(1, Math.round(rect.height || 300)),
          pixelRatio: ratio,
          preflightWebGL: true,
          rigOptions: bridge.rig || {},
          mappingOptions: bridge.mapping || {},
          onDiagnostic: diagnostic => this.reportDiagnostic(diagnostic)
        })
      } catch (error) {
        this.reportDiagnostic(mapCreateError(error))
        return
      }

      this._observer = null
      if (typeof ResizeObserver !== 'undefined' && host) {
        this._observer = new ResizeObserver(() => this.resizeToHost())
        this._observer.observe(host)
      }
      this._onWindowResize = () => this.resizeToHost()
      window.addEventListener('resize', this._onWindowResize)

      const initial =
        this._pendingBridge ||
        (this.bridge ? { pose: this.bridge.pose } : null) ||
        (this.prop ? { pose: this.prop.pose } : null)
      if (initial && initial.pose) {
        this.applyPose(initial.pose)
        this._appliedOnce = true
      }
      this._pendingBridge = null
      this.report('ready', { state: this.runtime.getState() })
      if (!this._appliedOnce) {
        // Renderjs prop delivery can lag the mounted hook; retry once shortly
        // after the view layer is ready instead of silently showing rest pose.
        setTimeout(() => this.syncInitialPose(), 80)
      }
    },

    syncInitialPose() {
      if (!this.runtime || this._appliedOnce) return
      const source =
        this._pendingBridge ||
        (this.bridge ? { pose: this.bridge.pose } : null) ||
        (this.prop ? { pose: this.prop.pose } : null)
      if (source && source.pose) {
        this.applyPose(source.pose)
        this._appliedOnce = true
      }
    },

    onBridgeChange(newValue) {
      if (!newValue || typeof newValue !== 'object') return
      if (!this.runtime) {
        this._pendingBridge = newValue
        return
      }
      if (newValue.mapping) {
        this.runtime.setMappingOptions(newValue.mapping)
      }
      if (newValue.pose) {
        this.applyPose(newValue.pose)
        this._appliedOnce = true
      }
    },

    applyPose(pose) {
      if (!this.runtime) return
      const applied = this.runtime.update(pose)
      if (applied) {
        this.report('applied', {
          frame: { timestamp: Number(pose && pose.timestamp) || 0, valid: true }
        })
      }
    },

    resizeToHost() {
      if (!this.runtime || !this._host || !this._host.getBoundingClientRect) return
      const rect = this._host.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        this.runtime.resize(rect.width, rect.height, false)
      }
    },

    teardown() {
      if (this._disposed) return
      this._disposed = true
      if (this._observer) {
        this._observer.disconnect()
        this._observer = null
      }
      if (this._onWindowResize && typeof window !== 'undefined') {
        window.removeEventListener('resize', this._onWindowResize)
        this._onWindowResize = null
      }
      if (this._onPageHide && typeof window !== 'undefined') {
        window.removeEventListener('pagehide', this._onPageHide)
        this._onPageHide = null
      }
      if (this.runtime) {
        this.runtime.dispose()
        this.runtime = null
      }
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas)
      }
      this._canvas = null
      this._host = null
    }
  }
}
</script>
<!-- #endif -->

<style scoped>
.hp3d {
  position: relative;
  overflow: hidden;
  background: #f4f7f9;
  border-radius: 10px;
}

.hp3d-host {
  width: 100%;
  height: 100%;
}

.hp3d-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.hp3d-fallback {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #f4f7f9;
}

.hp3d-fallback-text {
  font-size: 13px;
  color: #667;
  text-align: center;
}

.hp3d-diagnostic {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(40, 48, 56, 0.78);
}

.hp3d-diagnostic-text {
  color: #fff;
  font-size: 11px;
  line-height: 1.4;
}
</style>
