# HumanPose3D 接入说明（给页面负责人）

本阶段只交付组件、运行时、程序化资产、测试和文档。**没有修改任何页面、`package.json` 或 lockfile。**

## 1. 依赖

### 微信小程序（必需）

```sh
npm install threejs-miniprogram@0.0.8 --save
```

- 包：`threejs-miniprogram@0.0.8`，MIT，微信官方适配层，内部是 three.js r108。
- CLI 项目执行 `npm run build:mp-weixin` 即可（Vite 会打包依赖）。
- 如果用 HBuilderX 直接运行，安装后在微信开发者工具执行“工具 → 构建 npm”。
- 不安装时组件不会崩溃：会显示 `HP3D_WECHAT_ADAPTER_MISSING` 诊断并保留回退 UI。

### H5 / App-vue（无新增 npm 依赖）

- three.js r149 UMD 已放在 `src/static/models/vendor/three.min.js`（MIT，见同目录 `THREE-LICENSE.txt`）。
- renderjs 通过 `<script>` 动态加载：
  - App：`./static/models/vendor/three.min.js`
  - H5：`/static/models/vendor/three.min.js`，失败后回退 `./static/...`
- 如果部署在非根路径，建议改为相对路径或调整 `loadThreeGlobal()` 的候选列表。

**不要**为了前端安装 Python/PyTorch/Anny/MPFB；本阶段没有这样做。

## 2. PoseFrame 契约

```js
{
  timestamp: 1710000000000,
  rotations: {
    q0: { w: 1, x: 0, y: 0, z: 0 }, // 腰
    q1: { w: 1, x: 0, y: 0, z: 0 }, // 腕
    q2: { w: 1, x: 0, y: 0, z: 0 }  // 踝
  },
  valid: true
}
```

- `q0/q1/q2` 保持现有解析器的 `{w,x,y,z}` 公共表示。
- 传入 `[w,x,y,z]` 也会被接受，但输出仍是 `{w,x,y,z}`。
- 缺失、NaN、零四元数、缺 timestamp、CRC/姿态有效位失败都会得到 `valid:false`，组件**不会抛异常**，会保持上一有效姿态。
- 时间轴/回放请使用同一套时间基准（`sample.ts` 优先；没有 `ts` 时才用 `deviceMs`，再没有则帧无效）。

转换帮助函数：

```js
import {
  poseFrameFromSensorSample,
  normalizePoseFrame
} from '@/utils/pose3d/poseFrame.js'

const frame = poseFrameFromSensorSample(sample, {
  timestamp: sample.ts || Date.now()
})
```

## 3. 首页实时视图接入

### 3.1 引入组件

```js
import HumanPose3D from '@/components/HumanPose3D/HumanPose3D.vue'
import { poseFrameFromSensorSample } from '@/utils/pose3d/poseFrame.js'

export default {
  components: { HumanPose3D },
  data() {
    return {
      poseFrame: null,
      pose3dError: ''
    }
  },
  methods: {
    onPose3dError(diagnostic) {
      this.pose3dError = diagnostic && diagnostic.message ? diagnostic.message : '3D 不可用'
    },
    onPose3dReady(state) {
      // state: { rigVersion, width, height, triangles, drawCalls, ... }
      console.log('3D ready', state)
    }
  }
}
```

### 3.2 在现有采样更新处喂帧

在 `updateSensorData()` 拿到 `s`（真实或 mock）后、调用现有算法链之后加一行：

```js
this.poseFrame = poseFrameFromSensorSample(s, {
  timestamp: s.ts || Date.now()
})
```

现有 `algorithmManager.processSensorData(s)`、温度、报警、录制逻辑保持不变。`poseFrame` 只读取 `q0/q1/q2` 和有效位，不改协议。

### 3.3 模板

**保留现有二维 canvas/回退 UI**，在旁边新增卡片（或先隐藏旧 canvas，等 `@ready` 再切换）：

```html
<view class="card">
  <view class="cardTitle">
    <text class="h2">3D 姿态视图</text>
  </view>

  <HumanPose3D
    :pose="poseFrame"
    :height="320"
    :mapping="{ relativeToWaist: true, armGain: 1, legGain: 1 }"
    @ready="onPose3dReady"
    @error="onPose3dError"
  >
    <template #fallback>
      <!-- 这里可以放原有二维 canvas，或保留原来的占位文案 -->
      <text class="muted">3D 视图初始化中，继续使用原有二维显示</text>
    </template>
  </HumanPose3D>

  <view v-if="pose3dError" class="muted">{{ pose3dError }}</view>
</view>
```

注意：

