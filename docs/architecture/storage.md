# 会话存储架构

## 1. 为什么分块

微信小程序 `uni.setStorageSync` 通常有**单 key 约 1 MB、总量约 10 MB** 的平台限制（以当前官方文档为准）。一整晚样本可能达到数千条，单 key 序列化会超出限制并导致 `setStorageSync` 抛错。

`ChunkedSessionRepository` 将样本/事件切成 JSON 数组块，每个 key 默认最多 `128 * 1024` 个 UTF-16 字符（约 256 KB），可通过 `maxChunkChars` 调整。单个记录本身超限时单独成块，因为拆记录会破坏数据。

## 2. Key 布局

默认前缀 `babyband.session.v2`：

```text
babyband.session.v2:index
  { version: 2, updatedAt, sessionIds: string[] }

babyband.session.v2:session:<id>:meta
  {
    version, id, startTs, endTs, createdAt, updatedAt, finalized,
    sampleCount, eventCount,
    sampleChunks, eventChunks,
    sampleChunkSizes: number[],
    eventChunkSizes: number[],
    meta: {}
  }

babyband.session.v2:session:<id>:samples:<n>
babyband.session.v2:session:<id>:events:<n>
  JSON 数组
```

- `index` 只保存 session id 列表；计数以每个 session 的 `meta` 为准，因此追加样本不需要重写 index。
- `sampleChunkSizes[n]` 是该块的有效记录数。它让读取可以忽略“写成功但元数据未提交”的尾部多余记录。
- session id 限制为 `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`，防止 key 注入。
- 旧键 `baby_band_last_session_v1` 不在新布局中，迁移时**只读不删**。

## 3. 写入协议与失败语义

### createSession

1. 校验 id/时间/数组/meta。
2. 拒绝重复 id（meta 或 index 已存在）。
3. 写样本块 -> 写事件块 -> 写 meta -> 最后写 index。
4. 任一步失败：删除本次写入的块和 meta；若 index 已落地，尽力回滚 index。

因此 index 中出现的 id 才代表一个完整 session。

### appendSample / appendSamples / appendEvent

1. 读 meta（不存在 -> `SESSION_NOT_FOUND`；已 finalize -> `SESSION_FINALIZED`）。
2. 读最后一个块，按 `chunkSizes[last]` 截断历史残留，再拼接新记录。
3. 重写尾块；如果放不下，追加新块。
4. 写新 meta。

失败处理：

- 新块写失败：删除本次新增块；旧 meta 不变。
- 尾块重写成功但 meta 写失败：尾块可能多出记录，但旧 meta 的 `sampleChunkSizes` 会让下次读取/追加截断它们；**旧样本不会丢失**。
- 读回校验失败（存储静默丢弃写入）：抛 `StorageWriteError(VERIFY_FAILED)`，并回滚新增块。

### finalizeSession

写入 `endTs` / `finalized: true` / `updatedAt`。之后追加会被拒绝。当前没有“重新打开”API。

### 读回校验

默认 `verifyWrites: true`：每次写后立即 `get` 并比较字符串。uni 的同步存储通常可靠，但该检查能捕获静默失败/配额导致的空写。若性能敏感可关闭，但**不建议**在关键会话写入上关闭。

## 4. 错误类型

`src/repositories/storageErrors.mjs`：

| 类型 | code | 可恢复性 | 建议处理 |
| --- | --- | --- | --- |
| `StorageQuotaError` | `QUOTA_EXCEEDED` | 是（清理旧会话后重试） | 提示用户、停止录制、保留内存数据 |
| `StorageWriteError` | `WRITE_FAILED` / `VERIFY_FAILED` | 视情况 | 重试/提示；不要静默吞掉 |
| `StorageCorruptionError` | `CORRUPT_DATA` | 否（除非人工修复） | 不覆盖；提示回放不可用 |
| `StorageValidationError` | `SESSION_NOT_FOUND` / `SESSION_FINALIZED` / `SESSION_EXISTS` / `INVALID_ARGUMENT` | 调用方逻辑错误 | 修正调用顺序/id |

配额识别覆盖 `quota`、`exceed`、`storage full`、`存储空间` 等常见错误文案。

**进程崩溃**：`createSession`/`appendSamples` 是“先写块、后写元数据”。如果进程在两步之间被杀死，可能留下未被任何 meta 引用的孤儿块。它们不会被读取，也不会影响数据一致性；当前没有 GC API，父任务如需彻底清理可在后续维护任务中扫描前缀并删除不在 meta 中的块。不要在正常运行路径中盲目删除前缀下所有 key。

**当前限制**：本阶段没有实现 `deleteSession` / 自动淘汰旧会话。配额错误只会安全上报；父任务若要支持“空间不足自动清理”，需要在新阶段增加删除 API（必须同时清理 index/meta/chunks）或由 App SQLite 层执行 `DELETE`。

