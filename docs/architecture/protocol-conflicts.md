# 协议冲突与不确定项

## 1. 结论先行

- 本仓库**现有可执行协议实现**是 `src/utils/protocol/babyBandProtocol.js`，本阶段未修改它。
- 任务说明指出“提案中的固件协议与现有代码不同”，但**提案原文不在本仓库**；公开 GitHub 账号 `haibarakaguya` 的仓库列表中也没有 BabyBand/固件相关仓库（仅 ML/前端项目）。因此无法在本文档中逐字段引用提案，也**没有发明任何新偏移或消息类型**。
- 在固件方书面确认前，唯一可信的偏移/字节序以现有解析器为准；任何差异必须先在协议模块修正并加回归测试，而不是在页面或架构层猜。

## 2. 现有代码的协议事实

来源：`src/utils/protocol/babyBandProtocol.js`。

| 项 | 现有实现 | 位置 |
| --- | --- | --- |
| 帧长 | 固定 73 字节 | `FRAME_LEN` |
| 帧头 | 接受 `AA 55` 或 `55 AA` | `readHeader()` |
| 字节序 | 数值字段按 little-endian 读取 | `parseBabyBandFrame()` |
| CRC 覆盖 | 字节 `0..70` | `crc16_modbus(bytes, 0, 71)` |
| CRC 字段 | 偏移 `71..72`，小端/大端都参与匹配 | `getUint16BothEndian(view, 71)` |
| CRC 算法 | 同时尝试 MODBUS(IBM) 与 CCITT-FALSE | `crc16_modbus` / `crc16_ccitt_false` |
| `deviceMs` | uint32 @ 2 | 设备上电毫秒 |
| `sys` | uint8 @ 6 | bit0 温度有效，bit1 姿态有效 |
| `q0` | float32 w,x,y,z @ 7,11,15,19 | 注释：腰 |
| `q1` | float32 w,x,y,z @ 23,27,31,35 | 注释：腕 |
| `q2` | float32 w,x,y,z @ 39,43,47,51 | 注释：踝 |
| `tWaist` | float32 @ 55 | 腹/腰温度 |
| `tThigh` | float32 @ 59 | 大腿温度 |
| `tAnkle` | float32 @ 63 | 脚踝温度 |
| `frameSeq` | uint32 @ 67 | 帧序号 |
| `battery` | 未解析，恒为 `null` | 注释说明不假设来源 |

解析器返回：

```js
{
  ok: true,
  sample: {
    ts, deviceMs, frameSeq, sys, tempValid, attitudeValid,
    q0: { w, x, y, z }, q1: { w, x, y, z }, q2: { w, x, y, z },
    tWaist, tThigh, tAnkle,
    temp1, temp2, temp3,
    battery: null,
    crcOk, crcAlg
  },
  meta: { headerBytes, crcOk, crcField, crcCalc_modbus, crcCalc_ccitt }
}
```

### 重要行为

1. **CRC 失败不会让 `ok` 变成 false**。解析器仍返回 `sample.crcOk = false`，由上层决定是否丢弃。本阶段新增的 `ingestSample()` 默认保留，只有显式 `{ rejectCrcFailure: true }` 才拒绝。
2. **头字节序兼容** `AA55`/`55AA`，但数值字段只按小端解析；如果固件是大端，当前代码会解析出错误数值。
3. `temp1/temp2/temp3` 是 UI 兼容别名，分别等于 `tWaist/tThigh/tAnkle`。
4. `sys` 的 bit2..7 未使用；**没有**电量、报警位等语义，不要自行补。

## 3. 与提案的已知/未知差异

| 主题 | 状态 | 处理 |
| --- | --- | --- |
| 帧长/帧头 | 任务说明称提案不同，但提案原文不可得 | 不修改偏移；待固件确认 |
| 字节序 | 现有代码假定小端 | 需固件确认；大端会全字段错位 |
| CRC 多项式/初值/覆盖范围 | 现有代码同时尝试 MODBUS 与 CCITT-FALSE | 需固件给出唯一算法；双算法兼容只是联调兜底 |
| CRC 失败策略 | 现有解析器不拒绝 | 架构层提供显式策略，不改变解析器 |
| 时间字段 | `deviceMs` uint32 + 客户端 `ts` | 需确认设备时间基准、回绕处理 |
| 有效性位 | bit0 温度、bit1 姿态 | 需确认位定义/极性 |
| 电量 | 未定义 | 保持 `null`，不猜测 |
| 传感器安装轴/位置 | 代码注释腰/腕/踝 | 需结构/固件确认 q0/q1/q2 与安装方向 |
| BLE 服务/特征 UUID | 硬编码 HC-08 `FFE0/FFE1` | 需确认实际模组；见下 |
| 消息类型/控制命令 | 现有代码只有 notify 解析 | 没有实现任何下行消息；不得虚构 |

### BLE 侧现状

`src/utils/bluetooth/BluetoothManager.js`：

- Service UUID `0000FFE0-0000-1000-8000-00805F9B34FB`
- Characteristic UUID `0000FFE1-0000-1000-8000-00805F9B34FB`
- 扫描过滤名称包含 `HC` / `BT` 或无名设备
- 连接超时 10 秒
- 只监听 notify，不发送命令

这些是 HC-08 串口透传的常见 UUID，但**不能证明**与最终固件一致。若提案使用自定义 GATT/服务发现，需要固件提供 UUID 表和 notify 分包策略。

## 4. 固件确认清单（接入前必须逐项确认）

- [ ] 帧长是否仍为 73？是否固定长度？
- [ ] 帧头字节序？是否允许 `55 AA`？
- [ ] 所有数值字段的端序（little/big）？
- [ ] CRC 算法、初值、多项式、异或值、覆盖范围、CRC 字段端序？
- [ ] CRC 失败时设备是否重发？App 是否必须丢弃？
- [ ] `q0/q1/q2` 对应的身体位置与安装轴向？
- [ ] 四元数分量顺序（`w,x,y,z` 还是 `x,y,z,w`）与是否已单位化？
- [ ] `sys` 每个 bit 的定义、极性、保留位？
- [ ] 温度单位、量程、缩放、异常值（`0x7FC00000` 等）？
- [ ] `deviceMs` 基准、uint32 回绕、与 `frameSeq` 的关系？
- [ ] 电量字段是否存在？位置/编码？
- [ ] BLE Service/Characteristic UUID、notify 分包大小、是否需要写命令开启数据？
- [ ] 设备名/广播格式？

## 5. 集成规则

1. **不改现有偏移去“对齐”提案**，除非固件确认并同步修改 `babyBandProtocol.js` 和其回归测试（属于 functionality 范围）。
2. 架构层只消费解析器输出的 `SensorSample`；如果未来协议变化，应保持 `SensorSample` 公共字段不变，由解析器适配。
3. 四元数公共表示固定为对象 `{ w, x, y, z }`；算法边界用 `quaternionToArray()` 显式转换。
4. 在协议未确认前，任何“电量/报警/控制命令”都不得在 UI 或存储中伪造。
5. 本阶段没有真机，不能声称 BLE/固件联调通过。
