# 前端集成 API

> 本阶段不改页面。以下代码是父任务集成时的推荐接法；页面文件不在本工作树的可写范围内。

## 1. 初始化（建议在页面 `onLoad` 或应用启动时执行一次）

```js
import { createUniKeyValueStorage } from '@/repositories/keyValueStorage.mjs'
import { ChunkedSessionRepository } from '@/repositories/chunkedSessionRepository.mjs'

const storage = createUniKeyValueStorage(uni)
const sessionRepo = new ChunkedSessionRepository({ storage })

// 可选：把旧版“最近一次会话”迁入新仓库（幂等，不删除旧 key）
const migration = sessionRepo.migrateLegacyFromStorage()
if (!migration.ok && migration.reason !== 'NO_LEGACY_SESSION') {
  console.warn('session migration skipped:', migration)
}
```

注意：

- repository 不是 Vue 响应式数据；建议放在模块作用域或 `markRaw()`，不要塞进 `data()` 让大数组被深度代理。
- `createUniKeyValueStorage(uni)` 只是包装，不会在模块加载时访问 `uni`，因此 Node 测试无需 mock。

## 2. BLE 回调：解析 -> 校验 -> 算法 -> 存储 -> 渲染

```js
import { ingestSample, toAlgorithmSample } from '@/services/sampleIngestion.mjs'

let sessionId = null // 录制中才非空

function onBleSample(sample) {
  // 1) 摄入策略：需要严格 CRC/有效姿态时显式开启
  const result = ingestSample(sample, {
    rejectCrcFailure: true,
    rejectInvalidPose: true
  })

  if (!result.accepted) {
    console.warn('sample rejected:', result.rejectedReason, result.errors)
    return
  }

  // 2) 存储：始终存 {w,x,y,z} 对象，原样保留未知字段
  if (sessionId) {
    try {
      sessionRepo.appendSample(sessionId, result.sample)
    } catch (error) {
      // QUOTA_EXCEEDED / VERIFY_FAILED / SESSION_FINALIZED ...
      handleStorageError(error)
    }
  }

  // 3) 算法：必须显式转数组，不能把对象直接传给 AlgorithmManager
  const converted = toAlgorithmSample(result.sample)
  if (converted.ok) {
    const algorithmResult = algorithmManager.processSensorData(converted.sample)
    updateAlgorithmDisplay(algorithmResult)
  } else {
    // 姿态无效：跳过算法，但存储/告警仍可继续
    console.warn('algorithm skipped:', converted.errors)
  }

  // 4) 渲染：只消费 PoseFrame；valid=false 时走 fallback
  if (result.poseFrame.valid) {
    bodyRenderer?.update(result.poseFrame)
  } else {
    bodyRenderer?.showInvalidPose()
  }
}
```

`ingestSample()` 的返回：

- `accepted`：是否通过摄入策略（默认只要求是对象；CRC 失败默认接受）。
- `algorithmReady`：`accepted && poseFrame.valid`，可直接用作算法门禁。
- `rejectedReason`：例如 `CRC_FAILED`。
- `warnings`：可上报诊断，不建议逐条弹窗。

### 现有页面的接入位置

| 现页面 | 建议改动 |
| --- | --- |
| `pages/index/index.vue` `bluetoothManager.onDataReceived` | 改为调用上面的 `onBleSample(sample)`，再更新原有 `dataText` |
| `updateSensorData()` | 模拟帧也走 `ingestSample()`；`bodyFrameDisplay` 保留现有算法输出 |
| `startSession()` | `sessionId = sessionRepo.createSession({ startTs: Date.now() }).id` |
| `stopSession()` | `sessionRepo.finalizeSession(sessionId, { endTs: Date.now() })`，然后 `sessionId = null` |
| `raiseAlarm()` / 事件 | `sessionRepo.appendEvent(sessionId, { time, drop, timestamp: now, type: 'temperature_drop' })` |
| `pages/history/history.vue` `loadSession()` | 改为 `sessionRepo.loadSession(id)` 或 `tryLoadSession(id)`，不要再 `JSON.parse` 旧 key |

**已知页面问题（本阶段不修）**：

- `history.vue` 中 `renderBody()` 定义了两次（约 204 行与 403 行），后者覆盖前者；`onSliderChanging`/`onSliderChange` 也重复。父任务清理时保留一个版本。
- `history.vue` 仍只读 `baby_band_last_session_v1`；迁移后需要改成仓库读取，否则看不到新会话。
- `index.vue` 的 `stopSession()` 没有 try/catch；接入仓库后应捕获 `StorageQuotaError`。

## 3. 录制生命周期

```js
// 开始
sessionId = sessionRepo.createSession({
  startTs: Date.now(),
  meta: { source: 'ble', appVersion: '1.0.0' }
}).id

// 追加
sessionRepo.appendSample(sessionId, sample)

// 停止
sessionRepo.finalizeSession(sessionId, { endTs: Date.now() })
sessionId = null
```

