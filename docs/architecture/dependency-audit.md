# 依赖审计

审计日期：2026-10-21  
审计范围：`/home/jaythan/projects/babyband-parallel/architecture`  
Node 版本（本地）：`v22.23.1`  
包管理：npm（存在 `package-lock.json`）

## 1. 结论

- 本阶段**没有新增任何 npm 依赖**，没有修改 `package.json`、`package-lock.json`。
- 新增的架构模块只使用 ECMAScript 标准库和 Node 内置测试能力，运行时依赖为零。
- 仓库现有依赖全部是项目原有依赖；安全审计发现的问题均为**既有传递依赖**，修复需要升级/替换 uni-app 工具链，属于破坏性变更，本阶段不处理。
- 架构层不需要 AI API、网络服务或额外运行时。

## 2. 新增模块的依赖图

```text
src/services/sampleIngestion.mjs
  -> src/types/sensorSample.mjs
       -> src/types/quaternion.mjs
  -> src/types/quaternion.mjs

src/repositories/chunkedSessionRepository.mjs
  -> src/repositories/keyValueStorage.mjs
  -> src/repositories/storageErrors.mjs
  -> src/types/quaternion.mjs（仅 isFiniteNumber / isPlainObject）

src/repositories/storageErrors.mjs
  -> 无外部依赖
```

特征：

- 没有模块在加载时访问 `uni` 全局；`createUniKeyValueStorage(uni)` 只在调用时使用传入对象。
- 没有 `import` 任何 npm 包。
- 核心模块可在 `node --test` 下直接运行，无需 bundler/mock。
- 页面、BLE、协议、算法实现均未改动，因此没有引入新的平台耦合。

## 3. 现有依赖分类（未改动）

| 类别 | 包 | 用途 | 本阶段是否使用 |
| --- | --- | --- | --- |
| uni-app 框架 | `@dcloudio/uni-app`、`uni-app-plus`、`uni-mp-weixin`、`uni-h5` 等 | 跨端运行时/编译 | 间接（未修改） |
| Vue | `vue`、`@vue/runtime-core` | 页面框架 | 间接 |
| 国际化 | `vue-i18n` | 现有依赖 | 否 |
| 图表 | `@qiun/ucharts` | `history.vue` 温度曲线 | 否（本阶段未改页面） |
| 构建 | `vite`、`@dcloudio/vite-plugin-uni`、`sass` | H5/小程序/App 构建 | 否 |
| 类型 | `@dcloudio/types` | uni 类型声明 | 否 |
| 测试 | Node 内置 `node:test`、`node:assert` | 架构测试 | 是（无 npm 依赖） |

`@dcloudio/uni-automator`、`uni-stacktracey` 等为现有开发依赖，本阶段未使用。

## 4. 安全审计结果

执行的命令：

```sh
npm audit --omit=dev
npm audit --omit=dev --json
```

结果（生产依赖，含 uni-app 工具链传递依赖）：

```json
{
  "info": 0,
  "low": 14,
  "moderate": 16,
  "high": 32,
  "critical": 0,
  "total": 62
}
```

说明：

- 62 条均来自既有依赖树（例如 `@dcloudio/uni-cli-shared` 传递的 `@babel/core`、`esbuild`、`chokidar` 等），**不是本阶段新增**。
- `npm audit fix --force` 建议安装 `@dcloudio/uni-cli-shared@0.2.994` 等旧/不兼容版本，会破坏当前 uni-app 3.x 工具链；因此**未执行**。
- 这些多为构建期依赖；是否影响最终小程序/App 包需要单独做产物审计。本阶段没有做真机/产物安全验证。
- 修复建议（后续独立任务）：在确认 uni-app 兼容版本后整体升级 DCloud 工具链，重新执行 `npm ci`、构建和回归；不要单独强升传递依赖。

## 5. 版本与锁文件注意事项

- 仓库 `node_modules` 是指向同级项目的符号链接（`node_modules -> /home/jaythan/projects/babyband-cli_new/node_modules`），因此 `npm ls --depth=0` 显示的已安装版本可能与 `package.json` 的范围不完全一致。
- **以 `package-lock.json` 为准**；本阶段未修改锁文件。
- `package.json` 未声明 `engines`；README 要求 Node 18+。本地 Node 22 可运行 `node:test`。若 CI 使用 Node 18，`node:test` 也可用（18.x 已内置），但建议固定到 20/22 LTS 以获得稳定行为。

## 6. 平台/构建风险

- 新模块使用 `.mjs` 扩展名。Vite 5 与 uni-app 的 Vite 构建链支持 ESM/`.mjs`，但本阶段**没有运行 H5/微信小程序/App 构建**（避免影响页面/依赖；且没有设备）。
- 父任务集成时应至少执行：
  - `npm run build:h5`
  - `npm run build:mp-weixin`
  - App 构建/真机（需要 HBuilderX/设备）
- 如果某个平台的编译器对 `.mjs` 解析异常，优先在导入处写显式文件路径（`@/types/...mjs`），不要简单改回 `.js`：本包没有 `"type": "module"`，Node 会把 `.js` 当 CommonJS，导致 `node --test` 失败。

## 7. 结论与建议

- 本阶段依赖增量：**0**。
- 测试依赖增量：**0**（使用 Node 内置模块）。
- 既有安全债：62 条（0 critical / 32 high），均为既有传递依赖；需要独立的工具链升级任务。
- 不建议为了本阶段功能引入状态管理、数据库、校验库或日期库；当前实现已覆盖契约、校验和分块存储，新增依赖只会扩大小程序包体和攻击面。
