---
date: 2026-04-19
topic: new project and new session review
status: completed
sources: 12
---

# Research Report: New Project / New Session Review

## Summary

当前项目里，`new project` 和 `new session` 并不是两套独立实现。后端真实的领域对象只有 `workspace`：创建时统一走 `workspace:create` IPC、`SessionManager.addWorkspace()` 持久化、`startWorkspaceRuntime()` 启动 PTY/runtime 这一条链路；前端再把多个 workspace 按 `name + path` 分组成“项目 + 子 session”的层级视图。整体架构方向是清晰的，但 UI 与状态模型之间还没有完全接上：`new project` 的输入链路目前不完整，而 `new session` 只有视觉 affordance，没有真正可执行的交互。

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `App.vue` 持有创建草稿字段 `draftName` / `draftPath` / `draftProviderId`，并在 `handleWorkspaceCreate()` 中调用创建 API | `src/renderer/app/App.vue` | `src/renderer/app/App.vue:8-12,21-45` |
| `App.vue` 将创建相关 v-model 和 `@create` 事件下发给 `AppShell` | `src/renderer/app/App.vue` | `src/renderer/app/App.vue:63-74` |
| `AppShell` 只把 `createProject` 事件透传给上层，没有渲染任何名称/路径/provider 输入 UI | `src/renderer/components/AppShell.vue` | `src/renderer/components/AppShell.vue:11-28,42-49` |
| 左侧面板顶部只有 `New Project` 按钮；父节点上有 `+` session affordance，但没有点击处理 | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | `src/renderer/components/command/WorkspaceHierarchyPanel.vue:35-39,57-60` |
| `CommandSurface` 只是把 `createProject` 继续上抛 | `src/renderer/components/command/CommandSurface.vue` | `src/renderer/components/command/CommandSurface.vue:14-22` |
| preload 暴露 `createWorkspace()`，实际 IPC 通道为 `workspace:create` | `src/preload/index.ts` | `src/preload/index.ts:5-11` |
| IPC 常量中只有 `workspaceCreate`，没有独立的 `sessionCreate` 通道 | `src/core/ipc-channels.ts` | `src/core/ipc-channels.ts:1-8` |
| main 进程的 `createAndStartWorkspace()` 统一负责创建 workspace、配置 runtime metadata、启动 runtime | `src/main/index.ts` | `src/main/index.ts:72-96,177-179` |
| `SessionManager.addWorkspace()` 创建 canonical workspace，并写入持久化状态 | `src/core/session-manager.ts` | `src/core/session-manager.ts:225-243,339-346` |
| 启动 runtime 时统一走 `startWorkspaceRuntime()`，调用 provider、PTY host，并依次进入 `starting` / `running` 状态 | `src/core/workspace-runtime.ts` | `src/core/workspace-runtime.ts:39-70` |
| renderer store 通过 `name::path` 把多个 workspace 组成一个层级 group；这说明“项目/会话层级”目前是 UI 投影，不是后端独立模型 | `src/renderer/stores/workspaces.ts` | `src/renderer/stores/workspaces.ts:28-56` |
| 产品规格明确要求：顶部允许 new project/workspace，父节点下允许 visible affordance for new session | `research/2026-04-18-frontend-ready-product-spec.md` | `research/2026-04-18-frontend-ready-product-spec.md:103-114,136-153` |

## Design & Implementation

### 1. 当前真实模型：后端只有 workspace，没有独立 session 创建模型

从类型和 IPC 看，系统的 canonical object 是 `WorkspaceSummary`，创建请求也是 `CreateWorkspaceRequest`，没有单独的 `CreateSessionRequest` 或 `session:create` 通道。也就是说，当前“new session”并不是一个独立后端能力，而更像是未来要在 UI 上把多个 workspace 解释成同一 project 下的多个 child session。证据见 `src/shared/workspace.ts:11-22,98-126` 与 `src/core/ipc-channels.ts:1-8`。

### 2. New Project 的实现链路