- `createSession()` 返回完整 `Session`（含 `id`、空 `samples`/`events`）。
- `appendSample()` 返回 `SessionSummary`，不返回整个会话，避免大数组复制。
- 结束后继续追加会抛 `SESSION_FINALIZED`；这属于调用方状态错误。

## 4. 实时渲染

渲染器只需要：

```js
import { normalizePoseFrame } from '@/types/sensorSample.mjs'

function render(frame) {
  const safe = normalizePoseFrame(frame)
  if (!safe.valid) {
    // 保留上一帧 / 显示“姿态无效” / 隐藏模型，三选一
    return
  }
  // safe.rotations.q0/q1/q2 为 {w,x,y,z}
  // 渲染器内部需要数组时自行 quaternionToArray()
}
```

- `normalizePoseFrame()` 对 `null`、字段缺失、非法四元数都不会抛异常。
- `valid=false` 时 `rotations` 是单位四元数占位，**不要**把它当成真实姿态。
- 渲染器/3D 组件由 body3d 工作树实现；本阶段没有接入或真机验证。

## 5. 同步回放

```js
import { toPoseFrame } from '@/types/sensorSample.mjs'

const loaded = sessionRepo.tryLoadSession(sessionId)
if (!loaded.ok) {
  showReplayError(loaded.error)
  return
}

const session = loaded.session
let cursor = 0

function seekTo(timestamp) {
  // 示例：按时间戳找到不晚于目标时间的样本
  while (cursor + 1 < session.samples.length && session.samples[cursor + 1].ts <= timestamp) {
    cursor += 1
  }
  renderer.update(toPoseFrame(session.samples[cursor]))
}
```

回放注意：

- 样本 `ts` 是客户端接收时间；如果要做严格设备时间轴，需等固件确认 `deviceMs` 语义后再用。
- 大量样本不要一次性绘制；按时间窗口取帧，或对样本做抽稀。
- 回放与实时共用 `PoseFrame` 契约，渲染层不需要知道数据来自 BLE 还是存储。
- 温度曲线可以继续读 `sample.temp1/2/3`；新字段 `tWaist/tThigh/tAnkle` 与旧字段同步。

## 6. 迁移旧数据

```js
const result = sessionRepo.migrateLegacyFromStorage()

if (result.ok && result.migrated) {
  console.log('migrated legacy session:', result.id)
} else if (result.reason === 'ALREADY_EXISTS') {
  // 幂等，无需处理
} else if (result.reason === 'INVALID_LEGACY_JSON') {
  // 旧数据损坏：不要覆盖，提示用户/上报
}
```

- 旧 key 保留；是否删除由产品决定。
- 迁移后的 id 形如 `legacy-1700000000000`。
- 旧样本的未知字段原样保留。

## 7. 错误处理

```js
function handleStorageError(error) {
  switch (error.code) {
    case 'QUOTA_EXCEEDED':
      uni.showToast({ title: '存储空间不足，录制已停止', icon: 'none' })
      // 父任务可在此调用未来的 deleteSession/清理策略
      break
    case 'VERIFY_FAILED':
    case 'WRITE_FAILED':
      uni.showToast({ title: '保存失败，请重试', icon: 'none' })
      break
    case 'CORRUPT_DATA':
      uni.showToast({ title: '记录已损坏，无法回放', icon: 'none' })
      break
    default:
      console.error('storage error:', error)
  }
}
```

## 8. 平台切换（H5/小程序 -> App SQLite）

页面/服务只依赖 `SessionStore` 语义（见 `src/types/dataContracts.js`）。App 端用 `plus.sqlite` 实现异步版本后：

```js
const sessionStore = isApp
  ? createAppSqliteSessionStore({ /* plus.sqlite 初始化结果 */ })
  : sessionRepo

// App 端是异步的；页面方法改为 async/await
const session = await sessionStore.createSession({ startTs: Date.now() })
await sessionStore.appendSample(session.id, sample)
```

- 不要在 App 端用异步 SQLite 伪装同步接口；统一 `await` 更安全。
- SQLite 的建表、事务、分页和迁移约定见 `storage.md` 第 6 节。
- 本阶段没有实现该适配器，也没有真机验证。

## 9. 最小导入清单

```js
import { ingestSample, toAlgorithmSample } from '@/services/sampleIngestion.mjs'
import { normalizePoseFrame, toPoseFrame } from '@/types/sensorSample.mjs'
import { quaternionToArray } from '@/types/quaternion.mjs'
import { createUniKeyValueStorage } from '@/repositories/keyValueStorage.mjs'
import { ChunkedSessionRepository } from '@/repositories/chunkedSessionRepository.mjs'
```

如果所用构建链对 `.mjs` 解析异常，请先验证 `npm run build:mp-weixin` 与 App 构建；不要改回 `.js` 后直接用 `node --test`（当前包没有 `"type": "module"`，`.js` 会被 Node 当成 CommonJS）。
