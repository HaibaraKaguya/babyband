# Body3D 架构

## 1. 范围

本阶段实现“姿态帧 → 3D 婴儿姿态视图”的组件和运行时，不触碰 BLE 解析、算法、存储、页面。上游仍按现有链路：

```text
BLE / mock
  -> BabyBandStreamParser / parseBabyBandFrame
  -> sample { q0,q1,q2:{w,x,y,z}, ts, attitudeValid, crcOk, ... }
  -> AlgorithmManager（现有）
  -> 页面构造 PoseFrame
  -> HumanPose3D
  -> three.js 场景（WebGL）
```

`HumanPose3D` 不是 2D canvas 骨骼图。它创建 three.js `Scene`、`PerspectiveCamera`、`WebGLRenderer`、灯光和程序化关节层级，并按帧重绘。

## 2. 文件职责

```text
src/utils/pose3d/
  quaternion.js       公共 {w,x,y,z} 与数学 [w,x,y,z] / three {x,y,z,w} 的显式转换
  poseFrame.js        PoseFrame 契约、校验/归一化、SensorSample -> PoseFrame
  poseMapping.js      腰/腕/踝 -> 躯干/右臂/右腿关节四元数
  poseTimeline.js     有界时间轴、排序、slerp、无效帧保持
  proceduralRig.js    程序化婴儿关节层级、应用姿态、资源释放
  pose3dRuntime.js    Scene/Camera/Lights/Renderer、update/resize/dispose
  diagnostics.js      可跨逻辑层/视图层传输的诊断对象
  index.js            纯 JS 导出入口

src/components/HumanPose3D/
  HumanPose3D.vue     平台隔离：H5/App renderjs，MP-WEIXIN 原生 canvas，其它平台回退
  wechatRuntime.js    MP-WEIXIN: createSelectorQuery -> createScopedThreejs -> runtime

src/static/models/
  vendor/three.min.js H5/App 用 three r149 UMD（MIT）
  procedural/infant_rig_v1.json  程序化资产的尺寸/关节说明（文档用途）
```

## 3. 数据契约

### 3.1 输入

```js
{
  timestamp: number,
  rotations: {
    q0: { w, x, y, z },
    q1: { w, x, y, z },
    q2: { w, x, y, z }
  },
  valid: boolean
}
```

- `q0/q1/q2` 公共表示永远是 `{w,x,y,z}`，与 `babyBandProtocol.js` 一致。
- 数学函数接受 `[w,x,y,z]`，但内部先显式转对象。
- `normalizePoseFrame()` 不抛异常，返回固定结构；缺槽位用 identity 填充并置 `valid:false`。
- `valid` 需要：三个四元数有限且非零、timestamp 有限、上游未标记 false、`attitudeValid !== false`（由 `poseFrameFromSensorSample` 附加）、`crcOk !== false`。
- 非单位四元数会被归一化，并产生 `severity:'warning'` 的 `non_unit_*`，不直接判无效。

### 3.2 输出给渲染器

`mapPoseToRig()` 返回：

```js
{
  timestamp,
  valid,
  torso: {w,x,y,z},
  rightArm: {w,x,y,z},
  rightLeg: {w,x,y,z},
  issues: [...]
}
```

渲染前再显式转换为 three 的 `{x,y,z,w}`：

```js
rigPoseToThreeArgs(rigPose)
```

## 4. 姿态映射

```text
torso    = gain(q0 * mountQ0, torsoGain)
rightArm = gain(conj(q0) * (q1 * mountQ1), armGain)
rightLeg = gain(conj(q0) * (q2 * mountQ2), legGain)
```

- `q0` 作为躯干参考；腕/踝取相对腰的旋转。
- `gain` 通过“identity → delta”的 slerp 实现，范围 0..1，便于调小夸张摆动。
- 默认只驱动右臂、右腿；`drivenArm/drivenLeg` 目前是元数据，场景层级固定右臂/右腿，避免在不明确传感器左右安装时伪造另一侧。
- `mountQ*` 是传感器安装修正，默认 identity。**这不是标定结果。**

## 5. 程序化模型

`createProceduralInfantRig(THREE)`：

- 坐标系：`+X` 头/前，`+Y` 身体右侧，`+Z` 上；婴儿仰卧。
- 关节层级：
  - `pelvis`
    - `waist_joint`（q0）→ 躯干、头、左右臂
      - `right_arm_joint`（q1 相对 q0）→ 肘/手
      - `left_arm_joint`（静态）
    - `right_leg_joint`（q2 相对 q0）→ 膝/脚
    - `left_leg_joint`（静态）
- 全部由 `SphereGeometry`、`CylinderGeometry`、`BoxGeometry` 构成，约 21 个 mesh。
- 不使用 `CapsuleGeometry`、`GLTFLoader`、贴图或外部模型，保证 three r108（微信适配层）和 r149（H5/App）都能运行。
- 释放：geometry 去重 dispose、material 去重 dispose、从父节点移除、清空引用；幂等。

