# Session 五相位状态模型设计

日期：2026-05-06

## 背景

当前 session 状态管理持续漏掉状态转换，根因不是少了几个状态名，而是 reducer 缺少稳定的内部事实：

- `user interruption` 只是瞬时事件，没有稳定 outcome
- 各种 error 被压成单一 `failure`
- `blocked` 只有粗粒度状态，没有足够的 reason
- provider 迟到事件没有可靠 turn 边界，容易把状态冲回去

同时，现有设计把 `preparing`、`exited` 也暴露成 UI phase，导致展示层和状态机层纠缠在一起。这个方案收敛为：

- UI 只保留 5 个 phase
- reducer 内部保留最小但完整的判定事实
- 所有 provider 事件先映射到内部事实，再派生出 phase

这是 breaking change。不做兼容迁移。

## 目标

- UI 只展示 `ready | running | blocked | complete | failure`
- `interrupted`、`cancelled`、typed error 不作为 UI phase，但必须作为稳定内部事实保存
- `blocked -> running` 必须只能由显式 unblock 证据触发
- 迟到 `Stop` / `tool_completed` / error 事件不能再把状态冲回错误 phase
- Claude、Codex、OpenCode 共用同一套内部状态模型，允许 ingress 能力不同
- 现有遗漏项必须被明确列出，并在 reducer / provider adapter / tests 中被覆盖

## 非目标

- 不保留 `preparing` 或 `exited` 作为 UI phase
- 不从 terminal 文本猜测 agent 状态
- 不兼容旧持久化 schema
- 不保留旧的 `running = runtime alive` 语义

## 外部模型

外部只保留 5 个 phase：

```ts
type SessionPhase =
  | 'ready'
  | 'running'
  | 'blocked'
  | 'complete'
  | 'failure'
```

含义如下：

| Phase | 含义 |
|---|---|
| `ready` | 当前可视上没有正在执行、没有等待用户处理、没有未读完成提醒、也没有失败提醒。它同时折叠了 created/starting、clean exited、idle、interrupted 后 idle。 |
| `running` | 当前轮正在执行。 |
| `blocked` | 当前轮正在等待权限、elicitation 或其他用户介入。 |
| `complete` | 当前轮已经正常完成，但用户还没有查看结果。 |
| `failure` | 当前轮失败、runtime failed exit、或启动失败。 |

`ready` 只是展示结果，不是可推理的主状态。主进程不得把 `phase=ready` 当作“runtime 一定活着且可写输入”的依据。

## 内部最小模型

内部状态至少保留以下字段：

```ts
type SessionRuntimeState =
  | 'created'
  | 'starting'
  | 'alive'
  | 'exited'
  | 'failed_to_start'

type TurnState =
  | 'idle'
  | 'running'

type TurnOutcome =
  | 'none'
  | 'completed'
  | 'interrupted'
  | 'cancelled'
  | 'failed'

type BlockingReason =
  | 'permission'
  | 'elicitation'
  | 'denied'
  | 'provider_wait'

type FailureReason =
  | 'rate_limit'
  | 'authentication_failed'
  | 'billing_error'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'permission_denied'
  | 'tool_error'
  | 'provider_error'
  | 'runtime_crash'
  | 'failed_to_start'
  | 'unknown'

interface SessionStateCore {
  runtimeState: SessionRuntimeState
  runtimeExitReason: 'clean' | 'failed' | null
  turnState: TurnState
  turnEpoch: number
  lastTurnOutcome: TurnOutcome
  blockingReason: BlockingReason | null
  failureReason: FailureReason | null
  hasUnseenCompletion: boolean
}
```

语义约束：

