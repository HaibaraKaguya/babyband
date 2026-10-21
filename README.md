# BabyBand 婴儿姿态监测系统

uni-app / Vue 3 工程，包含 BLE 协议解析、姿态与温度算法、3D 人体展示、分块会话记录与时间轴回放。支持 H5、微信小程序及 App-vue。

## 环境

- Node.js 22（开发使用 22.23.1），npm 10（开发使用 10.9.8）。WSL 中运行 `nvm use` 可读取 `.nvmrc`。
- 微信端：微信开发者工具。
- App：HBuilderX，用于运行和打包 App 构建产物。
- 无需 Python、PyTorch、Blender 或单独后端服务即可运行当前版本。

## 安装与日常启动

首次克隆到新机器后，仅执行一次：

```sh
npm ci --prefer-offline
```

已有 `node_modules` 且依赖没有变化时，直接启动，不需要重新安装：

```sh
npm run dev:h5 -- --host 0.0.0.0
# 浏览器 http://localhost:5173/
npm run dev:mp-weixin
# 微信开发者工具导入 dist/dev/mp-weixin
```

拉取代码后，只有 `package.json` 或 `package-lock.json` 变化时才需要重新安装。`npm ci` 会重建 node_modules，不要把它放进日常启动脚本。`.npmrc` 已启用 prefer-offline，优先使用本机 npm 缓存；缓存不全时仍会下载。不要频繁清除 npm 缓存。

完全离线且缓存已齐全时，可使用 `npm ci --offline`；若缓存缺包会报错，不能保证任意新机器离线安装。

## 依赖与资源

| 类别 | 内容 | 安装方式 |
| --- | --- | --- |
| 框架 | Vue 3、同版本 DCloud uni-app 平台包 | npm ci 按 lockfile 安装 |
| 图表 | @qiun/ucharts | npm ci |
| 微信 3D | threejs-miniprogram 0.0.8 | npm ci；基于 three r108 |
| 构建 | Vite 5.2.8、DCloud Vite 插件、Sass | npm ci |
| 类型辅助 | @dcloudio/types 等 | npm ci |
| H5 / App 3D | three r149 UMD + MIT LICENSE | 已随源码保存在 src/static/models/vendor，无运行时 CDN 下载 |
| 人体资源 | 程序生成的婴儿比例关节模型 | 随源码，无外部模型下载 |

完整版本见 `package.json` 和 `package-lock.json`。多个 DCloud 包属于同一发布版本，升级时需协调，不能单独随意升级。`node_modules`、dist 和缓存不上传 GitHub。lockfile 必须保留，它记录准确依赖树。

## 验证与构建

```sh
npm test
npm run build:h5
npm run build:mp-weixin
npm run build:app
```

当前 122 项测试通过；三平台构建通过。App 产物在 `dist/build/app`，需 HBuilderX 运行/打包；尚未做 BLE、微信或 App 真机验收。

## 架构和限制

完整架构、已修复问题和未完成事项见 [集成交付说明](docs/INTEGRATION-REVIEW.md)。进一步阅读 [数据与存储](docs/architecture/README.md)、[3D 模块](docs/body3d/README.md)、[第三方资产来源与许可证](docs/body3d/ASSET_PROVENANCE.md)。

当前人体是简化示意模型；三个传感器不能直接测量全部关节。翻身识别准确性、固件协议、佩戴方向仍需联调；App SQLite 尚未实现。既有依赖审计告警见 [依赖审查](docs/architecture/dependency-audit.md)。