`New Project` 按钮在 `WorkspaceHierarchyPanel` 里触发 `createProject`，经过 `CommandSurface` 和 `AppShell` 逐级上抛，最后在 `App.vue` 落到 `handleWorkspaceCreate()`。这个函数会读取 `draftName`、`draftPath`、`draftProviderId`，通过 `window.vibecoding.createWorkspace()` 发 IPC 到 main 进程。main 进程收到 `workspace:create` 后执行 `createAndStartWorkspace()`：

1. `sessionManager.addWorkspace(request)` 创建并持久化 workspace
2. `configureSingleWorkspaceRuntimeMetadata()` 注入 `workspaceSecret` / `providerPort`
3. `startWorkspaceRuntime()` 调 provider 和 PTY 启动实际 runtime
4. `SessionManager` 发出 workspace event，renderer store 再 `applyEvent()` 更新状态

这条链从设计上是顺的，职责边界也合理：renderer 发 intent，main 持有状态真相，runtime 启动逻辑集中在 core。

### 3. New Session 的当前状态

`new session` 在 UI 规范和层级组件里都“被预留了位置”，但没有真正闭环：

- 规格文档要求父节点行要有 “new session” affordance。
- `WorkspaceHierarchyPanel` 确实渲染了父节点右侧 `+`。
- 但这个 `+` 只是 `<span>`，没有 `@click`、没有 emit、没有任何上层 handler。
- 后端也没有对应的独立创建 API。

因此现在的“new session”本质上还是一个**未实现的产品意图**，不是一个已经可用的功能。

### 4. 项目 / Session 层级的实际实现方式

renderer store 用 `const key = `${workspace.name}::${workspace.path}`` 来 group workspace，并把同组 workspace 展示为一个父项目下的多个子项。这意味着：

- “项目”只是 UI grouping，不是持久化实体
- “session”子项本质上仍然是一个个 workspace
- 如果想真正支持 “在已有项目下开新 session”，当前最自然的实现不是新增全新领域模型，而是“基于同 path/name 再创建一个 workspace 实例”，然后继续由 UI group 成同一父节点

这个方向与规格文档的“UI model 映射回 canonical workspace/session data，不在 renderer 发明假状态所有权”基本一致。

## Risk Points

- [!] **`new project` 当前前端交互链不完整，用户几乎无法真正创建。** `App.vue` 明确要求先有 `draftName` 和 `draftPath`，否则直接报错 `请先填写工作区名称和路径`；但 `AppShell` 和 `CommandSurface` 当前没有任何输入表单或弹窗来修改这些值。也就是说，点击 `New Project` 只会触发一个没有输入来源的创建动作。来源：`src/renderer/app/App.vue:21-27,63-74`，`src/renderer/components/AppShell.vue:37-60`。

- [!] **`new session` 只有视觉入口，没有行为实现。** 父节点的 `+` affordance 是纯展示元素，不可点击，也没有事件向上冒泡；因此规格要求的“new session under a parent group”还没有落地。来源：`src/renderer/components/command/WorkspaceHierarchyPanel.vue:57-60`，`research/2026-04-18-frontend-ready-product-spec.md:112-113,152`。

- [!] **后端没有独立 session 创建语义，容易造成产品术语和实现语义错位。** 现在无论是 new project 还是未来的 new session，底层都只能创建 workspace。如果产品继续在 UI 上强调“project / session”是两个概念，就需要明确：session 是不是只是“同项目路径下的另一个 workspace runtime”。否则后续会在 API 命名、持久化模型和恢复逻辑上持续混乱。来源：`src/shared/workspace.ts:11-22,98-126`，`src/core/ipc-channels.ts:1-8`，`src/renderer/stores/workspaces.ts:28-56`。

- [!] **创建后没有自动激活新 workspace。** `handleWorkspaceCreate()` 成功后只 `workspaceStore.addWorkspace(created)`，没有像 `handleWorkspaceSelect()` 那样同步更新 `activeWorkspaceId` 和 main 进程 active 状态。结果是新建完成后，新项目可能出现在左栏，但右侧终端仍停留在旧 workspace。来源：`src/renderer/app/App.vue:16-18,31-39`。