- 微信小程序 `canvas type="webgl"` 是原生组件，**不要**放进 `scroll-view`/`swiper`/`movable-view`；放在普通卡片层级。
- 组件默认 `showFallback=true`，初始化完成前显示 slot；`@ready` 后自动隐藏。
- 如果页面想继续显示旧二维图，不需要删任何旧代码；把旧 canvas 留在组件外即可。

## 4. 历史回放接入

`session.samples` 已包含 `ts` 和 `q0/q1/q2`，无需迁移存储格式。

### 4.1 拖动回放（与现有 slider 同步）

```js
import { poseFrameFromSensorSample } from '@/utils/pose3d/poseFrame.js'

computed: {
  currentPoseFrame() {
    const s = this.currentSample
    if (!s || !s.ts) return null
    return poseFrameFromSensorSample(s, { timestamp: s.ts })
  }
}
```

```html
<HumanPose3D :pose="currentPoseFrame" :height="300" @error="onPose3dError" />
```

现有温度曲线、slider、采样预览仍用同一个 `currentSample`，因此温度游标和 3D 姿态天然同步。

### 4.2 自动播放/平滑插值

```js
import { PoseTimeline } from '@/utils/pose3d/poseTimeline.js'
import { poseFrameFromSensorSample } from '@/utils/pose3d/poseFrame.js'

const timeline = new PoseTimeline({ capacity: 1200, interpolate: true })
for (const s of session.samples) {
  if (!s.ts) continue
  timeline.push(poseFrameFromSensorSample(s, { timestamp: s.ts }))
}

// 播放 tick：playheadTs 与温度曲线使用同一时间轴
const frame = timeline.sampleAt(playheadTs)
this.poseFrame = frame // 无效区间会保持最近有效姿态并带 warning
```

`PoseTimeline` 行为：

- 按 timestamp 排序、重复 timestamp 覆盖、容量满丢弃最旧。
- 两帧都有效时对 q0/q1/q2 做球面插值（slerp）。
- 相邻帧无效时保持最近有效姿态；整个区间无有效帧时返回 identity + `valid:false`。

## 5. 组件 Props / 事件

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `pose` | Object | null | PoseFrame；无效输入不崩溃 |
| `width` | Number/String | `'100%'` | 数字按 px |
| `height` | Number/String | `300` | 数字按 px |
| `mapping` | Object | `{}` | `torsoGain/armGain/legGain`（0..1）、`relativeToWaist`、`mountQ0/Q1/Q2` |
| `rig` | Object | `{}` | 皮肤/衣服/支撑垫颜色；仅挂载时生效 |
| `pixelRatio` | Number | 0 | 0 表示自动（H5/App 用 devicePixelRatio，小程序用系统 dpr） |
| `showFallback` | Boolean | true | 未 ready/致命错误时显示 slot |
| `showDiagnostics` | Boolean | true | 显示底部诊断条 |
| `fallbackText` | String | 见源码 | 默认回退文案 |

| 事件 | 参数 | 说明 |
|---|---|---|
| `ready` | runtime state | WebGL/rig 初始化完成 |
| `error` | diagnostic | 仅致命错误（缺 three、缺适配层、无 canvas/WebGL、创建失败、上下文丢失） |
| `diagnostic` | diagnostic | 所有诊断（含可恢复错误） |
| `pose-applied` | `{timestamp, valid}` | 成功应用一帧 |
| `pose-invalid` | frame 或 diagnostic | 无效帧（会保持上一姿态） |

## 6. 生命周期与资源释放

- 微信：`beforeUnmount` → `runtime.dispose()`；同时注销 `uni.onWindowResize`。
- H5/App：renderjs 在 `pagehide`/`beforeDestroy` 调用 `teardown()`；同时监听容器 `ResizeObserver` 和 `window.resize`。
- `dispose()` 幂等：遍历释放 geometry/material/texture，调用 `renderer.dispose()`/`forceContextLoss()`，移除 DOM 监听和 canvas。
- 页面销毁后不要再向 `pose` 写帧；组件已卸载时更新不会执行渲染。

## 7. 启动命令

```sh
npm ci
npm install threejs-miniprogram@0.0.8 --save   # 仅微信小程序需要
npm run dev:h5
npm run dev:mp-weixin
```

构建：

```sh
npm run build:h5
npm run build:mp-weixin
```

## 8. 已知限制（接入前请读）

- 程序化婴儿模型是**风格化几何体**，不是解剖/临床模型，也不是外部扫描网格。
- q0/q1/q2 分别按腰/腕/踝使用，且腕/踝相对腰计算；传感器安装方向未标定，`mountQ*` 默认 identity。若姿态方向不对，先调 `mapping` 的 gain/mount，而不是改协议。
- 只有一个腕、一个踝传感器，无法推断肘/膝弯曲；手臂和腿是刚性段。
- 没有真机验证。详见 `UNCERTAINTIES.md` 和 `TEST_REPORT.md`。
