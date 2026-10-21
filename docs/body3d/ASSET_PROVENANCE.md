# 资产与参考项目来源

统计时间：2026-10-21（GitHub REST API 实时查询）。

## 1. 选用

### three.js

- 仓库：`mrdoob/three.js`
- Stars：116,683；Forks：36,717
- License：MIT
- 默认分支：`dev`；最近 push：2026-10-20
- 使用方式：`three@0.149.0` 的 `build/three.min.js`（UMD）vendored 到
  `src/static/models/vendor/three.min.js`，供 H5/App-vue renderjs 动态加载。
- 许可证：`src/static/models/vendor/THREE-LICENSE.txt`
- 说明：r149 保留 UMD 构建；r150+ 已提示 UMD 将移除。代码只使用 r108 也存在的 API，兼容微信适配层。

### threejs-miniprogram（微信）

- 仓库：`wechat-miniprogram/threejs-miniprogram`
- Stars：799；Forks：238
- License：MIT
- 最近 push：2023-05-22（项目较久未更新）
- 包版本：`0.0.8`，内部 three r108
- 克隆位置：`/home/jaythan/projects/babyband-references/threejs-miniprogram`
- 使用方式：仅微信小程序 `npm install threejs-miniprogram@0.0.8`，通过
  `createScopedThreejs(canvas)` 获取 scoped THREE。
- 风险：three r108 较旧；本阶段只用了长期稳定 API，且通过微信构建验证，未真机验证。

## 2. 评估但未集成

### minisheeep/threejs-miniprogram-template

- Stars：38；Forks：1
- License：**无 LICENSE 文件**（GitHub API 返回 null）
- 最近 push：2025-07-17
- 结论：模板可读，但没有明确许可证，不能安全复制代码；未克隆、未复用。选用官方 `wechat-miniprogram/threejs-miniprogram` 替代。

### Anny（NAVER LABS）

- 仓库：`naver/anny`
- Stars：606；Forks：50
- GitHub API license：`NOASSERTION`；实际 `LICENSE` 文件为 **Apache License 2.0**
  （"Anny, Copyright (C) 2025 NAVER Corporation... Apache License, Version 2.0"）
- 最近 push：2026-09-28
- 能力：PyTorch 参数化人体模型，覆盖婴儿到老年，输出网格/骨骼，理论上可离线导出 GLB。
- 结论：**不是前端依赖**。需要 Python/PyTorch/离线导出管线，且本阶段没有执行导出；未克隆、未集成、未声称已使用。未来若要真实婴儿网格，应由资产管线离线导出 GLB，再单独评审加载器、体积和许可证。

### MPFB2（MakeHuman）

- 仓库：`makehumancommunity/mpfb2`
- Stars：648；Forks：90
- GitHub API license：`NOASSERTION` / "Other"
- 最近 push：2026-10-20
- 能力：Blender 插件，可生成人体。
- 结论：需要 Blender + Python，许可证需要单独法务/资产评审；本阶段未集成。

## 3. 当前实际资产

- `procedural/infant_rig_v1.json` + `src/utils/pose3d/proceduralRig.js`：
  **程序化几何体**（球/圆柱/盒），约 21 个 mesh，风格化婴儿。
- 这不是外部婴儿扫描模型，不是 GLB/GLTF，不是医学/解剖模型。
- 没有下载、转换或打包任何外部婴儿网格。

## 4. 网络与发布

- 本阶段只读 GitHub API / 官方文档，克隆官方适配层到允许的 references 目录。
- 没有 push、没有创建远程仓库、没有发布 artifact、没有修改凭据。
- 没有调用任何 AI API；运行时完全本地、无网络请求。