- `phase` 只允许派生，不允许作为持久化主 truth 保存
- `turnEpoch` 在每次新 turn 开始时递增
- reducer 消费的不是 provider 原始 `turn_id`，而是 Stoa 归一化后的本地 `turnEpoch`
- `turnState = running` 表示当前 turn 仍然打开；被 block 时也仍属于该 turn
- 所有 turn 级事件都必须附着在某个 `turnEpoch` 上
- `lastTurnOutcome` 在下一轮开始前保持稳定
- `failureReason` 和 `blockingReason` 只能由明确事件写入，不能靠 phase 反推
- `hasUnseenCompletion` 是 `complete` 的唯一来源

## Phase 派生规则

`phase` 必须由内部事实纯派生，优先级如下：

1. `runtimeState = failed_to_start` -> `failure`
2. `runtimeExitReason = failed` -> `failure`
3. `failureReason != null` -> `failure`
4. `blockingReason != null` 且 `turnState = running` -> `blocked`
5. `hasUnseenCompletion = true` 且 `lastTurnOutcome = completed` -> `complete`
6. `turnState = running` 且 `runtimeState = alive` -> `running`
7. 其他全部 -> `ready`

补充规则：

- `created`、`starting`、`alive but idle`、`clean exited`、`interrupted/cancelled after idle` 都折叠成 `ready`
- `runtimeState = exited` 且 `failureReason = null` 仍然展示 `ready`
- `phase=ready` 时是否允许发送输入，必须额外检查 `runtimeState === 'alive'`

## 合法转换

### `ready`

- `ready -> running`
  条件：新 turn 开始，创建更高 `turnEpoch`，并设置 `turnState=running`
- `ready -> blocked`
  条件：收到显式 permission / elicitation / provider wait；同时该 turn 保持 `turnState=running`
- `ready -> complete`
  条件：provider 缺少 turn-start 证据，但收到了更高 epoch 的正常完成事件
- `ready -> failure`
  条件：启动失败、runtime failed exit、provider 明确 failed

### `running`

- `running -> complete`
  条件：同一 `turnEpoch` 正常完成
  写入：`lastTurnOutcome=completed`、`hasUnseenCompletion=true`
- `running -> ready`
  条件：同一 `turnEpoch` interrupted / cancelled，或 provider 明确给出 terminal deny/cancel 语义
  写入：`lastTurnOutcome=interrupted | cancelled`
- `running -> blocked`
  条件：同一 `turnEpoch` permission requested / elicitation requested
- `running -> failure`
  条件：同一 `turnEpoch` failed，或 runtime crash

### `blocked`

- `blocked -> running`
  条件：同一 `turnEpoch` 的显式 unblock 证据；本质上是清除 `blockingReason`，`turnState` 保持 `running`
- `blocked -> ready`
  条件：同一 `turnEpoch` interrupted / cancelled，或 provider 明确给出 terminal deny/cancel 语义
- `blocked -> failure`
  条件：同一 `turnEpoch` provider error，或 runtime crash

### `complete`

- `complete -> ready`
  条件：用户查看了该轮结果，清除 `hasUnseenCompletion`
- `complete -> running`
  条件：用户开始新 turn；先清掉 `complete`，再进入更高 `turnEpoch`
- `complete -> failure`
  条件：runtime crash 或迟到 failed event，且该 failed event 属于当前未消费轮

### `failure`

- `failure -> ready`
  条件：显式 recover，且 failure 不是 fatal runtime failure
- `failure -> running`
  条件：用户 retry，开启新 `turnEpoch`

## 事件契约

reducer 不接受“只有 intent、没有 turn 边界”的 turn 级事件。所有 turn 级 patch 都必须带本地归一化后的 `turnEpoch`。

```ts
interface SessionStatePatchEvent {
  sessionId: string
  sequence: number
  occurredAt: string
  intent: SessionStateIntent
  source: 'runtime' | 'provider' | 'ui'
  turnEpoch?: number
  sourceTurnId?: string | null
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  failureReason?: FailureReason | null
  summary: string
  externalSessionId?: string | null
}
```

规则：

