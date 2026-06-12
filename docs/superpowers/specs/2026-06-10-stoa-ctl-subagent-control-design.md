# stoa-ctl Subagent 控制面设计

日期：2026-06-10

> 本设计是 breaking change。原型阶段不做兼容层、不做兼容迁移。
>
> 本文件是 `stoa-ctl` subagent/subsession 驱动开发能力的唯一权威 spec。implementation plan、research audit 和 task breakdown 只能细化执行，不得弱化、覆盖或改写本文件中的 contract。
>
> 本设计建立在 `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` 之上。统一 session tree、`SessionSupervisor`、caller identity、tree-local visibility 和 authority contract 仍然是底层权威。

## 背景

当前 `stoa-ctl` 已经能通过统一 session tree 完成基础 subsession 控制：

- `session create` 创建 child session
- `session prompt` 给 session 发送输入
- `session wait` 等待单个 session terminal outcome
- `session report` / `session output` 读取完成报告与终端 replay
- `session destroy` 清理 descendant session

这套能力可以驱动简单 child work，但还不是一个清晰的 subagent-driven development contract。实际缺口集中在：

- parent agent 很难记住长 session id
- 不能一次等待多个 child
- child 没有显式 result 提交接口
- 输入来源命名不统一
- `prompt` 作为命令名和参数名都过窄
- stop/interrupt 与 destroy 语义没有公开区分

本设计只补齐这些基础能力。它不引入通用 message bus、subscribe、notify、inbox、task DAG、taskId 或 dispatchId。

## 目标

- 新增 `stoa-ctl subagent` 命令组，作为 agent 驱动开发的主入口
- 让 subagent 仍然由 backing child session 实现，不新增第二套 runtime
- 为每个 subagent 返回一个短名和一个正式 ID
- 让短名和正式 ID 都可以指定 subagent
- 提供 `subagent list` 查询当前可见 subagent 的短名和正式 ID
- 统一所有正文输入来源为 `--text` / `--file` / `--stdin`
- 用 `subagent dispatch` 封装 child session create + initial input
- 用 `subagent wait` 支持等待一个或多个 subagent
- 用 `subagent result` 让 child 显式提交自然语言 result
- 用 `subagent input` 给已有 subagent 追加输入
- 用 `subagent stop` 暴露 `interrupt` 和 `destroy`
- 删除旧 `session prompt`，以 `session input` 替代

## 非目标

- 不做 `subscribe`
- 不做 `notify`
- 不做 `inbox`
- 不做 `ask`
- 不做 task DAG
- 不引入 `taskId` / `dispatchId`
- 不默认使用 JSON 作为 agent 间交流正文
- 不做 `--artifact` 参数；产物目录与文件路径由 prompt 约定，child 在 result 正文中说明
- 不恢复旧 `meta-session` proposal / dispatch 主路径
- 不新增独立 subagent runtime 或独立持久化文件
- 不修改 `research/upstreams/*`

## 方案选择与推荐

### A. 只保留底层 `session create/input/wait`

不推荐。

理由：

- 仍要求 agent 记忆长 session id
- 多 child 等待仍然需要脚本拼接
- child result 仍然只能靠 terminal final output 约定
- 不能把 agent 驱动开发能力表达成清晰 CLI contract

### B. 引入完整 orchestration：task、dispatch、notify、inbox、subscribe

不推荐。

理由：

- 当前需求还没有要求后台异步投递与通用消息系统
- task/dispatch 双 ID 会让第一版心智模型过重
- agent 之间主要读写自然语言，JSON-first message bus 不是必要抽象
- 会过早逼近独立 orchestration 平台，而不是补齐 Stoa 的 session tree 控制面

### C. 轻量 subagent facade + wait-many + explicit result

推荐。

理由：

- 复用现有 child session 和 `SessionSupervisor`
- 用短名解决 agent 操作长 ID 的摩擦
- 用 `wait-many` 补齐多 subagent 协作的同步读取路径
- 用 `result` 补齐 child 显式完成/阻塞/失败报告
- 保持所有正文为自然语言或 Markdown，让 agent 自己理解内容
- 不引入 subscribe/notify/inbox，避免不必要复杂度

## 核心决策

### 0. 本 spec 是 2026-05-29 contract 的扩展

本 spec 不建立并行控制面。

它只扩展 `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` 中的统一 session tree contract：

- 新增 CLI command group：`subagent`
- 新增 session command：`session input`
- 删除 session command：`session prompt`
- 扩展 read model：`subagentName`、`subagentResultSummary`
- 扩展 authority action：`subagentInput`、`subagentWait`、`subagentInterrupt`、`subagentDestroy`、`submitOwnResult`
- 扩展错误码：`unknown_subagent`、`ambiguous_subagent_name`、`duplicate_subagent_name`、`subagent_result_forbidden`、`invalid_input_source`、`invalid_result_status`、`interrupt_unsupported`

所有新增能力仍必须通过同一 `SessionSupervisor`、同一 caller identity、同一 `V(S)` visibility 和同一 `SessionGraphEvent` 更新路径落地。

本 spec 对 `subagent` command group 的 CLI stdout 做 scoped override：`subagent` 命令默认输出面向 agent 阅读的自然语言/Markdown，而不是 2026-05-29 中的 JSON-first CLI stdout。HTTP/control API 仍使用结构化 envelope。

### 1. Subagent 是 child session 的 facade

`subagent` 不是新的 runtime 对象。

每个 subagent 都对应一个 backing child session：

- 正式 ID 是 backing `sessionId`
- backing session 必须满足 `parentSessionId != null`
- invariant：所有 `parentSessionId != null` 的 session 都是 subagent；不存在“有 parent 但不是 subagent”的 child session
- 短名是 Stoa 为这个 backing session 分配的 alias
- 状态来自 backing session 状态和 optional explicit result
- 权限仍然走统一 session tree 的 visibility / authority contract

因此任何创建 child session 的成功路径都必须初始化 subagent facade state：

- `stoa-ctl subagent dispatch`
- `stoa-ctl session create --parent ...`
- renderer / IPC create-child path
- host-side equivalent child creation path

这些路径都必须分配 `subagentName`、初始化 internal `subagentInputEpoch`，并让该 child 出现在 `subagent list` 中。

Epoch initialization:

- child creation without delivered input initializes `subagentInputEpoch = 0`
- `dispatch` delivers initial input as part of the atomic operation, so successful dispatch stores `subagentInputEpoch = 1`
- the first successful `session input` / `subagent input` to a child created without input increments epoch from `0` to `1`

Root/top-level session 不是 subagent。任何 `subagent` 命令在解析 target 时遇到 `parentSessionId = null` 的 session，都必须按 `unknown_subagent` 处理，不能把 root session 当作 subagent 操作。

### 2. 不引入 taskId / dispatchId

第一版只返回：

- `name`: 短名，例如 `ryu`
- `id`: 正式 ID，即 backing `sessionId`

