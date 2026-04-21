---
date: 2026-04-21
topic: 项目测试设置与架构
status: completed
sources: 10
---

## Research Report: 项目测试设置

### Summary

项目使用 **Vitest 3.2.4** + **happy-dom** + **@vue/test-utils** 作为测试基础设施，共 **38 个测试文件**，按三层架构组织：单元测试（`src/**/*.test.ts`）、E2E 集成测试（`tests/e2e/*.test.ts`）、静态分析守卫测试。没有使用 `__tests__` 目录或 `.spec.` 命名模式。运行命令为 `npx vitest run`。

### 测试框架与配置

| 项目 | 值 | 来源 |
|------|-----|------|
| 测试框架 | Vitest 3.2.4 | `package.json:38` |
| DOM 环境 | happy-dom 18.0.1 | `vitest.config.ts:16` |
| Vue 测试工具 | @vue/test-utils 2.4.6 | `package.json:31` |
| Vite 插件 | @vitejs/plugin-vue 6.0.1 | `vitest.config.ts:3` |
| 运行命令 | `vitest run`（CI）/ `vitest`（watch） | `package.json:16-17` |

#### Vitest 配置 (`vitest.config.ts`)

```typescript
// vitest.config.ts - 全部 18 行
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@extensions': resolve(__dirname, 'src/extensions')
    }
  },
  test: {
    environment: 'happy-dom'
  }
})
```

**要点：**
- 全局使用 `happy-dom` 环境，Vue 组件测试文件也用 `// @vitest-environment happy-dom` 显式声明
- 路径别名与项目 `tsconfig` 对齐，测试文件使用 `@core/xxx` 形式的导入
- 配置极简——没有自定义 coverage、timeout、setup 文件或 globals 配置

### 三层测试架构

#### Tier 1: 单元测试（`src/**/*.test.ts`）— 28 个文件

紧邻被测源文件的 co-located 模式，测试独立模块的逻辑。

**核心层 (`src/core/`)：**

| 文件 | 测试内容 |
|------|----------|
| `project-session-manager.test.ts` | 项目/会话 CRUD、孤儿会话拒绝、唯一路径约束 |
| `state-store.test.ts` | JSON 持久化读写 |
| `webhook-server.test.ts` | HTTP 端点接受 |
| `webhook-server-validation.test.ts` | 事件验证拒绝分支 |
| `session-runtime.test.ts` | resume vs fresh-start 命令选择 |
| `session-runtime-callbacks.test.ts` | onData/onExit 回调、默认值、canResume 分支 |
| `pty-host.test.ts` | PTY spawn、write、resize 边界、dispose、exit 清理 |
| `app-logger.test.ts` | 日志文件写入 |

**主进程层 (`src/main/`)：**

| 文件 | 测试内容 |
|------|----------|
| `preload-path.test.ts` | Preload 路径解析、webPreferences 配置 |
| `session-runtime-controller.test.ts` | 会话运行时控制器 |

**渲染进程层 (`src/renderer/`)：**

| 文件 | 测试内容 |
|------|----------|
| `stores/workspaces.test.ts` | Pinia store hydrate/hierarchy/active 级联 |
| `app/App.test.ts` | 根组件 bootstrap/IPC mock/错误处理 |
| `components/AppShell.test.ts` | 顶层 activity bar、默认视图 |
| `components/TerminalViewport.test.ts` | 终端视口 |
| `components/GlobalActivityBar.test.ts` | 全局活动栏 |
| `components/WorkspaceList.test.ts` | 工作区列表 |
| `components/PanelExtensions.test.ts` | 面板扩展 |
| `components/command/*.test.ts` | CommandSurface, NewSessionModal, NewProjectModal, WorkspaceHierarchyPanel, TerminalMetaBar |
| `components/primitives/*.test.ts` | GlassFormField, BaseModal |
| `components/tree/ContextTreeSurface.test.ts` | 上下文树 |
| `components/inbox/InboxQueueSurface.test.ts` | 收件箱队列 |

**扩展层 (`src/extensions/`)：**

| 文件 | 测试内容 |
|------|----------|
| `providers/opencode-provider.test.ts` | OpenCode 命令构建 |
| `panels/index.test.ts` | Panel 注册 |

**共享层 (`src/shared/`)：**

| 文件 | 测试内容 |
|------|----------|
| `project-session.test.ts` | 共享类型/工具函数 |

#### 单元测试模式：

