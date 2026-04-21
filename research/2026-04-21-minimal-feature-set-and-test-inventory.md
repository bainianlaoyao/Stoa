---
date: 2026-04-21
topic: Minimal Feature Set, Frontend Interaction Flow, E2E Test Inventory & Logging
status: completed
sources: 35+
---

## Research Report: ultra_simple_panel — 功能集合、交互流程、E2E 测试现状与日志功能

### Summary

`ultra-simple-panel` 是一个 Electron 桌面应用，提供项目管理、终端会话（shell / opencode AI 编程）、xterm.js 终端仿真、结构化 webhook 事件回传、状态持久化与重启恢复等功能。前端使用 Vue 3 + Pinia，后端基于 Express（webhook）+ node-pty（终端），通过 9 个 IPC 通道进行主进程与渲染进程通信。当前 E2E 测试覆盖 10 个文件 ~120+ 测试用例，但日志系统 (`app-logger`) 实际是死代码，生产代码仅用 `console.*`。

---

## 一、最小化功能集合

### 1.1 核心功能清单

| # | 功能 | 描述 | 入口文件 |
|---|------|------|----------|
| F1 | **项目管理** | 创建项目（name + path）、设置活跃项目、持久化到 `~/.vibecoding/state.json` | `src/core/project-session-manager.ts` |
| F2 | **会话管理** | 在项目下创建 shell 或 opencode 会话、设置活跃会话、会话自动关联项目 | `src/core/project-session-manager.ts` |
| F3 | **终端仿真** | xterm.js viewport，支持键盘输入 → PTY → 输出回显，支持 resize | `src/renderer/components/TerminalViewport.vue` + `src/core/pty-host.ts` |
| F4 | **AI 编程会话 (opencode)** | sidecar 插件注入（`.opencode/plugins/vibecoding-status.ts`）、CLI 命令构建、session resume | `src/extensions/providers/opencode-provider.ts` |
| F5 | **结构化事件 Webhook** | 本地 Express 服务接收 `CanonicalSessionEvent`，验证 secret，触发会话状态更新 | `src/core/webhook-server.ts` |
| F6 | **状态持久化与恢复** | 所有项目/会话持久化到磁盘；重启后 `buildBootstrapRecoveryPlan()` 恢复全部会话 | `src/core/state-store.ts` + `src/core/session-runtime.ts` |
| F7 | **Provider 注册系统** | 可插拔会话提供者：`local-shell`（原生 shell）和 `opencode`（AI 编程） | `src/extensions/providers/index.ts` |
| F8 | **IPC 通信桥** | 7 个 invoke 通道 + 2 个 push 通道，承载完整的渲染器 ↔ 主进程双向通信 | `src/core/ipc-channels.ts` + `src/preload/index.ts` |
| F9 | **前端状态管理** | Pinia store 管理项目/会话层级、活跃状态级联、computed hierarchy | `src/renderer/stores/workspaces.ts` |
| F10 | **面板扩展系统** | `PanelExtensionDefinition` 接口 + 默认 `workspace-debug-summary` 面板 | `src/extensions/panels/index.ts` |

### 1.2 会话类型与行为差异

| 特性 | `shell` | `opencode` |
|------|---------|------------|
| 底层进程 | `powershell.exe` / `bash` | `opencode` CLI |
| Resume 支持 | ❌ (`supportsResume() = false`) | ✅ (`--session` flag) |
| 结构化事件 | ❌ | ✅ (webhook sidecar) |
| Sidecar 安装 | 无操作 | 写入 `.opencode/plugins/vibecoding-status.ts` |
| Recovery Mode | `fresh-shell` | `resume-external` |

### 1.3 会话生命周期状态机

```
bootstrapping → starting → running → exited
                         ↘ awaiting_input
                         ↘ degraded
                         ↘ error
                         ↘ needs_confirmation
```

### 1.4 持久化数据模型

**磁盘格式** (`~/.vibecoding/state.json`, `PersistedAppStateV2`):
```typescript
{
  version: 2,
  active_project_id: string | null,
  active_session_id: string | null,
  projects: PersistedProject[],    // snake_case keys
  sessions: PersistedSession[]     // snake_case keys
}
```

**内存格式** (`ProjectSummary` / `SessionSummary`):
```typescript
// camelCase keys, plus computed fields
ProjectSummary  = { id, name, path, defaultSessionType?, createdAt, updatedAt }
SessionSummary  = { id, projectId, type, status, title, summary,
                    recoveryMode, externalSessionId?, createdAt, updatedAt, lastActivatedAt }
```

