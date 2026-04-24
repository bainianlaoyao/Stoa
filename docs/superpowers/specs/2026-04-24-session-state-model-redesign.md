# Session 状态模型重构设计

日期：2026-04-24

## 背景与问题

当前实现把一个 `SessionStatus` 同时用来表达多件不同的事：

- Stoa 是否已经创建 session。
- provider/PTY 进程是否已经启动并存活。
- agent 是否正在处理一轮用户请求。
- agent 是否已经完成当前轮、可以接收下一次输入。
- agent 是否被权限、确认、错误阻塞。
- 前端行项目应该显示 `Preparing`、`Ready`、`Running` 还是 `Blocked`。

这导致 `running` 语义混乱。现在的 `markSessionRunning()` 实际含义是“PTY 进程 spawn 成功”，但用户看到 `Running` 会理解为“Claude/Codex/OpenCode 正在工作”。这就是新建会话一开始全部显示 Running、Claude ready/running/blocked 来回异常、前端 presence 卡在 Preparing 的根本原因。

结论：不能继续给单个 `SessionStatus` 打补丁。必须拆成三层状态：

- Runtime lifecycle：Stoa/PTY/provider 进程生命周期。
- Agent turn state：agent 当前一轮任务状态。
- UI presence：前端最终展示状态，必须纯派生。

## 目标

- provider 进程启动成功，不等于 agent 正在工作。
- Claude Code 必须由真实 hook 驱动 `Ready -> Running -> Blocked -> Running -> Ready`。
- Shell、Claude Code、OpenCode、Codex 共享同一套状态架构，但允许 provider 能力不同。
- 前端只消费一个权威派生状态，不再同时维护多套 truth。
- 所有状态全集、状态含义、合法转换和非法转换必须写清楚，并用测试锁住。
- 当前处于原型阶段，允许 breaking change，不做兼容迁移。

## 非目标

- 不从任意 terminal 文本猜 agent 状态。
- 不迁移旧 `.stoa` 状态文件。
- 不添加 terminal 顶栏。
- 不保留旧 `SessionStatus` 兼容层。

## 三层状态模型

### 第一层：Runtime 状态全集

Runtime 状态描述 Stoa 管理的进程生命周期，只能由 Stoa runtime 控制器更新。

```ts
type SessionRuntimeState =
  | 'created'
  | 'starting'
  | 'alive'
  | 'exited'
  | 'failed_to_start'
```

| Runtime 状态 | 含义 | 典型来源 |
|---|---|---|
| `created` | Session 记录已创建，但尚未开始启动 runtime。 | `createSession()` |
| `starting` | 正在安装 sidecar、构建命令或准备 spawn PTY。 | `startSessionRuntime()` |
| `alive` | PTY/provider 进程已成功 spawn，进程存活。 | `ptyHost.start()` 成功 |
| `exited` | PTY/provider 进程已退出。 | PTY exit callback |
| `failed_to_start` | runtime 在进入 alive 之前启动失败。 | install/build/spawn 抛错 |

补充字段：

```ts
runtimeExitCode: number | null
runtimeExitReason: 'clean' | 'failed' | null
```

`runtimeState = exited` 本身不说明成功还是失败，必须结合 exit metadata。干净退出显示 `Exited`，异常退出显示 `Failed`。

### 第二层：Agent 状态全集

Agent 状态描述 provider 内部 agent 当前 turn 状态，只能由 provider evidence 更新。

```ts
type SessionAgentState =
  | 'unknown'
  | 'idle'
  | 'working'
  | 'blocked'
  | 'error'
```

| Agent 状态 | 含义 | 典型来源 |
|---|---|---|
| `unknown` | 没有可靠 agent turn 证据。 | 新建 session、Shell、Codex 无 turn-start 证据时 |
| `idle` | agent 当前轮已结束，可以接收下一步。 | Claude `Stop`、OpenCode `session.idle`、Codex turn complete |
| `working` | agent 正在处理当前轮。 | Claude `UserPromptSubmit` / `PreToolUse` |
| `blocked` | agent 等待权限、确认或用户介入。 | Claude `PermissionRequest`、OpenCode `permission.asked` |
| `error` | 当前轮失败或 provider 报错。 | Claude `StopFailure`、OpenCode `session.error` |

