---
date: 2026-04-23
topic: session-type-architecture-and-extension
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Session Type Architecture & How to Add New Session Types

### Why This Was Gathered
理解 Session 的定义以及当前项目如何新增一种新的 Session 类型（例如支持 claude-code、aider 等新 provider）。

### Summary

Session 是项目中的一个**终端会话实例**，绑定到某个 Project 下，由一个 Provider 驱动运行在 PTY 中。当前有两种 Session 类型：`shell`（本地 shell）和 `opencode`（OpenCode AI 编码工具）。新增 Session 类型需要修改 4 层：类型定义层、Provider 扩展层、主进程路由层、前端 UI 层。

### Key Findings

#### 1. Session 的定义

Session 是 Project 下的一个**可恢复的终端会话**。核心数据结构在 `src/shared/project-session.ts`:

- **`SessionType`** — 联合类型 `'shell' | 'opencode'`（第1行），是 session 类型的枚举
- **`SessionSummary`** — session 的运行时模型（第22-35行），包含 id、projectId、type、status、title、recoveryMode、externalSessionId 等
- **`PersistedSession`** — session 的持久化格式（第46-59行）
- **`CreateSessionRequest`** — 创建 session 的请求结构（第113-118行）

Session 的生命周期状态（`SessionStatus`）：
`bootstrapping → starting → running → awaiting_input / degraded / error / exited / needs_confirmation`

Session 的恢复策略（`SessionRecoveryMode`）：
- `'fresh-shell'` — 每次都是全新 shell（用于 `shell` 类型）
- `'resume-external'` — 尝试恢复外部 session（用于 `opencode` 等类型）

#### 2. Provider 架构

Provider 是 Session 的**执行引擎**，定义在 `src/extensions/providers/index.ts`:

```typescript
interface ProviderDefinition {
  providerId: string
  supportsResume(): boolean
  supportsStructuredEvents(): boolean
  buildStartCommand(target, context): Promise<ProviderCommand>
  buildResumeCommand(target, externalSessionId, context): Promise<ProviderCommand>
  resolveSessionId(event): string | null
  installSidecar(target, context): Promise<void>
}
```

当前注册了两个 Provider（第27-30行）：
- `local-shell` → `src/extensions/providers/local-shell-provider.ts`
- `opencode` → `src/extensions/providers/opencode-provider.ts`

Provider 注册方式是硬编码的 Map：
```typescript
const providers = new Map<string, ProviderDefinition>([
  [localShellProvider.providerId, localShellProvider],
  [opencodeProvider.providerId, opencodeProvider]
])
```

#### 3. SessionType → Provider 的映射是硬编码的

关键路由逻辑在 `src/main/index.ts:119`：
```typescript
const providerId = session.type === 'shell' ? 'local-shell' : 'opencode'
```

**这是一个 `if/else` 二选一的硬编码映射**，不是查表。同样在恢复逻辑（第230行）也使用了相同的硬编码。

#### 4. 前端 UI 层

- **ProviderRadialMenu**（`src/renderer/components/command/ProviderRadialMenu.vue`）— 环形菜单，展示所有可用 provider 类型，从中选择创建哪种 session。数据源来自 `PROVIDER_ICONS`（`src/renderer/composables/provider-icons.ts`），硬编码了 `opencode` 和 `shell` 两种图标。
- **ProviderFloatingCard**（`src/renderer/components/command/ProviderFloatingCard.vue:19`）— 名称映射硬编码：`provider.type === 'opencode' ? 'OpenCode' : 'Shell'`
- **WorkspaceHierarchyPanel**（`src/renderer/components/command/WorkspaceHierarchyPanel.vue:38-42`）— 生成标题时硬编码了 `opencode` 的特殊处理。
- **WorkspaceList**（`src/renderer/components/WorkspaceList.vue`）— 下拉选择 session 类型。

#### 5. session-runtime.ts 的类型分支

`src/core/session-runtime.ts` 中有两处 `session.type` 分支：
- 第67-69行：只有 `opencode` 类型才检查是否可 resume
- 第78-79行：只有 `opencode` 类型才用 shell 包装命令

### 新增 Session 类型需要的改动清单

| # | 层级 | 文件 | 改动 |
|---|------|------|------|
| 1 | 类型定义 | `src/shared/project-session.ts:1` | `SessionType` 联合类型增加新成员 |
| 2 | Provider 实现 | `src/extensions/providers/` | 新建 `xxx-provider.ts`，实现 `ProviderDefinition` |
| 3 | Provider 注册 | `src/extensions/providers/index.ts:27-30` | Map 中添加新 provider |
| 4 | 主进程路由 | `src/main/index.ts:119,230` | 将硬编码的 if/else 改为查表（`type → providerId` 映射） |
| 5 | 恢复策略 | `src/core/project-session-manager.ts:100-102` | `createSessionRecoveryMode()` 需处理新类型 |
| 6 | 运行时分支 | `src/core/session-runtime.ts:67-79` | resume 检查和 shell 包装逻辑需泛化 |
| 7 | 图标 | `src/renderer/composables/provider-icons.ts` | 添加新类型的 icon |
| 8 | UI 名称映射 | `ProviderRadialMenu.vue:21-24` | `providerNames` 添加新条目 |
| 9 | UI 名称映射 | `ProviderFloatingCard.vue:19` | 三元表达式改为查表 |
| 10 | 标题生成 | `WorkspaceHierarchyPanel.vue:38-42` | 标题生成逻辑需泛化 |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| SessionType 联合类型定义 | `src/shared/project-session.ts` | 第1行 |
| SessionSummary 完整数据结构 | `src/shared/project-session.ts` | 第22-35行 |
| ProviderDefinition 接口 | `src/extensions/providers/index.ts` | 第13-25行 |
| Provider 注册 Map | `src/extensions/providers/index.ts` | 第27-30行 |
| SessionType→Provider 硬编码映射 | `src/main/index.ts` | 第119行 |
| 恢复逻辑中的硬编码映射 | `src/main/index.ts` | 第230行 |
| 恢复策略分支 | `src/core/project-session-manager.ts` | 第100-102行 |
| resume 检查的类型分支 | `src/core/session-runtime.ts` | 第67-69行 |
| shell 包装的类型分支 | `src/core/session-runtime.ts` | 第78-79行 |
| Provider 图标硬编码 | `src/renderer/composables/provider-icons.ts` | 第10-27行 |
| Provider 名称映射 | `src/renderer/components/command/ProviderRadialMenu.vue` | 第21-24行 |
| ProviderFloatingCard 名称 | `src/renderer/components/command/ProviderFloatingCard.vue` | 第19行 |

### Risks / Unknowns

- [!] **主进程硬编码映射是最大瓶颈**：`session.type === 'shell' ? 'local-shell' : 'opencode'` 意味着任何新类型都会走到 `opencode` 分支。新增类型前必须先将此处改为查表。
- [?] **`resolveRuntimePaths` 函数**（`src/main/index.ts:64`）当前只处理 `shell` 和 `opencode` 两种类型的路径解析，新增类型需要考虑是否需要新的路径检测逻辑。
- [?] **SessionEventBridge** 的 webhook/事件处理是否需要按 provider 区分行为，尚未确认。
- [?] 新增 provider 是否需要 sidecar 插件安装（类似 opencode 的 `.opencode/plugins/stoa-status.ts`），取决于新 provider 是否支持 webhook 事件回调。
