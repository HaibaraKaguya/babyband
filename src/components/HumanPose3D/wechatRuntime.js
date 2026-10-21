/**
 * WeChat-only runtime bootstrap.
 *
 * Imported behind `#ifdef MP-WEIXIN` from HumanPose3D.vue. The
 * `threejs-miniprogram` dependency is required for this platform only.
 */

import { createScopedThreejs } from 'threejs-miniprogram'
import { createPose3DRuntime } from '@/utils/pose3d/pose3dRuntime.js'
import { DIAGNOSTIC_CODES } from '@/utils/pose3d/diagnostics.js'

function queryCanvas(componentInstance, canvasId) {
  return new Promise((resolve, reject) => {
    const query = uni.createSelectorQuery().in(componentInstance)
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec(result => {
        const entry = result && result[0]
        if (!entry || !entry.node) {
          reject(new Error(DIAGNOSTIC_CODES.CANVAS_UNAVAILABLE))
          return
        }
        resolve(entry)
      })
  })
}

/**
 * @param {{
 *   componentInstance: object,
 *   canvasId: string,
 *   width?: number,
 *   height?: number,
 *   pixelRatio?: number,
 *   mappingOptions?: object,
 *   onDiagnostic?: (diagnostic:object)=>void
 * }} options
 * @returns {Promise<object>} pose3d runtime
 */
export async function createWeChatPose3DRuntime(options) {
  const entry = await queryCanvas(options.componentInstance, options.canvasId)
  const canvas = entry.node
  const width = Math.max(1, Math.round(entry.width || options.width || 320))
  const height = Math.max(1, Math.round(entry.height || options.height || 300))
  let pixelRatio = options.pixelRatio
  if (!Number.isFinite(pixelRatio)) {
    try {
      pixelRatio = uni.getSystemInfoSync().pixelRatio || 1
    } catch (error) {
      pixelRatio = 1
    }
  }

  // The adapter's renderer writes canvas.width/height; seed them so the first
  // frame is not rendered into a 300x150 default buffer.
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)

  let THREE
  try {
    THREE = createScopedThreejs(canvas)
  } catch (error) {
    const message = String((error && error.message) || error)
    if (/webgl|getContext/i.test(message)) {
      throw new Error(`${DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE}: ${message}`)
    }
    throw new Error(`${DIAGNOSTIC_CODES.WECHAT_ADAPTER_MISSING}: ${message}`)
  }

  if (!THREE) throw new Error(DIAGNOSTIC_CODES.WECHAT_ADAPTER_MISSING)

  return createPose3DRuntime(THREE, canvas, {
    width,
    height,
    pixelRatio,
    preflightWebGL: false,
    mappingOptions: options.mappingOptions || {},
    onDiagnostic: options.onDiagnostic
  })
}

export default createWeChatPose3DRuntime
