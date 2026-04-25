# Codex 输入归一化修复设计

日期：2026-04-25

## 背景

根据 [docs/architecture/hook-signal-chain.md](../../architecture/hook-signal-chain.md)、[docs/architecture/provider-observable-information.md](../../architecture/provider-observable-information.md) 和 [research/2026-04-25-codex-pty-submit-gap.md](../../../research/2026-04-25-codex-pty-submit-gap.md) 的现有结论，当前 Codex 会话状态卡在 `alive + unknown` 的直接原因，不是 reducer、observability projection 或前端展示，而是更上游的一层：

`sessionInput -> PTY write -> Codex TUI 是否把输入当成真实 submit`

新增实测进一步收窄了根因：

- `codex app-server` 的 `thread/start -> turn/start` 能稳定触发 `turn/started` 和真实 hook。
- 在 Stoa 内部，`window.stoa.sendSessionInput(sessionId, '整串文本\\r')` 仍会失败，Codex 只把文本留在 draft line。
- 但在同一套 Stoa 应用里，把同一句话改成“逐字符发送，最后单独发送 `\r`”，Codex 会立刻触发 hook，session 进入 `agentState = working`。

结论：当前 bug 不是“Codex 无法提供实时状态”，而是“Windows 下 Codex TUI 对整串批量注入与逐字符键入并不等价”。

## 目标

- 让 Codex 会话通过 Stoa 输入 prompt 时，能够稳定触发真实 hook，从而驱动既有状态链路。
- 修复必须只影响 Codex 输入链路，不改变 Claude Code、OpenCode、Shell 的输入语义。
- 不修改现有 session state model、observability reducer、renderer 状态呈现逻辑。
- 不引入兼容层；当前原型阶段允许 breaking change。

## 非目标

- 本次不把 Codex provider 全量迁移到 `app-server` 协议。
- 不在 renderer 层做 provider 专用输入 hack。
- 不通过 terminal 文本猜测运行状态。
- 不修改任何样式、design token 或状态显示配色。

## 设计决策

### 1. 修复边界放在主进程 `sessionInput`

Codex 的问题来自输入入口层，因此修复也必须落在输入入口层。主进程是唯一同时满足下面条件的位置：

- 能区分 session provider 类型。
- 能覆盖 renderer 键入、paste、以及直接调用 `window.stoa.sendSessionInput(...)` 的所有入口。
- 不把 provider 特殊语义泄漏进 Vue / xterm renderer。

因此本次新增一个主进程输入路由器，对 `IPC_CHANNELS.sessionInput` 做 Codex 专用归一化，然后再调用 `ptyHost.write(...)`。

### 2. 只对 Codex 做“纯文本输入归一化”

Codex 归一化的目标不是模拟完整键盘，而是修复已被证实会失效的“纯文本批量注入”。

规则：

- 非 `codex` session：输入原样透传。
- `codex` session：
  - 如果输入为空：忽略。
  - 如果输入包含 `ESC`（`\u001b`）：视为控制序列，整块原样透传。
  - 否则视为纯文本 chunk。
    - 长度为 `1`：按单字符发送。
    - 长度大于 `1`：拆成 code point 级字符流发送。

这里显式保留控制序列，是为了不破坏方向键、快捷键、终端控制码等非文本输入。

### 3. 对 Codex 纯文本输入引入最小字符间隔

实测表明：

- 同步逐字符、不加间隔：仍可能失败。
- 仅有普通字符间隔仍不够。
- `35ms` 左右的字符间隔，加上最后一个文本字符与提交回车之间约 `120ms` 的 settle gap，能够稳定触发 `SessionStart` / `UserPromptSubmit`。

因此对 Codex 纯文本帧引入最小间隔：

```ts
const CODEX_PLAIN_INPUT_MIN_INTERVAL_MS = 35
const CODEX_SUBMIT_INPUT_MIN_INTERVAL_MS = 120
```

行为：

- 同一个 Codex session 的纯文本输入必须串行发送。
- 相邻纯文本帧之间至少间隔 `35ms`。
- `\r` / `\n` 若属于纯文本 chunk 的一部分，也走同一队列，不能和前面的文本并发写入。
- 对提交帧（`\r` / `\n`）使用更长的 `120ms` 最小前置间隔，避免“文本已显示，但 turn 没真正 submit”的退化。