- `runtime.*` 事件可以不带 `turnEpoch`
- 所有 `agent.*` 事件必须带 `turnEpoch`
- provider 原始 `turn_id` 如果存在，先写进 `sourceTurnId`
- ingestion 层负责把 provider `turn_id` 或本地推断的 turn 边界归一化成单调递增的本地 `turnEpoch`
- reducer 只对本地 `turnEpoch` 做 stale-event 判定，不直接比较 provider 原始 `turn_id`

## 必须禁止的转换

- `blocked -> running` 由普通 `tool_started` 或 `tool_completed` 触发
- `interrupted/cancelled` 之后，同一 `turnEpoch` 的迟到 `turn_completed` 把 `ready` 冲成 `complete`
- `failure` 之后，同一 `turnEpoch` 的迟到 `turn_completed` 把状态冲成 `complete`
- runtime 已 `exited` 后，旧 `turnEpoch` 的 provider 事件继续改当前状态
- 新 `turnEpoch` 已开始后，旧 epoch 的 completion/error/unblock 继续回写

## Provider 映射

### Claude Code

Claude 文档里的关键事件面：

- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `PermissionDenied`
- `Stop`
- `StopFailure`
- `Elicitation`
- `ElicitationResult`
- `SessionEnd`

当前 Stoa 遗漏：

- 没接 `PreToolUse`
- 没接 `PermissionDenied`
- 没接 `StopFailure`
- 没接 `Elicitation`
- 没接 `ElicitationResult`
- 没接 `SessionEnd`

映射规则：

- `UserPromptSubmit` -> 新 `turnEpoch`，`running`
- `PreToolUse` -> `running`
- `PermissionRequest` -> `blocked`, `blockingReason=permission`
- `PermissionDenied`
  - 只表示 auto mode classifier 拒绝了一次工具调用
  - 不直接等价于 turn cancelled / ready / failure
  - 默认作为同一 turn 内的 denial evidence 记录，不单独驱动 phase 跳转
  - 该事件进入 observability/evidence 流，而不是 session core state
- `Elicitation` -> `blocked`, `blockingReason=elicitation`
- `ElicitationResult`
  - `accept/decline/cancel` 都只表示用户已经响应，默认清除 `blockingReason`
  - 若该 turn 仍在继续，则 phase 应回到 `running`
  - 不能仅因 `decline/cancel` 就推断整个 turn 已取消
- `Stop` -> `complete`, `lastTurnOutcome=completed`, `hasUnseenCompletion=true`
- `StopFailure` -> `failure`, 并保留 typed `failureReason`
- `SessionEnd` -> 只更新 `runtimeState=exited` 或附加终止元数据；UI 仍折叠为 `ready`

注意：

- Claude HTTP hooks 不支持 `SessionStart`，不能再把它当成可靠 ingress
- Claude 当前 hook 面没有“用户手动批准/拒绝 permission dialog”的独立完成事件
- 因此手动 deny 不能被假设为可直接观测；必须等待后续 continuation、turn terminal event 或本地 user interruption evidence
- 如果当前是 `blocked`，后续同一 `turnEpoch` 收到 `PreToolUse`，只能在 reducer 内按“显式 continuation 证据”解除 blocked，不能无条件解锁

### Codex

Codex 公开 hook 面主要是：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

并且 `UserPromptSubmit / PreToolUse / PostToolUse / Stop` 都有 `turn_id`。

当前 Stoa 遗漏：

- 没正确使用 `turn_id`
- 没接 `PreToolUse`
- 当前 `PostToolUse` matcher 可疑，可能根本收不到可靠工具事件
- 把 `PreToolUse` 输出里的 `permissionDecision = allow | deny | ask` 误当成 provider ingress 的风险没有被写清楚

映射规则：

- `UserPromptSubmit` -> 新 `turnEpoch`，`running`
- `PreToolUse` -> `running`
- `PostToolUse` -> 只作为 activity evidence，不直接解除 blocked
- `Stop` -> `complete`, `lastTurnOutcome=completed`, `hasUnseenCompletion=true`

注意：