所有 `<subagent>` 参数都必须同时接受 `name` 或 `id`。

### 3. 短名是 root session tree 内的便捷引用

短名在同一个 root session tree 内唯一。

唯一性键：

```text
(rootSessionId, name)
```

默认短名池：

```text
ryu, andy, mai, saski, naruto
```

实现应使用足够大的 alias 池，覆盖数百个常见短名。池耗尽不是常规设计压力；极端情况下可以生成稳定后缀名，例如 `ryu2`、`andy2`。

约束：

- `dispatch` 默认自动分配短名
- `dispatch --name <shortName>` 允许显式指定短名
- 自动短名分配不承诺 “first free” 顺序；默认短名池是候选集合，不是可观察的分配序列
- 自动分配必须是 non-enumerative：实现可以跳过不可用 alias，但不得通过输出或错误说明跳过了哪些 hidden/archived alias
- 显式短名在同一个 root session tree 内冲突时必须失败
- archived/destroyed subagent 的短名在同一个 root session tree 内继续保留
- v1 不做 alias 释放或重命名；只有未来显式 physical purge 删除 session record 后，alias 才可能被重新分配
- 显式 `--name` 对不可见 blocker 的冲突只允许泄漏一位信息：requested name unavailable。message 不得说明 blocker 属于同一 root tree、active/archived/destroyed 状态、正式 ID 或所在 branch
- 显式 `--name` 对可见 blocker 的冲突可以暴露 blocker 的正式 ID 和 phase；如果 blocker 可见且 archived/destroyed，message 可以建议用 `stoa-ctl session list --include-archived` 检查

短名解析 scope 与短名唯一性 scope 不同：

- 唯一性 scope：同一个 `rootSessionId` 的完整 descendant subagent tree
- 解析 scope：caller 当前 visibility scope `V(S)`
- 如果 `V(S)` 中只有一个 visible subagent 匹配短名，短名解析成功
- 如果 `V(S)` 中多个 visible subagent 匹配短名，必须返回 `ambiguous_subagent_name`，要求使用正式 ID
- 由于同一个 root tree 内 alias 唯一，session caller 在自己的 tree 内通常不会遇到 alias 歧义
- local-user 的解析 scope 是全局可见 session；不同 root tree 可以各自使用同一 alias，因此 local-user 跨 tree 仍可能遇到短名歧义

示例：

```text
R
├─ A  name=ryu
│  └─ A1 name=mai
└─ B  name=andy
   └─ B1 name=saski
```

解析规则：

| Caller     | Visible aliases                    | `mai` resolves to                                          |
| ---------- | ---------------------------------- | ------------------------------------------------------------ |
| A          | A, B, A1                           | A1                                                           |
| B          | A, B, B1                           | no match                                                     |
| R          | A, B, A1, B1                       | A1                                                           |
| local-user | all sessions across all root trees | A1 unless another root tree also has `mai`; then ambiguous |

### 4. `subagent list` 是短名发现入口

`stoa-ctl subagent list` 返回当前 caller 可见 subagents。

list 只返回 `parentSessionId != null` 的 sessions。Root/top-level sessions 不属于 subagent list。

最小返回字段：

- `name`
- `id`
- `parentSessionId`
- `type`
- `title`
- `phase`
- `resultStatus`
- `updatedAt`

session caller 只看见自己 visibility scope 中的 subagents。local-user 可以看全局 subagents，但短名解析不能在歧义时猜测。

`subagent list` 默认只列出当前可见且非 archived 的 subagents。它不是 alias tombstone 查询接口。

如果 `dispatch --name` 因 alias 保留失败：

- blocker 在 caller visibility scope 中时，错误 message 可以暴露 blocker 的正式 ID、phase，并建议用 `stoa-ctl session list --include-archived` 检查
- blocker 不在 caller visibility scope 中时，错误 message 只能说明 requested name unavailable，并建议选择不同 `--name`

这种 generic duplicate 仍然暴露“这个名字不可用”这一位 namespace availability 信息；这是 root-tree alias 唯一性的有界泄漏。除此之外不得泄漏 blocker 是否存在、是否 archived、是否历史保留、是否属于某个 branch。

### 5. 所有正文输入统一为 InputSource

所有 agent 正文输入和 result 正文都使用同一组参数名：

```text
--text <string>
--file <path>
--stdin
```

规则：

- 三者互斥
- 必须且只能提供一个
- `--text` 接受直接字符串
- `--file` 读取 UTF-8 文本文件
- `--stdin` 从标准输入读取 UTF-8 文本
- 空白正文无效，必须在 CLI 层和控制面层都拒绝

不再使用 `--prompt` / `--prompt-file` / `--json` 作为正文输入参数。

### 6. 删除 `session prompt`

`session prompt` 被 breaking 删除。

替代命令：

```text
stoa-ctl session input <sessionId> --text "..."
stoa-ctl session input <sessionId> --file prompt.md
stoa-ctl session input <sessionId> --stdin
```

`session input` 仍然是底层 session 原语。`subagent input` 是面向 subagent alias 的 facade。

2026-05-29 contract 中所有 `prompt` authority、visibility、错误语义和控制面约束在本 spec 中 breaking rename 为 `session input`，语义不变。

如果 `session input <sessionId>` 的目标 session 是 backing subagent session，即 `parentSessionId != null`，它必须触发与 `subagent input` 完全相同的 result invalidation 规则：更新 latest input timestamp、递增 internal `subagentInputEpoch`、清空或 stale previous explicit result、推送 graph update。不得因为调用者绕过 subagent facade 而让后续 `subagent wait` 返回旧 result。

完整 rename contract：

- CLI：删除 `stoa-ctl session prompt`，新增 `stoa-ctl session input`
- HTTP/control：删除 `POST /ctl/session/:id/prompt`，新增 `POST /ctl/session/:id/input`
- IPC：删除 `session:prompt`，新增 `session:input`
- capabilities：删除 `supports.sessionPrompt`，新增 `supports.sessionInput`
- bootstrap prompt：不得再出现 `session prompt` 或 `--prompt`
- legacy command/route/channel 不做 alias，不做兼容转发；旧 CLI command 必须 usage error，旧 HTTP route/channel 不能作为成功路径存在

### 7. `dispatch` 封装 create + initial input

`dispatch` 创建 direct child session，并立即提交初始输入。

`dispatch` 是 atomic operation：create child session + allocate alias + persist initial subagent facade state + deliver initial input + initialize `subagentInputEpoch = 1` 必须整体成功。

如果任一步失败：

- 不得返回 partial success
- 必须 cleanup 已创建的 child session
- 必须释放本次尚未提交成功的 alias allocation
- 不得保留可见 orphan subagent
- 不得保留 epoch/result facade state

这是 pre-commit transactional cleanup，不是用户可见的 normal `destroy` / archive lifecycle。因此它不会触发 alias tombstone 保留规则。

命令：

