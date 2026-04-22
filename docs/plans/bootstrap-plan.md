# 文档驱动启动计划

## 目标

基于当前文档库启动第一阶段工程工作，在不破坏既定架构原则的前提下，初始化最小可运行的 Electron 桌面工程。

## 建议阶段

### Milestone 1：工程脚手架

- 初始化 Electron + Vite + Vue + TypeScript。
- 建立 `src/main`、`src/preload`、`src/renderer`、`src/core` 目录。
- 打通最小窗口启动链路。

### Milestone 2：单工作区终端

- 集成 `node-pty` 与 `xterm.js`。
- 渲染一个工作区卡片与一个终端视图。
- 打通视觉流。

### Milestone 3：状态通道

- 引入 Express webhook server。
- 设计最小事件模型。
- 打通状态流并驱动状态灯更新。

### Milestone 4：恢复机制

- 写入与读取 `~/.stoa/state.json`。
- 保存 `last_cli_session_id`。
- 启动时尝试恢复工作区与 CLI 会话。

## 完成标准

第一阶段完成时，应能在本地桌面应用中启动至少一个工作区，看到终端输出，接收到状态事件，并在应用重启后尝试恢复上一轮工作会话。

## 当前进度（2026-04-18）

当前仓库已经完成 Milestone 1-4 的最小可运行实现：

- 已初始化 Electron + Vite + Vue + TypeScript 项目。
- 已建立 `src/main`、`src/preload`、`src/renderer`、`src/core`、`src/extensions`、`src/shared` 目录结构。
- 已实现最小 Electron 窗口启动链路与 preload 白名单桥接。
- 已实现基于 Pinia 的 workspace projection store，并有测试覆盖 hydrate / event apply 行为。
- 已实现左侧工作区控制台和右侧 `xterm.js` 主终端视图。
- 已接入 `node-pty`，由主进程 / `src/core` 托管本地 shell PTY。
- 已实现 preload 输入、resize、terminal data、workspace event 的白名单桥接。
- 已实现最小 Session Manager、Express 本地 webhook server 与 runtime state 分发。
- 已实现 `~/.stoa/state.json` 的最小持久化与启动恢复。
- 已验证 `npx pnpm test`、`npx pnpm typecheck`、`npx pnpm build`、`npx electron-vite preview`。

尚未完成的部分：

- 当前仍以单工作区、本地 shell provider 为主，尚未接入真实 Agent CLI provider。
- 当前 webhook server 已具备接线位置，但 sidecar 鉴权与完整 canonical event 校验仍需进一步收紧。
- 当前恢复逻辑只实现最小 session/state 恢复，不包含完整终端缓冲复原。
