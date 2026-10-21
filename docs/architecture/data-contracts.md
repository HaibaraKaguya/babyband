# 数据契约

本文档与 `src/types/dataContracts.js` 的 JSDoc 保持一致；二者应同步修改。

## 1. Quaternion

**公开表示始终是对象：**

```ts
type Quaternion = { w: number, x: number, y: number, z: number }
```

`parseBabyBandFrame()` 产出的 `q0/q1/q2` 就是这种对象。**不要改成数组**，也不要假设 `[x,y,z,w]` 顺序。

需要传给现有数学/算法代码时，必须显式转换：

```js
import { quaternionToArray, quaternionFromArray } from '@/types/quaternion.mjs'

const array = quaternionToArray(sample.q0) // [w, x, y, z]
const object = quaternionFromArray(array)   // { w, x, y, z }
```

### 校验/归一化规则

`normalizeQuaternion(input, options)`：

- 只接受 `{ w, x, y, z }` 普通对象；四个分量都必须是有限数字。
- 默认拒绝数组；`{ allowArray: true }` 时才接受旧版 `[w,x,y,z]`（明确用于迁移/兼容）。
- 范数 `<= 1e-8` 视为无效（`ZERO_NORM`）。
- 合法但非单位长度的四元数会被**归一化**；不合法输入不会被“修补”。
- 不修改输入对象。
- 返回结构化结果，不抛异常：

```js
{ ok: true, value: { w, x, y, z }, normalized: boolean, converted: boolean, norm }
// 或
{ ok: false, code, message, field? }
```

错误码：

| code | 含义 |
| --- | --- |
| `NOT_OBJECT` | 不是对象（或数组但未允许） |
| `INVALID_LENGTH` | `allowArray` 下数组长度不是 4 |
| `MISSING_COMPONENT` | 缺少 `w/x/y/z` |
| `NOT_FINITE` | 分量是 `NaN`、`Infinity` 或非数字 |
| `NORM_INVALID` | 分量有限但范数溢出（极端大值） |
| `ZERO_NORM` | 范数为 0 或过小 |

`quaternionToArray()` / `quaternionFromArray()` 是数学边界断言：输入非法时**抛 `TypeError`**，避免把 `NaN` 静默传给算法。

## 2. SensorSample