```text
stoa-ctl subagent dispatch --type <shell|opencode|codex|claude-code> --text "..."
stoa-ctl subagent dispatch --type <shell|opencode|codex|claude-code> --file task.md
stoa-ctl subagent dispatch --type <shell|opencode|codex|claude-code> --stdin
```

可选参数：

```text
--title <title>
--name <shortName>
--parent <sessionId>   # local-user only; required for local-user dispatch
--cols <n>
--rows <n>
```

caller 规则：

- session caller 只能创建自己的 direct child
- session caller 不允许传 `--project` 或 `--parent`
- local-user 必须传 `--parent <sessionId>`，`subagent dispatch` 不能创建 root session
- local-user root session creation 只能使用 `stoa-ctl session create`，不能使用 `stoa-ctl subagent dispatch`
- local-user dispatch 的 project 必须由指定 parent session 派生；CLI 不要求也不接受 `--project`
- 默认 title 仍由主机侧生成；CLI 不猜测默认 title

返回必须包含：

```text
name: ryu
id: session_child_123
status: running
```

JSON envelope 内部仍然可以结构化返回；CLI 面向 agent 的输出应优先可读、稳定、自然语言友好。

### 8. `wait` 是同步读取模式

`wait` 表示调用方前台等待并读取 result。

命令：

```text
stoa-ctl subagent wait <name-or-id...> --mode all --timeout <seconds>
stoa-ctl subagent wait <name-or-id...> --mode any --timeout <seconds>
```

规则：

- `<name-or-id...>` 至少一个
- `--mode all|any`，默认 `all`
- `--timeout <seconds>` 使用秒，不接受 `--timeout-ms`
- CLI `--timeout <seconds>` 必须转换为 HTTP/control API `timeoutMs` milliseconds
- `all` 等到所有 target terminal 或都有 explicit result
- `any` 等到任一 target terminal 或有 explicit result
- timeout 时返回已完成与未完成列表
- 单个 target 权限失败不应吞掉其它 target 的状态；返回必须包含 per-target result/error

聚合返回的最小结构：

```ts
type SubagentWaitMode = 'all' | 'any'
type SubagentWaitOverallStatus = 'complete' | 'partial' | 'timeout' | 'failed'
type SubagentResultSource = 'explicit' | 'terminal' | 'host'

interface SubagentWaitCompletedTarget {
  target: string
  name: string
  id: string
  state: 'completed'
  status: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'interrupted' | 'destroyed'
  source: SubagentResultSource
  title: string | null
  body: string
  updatedAt: string
}

interface SubagentWaitPendingTarget {
  target: string
  name: string
  id: string
  state: 'pending'
  phase: string
}

interface SubagentWaitErrorTarget {
  target: string
  state: 'error'
  error: SessionCommandErrorEnvelope
}

interface SubagentWaitAggregate {
  mode: SubagentWaitMode
  conditionMet: boolean
  overallStatus: SubagentWaitOverallStatus
  timeoutMs: number | null
  elapsedMs: number
  targets: Array<SubagentWaitCompletedTarget | SubagentWaitPendingTarget | SubagentWaitErrorTarget>
}
```

`conditionMet` 的定义：

- `all`: 所有 target 都进入 `state = 'completed'`
- `any`: 至少一个 target 进入 `state = 'completed'`

`overallStatus` 的定义：

- `complete`: `conditionMet = true` 且没有 pending/error target
- `partial`: `conditionMet = true` 但仍有 pending/error target，典型场景是 `any`
- `timeout`: timeout 到达且 `conditionMet = false`
- `failed`: 没有 pending target、`conditionMet = false`，且至少一个 target 是 error

HTTP/control API 对合法 `subagent wait` 请求始终返回 `ok: true` 和 `SubagentWaitAggregate`，包括 timeout 和 per-target error；只有 malformed request、auth failure、internal failure 才使用 top-level error envelope。

CLI exit code：`subagent wait` 是 aggregate command，本段规则优先于通用 exit code 表。`conditionMet = true` 时退出 `0`，即使 `overallStatus = 'partial'` 且其它 target 有 per-target error；`conditionMet = false` 时使用 generic non-zero。per-target `unknown_subagent` 不映射为 exit `6`。child result 的业务状态 `failed|blocked|cancelled` 不影响 CLI exit code，只体现在自然语言输出和 target status 中。

结果来源优先级：

1. host lifecycle `destroyed`
2. current-epoch explicit `subagent result`
3. current-epoch backing session terminal completion report + output replay

terminal fallback 必须通过 host-side `SessionSupervisor` 的 completion-report/output/read APIs 获取，不要求 child 通过公开 CLI 调用 `session report` 或 `session output`。

`wait` 不能返回 stale result。只有满足以下条件的结果才能完成 target：

- explicit result 的 `inputEpoch` 等于 backing session 当前 `subagentInputEpoch`
- terminal fallback 对应的 terminal outcome 发生在 latest dispatch/input 之后

如果实现无法证明 terminal fallback 属于 latest input epoch，必须把 target 视为 pending，直到 explicit result、可证明的新 terminal outcome 或 timeout。

如果使用 fallback，返回必须明确说明 result 来自 terminal output，而不是 explicit result。

`wait` 的 terminal fallback status 包括：

- `completed`
- `failed`
- `cancelled`
- `interrupted`

`interrupted` 不是 explicit `SubagentResult.status`。它只来自 runtime/session terminal outcome，例如 `stop --mode interrupt` 后 provider 报告 turn interrupted。

`destroyed` 是 wait-only host lifecycle status：

- 它不是 explicit `SubagentResult.status`
- 它不是 terminal fallback status
- 它只来自 backing subagent session 被 `destroy` / archive cleanup 后的 host lifecycle state
- `source` 必须是 `host`
- `body` 必须是自然语言说明，例如 `Subagent was destroyed before submitting a current result.`
- 它优先于 stored explicit result 和 terminal fallback；destroy/archive 后，`subagent wait` 不再返回销毁前的 full result body

`subagent wait` 的 target 解析必须能解析 caller-visible archived/destroyed backing subagent records。不可见 archived/destroyed target 仍必须返回 `unknown_subagent`。

如果 `stop --mode interrupt` 已发出但 target 还没有进入 terminal outcome，`wait` 必须继续把它视为 pending，直到 terminal outcome、explicit result 或 timeout。

### 9. `result` 只对 subagent 暴露

`stoa-ctl subagent result` 是 child/subagent 向 Stoa 写入 durable result 的接口。

它只对 subagent session 暴露。

约束：

- local-user 不能调用 `subagent result`
- root/top-level session 不能调用 `subagent result`
- 普通 parent session 不能为 child 代写 `subagent result`
- `capabilities` 对 root/top-level session 不暴露 `subagentResult`
- root/top-level bootstrap prompt 不提 `subagent result`
- child/subagent bootstrap prompt 可以说明如何调用 `subagent result`

命令：