---

## 二、前端交互流程

### 2.1 组件树

```
App.vue (Root — IPC 初始化 + 事件监听)
└── AppShell.vue (布局容器 + Surface 切换)
    ├── GlobalActivityBar.vue (4 个 Surface 导航按钮)
    ├── CommandSurface.vue (activeSurface === 'command')
    │   ├── WorkspaceHierarchyPanel.vue (左侧：项目/会话树)
    │   │   ├── NewProjectModal.vue → BaseModal + GlassFormField
    │   │   └── NewSessionModal.vue → BaseModal + GlassFormField
    │   └── TerminalViewport.vue (右侧：xterm.js 终端)
    ├── InboxQueueSurface.vue (placeholder)
    └── ContextTreeSurface.vue (placeholder)
```

**Surface 类型**: `command` | `queue` | `tree` | `settings`
- `command`: 主工作区（hierarchy + terminal）
- `queue` / `tree` / `settings`: 尚为占位符

### 2.2 典型用户交互流程

#### 流程 1: 应用启动 → 初始状态加载
```
App.vue onMounted()
  → window.vibecoding.getBootstrapState()    [IPC: project:bootstrap]
  → workspaceStore.hydrate(bootstrapState)   [Pinia store 初始化]
  → AppShell 渲染 projectHierarchy
  → WorkspaceHierarchyPanel 展示项目/会话树
```

#### 流程 2: 创建新项目
```
WorkspaceHierarchyPanel: 点击 "New Project"
  → showNewProject = true
  → NewProjectModal 渲染 (name + path 表单)
  → 用户填写 → 点击 "创建"
  → emit('createProject', {name, path})
  → App.vue handleProjectCreate()
    → window.vibecoding.createProject({name, path})  [IPC: project:create]
    → workspaceStore.addProject() + setActiveProject()
  → Modal 关闭, hierarchy 更新
```

#### 流程 3: 创建新会话
```
WorkspaceHierarchyPanel: 点击项目旁的 "+" 按钮
  → showNewSession = true, targetProjectId 设置
  → NewSessionModal 渲染 (title + type 选择: shell/opencode)
  → 用户填写 → 点击 "创建"
  → emit('createSession', {projectId, title, type})
  → App.vue handleSessionCreate()
    → window.vibecoding.createSession({...})  [IPC: session:create]
    → 主进程: manager.createSession() + startSessionRuntime()
    → workspaceStore.addSession() + setActiveSession()
  → TerminalViewport 显示 xterm.js 终端
```

#### 流程 4: 终端交互
```
用户在 TerminalViewport 中键入
  → xterm.js terminal.onData()
  → window.vibecoding.sendSessionInput(sessionId, data)  [IPC: session:input]
  → PtyHost.write() → 底层 PTY 进程

PTY 输出 → session-runtime-controller
  → win.webContents.send('terminal:data', {sessionId, data})  [IPC push]
  → preload listener → App.vue callback
  → workspaceStore 不存储, 直接 terminal.write(chunk.data)
```

#### 流程 5: 会话状态更新
```
Provider 发送 CanonicalSessionEvent → Webhook Server
  → 验证 secret → 触发 onEvent callback
  → session-runtime-controller.pushSessionEvent()
  → manager.markSessionRunning/markSessionExited()
  → win.webContents.send('session:event', {sessionId, status, summary})
  → preload listener → workspaceStore.updateSession(id, {status, summary})
  → TerminalViewport 响应: status !== 'running' 时显示退出消息
```

#### 流程 6: 切换活跃项目/会话
```
点击 hierarchy 中的项目或会话
  → emit('selectProject'/'selectSession')
  → App.vue handleProjectSelect/handleSessionSelect
    → window.vibecoding.setActiveProject/setActiveSession()  [IPC]
    → workspaceStore.setActiveProject/setActiveSession()
    → 活跃级联: setActiveSession 同时更新 activeProjectId
```

### 2.3 Pinia Store (`useWorkspaceStore`)

