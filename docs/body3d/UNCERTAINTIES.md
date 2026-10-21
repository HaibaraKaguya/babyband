# 不确定性与风险

## 1. 固件协议

- 本阶段**没有修改** `src/utils/protocol/babyBandProtocol.js`，也没有新增任何消息类型或字节偏移。
- 现有解析器使用：帧长 73、帧头 `0xAA55`、q0 从 offset 7、q1 从 23、q2 从 39、温度 55/59/63、帧序列 67、CRC 71..72（LE）。这些是现有代码事实，不代表已与提案固件核对。
- 提案固件协议与现有代码存在差异；在拿到固件正式协议/抓包前，不应假设 offset、CRC 算法或消息类型。
- `q0/q1/q2` 的物理归属目前按现有代码注释理解为：腰、腕、踝。**未通过真机/标定确认。**

## 2. 传感器安装与姿态映射

- `mapPoseToRig` 假设三个四元数在同一参考系，且腕/踝相对腰的旋转有意义（`conj(q0) * q1` / `conj(q0) * q2`）。
- 如果固件输出的是传感器局部姿态、或坐标轴定义不同，当前映射会看起来方向不对。
- 默认 `mountQ0/Q1/Q2 = identity`，没有做安装矩阵标定。接入后应先调 `mapping.mountQ*` 和 gain，而不是改组件内部数学。
- 只有一个腕、一个踝传感器，无法观测肘/膝关节屈曲；当前手臂/腿为刚性段，肘/膝只是静态几何关节，不随传感器弯曲。
- 默认只驱动右臂/右腿；传感器实际左右侧未知。`drivenArm/drivenLeg` 字段目前不会自动交换场景层级。
- 姿态“好看”不等于“临床正确”；没有与光学动捕/角度计对照。

## 3. 数据有效性

- `poseFrameFromSensorSample` 在 `crcOk === false`、`attitudeValid === false`、`parseError`、缺 timestamp、缺四元数时返回 `valid:false`。
- 无效帧不会崩溃：运行时会保持上一有效姿态；如果从未有过有效帧，则显示 rest pose。
- `timestamp` 需要页面统一：`sample.ts` 是解析时 `Date.now()`，`deviceMs` 是设备上电毫秒。两者不要混在同一条回放时间轴。
- 非单位四元数会被归一化并给出 warning；如果固件刻意输出非单位值，需确认这是噪声还是缩放错误。

## 4. 现有算法链的已知类型风险（未修改）

现有 `AlgorithmManager.processSensorData(sample)` 把 `sample.q2`（对象 `{w,x,y,z}`）直接传给 `Quaternion.fromArray()`，而 `fromArray()` 期望 `[w,x,y,z]`。这会产生 `undefined`/NaN，可能影响 `BodyFrameReconstructor`、DH 角度和踢被检测。

- 该问题在 `src/utils/algorithms/`，**不在本阶段允许修改范围**，因此没有改。
- 本组件不依赖 `AlgorithmManager` 的关节角度，直接使用 `q0/q1/q2`，因此不受该 bug 影响。
- 父级如果希望算法链也正确，应在自己的范围内把对象显式转数组，例如 `toQuaternionArray(sample.q2)`。
- 不要因为 3D 视图能显示，就认为算法链已经修复。

## 5. 平台与运行时

- H5/App 使用 renderjs + 动态 `<script>` 加载 vendored three r149；微信使用 `threejs-miniprogram@0.0.8` 的 scoped three r108。
- 只对 H5、App-vue、微信做了条件编译/构建检查；**没有在浏览器、微信开发者工具或真机运行**。
- App 只支持 app-vue（manifest 当前是 vue 页面）；nvue 不支持 renderjs。
- renderjs 中 `import '@/utils/...'` 与 `this.bridge/this.prop` 的初始值投递时序，按 uni-app 文档和常见用法实现，但没有真机日志验证；组件已加 80ms 初始同步兜底。
- H5 非根路径部署时 `/static/...` 可能失败，已保留 `./static/...` 回退；若仍失败会显示 `HP3D_THREE_MISSING`。
- 微信原生 canvas 层级高，不能放进 `scroll-view/swiper/movable-view`；接入时需放在普通卡片层级。
- 微信适配层 three r108 较旧，若后续使用 GLTFLoader、CapsuleGeometry、新色彩管理等 API 会不兼容。
- `src/static/models/vendor/three.min.js` 约 596 KB，会被复制到**所有**平台包（包括微信）。临时 harness 的微信构建总大小约 1.6 MB，低于 2 MB 主包上限但余量有限；若后续接近上限，需要把 vendor 改为按平台条件打包（本阶段不能改构建配置）。

## 6. 资产

- 当前是程序化风格化婴儿，不是外部婴儿网格；没有集成 Anny/MPFB。
- 没有贴图、没有骨骼蒙皮、没有表情/手指细节。
- 模型比例是手工设定，不是按真实婴儿测量；不应作为医学判断依据。

## 7. 未验证清单

- 真机 BLE → 解析 → PoseFrame → 3D 全链路。
- 真机 WebGL 上下文创建、纹理/几何释放、前后台切换。
- 微信开发者工具“构建 npm”后的实际运行。
- App 真机 renderjs 动态脚本路径。
- 传感器安装方向与 q0/q1/q2 物理对应关系。
- 现有算法链 NaN 问题对页面其他指标的影响。

## 8. 测试环境

- Node v22.23.1。
- 项目 `package.json` 没有 `"type":"module"`，测试使用 `node --experimental-default-type=module` 运行 `.js` ESM 源码；没有修改 package.json。
- 真实 three smoke test 在 `/home/jaythan/projects/babyband-references/three-smoke`，不属于仓库依赖。