```text
stoa-ctl subagent result --status completed --text "..."
stoa-ctl subagent result --status failed --file result.md
stoa-ctl subagent result --status blocked --stdin
```

可选参数：

```text
--title <title>
```

状态枚举：

```text
completed | failed | blocked | cancelled
```

`interrupted` 由 runtime / `stop --mode interrupt` 产生，不由 child 主动提交。

result body 是自然语言或 Markdown。Stoa 不强制 JSON，不解析业务含义。

最小持久化字段：

```ts
interface SubagentResult {
  sessionId: string
  parentSessionId: string
  inputEpoch: number
  status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  title: string | null
  body: string
  createdAt: string
  updatedAt: string
}

interface SubagentResultSummary {
  status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  title: string | null
  createdAt: string
  updatedAt: string
  hasBody: boolean
}
```

`SubagentResult.body` 是完整正文，只能通过 `subagent wait` 的 explicit-result path 返回给有 result body read 权限的 caller。

Full result body read authority：

| Caller relation to target | Can `subagent wait` return full body? |
| ------------------------- | ------------------------------------- |
| local-user                | yes                                   |
| self                      | yes                                   |
| ancestor / parent         | yes                                   |
| descendant                | no                                    |
| same-depth peer           | no                                    |
| sibling descendant        | no                                    |
| invisible target          | no, must be `unknown_subagent`        |

如果 caller 可以看到 target 但没有 full body read 权限，`subagent wait` 必须为该 target 返回 `state = 'error'`、`error.code = 'forbidden_authority_scope'`，不得返回 full body，也不得把该 target 计入 `conditionMet`。

`SessionSummary`、`SessionNodeSnapshot`、`session list`、`session inspect` 和 `SessionGraphEvent` 不得投影 full result body。它们只能投影 `SubagentResultSummary`。

`session inspect` 的所有 views/levels 都默认 summary-only，包括 `--view context --level full`。如果未来某个 inspect mode 需要返回 subagent full body，必须显式复用同一 full body read authority、stale epoch 和 destroyed precedence guard；不得通过 inspect 绕过 `subagent wait`。

### 10. 每个 subagent 只保留 latest result

第一版每个 backing session 只保留 latest explicit result。

每个 backing subagent session 同时维护一个 internal `subagentInputEpoch`：

- child creation without delivered input 初始化为 `0`
- `dispatch` 成功提交 initial input 时初始化为 `1`
- 每次 successful `subagent input` 递增 `subagentInputEpoch`
- 每次 successful `session input` 直接输入 backing subagent session 时也必须递增 `subagentInputEpoch`
- 未来任何 IPC/host-side input path 只要向 backing subagent session 投递正文，都必须经过同一个 internal `recordSubagentInput` hook
- `subagent result` 写入时记录当前 `subagentInputEpoch` 到 `SubagentResult.inputEpoch`
- `subagentInputEpoch` 不是 `taskId`，不对外作为可寻址对象，不引入任务 DAG

同一个 subagent 再次调用 `subagent result`：

- 覆盖 previous result
- 更新 `updatedAt`
- `wait` 返回 latest result

successful input 后，无论来自 `subagent input`、direct `session input` 还是 host-side equivalent，之前的 explicit result 必须被清空或标记 stale；generic projection 的 `subagentResultSummary` 必须变为 `null`，直到 child 为新 epoch 提交 result。

历史 result event 可以未来再加，不属于本期。

### 11. blocked/options 也用自然语言表达

当 child 需要父 session 决策时，提交：

```text
stoa-ctl subagent result --status blocked --text "需要父 session 决策：

A. 只实现 wait-many。
B. 同时实现 result。

建议 B，因为..."
```

Stoa 不把 options 程序化建模为 JSON。agent 负责阅读 Markdown 并决定下一步。

本期不提供 `--artifact` 参数。产物目录、文件命名和报告路径由 dispatch/input prompt 自然语言约定；child 在 result body 中写明实际产物路径。

### 12. `input` 是追加输入，不是完成信号

命令：

```text
stoa-ctl subagent input <name-or-id> --text "..."
stoa-ctl subagent input <name-or-id> --file followup.md
stoa-ctl subagent input <name-or-id> --stdin
```

返回只表示 delivery acknowledgement，不表示 child 完成。

successful `subagent input` 是新的工作轮次开始信号。它必须更新 backing session 的 latest input timestamp、递增 internal `subagentInputEpoch`，并使旧 explicit result 不再满足后续 `subagent wait`。

### 13. `stop` 只保留 interrupt 和 destroy

命令：

```text
stoa-ctl subagent stop <name-or-id...> --mode interrupt
stoa-ctl subagent stop <name-or-id...> --mode destroy
```

规则：

- 默认 mode 是 `interrupt`
- `interrupt` 尝试中断当前 turn，但保留 session
- `destroy` 复用现有 archive/subtree cleanup 语义
- 不引入 `terminate`
- 多 target stop 返回 per-target status/error

### 14. shell subagent 行为

`subagent dispatch --type shell` 允许存在，因为 shell 仍是合法 session type。

但 shell 不是 agent provider：

- shell session 不会收到 agent bootstrap prompt
- Stoa 不假设 shell 会理解 dispatch 文本
- shell child 仍然可以在命令行中手动调用 `stoa-ctl subagent result`
- `subagent result` 的权限仍按 caller identity 判断，不按 provider type 判断
- capabilities 中是否暴露 `subagentResult` 只取决于 caller 是否是 child/subagent session，不取决于 provider type

因此 shell subagent 可以提交 result，但需要 prompt/command 本身明确告诉 shell 内执行者如何调用。

### 15. 退出码保持 shell 最小语义，业务状态用自然语言表达

面向 agent 的结果不依赖复杂退出码。

CLI 输出必须用自然语言说明业务状态，例如：

```text
Timed out waiting for ryu after 120 seconds.
Completed: mai.
Pending: ryu.
Run `stoa-ctl subagent list` to inspect current status, or wait again.
```

进程退出码只保留最小 shell 语义：

- `0`: 命令成功
- `2`: usage error
- `3`: config/auth/control identity error
- `6`: non-aggregate command 的 top-level unknown session/subagent
- non-zero generic: timeout、forbidden、internal failure 等

Aggregate commands override this table:

- `subagent wait`: exit `0` iff `conditionMet = true`; otherwise generic non-zero
- `subagent stop`: exit `0` iff `overallStatus = 'complete'`; otherwise generic non-zero
- per-target unknown/forbidden/unsupported errors inside aggregate payload do not use exit `6`

实现可以继续沿用现有 exit code mapping，但不能把业务细节只放在退出码里。

## CLI 设计

### 顶层 usage