| 类型 | 名称 | 说明 |
|------|------|------|
| **State** | `projects: ProjectSummary[]` | 所有项目 |
| | `sessions: SessionSummary[]` | 所有会话 |
| | `activeProjectId: string \| null` | 当前活跃项目 |
| | `activeSessionId: string \| null` | 当前活跃会话 |
| | `terminalWebhookPort: number \| null` | Webhook 端口 |
| | `lastError: string \| null` | 错误状态 |
| **Computed** | `activeProject` | 按 ID 查找项目 |
| | `activeSession` | 按 ID 查找会话 |
| | `projectHierarchy` | 嵌套层级: projects → sessions + active flags |
| **Actions** | `hydrate(state)` | 从 BootstrapState 初始化 |
| | `setActiveProject(id)` | 设置活跃项目 + 自动选择第一个会话 |
| | `setActiveSession(id)` | 设置活跃会话 **且** 级联更新 activeProjectId |
| | `addProject / addSession` | 添加新实体 |
| | `updateSession(id, patch)` | 更新 status/summary/externalSessionId |
| | `clearError()` | 清除错误 |

### 2.4 IPC 通道完整映射

| 通道名 | 方向 | 触发场景 | 返回类型 |
|--------|------|----------|----------|
| `project:bootstrap` | Renderer → Main | App.vue onMounted | `BootstrapState` |
| `project:create` | Renderer → Main | 创建项目 | `ProjectSummary` |
| `project:set-active` | Renderer → Main | 点击项目 | `void` |
| `session:create` | Renderer → Main | 创建会话 | `SessionSummary` |
| `session:set-active` | Renderer → Main | 点击会话 | `void` |
| `session:input` | Renderer → Main | 终端键盘输入 | `void` |
| `session:resize` | Renderer → Main | 窗口大小变化 | `void` |
| `terminal:data` | Main → Renderer | PTY 输出流 | `TerminalDataChunk` |
| `session:event` | Main → Renderer | 会话状态变化 | `SessionStatusEvent` |

---

## 三、E2E 测试现状

### 3.1 测试基础设施

| 配置项 | 值 |
|--------|-----|
| 框架 | Vitest (`vitest.config.ts`) |
| 环境 | `happy-dom` |
| Vue 支持 | `@vitejs/plugin-vue` |
| 路径别名 | `@renderer`, `@core`, `@shared`, `@extensions` |
| 共享工具 | `tests/e2e/helpers.ts` (temp dir 管理、seeded manager) |
| 已知失败 | `main-config-guard.test.ts`: `sandbox: false` 缺失 (跟踪真实 bug) |

### 3.2 E2E 测试文件清单

| 文件 | 测试数量 | 测试内容 | Mock 策略 |
|------|----------|----------|-----------|
| `backend-lifecycle.test.ts` | ~38 | 完整后端生命周期: 空状态 → 多项目 → 会话 CRUD → 持久化 → 重启恢复 → webhook → session runtime → provider 命令 | mockPtyHost + mockManager + 真实 HTTP |
| `frontend-store-projection.test.ts` | ~39 | Pinia store hydrate、computed 正确性、active 级联、add 操作、store-backend 一致性、edge cases、error state | 无 mock, 真实 manager + Pinia |
| `error-edge-cases.test.ts` | ~26 | 重复路径检测、孤儿会话、JSON 损坏恢复、并发 manager、空状态、路径规范化、快速操作、recovery plan edge cases | 无 mock, 真实文件系统 |
| `provider-integration.test.ts` | ~25 | Provider 注册、local-shell 命令构建、opencode 命令构建、sidecar 文件写入(真实磁盘)、环境隔离 | 无 mock |
| `ipc-bridge.test.ts` | ~15 | FakeIpcBus 模拟 IPC 往返、通道注册完整性、payload 透传、null manager fallback、通道名匹配 | FakeIpcBus (自实现) |
| `app-bridge-guard.test.ts` | ~10 | App.vue 在 window.vibecoding undefined/partial/null 时的行为 | vi.fn() mock window.vibecoding |
| `main-config-guard.test.ts` | ~15 | 静态源码分析: sandbox:false、IPC 注册完整性、preload 类型契约、push 通道注册 | 无 mock, readFileSync 字符串分析 |
| `session-runtime-lifecycle.test.ts` | ~7 | 真实 PtyHost + 真实进程: 完整生命周期、终端输出捕获、多会话、exit 处理、重启恢复、非零退出码 | echo/fail provider (真实进程) |
| `store-lifecycle-sync.test.ts` | ~10 | 跨层同步: PtyHost → manager → Pinia store → computed、事件顺序、多会话、重启后一致性 | echo provider + capturingManager |

**总计: ~185 个 E2E 测试用例**

### 3.3 测试覆盖的关键路径

