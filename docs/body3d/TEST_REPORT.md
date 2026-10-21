# 测试与验证记录

环境：Node v22.23.1、npm 10.9.8、WSL Linux。
日期：2026-10-21。

## 1. 单元/行为测试（仓库内）

命令：

```sh
cd /home/jaythan/projects/babyband-parallel/body3d
node --experimental-default-type=module --test tests/body3d/*.test.mjs
```

结果：

```text
1..38
# tests 38
# suites 0
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

覆盖：

- `quaternion-mapping.test.mjs`：`{w,x,y,z}` / `[w,x,y,z]` / three `{x,y,z,w}` 显式转换；identity；q1 驱动右臂；q0=q1 时相对旋转为 identity；相对四元数公式；gain；无效帧；slerp。
- `pose-frame.test.mjs`：identity 有效；缺槽位；NaN/零/非对象；非单位归一化 warning；上游 valid=false；数组输入；SensorSample 映射；CRC/attitude 失败；缺 timestamp；parseError；深拷贝。
- `pose-timeline.test.mjs`：无 timestamp 拒绝；重复 timestamp 覆盖；乱序排序；slerp 中点；首尾 clamp；无效邻居保持；全无效 identity；容量淘汰；clear。
- `pose3d-runtime.test.mjs`：fake three 场景创建（21 mesh）；有效帧应用；无效帧不抛异常并保持时间戳；rest pose；右臂 90° 映射；resize；幂等 dispose；geometry/material/renderer 释放；dispose 后 update；context lost；缺 THREE/canvas/renderer 失败；WebGL 预检。

运行 `npm` 脚本没有修改 `package.json`；因为项目没有 `"type":"module"`，测试使用 `--experimental-default-type=module` 让 `.js` 源码按 ESM 解析。

## 2. 真实 three.js r149 smoke test（仓库外）

参考目录：`/home/jaythan/projects/babyband-references/three-smoke`

命令：

```sh
cd /home/jaythan/projects/babyband-references/three-smoke
node smoke.mjs
```

结果：

```json
{"three":"149","meshes":21,"disposedGeometries":21,"disposedMaterials":5,"armAngle":90}
```

验证内容：用真实 three.js 构造程序化 rig、应用腕部 90° 旋转、释放全部 geometry/material。退出码 0。

## 3. SFC / 平台条件编译检查

使用项目内 `@vue/compiler-sfc@3.4.21` 和 `@dcloudio/uni-cli-shared` 的 `preHtml/preJs`：

```sh
node /tmp/check-platforms.cjs h5
node /tmp/check-platforms.cjs app-plus
node /tmp/check-platforms.cjs mp-weixin
node /tmp/check-platforms.cjs mp-alipay
```

结果（均通过）：

```text
h5 ok; renderjs=true; templateBytes=1530; mainBindings=28
app-plus ok; renderjs=true; templateBytes=1530; mainBindings=28
mp-weixin ok; renderjs=false; templateBytes=1655; mainBindings=28
mp-alipay ok; renderjs=false; templateBytes=1309; mainBindings=28
h5 renderjs syntax ok
app-plus renderjs syntax ok
```

说明：

- H5/App 保留 renderjs、移除 MP canvas；微信保留原生 canvas、移除 renderjs；支付宝两个都移除，只留 fallback。
- `node --check` 对 H5/App 的 renderjs 代码做语法检查通过。
- 该检查使用临时脚本 `/tmp/check-platforms.cjs`，不在仓库内。

## 4. 项目构建（组件尚未接入页面）

命令与结果：

```sh
cd /home/jaythan/projects/babyband-parallel/body3d
npm run build:h5          # DONE Build complete. exit 0
npm run build:mp-weixin   # DONE Build complete. exit 0
```

注意：本阶段不允许改 pages，因此这两个构建**没有真正引用 HumanPose3D**，只能证明仓库原有页面无回归。

## 5. 临时接入页构建（组件实际参与打包）

为避免修改项目 pages，在 `/tmp/body3d-build-test` 复制了一份项目，新增一个仅用于构建的 `pages/hp3dtest/hp3dtest.vue`，导入 `HumanPose3D` 并传 identity PoseFrame。

命令：

```sh
cd /tmp/body3d-build-test
npm run build:h5
npm run build:mp-weixin
```

结果：

- H5：exit 0。`dist/build/h5/assets/pages-hp3dtest-hp3dtest.*.js` 包含
  `babyband_infant_root` / `createProceduralInfantRig`；`static/models/vendor/three.min.js` 被复制。
- 微信：exit 0。生成
  `dist/build/mp-weixin/components/HumanPose3D/{HumanPose3D.js,wxml,wxss,json,wechatRuntime.js}`；
  `common/vendor.js` 含 `createScopedThreejs`；临时包总大小约 1.6 MB。
- 微信构建时在临时 node_modules 中放了 `threejs-miniprogram@0.0.8` 的 npm tarball；没有修改项目 `package.json`/lockfile 或共享 node_modules。

这是**构建验证**，不是运行验证。

## 6. 未执行 / 未声明

- 未在 H5 浏览器实际打开页面（环境无 Chromium/Firefox）。
- 未在微信开发者工具运行，未扫码真机。
- 未在 App 真机运行 renderjs。
- 未接真实 BLE 设备，未验证固件协议/传感器安装方向。
- 没有真实设备，因此不能声称“真机通过”。
- 没有做性能/FPS/内存曲线；只做了 1 Hz 按需渲染设计和静态资源释放测试。

## 7. 已知构建警告（非本阶段引入）

- Dart Sass legacy JS API deprecation。
- Browserslist 数据 9 个月未更新。
- Node 对无 `"type":"module"` 的 ESM 源码给出 `MODULE_TYPELESS_PACKAGE_JSON` 提示（仅真实 three smoke 脚本出现）。