这里不设置长期 `complete` 状态。`complete` 是一个事件语义：某一轮完成。完成事件进入 reducer 后，稳定 agent 状态是 `idle`，UI presence 显示 `Ready`。如果 UI 想短暂展示 “Complete”，应该作为最近事件摘要或 toast，而不是长期 session 状态。

### 第三层：UI Presence 状态全集

UI Presence 是唯一给前端行项目展示的状态，必须由 runtime + agent + provider capability 纯派生，不能作为主 truth 持久化。

```ts
type SessionPresencePhase =
  | 'preparing'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'exited'
```

| UI 状态 | 展示文案 | 含义 |
|---|---|---|
| `preparing` | Preparing | Stoa 正在创建或启动 runtime。 |
| `ready` | Ready | runtime 可用，agent 没在工作，或当前 turn 已完成。 |
| `running` | Running | agent 正在处理任务；Shell 例外，进程 alive 即 Running。 |
| `blocked` | Blocked | agent 等待权限/确认/用户介入。 |
| `failed` | Failed | runtime 启动失败、异常退出，或 agent 报错。 |
| `exited` | Exited | runtime 干净退出。 |

注意：旧代码里 observability phase 曾叫 `working`。本次 breaking change 推荐统一改为 `running`，因为 UI 和用户语言都叫 Running。若实现阶段选择内部保留 `working`，必须在同一轮改动中清理所有 `running/working` 双命名歧义。

## 事件意图全集

只传 `agentState = working` 不够，因为 reducer 需要知道“为什么能转移”。例如 `blocked -> working` 只有在权限被解决后才合法，普通 stale `PreToolUse` 不应随便解除 blocked。因此所有状态 patch 必须带 intent。

```ts
type SessionStateIntent =
  | 'runtime.created'
  | 'runtime.starting'
  | 'runtime.alive'
  | 'runtime.exited_clean'
  | 'runtime.exited_failed'
  | 'runtime.failed_to_start'
  | 'agent.turn_started'
  | 'agent.tool_started'
  | 'agent.turn_completed'
  | 'agent.permission_requested'
  | 'agent.permission_resolved'
  | 'agent.turn_failed'
  | 'agent.recovered'
```

每个 patch 还必须带单 session 单调递增序列：

```ts
interface SessionStatePatchEvent {
  sessionId: string
  sequence: number
  occurredAt: string
  intent: SessionStateIntent
  providerEventType: string
  runtimeState?: SessionRuntimeState
  agentState?: SessionAgentState
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  summary: string
  externalSessionId?: string | null
}
```

没有 provider sequence 的事件，由 Stoa ingestion 时分配 per-session monotonic sequence，再进入 reducer。

## UI 派生规则

Presence phase 由一个纯函数集中计算：

```ts
function derivePresencePhase(input: {
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  provider: SessionType
}): SessionPresencePhase
```

优先级从上到下：

| 条件 | UI Presence |
|---|---|
| `runtimeState = failed_to_start` | `failed` |
| `agentState = error` | `failed` |
| `runtimeState = exited` 且 `runtimeExitReason = failed` | `failed` |
| `runtimeState = exited` 且 `runtimeExitReason = clean` | `exited` |
| `agentState = blocked` | `blocked` |
| `agentState = working` | `running` |
| `agentState = idle` | `ready` |
| `runtimeState = created 或 starting` | `preparing` |
| `runtimeState = alive` 且 `agentState = unknown` 且 provider 是 Shell | `running` |
| `runtimeState = alive` 且 `agentState = unknown` 且 provider 是 agent provider | `ready` |

`activeSessionId` 不得参与 phase 派生。当前是否 active 只影响 unread/attention 元数据，不影响 session 本身状态。

## 状态转换总览

### Runtime 合法转换

| 当前 Runtime | 事件 intent | 下一个 Runtime | 说明 |
|---|---|---|---|
| 无记录 | `runtime.created` | `created` | 创建 session。 |
| `created` | `runtime.starting` | `starting` | 开始启动 runtime。 |
| `starting` | `runtime.alive` | `alive` | PTY spawn 成功。 |
| `created` / `starting` | `runtime.failed_to_start` | `failed_to_start` | 启动前失败。 |
| `alive` | `runtime.exited_clean` | `exited` | 正常退出。 |
| `alive` | `runtime.exited_failed` | `exited` | 异常退出，UI 派生为 Failed。 |
| `exited` | `runtime.starting` | `starting` | 用户显式 restore/retry。 |
| `failed_to_start` | `runtime.starting` | `starting` | 用户显式 retry。 |