现有解析器输出的字段（完整 JSDoc 见 `src/types/dataContracts.js`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ts` | `number` | 客户端接收时间，Unix ms；缺失时归一化层补当前时间 |
| `deviceMs` | `number?` | 设备上电毫秒 |
| `frameSeq` | `number?` | 设备帧序号 |
| `sys` | `number?` | 原始状态位 |
| `tempValid` | `boolean?` | `sys` bit0 派生 |
| `attitudeValid` | `boolean?` | `sys` bit1 派生 |
| `q0` | `Quaternion?` | 当前代码注释为腰部 |
| `q1` | `Quaternion?` | 当前代码注释为手腕 |
| `q2` | `Quaternion?` | 当前代码注释为脚踝 |
| `tWaist` / `tThigh` / `tAnkle` | `number?` | 腹/大腿/脚踝温度，℃ |
| `temp1` / `temp2` / `temp3` | `number?` | 旧 UI 别名，分别镜像上面三个字段 |
| `battery` | `number \| null?` | 当前协议未确认电量来源 |
| `crcOk` | `boolean?` | CRC 校验结果 |
| `crcAlg` | `'modbus' \| 'ccitt_false' \| 'unknown'?` | 匹配的 CRC 算法 |
| `parseError` | `string?` | 仅解析失败模拟样本 |

### `normalizeSensorSample(raw, options)`

- 非对象输入：`ok: false`，不抛异常。
- 对象输入：`ok: true`，即使四元数非法；问题放在 `warnings` / `quaternionStates`。
- 非法四元数**保留原值**用于诊断/存储，但不会进入合法的 PoseFrame。
- `ts` 缺失时补 `now`（可用 `{ now }` 固定测试时间），并产生 `MISSING_TIMESTAMP`。
- 温度兼容：
  - `tWaist` 优先；同步写入 `temp1`。
  - 只有 `temp1` 时反填 `tWaist`。
  - 两边都有但不一致时，`tWaist` 为准并产生 `TEMPERATURE_ALIAS_MISMATCH`。
- `crcOk === false` 只产生 `CRC_FAILED` 告警，不自动丢弃样本。
- 输出 `quaternionStates`：

```js
{
  q0: { valid: true, status: 'valid' | 'normalized' },
  q1: { valid: false, status: 'missing' | 'invalid', code, message }
}
```

常用告警码：`MISSING_TIMESTAMP`、`QUATERNION_MISSING`、`QUATERNION_INVALID`、`QUATERNION_NORMALIZED`、`TEMPERATURE_ALIAS_MISMATCH`、`TEMPERATURE_INVALID`、`CRC_FAILED`、`ATTITUDE_INVALID`、`TEMPERATURE_FLAG_INVALID`、`SYS_INVALID`。

## 3. PoseFrame（渲染器契约）

```ts
type PoseFrame = {
  timestamp: number,
  rotations: {
    q0: Quaternion,
    q1: Quaternion,
    q2: Quaternion
  },
  valid: boolean
}
```

示例：

```json
{
  "timestamp": 1700000000000,
  "rotations": {
    "q0": { "w": 1, "x": 0, "y": 0, "z": 0 },
    "q1": { "w": 0.9238795, "x": 0.3826834, "y": 0, "z": 0 },
    "q2": { "w": 0.9981, "x": 0.0615, "y": 0.0017, "z": 0.0008 }
  },
  "valid": true
}
```

语义：

- `rotations` 的三个键**始终存在**；缺失/非法源数据用单位四元数占位。
- `valid === false` 表示**不要信任 rotations**：应显示 fallback、保持上一帧或提示“姿态无效”，不要用占位单位四元数伪装成有效姿态。
- `valid === false` 的触发条件：任一 `q0/q1/q2` 缺失或非法、`attitudeValid === false`。
- CRC 失败**不直接**让 PoseFrame 失效；是否丢弃由摄入策略决定（见下）。
- `timestamp` 始终是有限数字；优先 `sample.ts`，否则取当前时间。

### 构建函数

- `toPoseFrame(sample, { now })`：从 SensorSample 构建。
- `normalizePoseFrame(input, { now })`：渲染器边界防御函数，接受 PoseFrame、SensorSample、`null` 或任意垃圾输入，**永不抛异常**，始终返回完整契约。推荐渲染器入口统一走它。

## 4. 摄入结果（`ingestSample`）

```js
const result = ingestSample(rawSample, {
  rejectCrcFailure: true,
  rejectInvalidPose: true
})

{
  accepted: boolean,        // 是否通过摄入策略
  algorithmReady: boolean,  // accepted 且 PoseFrame.valid
  sample: SensorSample|null,
  poseFrame: PoseFrame,
  warnings: Array<{ code, message, field? }>,
  errors: Array<{ code, message, field? }>,
  rejectedReason: string|null
}
```

- `accepted` 默认只要求输入是对象；CRC 失败/姿态非法仍接受（用于诊断和原始数据留存）。
- `rejectCrcFailure: true` 时，`crcOk === false` 会让 `accepted = false`，`rejectedReason = 'CRC_FAILED'`。
- `rejectInvalidPose: true` 时，`PoseFrame.valid === false` 会让 `accepted = false`，`rejectedReason = 'INVALID_POSE'`。录制正式数据时建议开启。
- `algorithmReady` 为 true 才应调用算法；否则使用 `poseFrame.valid` 决定渲染 fallback。

## 5. Session / Event

```ts
type Session = {
  id: string,
  startTs: number,
  endTs: number | null,
  createdAt?: number,
  updatedAt?: number,
  finalized?: boolean,
  samples: SensorSample[],
  events: StoredEvent[],
  meta?: Record<string, unknown>
}
```

- `samples` 按采集顺序保存，**原样保留未知字段**（例如旧数据里的 `legacyOnlyField`）。
- `events` 兼容现有 `{ time, drop }`，并允许 `timestamp`、`type` 等扩展字段。
- 顶层 `startTs/endTs/samples/events` 与旧格式 `baby_band_last_session_v1` 一致，历史页可以直接复用对象。
- 存储元数据（chunk 数、计数）不暴露在 `Session` 顶层；调用方只看到 `meta`。

## 6. 算法输入转换

现有算法期望数组。`toAlgorithmSample(sample)`：

```js
const converted = toAlgorithmSample(sample)
if (converted.ok) {
  algorithmManager.processSensorData(converted.sample)
}
```

- 返回浅拷贝；原 `sample.q0` 仍是对象。
- 任一分量缺失/非法时 `ok: false`，错误列出字段，不调用算法。
- 不要直接把 `sample` 传给 `AlgorithmManager`：现行实现会把它当数组索引，产生 `undefined/NaN`。