| 路径 | 覆盖状态 | 测试文件 |
|------|----------|----------|
| 项目 CRUD + 持久化 | ✅ 完整 | `backend-lifecycle.test.ts` Phase 1-2 |
| 会话创建 + 类型分支 | ✅ 完整 | `backend-lifecycle.test.ts` Phase 2, `error-edge-cases.test.ts` |
| 状态恢复 (重启) | ✅ 完整 | `backend-lifecycle.test.ts` Phase 3 |
| Recovery plan 生成 | ✅ 完整 | `backend-lifecycle.test.ts` Phase 3, `error-edge-cases.test.ts` |
| Webhook server | ✅ 完整 | `backend-lifecycle.test.ts` Phase 5 |
| Session runtime (mock PTY) | ✅ 完整 | `backend-lifecycle.test.ts` Phase 6 |
| Provider 命令构建 | ✅ 完整 | `provider-integration.test.ts`, `backend-lifecycle.test.ts` Phase 7 |
| Sidecar 文件写入 | ✅ 完整 | `provider-integration.test.ts` |
| Pinia store hydrate | ✅ 完整 | `frontend-store-projection.test.ts` Phase 1-2 |
| Active 状态级联 | ✅ 完整 | `frontend-store-projection.test.ts` Phase 3 |
| IPC 通道往返 | ✅ 完整 | `ipc-bridge.test.ts` |
| App.vue 桥接保护 | ✅ 完整 | `app-bridge-guard.test.ts` |
| 静态配置守卫 | ✅ 完整 (1 个已知失败) | `main-config-guard.test.ts` |
| 真实进程生命周期 | ✅ 完整 | `session-runtime-lifecycle.test.ts` |
| 跨层 store 同步 | ✅ 完整 | `store-lifecycle-sync.test.ts` |
| 错误/边界条件 | ✅ 完整 | `error-edge-cases.test.ts` |

### 3.4 测试工具模式总结

| 模式 | 使用位置 | 说明 |
|------|----------|------|
| `createMockPtyHost()` | `backend-lifecycle.test.ts` | 记录 start() 调用, 手动触发 onExit |
| `createMockManager()` | `backend-lifecycle.test.ts` | 记录 lifecycle 调用序列 |
| `FakeIpcBus` | `ipc-bridge.test.ts` | 模拟 ipcMain.handle + ipcRenderer.invoke |
| `vi.fn()` mock | `app-bridge-guard.test.ts` | 模拟 window.vibecoding 方法 |
| `readFileSync` 静态分析 | `main-config-guard.test.ts` | 读源码文件做字符串/正则断言 |
| `createEchoProvider()` | `session-runtime-lifecycle.test.ts`, `store-lifecycle-sync.test.ts` | 生成 echo 进程, 真实输出捕获 |
| `createFailProvider()` | `session-runtime-lifecycle.test.ts` | exit code 42 的失败进程 |
| `createCapturingManager()` | `session-runtime-lifecycle.test.ts`, `store-lifecycle-sync.test.ts` | 包装真实 manager + 事件记录 |
| 无 mock 纯集成 | `error-edge-cases.test.ts`, `frontend-store-projection.test.ts`, `provider-integration.test.ts` | 真实文件系统 + 真实模块 |

---

## 四、日志功能

### 4.1 现状

| 维度 | 状态 |
|------|------|
| **核心模块** | `src/core/app-logger.ts` — 提供 `writeAppLog()` + `getLogFilePath()` |
| **日志路径** | `~/.vibecoding/logs/app.log` |
| **日志格式** | `[ISO时间戳] message` |
| **日志级别** | ❌ 无 (仅接受 plain string) |
| **生产调用** | ❌ **零调用** — `writeAppLog` 仅在 `app-logger.test.ts` 中使用 |
| **实际日志方式** | `console.log` / `console.warn` / `console.error` |
| **日志轮转** | ❌ 无 |
| **用户访问日志** | ❌ 无 IPC 通道、无 UI 组件、无 preload API |
| **第三方日志库** | ❌ 未使用 |

### 4.2 console.* 使用分布

| 文件 | 方法 | 用途 |
|------|------|------|
| `src/main/session-runtime-controller.ts` | `console.log`, `console.warn` | PushSessionEvent 状态转换 |
| `src/core/session-runtime.ts` | `console.log` | 会话启动/生成/退出追踪 |
| `src/main/index.ts` | `console.log`, `console.error` | 会话创建、bootstrap 恢复 |
| `src/renderer/app/App.vue` | `console.log` | 组件事件调试 |