Runtime 非法或忽略转换：

- 旧 sequence 的 runtime 事件忽略。
- `exited` 后的旧 `alive` 忽略，除非来自更新 sequence 的 restore/retry。
- `failed_to_start` 后的 provider agent 事件忽略，除非 runtime 已重新进入 `starting/alive`。

### Agent 合法转换

| 当前 Agent | 事件 intent | 下一个 Agent | 说明 |
|---|---|---|---|
| `unknown` | `agent.turn_started` | `working` | 收到用户 turn 开始证据。 |
| `idle` | `agent.turn_started` | `working` | Ready -> Running。 |
| `error` | `agent.turn_started` | `working` | 新 turn/重试恢复。 |
| `unknown` | `agent.tool_started` | `working` | 工具调用是 working 证据。 |
| `idle` | `agent.tool_started` | `working` | Ready -> Running。 |
| `working` | `agent.tool_started` | `working` | 保持 Running，更新摘要/工具名。 |
| `working` | `agent.turn_completed` | `idle` | Running -> Complete event -> Ready state。 |
| `working` | `agent.permission_requested` | `blocked` | Running -> Blocked。 |
| `idle` | `agent.permission_requested` | `blocked` | Ready -> Blocked，少见但合法。 |
| `blocked` | `agent.permission_resolved` 且 approved/continued | `working` | Blocked -> Running。 |
| `blocked` | `agent.permission_resolved` 且 denied/cancelled | `idle` 或 `error` | 取决于 provider 明确信号。 |
| 任意非 `error` | `agent.turn_failed` | `error` | 当前 turn 失败。 |
| `error` | `agent.recovered` | `idle` 或 `working` | 显式恢复事件。 |

Agent 非法或忽略转换：

- `blocked -> working` 不能由普通 `agent.tool_started` 随意触发，必须是明确的 permission resolved 或同一 turn 的 post-permission continuation。
- `blocked -> idle` 不能由 stale `agent.turn_completed` 触发。
- `error -> idle` 不能由 stale `agent.turn_completed` 触发。
- `runtimeState = exited` 后的 agent 事件忽略，除非 session 已有更新 sequence 的 restart/resume。
- sequence 小于等于 `lastStateSequence` 的 patch 忽略，除完全幂等重复外。

### UI Presence 转换

下面是用户实际看到的稳定转换。`Complete` 不是长期状态，而是 `Running -> Ready` 的事件说明。

| 当前 UI | 触发事实 | 下一个 UI | 例子 |
|---|---|---|---|
| 无 | 创建 session | `Preparing` | 新建 Claude session。 |
| `Preparing` | runtime alive，agent unknown，provider 是 Claude/OpenCode/Codex | `Ready` | Claude 进程已启动但尚未工作。 |
| `Preparing` | runtime alive，provider 是 Shell | `Running` | Shell 进程就是用户工作对象。 |
| `Ready` | `agent.turn_started` | `Running` | Claude `UserPromptSubmit`。 |
| `Ready` | `agent.tool_started` | `Running` | Claude `PreToolUse`。 |
| `Running` | `agent.permission_requested` | `Blocked` | Claude `PermissionRequest`。 |
| `Blocked` | 权限 approved/continued | `Running` | OpenCode approved reply 或 Claude post-permission `PreToolUse`。 |
| `Blocked` | 权限 denied/cancelled | `Ready` 或 `Failed` | 取决于 provider 结果。 |
| `Running` | `agent.turn_completed` | `Ready` | Claude `Stop`。这就是用户说的 running -> complete -> ready，其中 complete 是事件，不是持久状态。 |
| `Running` | `agent.turn_failed` | `Failed` | Claude `StopFailure`。 |
| `Ready` | runtime clean exit | `Exited` | 用户关闭进程。 |
| 任意非 Failed | runtime failed exit | `Failed` | provider crash。 |
| `Failed` / `Exited` | 用户 restore/retry | `Preparing` | 恢复 session。 |

## Provider 映射

### Claude Code

HTTP hook 注册：

- `UserPromptSubmit` -> `intent = agent.turn_started`, `agentState = working`
- `PreToolUse` -> `intent = agent.tool_started`, `agentState = working`
- `Stop` -> `intent = agent.turn_completed`, `agentState = idle`
- `PermissionRequest` -> `intent = agent.permission_requested`, `agentState = blocked`, `blockingReason = permission`
- `StopFailure` -> `intent = agent.turn_failed`, `agentState = error`

