# 双通道模型

## 为什么必须双通道

传统终端工具容易把字符流同时拿来做人类展示和状态推断，但这会把系统建立在脆弱字符串解析上。Vibecoding 框架明确把这两件事拆开：视觉流服务于人类，状态流服务于系统。

## 通道一：视觉流通道

职责是把 CLI 的 stdout/stderr 原样送到 `xterm.js`。这条链路不做语义判断，只要求尽量低延迟和高保真。

链路如下：

`CLI 进程 -> node-pty -> Main Process -> IPC -> Renderer -> xterm.js`

设计要求：

- 不在视觉流上做正则解析。
- 不基于输出文本推断 Agent 是否调用工具或进入报错态。
- 不让前端直接操作 PTY 底层流。

## 通道二：状态信令通道

职责是把结构化 JSON 事件从 CLI 运行时送回后端。事件至少应支持以下类别：

- session started
- session resumed
- tool call started
- tool call finished
- agent thinking
- error raised
- heartbeat or status summary updated

链路如下：

`Hook Sidecar -> HTTP POST -> Express Server -> Session Manager -> IPC -> Pinia`

设计要求：

- 事件格式稳定、可版本化。
- 状态合成在主进程完成。
- 前端只消费合成结果，不直接拼装多源状态。
- 所有可驱动主状态的事件都必须符合 `state-event-contract.md` 中定义的 canonical envelope。

## 通道交汇点

两条通道的唯一交汇点是 Session Manager。它需要将视觉流绑定到特定工作区，同时将状态流写入统一状态模型，并在必要时持久化关键恢复字段。

当前实现状态（2026-04-18）：

- 视觉流已经落地：`node-pty -> Main Process -> IPC -> Renderer -> xterm.js` 可运行。
- 状态流已具备最小实现：Express 本地 webhook server、Session Manager、IPC 广播、Pinia 投影均已接通。
- 当前 provider 仍以本地 shell 为主，后续接入真实 Agent CLI 时仍需补强 sidecar 鉴权、事件校验与 provider capability 分级细节。

## 失败处理

- 视觉流断开但状态流仍在：UI 应提示终端失联，但工作区可能仍在运行。
- 状态流断开但视觉流仍在：终端继续显示输出，但状态灯降级为 `degraded`，且在 fresh event 恢复前不得伪装为正常运行。
- 两条通道都断：工作区标记为故障，需要人工或自动重启。