```text
Usage: stoa-ctl <command>

Commands:
  health
  whoami
  capabilities

  session list [--include-archived]
  session create --type <shell|opencode|codex|claude-code> [--title "..."] [--project <projectId>] [--parent <sessionId>] [--external-session-id <id>] [--cols <n>] [--rows <n>]
  session inspect <sessionId>
  session status <sessionId>
  session output <sessionId>
  session wait <sessionId> [--timeout <seconds>]
  session report <sessionId>
  session input <sessionId> --text <text>|--file <path>|--stdin
  session destroy <sessionId>

  subagent list
  subagent dispatch --type <shell|opencode|codex|claude-code> --text <text>|--file <path>|--stdin [--title <title>] [--name <shortName>] [--parent <sessionId>] [--cols <n>] [--rows <n>]
  subagent wait <subagent...> [--mode all|any] [--timeout <seconds>]
  subagent input <subagent> --text <text>|--file <path>|--stdin
  subagent stop <subagent...> [--mode interrupt|destroy]
  subagent result --status <completed|failed|blocked|cancelled> --text <text>|--file <path>|--stdin [--title <title>]
```

`session prompt` 不再出现在 usage 中。

`session status`、`session output`、`session wait`、`session report` 是现有底层 session 诊断命令。它们不是 subagent facade 的新增抽象；`subagent wait` 的 terminal fallback 直接复用 host-side supervisor read APIs。

当这些底层 read APIs 的 target 是 backing subagent session，即 `parentSessionId != null` 时，不能绕过 subagent read policy：

- `session wait` / `session report` / `session output` 必须执行同一 full result body read authority
- 无权读取 full body 的 visible caller 必须收到 `forbidden_authority_scope`
- 不可见 target 必须按 `unknown_session` / `unknown_subagent` 类等价隐藏，不得泄漏存在
- stale epoch 和 destroyed precedence 规则仍然适用
- generic `session inspect` / `session list` 仍只能看到 `subagentResultSummary`，不能看到 full body

### Output style

CLI output should be stable enough for agents and scripts.

For success paths, prefer concise line-oriented text:

```text
Subagent dispatched.
Name: ryu
ID: session_child_123
Status: running
```

For wait results:

```text
Wait completed.
Mode: all

ryu (session_child_123): completed
Result source: explicit

<result body>
```

For fallback:

```text
mai (session_child_456): completed
Result source: terminal

No explicit subagent result was submitted. The following output is terminal replay:

<output text>
```

JSON envelopes can remain internal HTTP/control API shape. The CLI contract for agent-to-agent content is natural language/Markdown first.

## HTTP/control API contract

HTTP/control API 是 `stoa-ctl` CLI 的本地 loopback transport，不是 agent 间正文格式。

通用 envelope：

```ts
interface ControlSuccessEnvelope<T> {
  ok: true
  data: T
  error: null
}

interface ControlErrorEnvelope {
  ok: false
  data: null
  error: SessionCommandErrorEnvelope
}
```

CLI 的 `--text|--file|--stdin` 在进入 HTTP/control API 前解析为 UTF-8 `text` 字段。HTTP/control API 不接收 `file` 或 `stdin` 字段，避免控制服务读取调用方任意文件或模拟标准输入。控制面仍必须拒绝空白 `text`。

### Session input route

`session prompt` breaking rename 后的底层 route：

| Method | Path | Request | Success data |
| ------ | ---- | ------- | ------------ |
| POST | `/ctl/session/:id/input` | `{ text: string }` | `{ delivered: true, sessionId: string, updatedAt: string }` |

`POST /ctl/session/:id/prompt` 不得作为兼容成功路径存在。

### Subagent routes

| Command | Method | Path | Request | Success data |
| ------- | ------ | ---- | ------- | ------------ |
| `subagent list` | GET | `/ctl/subagent/list` | query: none | `{ subagents: SubagentListItem[] }` |
| `subagent dispatch` | POST | `/ctl/subagent/dispatch` | `SubagentDispatchRequest` | `{ subagent: SubagentListItem }` |
| `subagent wait` | POST | `/ctl/subagent/wait` | `SubagentWaitRequest` | `{ result: SubagentWaitAggregate }` |
| `subagent input` | POST | `/ctl/subagent/input` | `SubagentInputRequest` | `{ delivered: true, subagent: SubagentListItem, updatedAt: string }` |
| `subagent stop` | POST | `/ctl/subagent/stop` | `SubagentStopRequest` | `{ result: SubagentStopAggregate }` |
| `subagent result` | POST | `/ctl/subagent/result` | `SubagentResultRequest` | `{ result: SubagentResultSummary }` |

```ts
interface SubagentListItem {
  name: string
  id: string
  parentSessionId: string
  type: SessionType
  title: string
  phase: string
  resultStatus: SubagentResultSummary['status'] | null
  updatedAt: string
}

interface SubagentDispatchRequest {
  type: SessionType
  text: string
  title?: string
  name?: string
  parentId?: string
  initialCols?: number
  initialRows?: number
}

interface SubagentWaitRequest {
  targets: string[]
  mode?: 'all' | 'any'
  timeoutMs?: number
}

interface SubagentInputRequest {
  target: string
  text: string
}

interface SubagentStopRequest {
  targets: string[]
  mode?: 'interrupt' | 'destroy'
}

type SubagentStopOverallStatus = 'complete' | 'partial' | 'failed'

interface SubagentStopSuccessTarget {
  target: string
  name: string
  id: string
  mode: 'interrupt' | 'destroy'
  state: 'interrupt_requested' | 'destroyed'
  updatedAt: string
}

interface SubagentStopErrorTarget {
  target: string
  mode: 'interrupt' | 'destroy'
  state: 'error'
  error: SessionCommandErrorEnvelope
}

interface SubagentStopAggregate {
  mode: 'interrupt' | 'destroy'
  overallStatus: SubagentStopOverallStatus
  targets: Array<SubagentStopSuccessTarget | SubagentStopErrorTarget>
}

interface SubagentResultRequest {
  status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  text: string
  title?: string
}
```

`SubagentWaitRequest.timeoutMs` 单位是 milliseconds。CLI 是唯一负责把 `--timeout <seconds>` 转换为 `timeoutMs` 的层。

`SubagentStopAggregate.overallStatus` 的定义：

- `complete`: 所有 target 都成功进入 `interrupt_requested` 或 `destroyed`
- `partial`: 至少一个 target 成功，且至少一个 target error
- `failed`: 所有 target 都是 error

HTTP/control API 对合法 `subagent stop` 请求始终返回 `ok: true` 和 `SubagentStopAggregate`，包括 per-target lookup、unknown/invisible target、visible-but-forbidden target 和 `interrupt_unsupported`。CLI 只有 `overallStatus = 'complete'` 时退出 `0`；`partial|failed` 使用 generic non-zero，并在自然语言输出中列出每个 target 的状态或 next step。

HTTP API 参数名使用 camelCase，CLI 参数名使用 kebab-case。例如 CLI `--parent` 映射到 HTTP `parentId`，CLI `--cols` 映射到 HTTP `initialCols`。

Malformed request、auth failure、invalid caller identity 和 internal failure 使用 top-level `ControlErrorEnvelope`。