- Codex 没有与 Claude 对应的公共 `StopFailure`
- 因此 Codex 的失败有一部分只能从 runtime failed exit 推断
- Codex 必须优先使用文档给出的 `turn_id` 作为 `turnEpoch` 映射依据
- Codex 文档中的 `permissionDecision = allow | deny | ask` 属于 hook 输出，不是 Stoa 被动接收的 provider event
- 因此在当前被动 observability 设计下，Codex 的 blocked/deny 并没有可靠 ingress；只有当 Stoa 未来主动参与 hook 决策时，才能把这些输出转换为本地 state intent

### OpenCode

OpenCode 文档里的关键事件面：

- `permission.asked`
- `permission.replied`
- `session.idle`
- `session.error`
- `session.status`
- `tool.execute.before`
- `tool.execute.after`
- `message.updated`

当前 Stoa 遗漏：

- 没接 `session.status`
- 没接 `tool.execute.before`
- 没接 `tool.execute.after`
- 没接 `message.updated`
- `permission.replied` 被压成过于粗糙的恢复逻辑

映射规则：

- `tool.execute.before` 或可靠 `session.status=running` -> `running`
- `permission.asked` -> `blocked`, `blockingReason=permission`
- `permission.replied`
  - 必须先归一化真实 payload；不能假设所有实现都用同一个字段名表达 decision
  - approved/continued -> 解除 blocked，返回 `running`
  - denied/cancelled -> 至少解除 blocked；默认返回 `running`，等待后续 terminal evidence 决定 `ready/failure/complete`
  - reply 带 error -> `failure`
- `session.idle` -> `complete`, `lastTurnOutcome=completed`, `hasUnseenCompletion=true`
- `session.error` -> `failure`, 尽量提取 `failureReason`
- `tool.execute.after` 只作为 activity evidence，不直接负责 phase 跳转

## 当前遗漏项清单

在五相位方案下，当前系统真正缺的是这些内部事实，而不是更多 phase：

1. `turnState`
2. `turnEpoch`
3. `lastTurnOutcome`
4. `blockingReason`
5. `failureReason`
6. `runtimeState`
7. `blocked -> running` 的显式 guard

它们分别解决的问题是：

| 缺失项 | 当前错误表现 |
|---|---|
| `turnState` | 只有 outcome 和 reason，仍然无法稳定推导 `running` |
| `turnEpoch` | restart / interrupt 后迟到事件继续污染当前状态 |
| `lastTurnOutcome` | interrupted/cancelled 被压成普通 ready |
| `blockingReason` | blocked 无法区分 permission / elicitation / denied |
| `failureReason` | 所有错误都被压成单一 failure |
| `runtimeState` | clean exited 与 alive idle 全部混成一个不可推理的 ready |
| unblock guard | 普通 tool 事件会错误地清掉 blocked |

## 数据模型调整

`SessionSummary` 至少新增：

```ts
interface SessionSummary {
  id: string
  projectId: string
  type: SessionType
  runtimeState: SessionRuntimeState
  turnState: TurnState
  turnEpoch: number
  lastTurnOutcome: TurnOutcome
  blockingReason: BlockingReason | null
  failureReason: FailureReason | null
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  lastStateSequence: number
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

持久化 schema 同步 breaking 修改。不读取旧 schema，不做迁移。

## Reducer 规则

reducer 输入不能只带 phase patch，必须带意图和必要元数据。

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
  | 'agent.permission_requested'
  | 'agent.permission_resolved'
  | 'agent.turn_completed'
  | 'agent.turn_interrupted'
  | 'agent.turn_cancelled'
  | 'agent.turn_failed'
  | 'agent.completion_seen'
  | 'agent.recovered'
```

核心规则：