这意味着：

- 一次性 `sendSessionInput(sessionId, 'Reply...\\r')` 会被转换成保序字符流，并在提交前自动加入 settle gap。
- 用户正常逐字输入几乎不受影响；若输入事件本身已经慢于 `35ms`，路由器不会额外放慢。
- 高频程序化逐字符发送也会被最小间隔保护，避免再次退化成“视觉上输入了，但没有真实 submit”。

### 4. 每个 session 独立排队，且支持 reset

路由器必须为每个 session 维护独立发送队列，避免不同 session 相互阻塞。

同时必须支持：

- `resetSession(sessionId)`
- `dispose()`

`resetSession(sessionId)` 的用途：

- 在 session archive 前清空遗留输入。
- 在 restore / runtime restart 前丢弃旧 runtime 尚未发完的 stale 输入。

这样可以避免下面的问题：

- 旧 runtime 已退出，但旧队列还没发完。
- session 恢复后复用同一 `sessionId`，旧输入被误发到新 runtime。

## 模块边界

新增模块：

- `src/main/session-input-router.ts`

职责：

- 根据 `sessionId` 查询 session 类型。
- 决定是否应用 Codex 输入归一化。
- 维护 per-session 输入队列与最小间隔。
- 调用底层 `ptyHost.write(sessionId, chunk)`。

不负责：

- session 状态更新。
- hook 解析。
- renderer UI 逻辑。

主进程集成点：

- `src/main/index.ts` 的 `IPC_CHANNELS.sessionInput`
- `sessionArchive`
- `sessionRestore`
- app shutdown 清理

## 数据流

修复后的链路：

```text
Renderer / preload / test script
  -> IPC_CHANNELS.sessionInput
  -> SessionInputRouter.send(sessionId, data)
  -> (codex only) normalize + queue + throttle
  -> ptyHost.write(sessionId, chunk)
  -> Codex TUI 接受真实 submit
  -> /hooks/codex
  -> adaptCodexHook()
  -> SessionEventBridge
  -> reducer / presence / renderer
```

注意：本次修复不改变下游状态链路。它修复的是“让真实 provider event 产生出来”。

## 测试策略

### 单元测试

新增：

- `src/main/session-input-router.test.ts`

覆盖点：

- 非 Codex 输入保持原样。
- Codex 纯文本 chunk 被拆成字符流。
- Codex 控制序列（含 `ESC`）不被拆分。
- Codex 高频连续输入会应用最小间隔。
- `resetSession()` 能阻止 stale 队列继续写入。

### 集成验证

保留并复用现有真实复现脚本思路，验证：

- Stoa 内部单次整串 `sendSessionInput(sessionId, 'Reply...\\r')`
- 修复后应能让 Codex 从 `alive + unknown` 进入 provider-driven `working`

这类验证作为实现期证据和手动回归，不要求把外部 Codex 账号环境强绑定进稳定自动化测试基线。

## 风险与取舍

### 风险 1：Codex 输入节流可能影响交互手感

取舍：

- 只对 Codex 生效。
- 只对纯文本帧生效。
- `35ms + submit 前 120ms` 是当前已验证的最小稳定节奏，不是任意凭空猜测。

这比继续让状态永远卡在 `idle/unknown` 更可接受。

### 风险 2：把所有多字符输入都拆分会破坏控制序列

取舍：

- 通过 `ESC` 检测保留控制序列整块透传。
- 不尝试在 renderer 层识别特殊按键。

### 风险 3：这不是最终架构

成立。长期更优雅的方向仍然是 Codex `app-server` 结构化控制，而不是 PTY 注入。

但这次修复的目标是：

- 在不重写 provider transport 的前提下，
- 以最小改动恢复真实 hook 驱动的状态链路。

这是当前最小且正确的修复，不排斥后续单独推进 `app-server` 架构升级。

## 成功标准

- 在 Stoa 内部，Codex 会话通过一次性输入 prompt 后，能够稳定进入 provider-driven `working`。
- `/hooks/codex` 能真实收到 `SessionStart` / `UserPromptSubmit` 等事件。
- 前端状态展示无需新增任何特判，即可随着既有状态链路正确显示 `running` / `complete` / `blocked`。
- Claude Code、OpenCode、Shell 输入行为不回归。
