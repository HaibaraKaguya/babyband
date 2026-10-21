## 完成报告（本阶段，已按允许范围落地）

### 1. 修改文件
- `src/utils/protocol/babyBandProtocol.js`：CRC 失败现在直接返回 `ok:false`，不再把损坏帧送入算法；输入类型/长度/帧头校验更稳健。
- `src/utils/bluetooth/BluetoothManager.js`：`startNotify()` 返回 Promise；`connect()` 必须等通知开启成功才 resolve；通知失败 reject 并关闭连接；接入重复/过期样本过滤。
- `src/utils/algorithms/Quaternion.js`：新增 `fromQuaternionLike()`、`quaternionToArray()`、`toObject()`、`normalized()`、`isValid()`；显式处理 `{w,x,y,z}` 与 `[w,x,y,z]` 转换，非法值不再产生 NaN。
- `src/utils/algorithms/BodyFrameReconstructor.js`：接受对象/数组四元数；无效输入返回 `valid:false` 的单位姿态，不更新状态、不抛异常。
- `src/utils/algorithms/DHParameters.js`：四元数转换、欧拉角/关节角计算全部做有效性保护。
- `src/utils/algorithms/TemperatureAnalyzer.js`：`tempDiff` 符号修正为 `temp1 - temp2`（腹部减大腿，正值=大腿更凉）；无效标志/非有限值返回 `valid:false` 和 null，不写入历史。
- `src/utils/algorithms/KickDetector.js`：与上述温差方向一致；无效标志/NaN 输入返回 `skipped:true`，不产生假报警。
- `src/utils/algorithms/AlgorithmManager.jsx`：保留为兼容入口，改为 re-export 新实现。
- `src/utils/bodyKinematics.js`：`computeJoints2D` 不再依赖不存在的 `sample.quaternions`，温度缺失/NaN 时回退默认姿势，避免 canvas 收到 NaN。
- `src/mock/deviceData.js`：协议导入改为相对路径，便于 Node 测试。

### 2. 新增文件
- `src/utils/algorithms/AlgorithmManager.js`：算法管理实际实现，输出结构稳定，强制 `attitudeValid`/`tempValid`。
- `src/utils/poseFrame.js`：`buildPoseFrame()` / `sanitizePoseFrame()`，固定输出 `{timestamp, rotations:{q0,q1,q2}, valid}`；缺失/非法输入返回有限单位四元数，不崩溃。
- `src/utils/sampleGuard.js`：纯函数 `evaluateSample()` + 有状态 `createSampleGuard()`，按 `frameSeq`/`deviceMs`/`ts` 识别重复和过期样本，支持 `maxAgeMs`。
- `tests/functionality/`：
  - `protocol.test.mjs`
  - `quaternion.test.mjs`
  - `poseFrame.test.mjs`
  - `algorithmManager.test.mjs`
  - `bluetooth.test.mjs`
  - `sampleGuard.test.mjs`
  - `temperatureDetector.test.mjs`
  - `helpers/frames.mjs`

### 3. 删除文件
无。`AlgorithmManager.jsx` 原实现移动到 `AlgorithmManager.js`，`.jsx` 保留兼容入口，没有删除页面依赖。

### 4. 实际测试结果
执行命令：

```sh
node --experimental-default-type=module --test tests/functionality/*.test.mjs
```

结果：**44 tests / 44 pass / 0 fail / 0 skipped**，耗时约 108–137 ms。

另外执行：

```sh
npm run build:mp-weixin
```

结果：**构建成功，exit 0**（仅有 Sass legacy API 与 browserslist 数据过旧警告，无编译错误）。

说明：项目根 `package.json` 未声明 `"type":"module"`，因此 Node 测试必须带 `--experimental-default-type=module`；未新增任何依赖。

