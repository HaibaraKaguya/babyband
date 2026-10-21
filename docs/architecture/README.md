# 架构层说明（第一阶段）

本阶段只建立**与页面解耦**的数据契约、校验/归一化、摄取入口和会话存储抽象。现有页面、BLE 管理器、协议解析器和算法实现均未修改；由父任务后续集成。

## 数据流

```text
BLE notify
  -> BluetoothManager / BabyBandStreamParser（现有，不改）
  -> parseBabyBandFrame() 产出 SensorSample
        q0/q1/q2 为 { w, x, y, z } 对象
  -> src/services/sampleIngestion.mjs: ingestSample()
        - 归一化四元数、温度别名、时间戳
        - 生成 renderer 可直接消费的 PoseFrame
        - 可选 CRC 拒绝策略
  -> 算法层（现有 AlgorithmManager）
        必须通过 toAlgorithmSample() 显式转为 [w,x,y,z] 数组
  -> ChunkedSessionRepository
        session / samples / events 分块持久化
  -> PoseFrame -> 3D 渲染器 / 实时人体视图
  -> 回放：loadSession() -> 每条 sample -> toPoseFrame() / normalizePoseFrame()
```

关键原则：**存储与算法之间不共享可变对象**。`toAlgorithmSample()` 返回浅拷贝，并把对象四元数转换为数组；存储仍保存 `{ w, x, y, z }`。

## 模块边界

| 路径 | 职责 | 是否依赖 `uni` |
| --- | --- | --- |
| `src/types/dataContracts.js` | 纯 JSDoc 契约：SensorSample、PoseFrame、Session、存储端口 | 否 |
| `src/types/quaternion.mjs` | 四元数校验、单位化、对象↔数组显式转换 | 否 |
| `src/types/sensorSample.mjs` | 样本归一化、温度别名兼容、PoseFrame 安全构造 | 否 |
| `src/services/sampleIngestion.mjs` | BLE 回调入口：校验策略 + 算法输入转换 | 否 |
| `src/repositories/keyValueStorage.mjs` | 同步键值存储端口、uni 适配器工厂 | 仅工厂函数接收 `uni` |
| `src/repositories/chunkedSessionRepository.mjs` | 分块会话存储、迁移、配额/写失败处理 | 否（通过端口注入） |
| `src/repositories/storageErrors.mjs` | 类型化存储错误 | 否 |

这种分层让核心逻辑可在 `node --test` 中直接运行，不需要模拟 `uni`，也为 App 的 SQLite 后端留下替换点。

## 本阶段明确不做的事

- 不修改页面（`src/pages/**`），不接入渲染器。
- 不修改 `src/utils/protocol/babyBandProtocol.js`、`src/utils/bluetooth/BluetoothManager.js` 或 `src/utils/algorithms/**`。
- 不新增第三方依赖，不修改 `package.json` 或锁文件。
- 不删除旧存储键 `baby_band_last_session_v1`，迁移只读旧键并写入新结构。
- 不宣称真机验证；本阶段只做 Node.js 单元测试。

## 已知集成阻塞点

1. **算法层数组/对象不一致**：现有 `AlgorithmManager.processSensorData()` 按数组使用 `q0/q1/q2`，但协议解析器产出对象。父任务必须在算法边界调用 `toAlgorithmSample()`；本阶段没有改算法实现。
2. **CRC 语义**：解析器在 CRC 不匹配时仍返回 `ok: true`，只是 `sample.crcOk = false`。摄入层默认保留数据并告警；需要拒绝时显式传 `rejectCrcFailure: true`。
3. **协议待确认**：本仓库现有偏移和固件提案存在差异，但提案原文不在本仓库。详见 `protocol-conflicts.md`，不要自行猜测偏移。
4. **页面仍写旧格式**：首页 `stopSession()` 仍写 `baby_band_last_session_v1`。父任务切换到新仓库后，可调用一次迁移；迁移不会删除旧键。
5. **App SQLite 为异步 API**：`plus.sqlite` 回调式接口不能直接替换同步本地仓库，需要异步门面或适配层；详见 `storage.md`。

## 测试

```sh
node --test tests/architecture/*.test.mjs
```

## 文档索引

- [数据契约](data-contracts.md)
- [存储与 App SQLite 边界](storage.md)
- [协议冲突与不确定项](protocol-conflicts.md)
- [前端集成 API](integration-api.md)
- [依赖审计](dependency-audit.md)

覆盖：

- 四元数合法/非法输入、单位化、对象↔数组转换。
- PoseFrame 对缺失/非法输入的安全降级（不抛异常）。
- 温度别名与 CRC 策略。
- 会话创建、追加、分块重载、顺序保持。
- 存储配额失败、静默写失败（读回校验）、元数据失败后的数据一致性。
- 旧格式迁移、幂等迁移、损坏数据的安全报错。

测试只使用 Node 内置 `node:test` / `node:assert`，不引入依赖。