`subagent wait` 的 timeout 不使用 `SessionCommandErrorEnvelope.code = 'wait_timeout'`。合法 wait 请求 timeout 时必须返回 `ok: true` 和 `SubagentWaitAggregate.overallStatus = 'timeout'`，保留 completed/pending/error target。

`subagent wait` / `subagent stop` 的 per-target lookup、unknown/invisible target、visible-but-forbidden target、wait timeout 和 unsupported-runtime 结果不应丢弃其它 target 状态，必须进入 aggregate success data。session caller 传入不可见 target 时，per-target error code 必须是 `unknown_subagent`，不得使用 `forbidden_visibility_scope` 泄漏目标存在。

### Capabilities output

`stoa-ctl capabilities` 仍是结构化 JSON。

`supports` 必须使用新能力名：

```ts
interface StoaCtlCapabilitiesSupports {
  sessionList: boolean
  sessionInspect: boolean
  sessionStatus: boolean
  sessionInput: boolean
  sessionCreate: boolean
  sessionDestroy: boolean
  sessionWait: boolean
  sessionOutput: boolean
  sessionCompletionReport: boolean
  subagentList: boolean
  subagentDispatch: boolean
  subagentWait: boolean
  subagentInput: boolean
  subagentStop: boolean
  subagentResult?: boolean
}
```

Rules:

- `sessionPrompt` must be absent or `false`; new code must not depend on it
- `subagentResult` may be `true` only when caller is a child/subagent session with `parentSessionId != null`
- local-user and root/top-level sessions must not see `subagentResult: true`
- provider type does not affect `subagentResult`; shell child sessions can submit result if caller identity is a child session

## 控制面 / 主机侧设计

### 1. 继续复用 SessionSupervisor

所有 subagent command 必须落到现有 session graph 和 `SessionSupervisor`。

不得新增绕过 `SessionSupervisor` 的第二套 session mutation path。

### 2. 新增 Subagent facade service

新增一个轻量 Stoa-side service，例如 `SubagentSupervisor`。

职责：

- 分配和解析短名
- 拒绝把 root/top-level session 解析为 subagent target
- 调用 `SessionSupervisor.createChildSession`
- 调用 session input path 提交 initial input / follow-up input
- 聚合 wait-many
- 持久化 latest result
- 维护 internal `subagentInputEpoch` / latest input timestamp，防止 stale result 被 wait 返回
- 执行 result visibility guard
- 格式化 subagent list projection

它不拥有 runtime，不直接 spawn process。

### 3. 持久化边界

第一版必须复用项目现有 session 状态持久化边界，不新增独立 meta-session 文件。

可以在 session record 中增加 subagent facade 字段：

```ts
interface SessionSummary {
  subagentName?: string | null
  subagentResultSummary?: SubagentResultSummary | null
}

interface InternalSubagentFacadeState {
  subagentInputEpoch?: number
  subagentLatestInputAt?: string
  subagentResult?: SubagentResult | null
}
```

`InternalSubagentFacadeState` 是 backing session record 内部状态，不是 `SessionSummary` projection。`subagentInputEpoch` 不得作为 `<subagent>` target、task id、dispatch id 或跨 session 协作 ID 暴露。

如果实现需要独立内部索引，也必须从 session records 派生，不能成为第二事实源。

control token 不持久化的既有规则不变。

`subagentResult` 写入是 session graph mutation；generic read projection 只暴露 `subagentResultSummary`。

每次 successful `subagent result` 都必须：

- 更新 backing session 的 latest `subagentResult`
- 更新 backing session `updatedAt`
- 推送 `SessionGraphEvent.kind = 'updated'`
- 在事件中包含完整 `SessionNodeSnapshot`
- 让 renderer 通过 bootstrap snapshot 和 graph push 都能看到 `subagentName` / `subagentResultSummary`

不得要求 renderer polling 或刷新应用才能看到 latest result。

完整 `subagentResult.body` 不进入 renderer bootstrap snapshot、graph push、generic `session list` 或 generic `session inspect`。如果未来 UI 需要展示正文，必须走显式 read action，不能复用被动 graph projection。

### 4. Result visibility guard

`subagent result` 的 caller 必须满足：

- caller 是 `session`
- caller session 存在
- caller session 有 `parentSessionId`
- result target 是 caller 自己

因此命令不接受 `<subagent>` 参数。它永远写当前 caller session 的 result。

local-user、root session、以及 parent session 代写 child result 都必须失败。

### 5. Wait-many aggregation

`subagent wait` 对每个 target 独立解析 alias/id、检查 visibility、等待 result/terminal。

target 解析必须先确认 target 是 subagent，即 backing session `parentSessionId != null`。如果用户传入 root session ID，返回 `unknown_subagent`。

返回聚合：

- completed targets
- pending targets
- failed target lookups / forbidden target accesses
- mode
- timeout
- elapsed time

`any` 模式只要一个 target 完成即可返回，但仍应附带其它 target 的当前状态。

### 6. Interrupt integration

`stop --mode interrupt` 必须接入现有 runtime interruption 能力。

如果 target provider/runtime 不支持 interrupt，返回自然语言说明，并以 per-target error 体现。

`destroy` 继续复用现有 archive/subtree cleanup 语义。

### 7. Authority matrix extension

本 spec 扩展 2026-05-29 的 authority matrix。

| Action                             | local-user                                  | root/top-level session        | child/subagent session                       | Target rule                                    |
| ---------------------------------- | ------------------------------------------- | ----------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `subagent list`                  | allowed                                     | allowed                       | allowed                                      | list caller-visible subagents                  |
| `subagent dispatch`              | allowed with project/parent rules           | allowed, creates direct child | allowed, creates direct child                | no cross-tree create                           |
| `subagent input`                 | allowed for visible target                  | allowed for visible target    | allowed for visible target                   | target must resolve in caller visibility scope |
| `subagent wait`                  | target resolution allowed for visible target; body read follows full body authority | target resolution allowed for visible target; body read follows full body authority | target resolution allowed for visible target; body read follows full body authority | visibility check first, then full body authority |
| `subagent stop --mode interrupt` | allowed for visible subagent with authority | descendant subagents only     | descendant/self only when self is a subagent | same authority class as destructive control    |
| `subagent stop --mode destroy`   | allowed for visible subagent with authority | descendant subagents only     | descendant/self only when self is a subagent | reuses destroy authority                       |
| `subagent result`                | forbidden                                   | forbidden                     | allowed only for caller's own session        | no target argument; caller writes self result  |

Notes:

- `subagent input` intentionally follows existing visible prompt/input authority rather than destroy authority.
- `subagent wait` is two-phase: target resolution is read-like for visible targets; full result body return follows the explicit full body read authority table above.
- `subagent result` is neither parent-to-child nor local-user control. It is child self-report only.
- session caller invisible targets must return `unknown_subagent`, never `forbidden_visibility_scope`; `forbidden_authority_scope` is only for visible-but-unauthorized targets.