Claude HTTP hooks 不支持 `SessionStart`，所以不能通过当前 HTTP sidecar 注册它。

Claude 没有专门的 HTTP permission accepted 事件。设计规定：如果当前 agent 是 `blocked`，且收到更新 sequence 的同一 turn 后续 `PreToolUse`，Stoa 将其视为 `agent.permission_resolved` + `agent.tool_started` 的组合证据，从而允许 `Blocked -> Running`。

### OpenCode

- `permission.asked` -> `intent = agent.permission_requested`, `agentState = blocked`
- `permission.replied` 必须读取 reply payload：
  - approved/continued -> `intent = agent.permission_resolved`, `agentState = working`
  - denied/cancelled -> `intent = agent.permission_resolved`, `agentState = idle` 或 `error`
- `session.idle` -> `intent = agent.turn_completed`, `agentState = idle`
- `session.error` -> `intent = agent.turn_failed`, `agentState = error`
- 只有可靠 active turn/tool 事件才能设置 `agentState = working`

不能把所有 `permission.replied` 盲目映射成 Running。

### Codex

Codex 当前 turn-start 结构化证据较弱，因此：

- runtime alive + agent unknown -> UI `Ready`
- turn complete notify -> `intent = agent.turn_completed`, `agentState = idle`
- error notify -> `intent = agent.turn_failed`, `agentState = error`
- 未来接入可靠 turn-start / OTel / notify 事件后，才允许设置 `agentState = working`

### Shell

Shell 没有 agent 层：

- `runtimeState = alive`
- `agentState = unknown`
- UI 派生为 `Running`

## 数据模型

```ts
interface SessionSummary {
  id: string
  projectId: string
  type: SessionType
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  lastStateSequence: number
  blockingReason: BlockingReason | null
  title: string
  summary: string
  recoveryMode: SessionRecoveryMode
  externalSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
  archived: boolean
}
```

持久化字段采用 snake_case：

```ts
interface PersistedSession {
  session_id: string
  project_id: string
  type: SessionType
  title: string
  runtime_state: SessionRuntimeState
  agent_state: SessionAgentState
  runtime_exit_code: number | null
  runtime_exit_reason: 'clean' | 'failed' | null
  last_state_sequence: number
  blocking_reason: BlockingReason | null
  last_summary: string
  external_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  recovery_mode: SessionRecoveryMode
  archived: boolean
}
```

这是 breaking schema change。旧状态文件可以重置或拒绝读取，不做迁移。

## Reducer 规则

所有状态写入必须经过一个 reducer：

```ts
function reduceSessionState(
  session: SessionSummary,
  patch: SessionStatePatchEvent,
  nowIso: string
): SessionSummary
```

核心规则：

- Runtime 和 Agent 是独立字段。
- `runtime.alive` 只能更新 runtime，绝不能设置 agent 为 `working`。
- `agent.turn_completed` 表示 complete 事件，最终稳定状态是 `agentState = idle`，UI 显示 `Ready`。
- `agent.permission_requested` 设置 `blocked`。
- `blocked -> working` 必须有 explicit unblock evidence。
- `error -> idle/working` 必须有新 turn 或 explicit recovery evidence。
- `runtime.exited` 不清空 agent 状态；最终 UI 由 exit metadata 和 agent error 优先级派生。
- 旧 sequence patch 忽略。

## Runtime 控制器变更

旧方法名会误导，应改名：

```ts
markSessionStarting(sessionId, summary, externalSessionId)
markRuntimeAlive(sessionId, externalSessionId)
markRuntimeExited(sessionId, exitCode, summary)
applyProviderStatePatch(event)
```

启动流程：

```text
createSession()
  -> runtimeState = created
  -> agentState = unknown

startSessionRuntime()
  -> markSessionStarting()
  -> installSidecar()
  -> build command
  -> ptyHost.start()
  -> markRuntimeAlive()
```

`markRuntimeAlive()` 只设置 `runtimeState = alive`，不设置 `agentState = working`。

## Observability 与前端规则

`SessionPresenceSnapshot` 是前端状态展示的权威输入：