- [!] **创建失败会留下已持久化但未成功启动的 workspace。** `createAndStartWorkspace()` 先 `addWorkspace()` 再 `startWorkspaceRuntime()`；如果 runtime 启动失败，IPC 会抛错给前端，但 state.json 里已经写入了这条 workspace。下次启动时它会按恢复逻辑继续出现，可能形成“僵尸条目”。来源：`src/main/index.ts:77-95`，`src/core/session-manager.ts:225-243,339-346`，`src/core/state-store.ts:68-74`。

- [!] **路径校验过弱。** `assertWorkspacePathExists()` 仅调用 `access(path)`，验证的是“可访问”，不是“该路径确实是目录 / 有效 workspace 根目录”。这会让文件路径或不合规路径通过创建校验。来源：`src/core/session-manager.ts:33-39`。

- [!] **状态恢复与 `needs_confirmation` 设计还有未闭环点。** 恢复逻辑会把某些缺少 `cliSessionId` 的 workspace 置为 `needs_confirmation`，但合法状态迁移表里 `needs_confirmation` 没有任何可迁出状态。如果没有单独的确认恢复 UI / 操作，这类条目会卡死。来源：`src/core/session-manager.ts:41-54,56-72`。

- [!] **`acceptedEventIds` 无上限增长。** 去重集合只增不减，长时间运行会累积内存。来源：`src/core/session-manager.ts:159-162,246-269`。

- [?] **启动阶段的 provider_id 事件目前被硬编码成 `local-shell`。** `markWorkspaceStarting()` / `markWorkspaceRunning()` / `markWorkspaceExited()` 发出的事件都写死 `provider_id: 'local-shell'`，如果未来用 `opencode` provider 创建 workspace，事件层的 provider 信息可能与实际配置不一致。来源：`src/core/session-manager.ts:281-332`。

- [?] **main 进程重复创建了两次 `SessionManager`。** 应用 ready 后先以 `webhookPort: null` 初始化一次，启动 webhook server 后又以真实端口初始化第二次。第二次会覆盖第一次实例，虽然不一定造成功能错误，但会带来重复读写状态与初始化成本。来源：`src/main/index.ts:140-160`。

## Recommendations

1. **先统一概念：明确 “new session = 在同一项目 path/name 下再创建一个 workspace runtime” 还是引入新的后端 session 实体。** 以当前代码结构看，前者更顺，也更符合现有 renderer grouping 实现。
2. **把 `new project` 先补成完整可用链路。** 至少需要一个实际输入 UI（inline form、modal、drawer 任一都可以），能写入 `draftName` / `draftPath` / `draftProviderId`，否则顶部按钮只是半成品。
3. **为父节点 `+` 明确增加 `createSession(group)` 行为。** 如果沿用当前模型，可以直接复用 `createWorkspace`，但从 group 预填 `name/path`，只让用户选择 provider 或补充 label。
4. **创建成功后自动切换 active workspace。** 这样右侧终端会自然进入新开的 project/session，减少“创建成功但界面没变”的错觉。
5. **给创建流程补启动失败回滚或失败态标记。** 至少要避免“已写入持久化，但 runtime 根本没起来”的僵尸项长期残留。
6. **补强路径与状态恢复逻辑。** 路径应验证为目录；`needs_confirmation` 需要可恢复的用户操作和合法状态迁移。
7. **修正事件里的 providerId 传播与长期内存细节。** 这属于中层质量问题，不会阻塞演示，但会阻塞后续多 provider 扩展。

## Open Questions

- `new session` 在产品上是否真的等价于“同一项目下的另一条 runtime/thread”，还是计划引入独立 session 持久化对象？
- `AppShell` 当前为什么已经暴露了 `name/path/providerId` props 和 update emits，却没有对应的输入组件？这是未提交部分，还是实现被中断了？
- `needs_confirmation` 预期由哪个 UI surface 承担恢复入口：Command 面板、Inbox/Queue，还是未来的 Settings/Recovery 流程？

## Next Steps

Based on this research, the implementation path would most likely be:

1. 在 renderer 里补一个真正的创建入口，先打通 `new project`。
2. 把 group 级 `+` 接成 `new session` 行为，并复用/扩展现有 `createWorkspace` 流程。
3. 在 main/core 层补创建失败回滚、providerId 事件修正、恢复态闭环。