### 5. 需要父级页面修改的缺陷（本阶段未改页面）
- `src/pages/index/index.vue:311-374`
  - 未按 `s.crcOk`、`s.tempValid`、`s.attitudeValid` 拦截 UI 显示、录制和报警；无效温度仍可能进入 `historyT3` 并触发温度下降逻辑。
  - `sessionSamples.push(s)` 直接保存原始样本，未过滤重复/过期/CRC 失败帧。
  - 蓝牙已连接时仍用 1 秒定时器反复处理同一个 `realDataSample`，会重复送入算法；应改为通知驱动或先调用 `sampleGuard`。
  - `s.battery = s.battery || 90` 会把真实电量 0 误改成 90。
  - 未消费 `kickDetected`、`temperatureAnalysis`、`poseFrame`，因此“实时人体视图/姿势事件”尚未接入页面。
- `src/pages/index/index.vue:229-241`
  - 未处理 `onSampleRejected`，也未监听 BLE 连接状态变化；设备断开后 `isBluetoothConnected` 不会自动复位。
- `src/pages/history/history.vue:189-204` 与 `:391-490`
  - `onSliderChanging`、`onSliderChange`、`renderBody` 各定义了两次，后定义覆盖前定义，属于实际页面缺陷；父级应合并。
  - 回放只按温度画 2D 火柴人，未使用 `q0/q1/q2` 或 `PoseFrame`，不满足“同步姿势回放”；父级应使用 `buildPoseFrame/sanitizePoseFrame`。
  - 图表仅检查 NaN，未按 `tempValid`/`attitudeValid` 跳过无效样本。

### 6. 父级集成接口

```js
import AlgorithmManager from '@/utils/algorithms/AlgorithmManager.jsx'
import { buildPoseFrame, sanitizePoseFrame } from '@/utils/poseFrame.js'
import { createSampleGuard } from '@/utils/sampleGuard.js'

const guard = createSampleGuard({ maxAgeMs: 15000 })
const decision = guard.check(sample)
if (!decision.accept) return // duplicate-frame / stale-frame / expired

const result = algorithmManager.processSensorData(sample)
// result.valid / result.attitudeValid / result.tempValid
// result.poseFrame / result.jointAngles / result.temperatureAnalysis
// result.kickDetected
```

注意：姿态无效时 `result.jointAngles` 和 `result.endEffectorPositions` 为 `null`；温度分析无效时 `temperatureAnalysis` 的数值字段为 `null`。渲染器应使用 `sanitizePoseFrame()`，不要直接假设三者都存在。

### 7. 风险与不确定项
- **CRC 算法未确认**：当前同时接受 MODBUS 与 CCITT-FALSE；若固件使用其他 CRC、初值或覆盖范围，所有帧都会被拒绝。字段偏移保持原样，未猜测新协议。
- **数据字节序未确认**：浮点/整数仍按 little-endian 解析；若固件为 big-endian，CRC 可能通过但数值会错误。
- **状态位定义未确认**：`sys` 的 bit0 温度有效、bit1 姿态有效来自现有代码/会议纪要，固件定义可能不同。
- **传感器映射未确认**：q0/q1/q2 分别按腰/腕/踝使用；是否与提案或实际佩戴一致需硬件确认。
- **BLE UUID 未确认**：仍使用 HC-08 的 FFE0/FFE1 假设。
- **设备重启风险**：`frameSeq`/`deviceMs` 复位后，样本守卫会视为 stale；当前在连接/断开时重置，若设备在连接期间重启，父级需调用 `resetIngestionState()` 或 `guard.reset()`。
- **未做真机验证**：没有连接真实设备，无法确认 BLE 通知、固件 CRC、字节序和实际姿态数据。
- **非功能性说明**：`BodyFrameReconstructor.js`、`Quaternion.js` 原文件为混合 CRLF，编辑后统一为 LF，逻辑无变化。

### 8. 启动方式

```sh
cd /home/jaythan/projects/babyband-parallel/functionality
npm ci
npm run dev:mp-weixin     # 微信开发者工具导入 dist/dev/mp-weixin
npm run dev:h5
npm run build:mp-weixin
```

App 端当前 `package.json` 没有 `dev:app-plus`/`build:app-plus` 脚本，需用 HBuilderX 打开项目运行，或后续在允许范围内补充脚本；本阶段未修改 `package.json`。