## Bootstrap Prompt 设计

### Root/top-level bootstrap prompt

Root/top-level session 应看到：

- `subagent dispatch`
- `subagent list`
- `subagent wait`
- `subagent input`
- `subagent stop`

Root/top-level session 不应看到：

- `subagent result`

### Child/subagent bootstrap prompt

Child/subagent session 应看到：

- 如何使用 `subagent result --status ... --text|--file|--stdin` 提交结果
- result body 应写自然语言/Markdown
- blocked 决策也用 Markdown 写清楚，不要求 JSON
- large artifacts 应由 prompt 约定目录，result body 写明路径

如果一个 child/subagent session 又 dispatch 了自己的 child，它既是自己 parent 的 subagent，也是 grandchildren 的 parent。它仍然可以看到 `subagent result`，但 `subagent result` 永远只为当前 caller session 自己提交 result，不能代写 descendant result。

### Session command rename

所有 bootstrap prompt 中的 `session prompt` 必须改为 `session input` 或 `subagent input`。

## 错误语义

HTTP/control API 错误仍然使用结构化 envelope，不返回 ad-hoc 字符串。

本 spec 扩展 2026-05-29 的 `SessionCommandErrorEnvelope`：

```ts
type SubagentCommandErrorCode =
  | 'unknown_subagent'
  | 'ambiguous_subagent_name'
  | 'duplicate_subagent_name'
  | 'subagent_result_forbidden'
  | 'invalid_input_source'
  | 'invalid_result_status'
  | 'interrupt_unsupported'

interface SessionCommandErrorEnvelope {
  code:
    | 'unknown_session'
    | 'unknown_project'
    | 'forbidden_visibility_scope'
    | 'forbidden_authority_scope'
    | 'invalid_parent_session'
    | 'cross_project_parent_forbidden'
    | 'internal_error'
    | SubagentCommandErrorCode
  message: string
  nextSteps: string[] | null
}
```

新增错误码：

- `unknown_subagent`
- `ambiguous_subagent_name`
- `duplicate_subagent_name`
- `subagent_result_forbidden`
- `invalid_input_source`
- `invalid_result_status`
- `interrupt_unsupported`

补充约束：

- session caller 请求不可见 subagent 时必须返回 `unknown_subagent`，不得泄漏不可见 session 是否存在
- 短名歧义必须给出可执行 next step：运行 `stoa-ctl subagent list`，或使用正式 ID
- 显式短名冲突必须给出可执行 next step：选择不同 `--name`；只有 blocker 在 caller visibility scope 中时，message 才能暴露 blocker 的正式 ID 和 phase；hidden blocker 只能返回 generic duplicate
- top-level/root session 调用 `subagent result` 必须返回自然语言清楚说明：result 只能由 child/subagent session 为自己提交
- CLI stderr/stdout 必须包含自然语言 next step，不能只输出错误码

最低 next steps：

| Code                          | Required nextSteps                                                     |
| ----------------------------- | ---------------------------------------------------------------------- |
| `unknown_subagent`          | run `stoa-ctl subagent list`; retry with a visible name or formal ID |
| `ambiguous_subagent_name`   | run `stoa-ctl subagent list`; retry with formal ID                   |
| `duplicate_subagent_name`   | choose a different `--name`; if the message identifies a visible blocker, run `stoa-ctl subagent list` or `stoa-ctl session list --include-archived` to inspect it |
| `subagent_result_forbidden` | call `subagent result` only from the child/subagent session itself   |
| `invalid_input_source`      | provide exactly one of `--text`, `--file`, or `--stdin`          |
| `invalid_result_status`     | use `completed`, `failed`, `blocked`, or `cancelled`           |
| `interrupt_unsupported`     | use `subagent stop --mode destroy` if cleanup is required            |

## 测试策略

### CLI 单元测试

目标文件：`tools/stoa-ctl/index.test.ts`

覆盖：

- `--text` / `--file` / `--stdin` 三选一解析
- 同时传多个 InputSource 被拒绝
- 缺少 InputSource 被拒绝
- `session prompt` 不再出现在 usage
- `session input` 调用新 endpoint
- `session prompt` 旧命令返回 usage error，不调用旧 endpoint
- `subagent dispatch` 输出 name + id
- local-user `subagent dispatch` 缺少 `--parent` 被拒绝
- session caller `subagent dispatch` 传 `--parent` 被拒绝
- `subagent list` 输出 name + id
- `subagent list` 不输出 root/top-level sessions
- `subagent wait` 支持多个 target 和 `--mode all|any`
- aggregate `subagent wait` exit code 只由 `conditionMet` 决定，per-target unknown 不使用 exit `6`
- root session ID 作为 `<subagent>` target 返回 `unknown_subagent`
- `subagent result` 拒绝无效 status
- `subagent stop` 只接受 `interrupt|destroy`
- aggregate `subagent stop` exit code 只由 `overallStatus` 决定，per-target unknown 不使用 exit `6`
- usage 和 bootstrap prompt 不出现 `--artifact`

### 控制面 / Supervisor 测试

目标文件：

- `src/core/session-control-server.test.ts`
- 新增或扩展 `src/core/session-supervisor.test.ts`
- 如新增 facade service，则新增 `src/core/subagent-supervisor.test.ts`

覆盖：