```typescript
// 核心/主进程：直接导入模块，手动管理临时文件
import { afterEach, describe, expect, test } from 'vitest'
import { ProjectSessionManager } from './project-session-manager'

// Vue 组件：mount + Pinia + window.vibecoding mock
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
// @vitest-environment happy-dom
```

#### Tier 2: E2E 集成测试（`tests/e2e/*.test.ts`）— 9 个文件

全管线测试，使用真实文件系统、真实 HTTP 请求、真实 Pinia store。仅 mock Electron IPC。

| 文件 | 测试范围 |
|------|----------|
| `backend-lifecycle.test.ts` | 全生命周期：创建项目→会话 CRUD→状态持久化→重启恢复→webhook→运行时→provider 命令（919行，最大文件） |
| `frontend-store-projection.test.ts` | 后端→Pinia hydrate→computed→active 级联→一致性 |
| `error-edge-cases.test.ts` | 重复路径、孤儿会话、状态损坏恢复、并发管理器、快速操作、路径规范化 |
| `provider-integration.test.ts` | Provider 注册、命令构建、环境变量、sidecar 文件写入 |
| `ipc-bridge.test.ts` | FakeIpcBus 模拟：renderer → preload → ipcMain → manager → response |
| `app-bridge-guard.test.ts` | App.vue 在 window.vibecoding undefined/部分定义/null 时的行为 |
| `store-lifecycle-sync.test.ts` | Store 生命周期同步 |
| `session-runtime-lifecycle.test.ts` | 会话运行时生命周期 |

#### E2E 共享工具 (`tests/e2e/helpers.ts`)：

```typescript
// 提供：createTestWorkspace, createTestStatePath, readStateFile, cleanupTempDirs, createSeededManager
// 统一管理临时目录清理（afterEach 自动 cleanup）
```

#### Tier 3: 静态分析守卫测试（`main-config-guard.test.ts`）

读取源文件文本进行结构验证——捕获运行时测试无法检测的配置漂移：

- `webPreferences` 必须包含 `sandbox: false`
- IPC handler 注册必须使用 `IPC_CHANNELS` 常量（非硬编码字符串）
- Preload 必须暴露 `RendererApi` 定义的所有方法
- Channel 名称在 preload 和 main 进程间必须匹配

### 测试运行方式

```bash
# 单次运行（CI）
npx vitest run

# Watch 模式（开发）
npx vitest

# 没有独立的 coverage 命令
# 没有 CI 配置文件（如 vitest.ci.config.ts）
```

### Evidence Chain

| 发现 | 来源 | 位置 |
|------|------|------|
| Vitest 3.2.4 为测试框架 | `package.json` | `:38` |
| happy-dom 为全局测试环境 | `vitest.config.ts` | `:16` |
| 共 38 个 .test.ts 文件 | Glob 搜索 | 项目根目录 |
| 无 .spec. 或 __tests__ 文件 | Glob 搜索 | 项目根目录 |
| E2E 使用真实文件系统和 HTTP | `backend-lifecycle.test.ts` | `:1-60` |
| Vue 组件使用 mount + Pinia | `AppShell.test.ts` | `:18-29` |
| 静态分析读源码文本做验证 | `main-config-guard.test.ts` | `:1-60` |
| E2E helpers 统一管理临时目录 | `helpers.ts` | `:1-71` |
| sandbox:false 为已知故意失败测试 | `AGENTS.md` | Quality Gate 节 |
| 无 coverage 配置 | `vitest.config.ts` | 全文 |

### Risk Points

- [!] **无 Coverage 配置** — `vitest.config.ts` 中没有 coverage 设置，无法量化测试覆盖率
- [!] **已知失败测试** — `main-config-guard.test.ts` 中 sandbox:false 检测为已知的 intentional failure（跟踪真实 bug）
- [?] **E2E 测试体积** — `backend-lifecycle.test.ts` 有 919 行，可能需要拆分为更集中的测试文件

### Recommendations

1. 当前三层架构清晰合理，单元/E2E/静态分析的分层是最佳实践
2. 如果需要量化覆盖率，可添加 `coverage` 配置到 `vitest.config.ts`
3. E2E 最大文件（919行）可考虑按场景拆分

### Open Questions

- 是否有 CI 管道配置（如 GitHub Actions）来自动运行 `npx vitest run`？项目中未见 CI 配置文件
- `main-config-guard.test.ts` 的 sandbox:false bug 有计划修复时间线吗？