### 4.3 结论

`app-logger.ts` 是一个**骨架模块，无生产使用**。所有运行时日志通过 `console.*` 输出到 Electron 主进程 stdout/stderr，用户无法通过应用界面访问日志。

---

## 五、测试规划参考

### 5.1 当前未覆盖的功能点（可考虑新增测试）

| 缺口 | 优先级 | 说明 |
|------|--------|------|
| `setActiveProject` IPC 真实修改 manager 状态 | 中 | 当前仅验证 "不抛异常", 未验证 manager state 变更 |
| `setActiveSession` IPC 真实修改 manager 状态 | 中 | 同上 |
| `terminal:data` push 完整往返 | 高 | 无从 `webContents.send` → preload listener → renderer 的端到端测试 |
| `session:event` push 完整往返 | 高 | 同上 |
| Webhook → SessionRuntimeController → session 状态变更 | 高 | 当前分别测试 webhook 和 session-runtime, 未做集成 |
| Provider 命令失败（binary 不存在） | 中 | 仅测试成功路径 |
| Recovery plan + startSessionRuntime 集成 | 中 | 当前分别测试 |
| 日志系统实际使用 | 低 | 当前为死代码, 但如果需要激活日志, 需要测试 |

### 5.2 测试架构分层（AGENTS.md 规范）

| 层级 | 位置 | 添加新代码时 |
|------|------|-------------|
| Tier 1: 单元测试 | `src/**/*.test.ts` | 新 core 模块 → 同目录下添加 |
| Tier 2: E2E 集成 | `tests/e2e/*.test.ts` | 新 IPC 通道 → ipc-bridge + main-config-guard |
| Tier 3: 配置守卫 | `tests/e2e/main-config-guard.test.ts` | 静态分析, 防止配置漂移 |

### 5.3 必须通过的验证命令

```bash
npx vitest run   # 全套测试, 零意外失败
```

唯一已知可接受失败: `main-config-guard.test.ts` 的 `sandbox: false` 测试。

---

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 9 个 IPC 通道定义 | `src/core/ipc-channels.ts` | :1-11 |
| RendererApi 接口 (7 invoke + 2 event) | `src/shared/project-session.ts` | :99-109 |
| 会话类型: shell / opencode | `src/shared/project-session.ts` | :1 |
| 会话状态: 8 种状态 | `src/shared/project-session.ts` | :3-11 |
| 持久化格式: PersistedAppStateV2 | `src/shared/project-session.ts` | :59-65 |
| 项目/会话数据模型 | `src/shared/project-session.ts` | :13-34 |
| Pinia store: hydrate + computed + actions | `src/renderer/stores/workspaces.ts` | 全文件 |
| 组件树: App → AppShell → CommandSurface | `src/renderer/components/` | 目录结构 |
| 活跃状态级联: setActiveSession 更新 activeProjectId | `src/renderer/stores/workspaces.ts` | setActiveSession action |
| app-logger 零生产调用 | `src/core/app-logger.ts` + 全局搜索 | writeAppLog 无 import |
| console.* 为实际日志方式 | `session-runtime-controller.ts` 等 | 多文件 |
| 10 个 E2E 测试文件 ~185 用例 | `tests/e2e/` | 目录结构 |
| sandbox:false 已知失败 | `tests/e2e/main-config-guard.test.ts` | webPreferences 断言 |
| Vitest + happy-dom + plugin-vue | `vitest.config.ts` | :1-18 |

## Risk Points

- [!] `app-logger.ts` 是死代码 — 如果激活日志功能, 需要从头集成 (IPC 通道、UI、日志级别)
- [!] InboxQueueSurface / ContextTreeSurface 是占位符 — 未来实现时需要完整测试
- [?] WorkspaceList.vue 在当前组件树中未被引用 — 可能是遗留代码, 测试价值低
- [!] Webhook server 无 TLS, 仅绑定 127.0.0.1 — 安全但需注意端口冲突
- [!] Recovery bootstrap 在 `app.whenReady()` 中运行 — 如果恢复过程挂起, 应用无法启动

## Open Questions

- 日志功能是否需要激活？如果是, 需要设计日志级别、UI 查看器、IPC 通道
- `InboxQueueSurface` 和 `ContextTreeSurface` 的具体功能规划是什么？
- 是否需要测试 Electron 打包后的行为（当前全部为非 Electron 运行时测试）？
- 是否需要性能/负载测试（大量会话、长时间运行）？