- `runtime.starting` 表示新的 runtime 边界，必须清空上一轮 turn/block/failure/completion 元数据
- 任何新 turn 开始时，`turnEpoch += 1`，并设置 `turnState=running`
- 新 turn 开始会清空上一轮 `blockingReason`、`failureReason`、`hasUnseenCompletion`
- `turn_completed` 只能作用于当前 `turnEpoch`，并将 `turnState=idle`
- `turn_interrupted` / `turn_cancelled` 之后，同 epoch 的 `turn_completed` 必须忽略，并将 `turnState=idle`
- `turn_failed` 只能作用于当前 `turnEpoch`，并将 `turnState=idle`
- `permission_requested` 设置 `blockingReason`，但不关闭当前 turn
- `permission_resolved` 只有在 `blocked` 且 epoch 匹配时才生效，本质上只清除 `blockingReason`
- `tool_started/tool_completed` 不能单独解除 `blocked`
- `runtime.exited_clean` 不得覆盖 `complete`
- `runtime.exited_failed` 总是提升到 `failure`

## 前端与运行时约束

- 前端只消费五相位 `phase`
- 是否允许发送输入，必须看 `runtimeState === 'alive'`
- `complete` 是稳定态，只有 `agent.completion_seen` 才能清掉
- renderer fallback 只能在 backend snapshot 缺失时使用，且必须遵守相同派生规则
- `ready` 的视觉语气必须保持 neutral/subtle，不能复用 accent

## 测试策略

### Unit

- `running -> interrupted -> ready` 后，同 epoch `turn_completed` 被忽略
- `blocked -> deny response` 后，若无 terminal evidence，不会错误跳成 `ready`
- `failure` 后，同 epoch `turn_completed` 被忽略
- `blockingReason` 清除后，在同 epoch 且 `turnState=running` 时正确回到 `running`
- `complete` 只有 `completion_seen` 才能回到 `ready`
- `runtime.exited_clean` 不覆盖 `complete`
- `runtime.exited_failed` 总是进入 `failure`
- `runtime.starting` 会清空上一轮 turn/block/failure/completion 元数据
- `phase=ready` 但 `runtimeState=exited` 时，不允许发送输入

### Provider adapter

- Claude `StopFailure` 提取 typed `failureReason`
- Claude `Elicitation` 正确落成 `blockingReason=elicitation`
- Claude `PermissionDenied` 进入 observability evidence，但不被误当成 turn terminal event
- Codex 使用 `turn_id` 对齐 `turnEpoch`
- Codex 不把 hook 输出 `permissionDecision=ask|deny` 误当成 provider ingress
- OpenCode `permission.replied` 正确区分 approve / deny / cancel / error
- OpenCode `tool.execute.before` 可提供 `running` 证据

### E2E

- 新建 Claude session 不因 runtime alive 显示 `running`
- Claude interrupted 后不会因为迟到 `Stop` 重新显示 `complete`
- Claude `PermissionDenied` 不会错误终结当前 turn，也不会污染 core state
- OpenCode deny/cancel 后不会继续卡在 `blocked`，并等待后续 terminal evidence 决定最终 phase
- Codex 同一旧 `turn_id` 的迟到 `Stop` 不污染新 turn

## 实现步骤

1. 更新 shared types，删除旧的 `preparing/exited` 对外 phase 语义
2. 重写 reducer，加入 `turnEpoch / lastTurnOutcome / failureReason`
3. 更新 provider adapters 与 sidecar 安装逻辑，补齐遗漏 ingress
4. 更新 runtime controller，使 sendability 与 `runtimeState` 解耦于 `phase`
5. 更新 observability snapshot 和 renderer fallback
6. 增补 unit / provider / e2e tests
7. 运行完整质量门禁

## 验收标准

- UI 只出现 `ready / running / blocked / complete / failure`
- `interrupted` 和 `cancelled` 不显示为 phase，但在 reducer 中有稳定落点
- 所有 typed failure 都能保留具体 `failureReason`
- `blocked -> running` 只在显式 unblock 证据下发生
- provider 迟到事件不会再把状态冲回错误 phase
- `phase=ready` 不再被错误地当成 runtime 可写输入的依据
- Claude、Codex、OpenCode 的已知遗漏 ingress 都有明确接入或明确记录为不可观测