## 5. 旧格式迁移

旧页面写入：

```text
baby_band_last_session_v1 = JSON.stringify({
  startTs, endTs, samples: SensorSample[], events: [{ time, drop }]
})
```

迁移 API：

```js
const repo = new ChunkedSessionRepository({
  storage: createUniKeyValueStorage(uni)
})

const result = repo.migrateLegacyFromStorage()
// { ok: true, migrated: true, id: 'legacy-<startTs>', legacyKey: ... }
// 或 { ok: true, migrated: false, reason: 'ALREADY_EXISTS' }
// 或 { ok: false, reason: 'NO_LEGACY_SESSION' | 'INVALID_LEGACY_JSON' | ... }
```

规则：

- 迁移后的 id 默认 `legacy-<Math.trunc(startTs)>`；startTs 缺失时用首个样本 `ts`，再缺省为 `legacy-0`。
- 样本/事件对象**原样保存**，未知字段不丢。
- 迁移结果 `finalized: true`。
- 幂等：同 id 已存在时返回 `migrated: false, reason: 'ALREADY_EXISTS'`。
- 旧键不删除、不修改；是否清理由用户/父任务决定。
- 旧 JSON 损坏不会被当成“空数据”覆盖，而是返回 `INVALID_LEGACY_JSON`。

## 6. App SQLite 适配边界

### 为什么不能直接替换

`plus.sqlite` 的回调式 API 是异步的，而 `ChunkedSessionRepository` 是同步的（为了适配 `uni.setStorageSync` 和 Node 测试）。App 端不应把异步 SQLite 伪装成同步 API，否则会阻塞/竞态。

### 边界定义

App 端实现一个**异步 SessionStore**，语义与本地仓库一致：

```ts
interface AsyncSessionStore {
  createSession(input): Promise<Session>
  appendSample(id, sample): Promise<SessionSummary>
  appendSamples(id, samples): Promise<SessionSummary>
  appendEvent(id, event): Promise<SessionSummary>
  finalizeSession(id, { endTs, meta }): Promise<SessionSummary>
  loadSession(id): Promise<Session | null>
  listSessions(): Promise<SessionSummary[]>
  migrateLegacySession(legacy, options): Promise<MigrationResult>
}
```

页面/服务依赖该接口，而不是直接依赖 `plus.sqlite`。H5/小程序继续用 `ChunkedSessionRepository`；App 可切换为 SQLite 实现。若页面希望统一 `await`，可包一层同步→Promise 门面。

### 建议表结构

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bb_sessions (
  id TEXT PRIMARY KEY,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS bb_samples (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES bb_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bb_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  occurred_at INTEGER,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES bb_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bb_samples_session_seq
  ON bb_samples(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_bb_sessions_start
  ON bb_sessions(start_ts DESC);
```

### 写入约定

- 每次 `appendSample` 使用一个事务：`BEGIN IMMEDIATE` -> 计算 `seq = COALESCE(MAX(seq)+1, 0)`（并发下用唯一约束重试）-> `INSERT` -> `COMMIT`。
- `payload_json` 保存完整 SensorSample，**保持 `{w,x,y,z}` 对象**，不要存算法数组。
- 批量追加用单事务 + 预编译语句，避免每条一次事务。
- `endTs` 用 UPDATE；`finalized` 为 1 后拒绝追加。
- 迁移旧 JSON：解析后逐条插入；保留旧 key；成功后写 `meta_json.migratedFrom`。
- 读回放时分页：`SELECT payload_json FROM bb_samples WHERE session_id=? ORDER BY seq LIMIT ? OFFSET ?`；不要一次把整晚数据读进内存。
- 错误映射：SQLite `SQLITE_FULL` -> `StorageQuotaError`；约束/损坏 -> `StorageCorruptionError` 或 `StorageValidationError`。

### 平台约束

- SQLite 适配器只能用于 App（`plus` 运行时）；H5/微信小程序继续使用键值仓库。
- 本阶段**没有实现也没有真机验证** SQLite 适配器；无法在没有 App 运行时/设备的情况下验证 `plus.sqlite` 行为。父任务接入时需要自行完成初始化、数据库迁移和真机测试。
- 不新增任何 npm 依赖；若使用 `plus.sqlite`，它是 DCloud 运行时能力，不是 npm 包。

## 7. 容量与回放建议

- 样本约数百字节/条；按 1 MB/key 上限，默认块约 256 KB（UTF-16），单块可容纳上千条。实际以真机存储 API 为准。
- 回放时不要一次性渲染全部样本：按时间窗口分页/抽帧；`PoseFrame` 由样本即时计算，不重复存储。
- 长时间录制建议定期 `finalizeSession()` 并开启新 session，避免单 session 无限增长；本阶段未实现自动轮转。