## 6. 运行时

`createPose3DRuntime(THREE, canvas, options)`：

- Scene + PerspectiveCamera + AmbientLight + 两个 DirectionalLight。
- `WebGLRenderer({ canvas, antialias })`。
- 按更新渲染，不启动永久 RAF：BabyBand 约 1 Hz，避免小程序/手机持续耗电。
- `update(poseFrame)`：
  - 归一化；
  - 无效 → 计数、发 `HP3D_INVALID_POSE`、保持上一有效姿态（首次无效则 rest pose），返回 false；
  - 有效 → 映射、应用 `rest * delta`、`renderer.render`，记录 `lastValidTimestamp`。
- `resize(w,h)`：更新 renderer 和 camera aspect；非法尺寸发 `HP3D_RESIZE_FAILED`。
- `dispose()`：移除 contextlost 监听、释放 rig、renderer、scene 引用；可重复调用。
- `webglcontextlost`：`preventDefault()` 并发 `HP3D_CONTEXT_LOST`。

## 7. 平台隔离

| 平台 | 入口 | three 来源 | canvas | 生命周期 |
|---|---|---|---|---|
| H5 | `<script module lang="renderjs">` | 动态 `<script>` 加载 `/static/models/vendor/three.min.js` (r149) | renderjs 内 `document.createElement('canvas')` 挂到 host | `pagehide` / `beforeDestroy` |
| App-vue | 同一 renderjs | 动态 `<script>` 加载 `./static/models/vendor/three.min.js` (r149) | 同上 | 页面/webview 销毁 + `pagehide` |
| 微信小程序 | 普通 `<script>` + 原生 `<canvas type="webgl">` | `threejs-miniprogram@0.0.8` 的 `createScopedThreejs` (r108) | `createSelectorQuery().fields({node:true})` | `beforeUnmount` + `uni.offWindowResize` |
| 其它小程序/平台 | 无 canvas | 无 | 无 | 显示 `HP3D_PLATFORM_UNSUPPORTED`，保留 fallback |

条件编译：

- 模板：`#ifdef MP-WEIXIN` / `#ifdef H5 || APP-PLUS` / 嵌套 `#ifndef` 回退。
- 逻辑脚本：MP 的 `wechatRuntime` 只在 `#ifdef MP-WEIXIN` 内 import，避免 H5 构建解析未安装的包。
- renderjs 整块包在 `#ifdef H5 || APP-PLUS` 内。

## 8. 诊断

| code | 触发 | 是否致命 |
|---|---|---|
| `HP3D_PLATFORM_UNSUPPORTED` | 非 H5/App-vue/微信 | 是 |
| `HP3D_THREE_MISSING` | vendor 脚本加载失败 | 是 |
| `HP3D_WECHAT_ADAPTER_MISSING` | 未安装 threejs-miniprogram | 是 |
| `HP3D_CANVAS_UNAVAILABLE` | 取不到 canvas node / host | 是 |
| `HP3D_WEBGL_UNAVAILABLE` | 无 WebGL 上下文 | 是 |
| `HP3D_RENDERER_CREATE_FAILED` | WebGLRenderer 构造失败 | 是 |
| `HP3D_RENDER_UPDATE_FAILED` | 渲染/更新抛错 | 否（保留上一帧） |
| `HP3D_INVALID_POSE` | 无效 PoseFrame | 否（保留上一姿态） |
| `HP3D_RESIZE_FAILED` | 尺寸非法/调整失败 | 否 |
| `HP3D_CONTEXT_LOST` | WebGL context lost | 是 |
| `HP3D_DISPOSED` | 释放后 update | 否 |

诊断对象可跨 renderjs/小程序 `callMethod` 传递，避免依赖 Error 序列化。

## 9. 回退 UI

- 组件自身有 `fallback` slot 和诊断条。
- 页面必须保留现有 2D canvas/占位 UI；组件只新增，不替换。
- 初始化失败时组件显示 `fallbackText`，不会让页面白屏。
- 无效帧不会让 3D 黑屏；保持上一有效姿态并显示诊断文字。

## 10. 测试与验证边界

- 纯 JS 单测覆盖：显式四元数转换、identity/相对旋转、gain、无效帧、时间轴插值/容量、fake-three 场景与幂等释放。
- 真实 three r149 的 scene/rig 释放 smoke test（外部目录，不进入仓库）。
- 对 H5/App/微信/支付宝做条件编译 + SFC 编译检查。
- 在临时副本里把组件接入一个测试页面，完成 H5 和微信小程序**构建**验证；未在真机/开发者工具运行。
- 未做真机 BLE、真机 WebGL、真实传感器方向验证。