- dispatch 创建 direct child 并发送 initial input
- `session create --parent` 和 renderer/IPC create-child 也会分配 `subagentName`、初始化 epoch，并出现在 `subagent list`
- dispatch create + alias + initial input + epoch persistence 是 atomic operation，任一步失败都 cleanup child/alias/epoch
- control API 暴露 `/ctl/subagent/list|dispatch|wait|input|stop|result`
- control API 暴露 `/ctl/session/:id/input`，不保留 `/ctl/session/:id/prompt` 成功路径
- capabilities 输出 `sessionInput`，不输出可用的 `sessionPrompt`
- root/top-level capabilities 不暴露 `subagentResult: true`
- local-user dispatch 必须指定 parent，且不能创建 root subagent
- 自动短名分配
- 自动短名分配不承诺 first-free 顺序，不通过 skipped alias 泄漏 hidden blocker
- `--name` 冲突失败
- hidden blocker 的 `--name` 冲突只返回 generic requested name unavailable
- archived/destroyed alias 在同一 root tree 内继续保留，不能复用
- alias 和 sessionId 都能解析
- root session id 不能解析为 subagent target
- local-user 短名歧义失败
- wait-many all 完成
- wait-many any 完成
- wait timeout 以 `SubagentWaitAggregate.overallStatus = 'timeout'` 返回 completed/pending/error targets
- wait partial target lookup/authority failure 进入 per-target error，不吞掉其它 target 状态
- host lifecycle `destroyed` 优先于 stored explicit result 和 terminal fallback
- explicit result 优先于 terminal fallback when target is not destroyed
- successful `subagent input` 后旧 explicit result 被清空或标记 stale，`subagentResultSummary` 变为 `null`
- direct `session input` 输入 backing subagent session 后同样递增 epoch 并清空或 stale old result
- `subagent wait` 不返回 latest input 之前的 stale explicit result 或 stale terminal fallback
- no explicit result 时 fallback 到 supervisor completion-report/output read APIs
- full result body 只通过 `subagent wait` 返回，不进入 generic session snapshot/list/inspect/graph push
- same-depth peer 对 visible target 调 `subagent wait` 时不能读取 full result body，返回 per-target `forbidden_authority_scope`
- same-depth peer 也不能通过底层 `session wait|report|output` 绕过 full body read authority
- 底层 `session wait|report|output` 对 backing subagent session 同样执行 stale epoch 和 destroyed precedence
- result 只能由 child 自己提交
- root/top-level session 调 result 被拒绝
- local-user 调 result 被拒绝
- stop interrupt 调用 runtime interruption path
- stop destroy 复用现有 destroy path
- stop destroy 后 `subagent wait` 对 visible target 返回 wait-only host status `destroyed`
- forbidden scope 不泄漏不可见 session
- `subagent result` 推送 `SessionGraphEvent.updated`
- renderer snapshot / graph push 包含 `subagentName` 和 `subagentResultSummary`
- `stop --mode interrupt` 后 wait 返回 terminal `interrupted` fallback 或 pending/timeout
- shell child 可以基于 caller identity 调用 `subagent result`
- short name 在 restart 后能从 session state 恢复
- dispatch 失败不会泄漏 child session、占用短名或保留 epoch/result facade state

### Bootstrap Prompt 测试

目标文件：

- `src/core/session-bootstrap-prompt-service.test.ts`

覆盖：

- root/top-level prompt 不出现 `subagent result`
- child/subagent prompt 出现 `subagent result`
- prompt 中不再出现 `session prompt`
- prompt 中统一使用 `--text|--file|--stdin`
- prompt 中不出现 `--artifact`

### E2E / Behavior Assets

新增或更新：

- `testing/behavior/stoactl-subagent-control.ts`
- `testing/journeys/stoactl-subagent-control.journey.ts`
- generated Playwright artifacts 由 `npm run test:generate` 生成，不手写

覆盖最小旅程：

- 创建 root session
- root 通过 `stoa-ctl subagent dispatch` 创建 child
- `subagent list` 显示短名和正式 ID
- root/top-level session 不出现在 `subagent list`
- child 提交 explicit result
- parent 通过 `subagent wait` 读取 explicit result
- parent 追加 `subagent input` 后，下一次 `wait` 等待新 result，不返回旧 result
- 多 child wait all/any 返回正确聚合
- root/top-level 不知道也不能调用 `subagent result`
- 不存在 `--artifact` 参数，产物路径只在 prompt/result body 中自然语言说明
- blocked/options 用自然语言 Markdown 表达，不要求 JSON
- wait 对 blocked/interrupted/destroyed target 都有明确输出
- error envelope union 覆盖所有新增 subagent 错误码

## 质量门禁

实现完成后必须运行：

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

一站式验证可以使用：

```bash
npm run test:all
```

生成文件 under `tests/generated/` 不允许手写。

## 实现顺序

1. 新增 shared types：subagent alias projection、result、wait aggregate。
2. 新增或扩展 supervisor facade，复用 `SessionSupervisor`。
3. 新增 control endpoints。
4. 更新 `stoa-ctl` CLI parser 与 output。
5. 删除 `session prompt`，新增 `session input`。
6. 更新 bootstrap prompt，区分 root/top-level 与 child/subagent。
7. 增加 CLI / control / supervisor / bootstrap tests。
8. 增加 behavior and journey assets。
9. regenerate generated tests and run quality gate。

## 验收标准

- `dispatch` 返回短名和正式 ID
- `session create --parent` / renderer create-child 也会初始化 subagent alias 和 epoch
- 自动短名分配不承诺 first-free 顺序，不通过 skipped alias 泄漏 hidden blocker
- `<subagent>` 参数可用短名或正式 ID
- `<subagent>` 参数不能把 root/top-level session ID 当作 subagent
- `subagent list` 能展示当前可见 subagents 的短名和正式 ID
- `subagent list` 不展示 root/top-level sessions
- `wait` 能等待一个或多个 subagent
- `wait --mode all` 和 `wait --mode any` 语义明确并有测试
- `wait` 返回 `SubagentWaitAggregate`，timeout/partial/error target 语义明确
- aggregate `subagent wait` exit code 只由 `conditionMet` 决定，per-target unknown/forbidden 不使用 exit `6`
- visible destroyed/archived backing subagent 可以被 `wait` 解析，并返回 wait-only host status `destroyed`
- destroyed host lifecycle 覆盖销毁前 stored explicit result 和 terminal fallback
- `result` 只能由 child/subagent session 为自己提交
- root/top-level session 不通过 capabilities/bootstrap prompt 得知 `result`
- full result body 只通过 `subagent wait` 返回，generic session projection 只暴露 `subagentResultSummary`
- same-depth peer 即使可见 target，也不能通过 `subagent wait` 读取 full result body
- 底层 `session wait|report|output` 不能绕过 subagent full body read authority、stale epoch 或 destroyed precedence
- `subagent input` 和 direct `session input` 输入 backing subagent session 后都必须清空或 stale old result，后续 `wait` 不返回旧 result
- 没有 explicit result 时，`wait` fallback 到 supervisor completion-report/output read APIs 并明确标记来源
- `session prompt` 被 breaking 删除，`session input`、`/ctl/session/:id/input`、`session:input` 替代所有旧成功路径
- capabilities 使用 `sessionInput`，不暴露可用的 `sessionPrompt`
- 所有正文输入参数统一为 `--text|--file|--stdin`
- `stop --mode interrupt|destroy` 可用，并返回 per-target 状态
- `stop` 返回 `SubagentStopAggregate`，partial/error target 语义明确
- aggregate `subagent stop` exit code 只由 `overallStatus` 决定，per-target unknown/forbidden 不使用 exit `6`
- 不存在 `--artifact` 参数
- blocked/options 使用自然语言 Markdown
- short name restart 后可恢复
- archived/destroyed alias 在同一 root tree 内继续保留，不被默认复用
- dispatch 失败会回滚/清理 child session、短名分配、epoch 和 result facade state
- `subagent result` 写入会触发 graph updated event
- error envelope 扩展 2026-05-29 union
- 所有新增能力通过测试和 behavior coverage gate

## 参考上下文

- `research/2026-06-09-stoactl-subagent-control-gap-analysis.md`
- `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`
- `docs/superpowers/specs/2026-05-11-stoa-ctl-send-keys-design.md`
- `docs/superpowers/specs/2026-05-12-stoa-ctl-work-session-lifecycle-design.md`