```ts
interface SessionPresenceSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  providerLabel: string
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  phase: SessionPresencePhase
  confidence: ObservabilityConfidence
  health: ObservabilityHealth
  blockingReason: BlockingReason | null
  sourceSequence: number
}
```

前端规则：

- Backend `SessionPresenceSnapshot` 一旦存在，就是权威 UI 状态。
- Renderer 只能在没有 backend snapshot 时，用 `SessionSummary` 通过同一个 shared projection 函数做 fallback。
- Renderer 不得把 fallback 写成更高优先级 truth。
- Renderer apply snapshot/patch 必须比较 `sourceSequence`。
- Hierarchy row 只渲染 `SessionRowViewModel`，不在组件内重新解释状态。

## 用户可见行为

### Claude Code

```text
新建 session              -> Preparing
runtime alive             -> Ready
UserPromptSubmit          -> Running
PreToolUse                -> Running
PermissionRequest         -> Blocked
permission resolved       -> Running
Stop                      -> Ready
StopFailure               -> Failed
clean process exit        -> Exited
failed process exit       -> Failed
```

### OpenCode

```text
新建 session              -> Preparing
runtime alive             -> Ready
active turn evidence      -> Running
permission.asked          -> Blocked
permission.replied approve -> Running
permission.replied deny   -> Ready 或 Failed
session.idle              -> Ready
session.error             -> Failed
```

### Codex

```text
新建 session              -> Preparing
runtime alive             -> Ready
可靠 turn-start 证据       -> Running，未来接入后
turn complete notify      -> Ready
error notify              -> Failed
```

### Shell

```text
新建 session              -> Preparing
runtime alive             -> Running
clean process exit        -> Exited
failed process exit       -> Failed
```

## 测试策略

### Unit

- Runtime 全转换矩阵。
- Agent 全转换矩阵。
- `runtime.alive` 不会设置 `agentState = working`。
- `blocked + stale turn_completed` 仍为 Blocked。
- `error + stale turn_completed` 仍为 Failed。
- `error + new turn_started` 可恢复 Running。
- runtime exit 后旧 agent event 被忽略。
- shell `alive + unknown` -> Running。
- Claude/OpenCode/Codex `alive + unknown` -> Ready。

### Provider Adapter

- Claude `UserPromptSubmit` -> turn started。
- Claude `PreToolUse` -> tool started。
- Claude `PermissionRequest` -> blocked。
- Claude post-permission `PreToolUse` 可解除 blocked。
- Claude `Stop` -> turn completed -> Ready。
- Claude `StopFailure` -> Failed。
- OpenCode `permission.replied` 必须区分 approve/deny。

### Renderer

- Backend snapshot 优先于 fallback。
- 低 sequence fallback 不覆盖高 sequence snapshot。
- session patch 先到、presence 后到，状态正确。
- presence 先到、session patch 后到，状态正确。
- row 展示 `Ready -> Running -> Blocked -> Running -> Ready`。

### E2E

- 新建 Claude 不应仅因 runtime alive 显示 Running。
- Claude hook `UserPromptSubmit` 或 `PreToolUse` 后显示 Running。
- Claude hook `PermissionRequest` 后显示 Blocked。
- Claude hook `Stop` 后显示 Ready。
- Shell spawn 后仍显示 Running。

## 实现阶段

1. 添加 shared types 和 `derivePresencePhase`。
2. 添加 reducer 和全转换矩阵测试。
3. breaking 修改持久化 schema。
4. 改 runtime controller：`markRuntimeAlive` 不再影响 agent。
5. 改 Claude/OpenCode/Codex provider adapter 输出 intentful patch。
6. 改 observability service 输出权威 `SessionPresenceSnapshot`。
7. 改 renderer store：backend snapshot 权威，fallback 只读派生。
8. 改 UI/view model 测试与 E2E。
9. 删除旧 `SessionStatus`、`markSessionRunning` 语义和非回退状态集合。

## 验收标准

- 除 Shell 外，任何 provider 都不能仅因进程启动显示 Running。
- Claude 的 Running/Blocked/Ready 全部由真实 hook 或明确 provider evidence 驱动。
- `Blocked -> Running` 有明确 permission resolved 或 post-permission continuation 证据。
- `Running -> Complete -> Ready` 中，Complete 是事件，稳定 UI 状态是 Ready。
- 前端不会因为 stale fallback/presence 再次卡在 Preparing。
- 测试能阻止 `runtime alive` 再次被误实现成 `agent working`。
