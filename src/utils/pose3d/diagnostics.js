/**
 * Explicit, user-visible diagnostics for the 3D renderer.
 *
 * Diagnostics are plain objects so they can cross the logic/view boundary
 * (renderjs, mini-program setData) without depending on Error serialization.
 */

export const DIAGNOSTIC_LEVEL = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
})

export const DIAGNOSTIC_CODES = Object.freeze({
  PLATFORM_UNSUPPORTED: 'HP3D_PLATFORM_UNSUPPORTED',
  THREE_MISSING: 'HP3D_THREE_MISSING',
  WECHAT_ADAPTER_MISSING: 'HP3D_WECHAT_ADAPTER_MISSING',
  CANVAS_UNAVAILABLE: 'HP3D_CANVAS_UNAVAILABLE',
  WEBGL_UNAVAILABLE: 'HP3D_WEBGL_UNAVAILABLE',
  RENDERER_CREATE_FAILED: 'HP3D_RENDERER_CREATE_FAILED',
  RENDER_UPDATE_FAILED: 'HP3D_RENDER_UPDATE_FAILED',
  INVALID_POSE: 'HP3D_INVALID_POSE',
  RESIZE_FAILED: 'HP3D_RESIZE_FAILED',
  DISPOSED: 'HP3D_DISPOSED',
  CONTEXT_LOST: 'HP3D_CONTEXT_LOST'
})

const DEFAULT_MESSAGES = {
  [DIAGNOSTIC_CODES.PLATFORM_UNSUPPORTED]:
    '当前平台未启用 3D 渲染（支持 H5、App-vue、微信小程序）',
  [DIAGNOSTIC_CODES.THREE_MISSING]:
    '未找到 three.js 运行时，请确认 src/static/models/vendor/three.min.js 存在',
  [DIAGNOSTIC_CODES.WECHAT_ADAPTER_MISSING]:
    '未找到 threejs-miniprogram，请在项目中执行 npm i threejs-miniprogram@0.0.8 并构建 npm',
  [DIAGNOSTIC_CODES.CANVAS_UNAVAILABLE]:
    '无法获取 canvas 节点，页面可能尚未渲染完成',
  [DIAGNOSTIC_CODES.WEBGL_UNAVAILABLE]:
    '当前 WebGL 上下文不可用，请检查设备/开发者工具是否开启 WebGL',
  [DIAGNOSTIC_CODES.RENDERER_CREATE_FAILED]:
    '3D 渲染器创建失败，已保留 2D/占位回退界面',
  [DIAGNOSTIC_CODES.RENDER_UPDATE_FAILED]:
    '3D 姿态更新失败，已保持上一有效姿态',
  [DIAGNOSTIC_CODES.INVALID_POSE]:
    '收到的姿态帧无效，已保持上一有效姿态',
  [DIAGNOSTIC_CODES.RESIZE_FAILED]:
    '3D 画布尺寸更新失败',
  [DIAGNOSTIC_CODES.DISPOSED]:
    '3D 渲染资源已释放',
  [DIAGNOSTIC_CODES.CONTEXT_LOST]:
    'WebGL 上下文已丢失，请重新进入页面'
}

export function createDiagnostic(code, detail = '', level = DIAGNOSTIC_LEVEL.ERROR) {
  return {
    code,
    level,
    message: DEFAULT_MESSAGES[code] || code,
    detail: detail ? String(detail) : ''
  }
}

export function formatDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object') return ''
  const prefix = diagnostic.code || 'HP3D_UNKNOWN'
  const detail = diagnostic.detail ? ` (${diagnostic.detail})` : ''
  return `[${prefix}] ${diagnostic.message || ''}${detail}`
}

export function diagnosticFromError(code, error) {
  const detail =
    error && typeof error === 'object' && 'message' in error
      ? error.message
      : error
  return createDiagnostic(code, detail)
}
