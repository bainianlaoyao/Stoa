---
date: 2026-05-06
topic: session state omission audit across claude codex opencode
status: completed
mode: context-gathering
sources: 16
---

## Context Report: Session State Omission Audit

### Why This Was Gathered

排查当前 session 状态管理为什么持续漏掉状态转换，重点核对三类 CLI 的本地 hook / plugin 文档，与当前 Stoa 的状态模型、adapter、reducer、provider wiring 是否一致。

### Summary

当前问题不只是少了几个 `status` 名字，而是少了三类稳定状态事实：

- `interrupted / cancelled` 这一类 turn 终止结果没有稳定落点
- `failed` 只有粗粒度错误，没有失败原因维度
- `exited` 只有 clean / failed，没有会话结束原因维度

同时，还有一批事件虽然在 Claude / Codex / OpenCode 的文档里存在，但当前 wiring 根本没有接进 reducer。因此很多“看起来像状态缺失”的问题，本质上其实是两件事叠加：一部分状态维度确实没建模，另一部分则是 provider 事件根本没进状态机。

如果只问“最关键缺了哪些状态事实”，我认为是这 4 个：

1. **turn outcome = interrupted / cancelled**
2. **failure reason = typed error class**
3. **termination reason = why session ended**
4. **blocked reason coverage = permission 之外的 elicitation / denial / provider-side waiting**

### Key Findings

#### 1. `user interruption` 目前只是一个瞬时 intent，不是稳定状态

- 当前系统确实能识别用户中断：`SessionInputRouter` 在 agent session 收到 `Ctrl+C` 时，会调用 `markAgentTurnInterrupted()`。[src/main/session-input-router.ts:29-43](src/main/session-input-router.ts:29), [src/main/index.ts:427-444](src/main/index.ts:427)
- 但 reducer 对 `agent.turn_interrupted` 的处理是立刻把 session 归并回 `agentState = idle`，并清掉 `hasUnseenCompletion` 和 `blockingReason`。[src/shared/session-state-reducer.ts:128-133](src/shared/session-state-reducer.ts:128)
- 结果是：**被用户打断的一轮** 和 **普通 idle / ready** 在稳定状态上不可区分。当前模型里只有 intent，没有持久 outcome。

这意味着以下事实全都被压扁了：

- 用户主动中断了一轮
- provider 自己取消了一轮
- 一轮从未真正完成，只是被打断后回到 idle

这正是你举的 `user interruption` 例子里最核心的遗漏。

#### 2. 错误状态被压成了单一 `error`，缺少失败原因维度

- 当前 agent 层只有 `unknown | idle | working | blocked | error`，runtime 层只有 `clean | failed` 两种 exit reason。[src/shared/project-session.ts:16-18](src/shared/project-session.ts:16), [src/shared/project-session.ts:47-49](src/shared/project-session.ts:47)
- Claude 的 `StopFailure` 实际有明确错误类型：`rate_limit`、`authentication_failed`、`billing_error`、`invalid_request`、`server_error`、`max_output_tokens`、`unknown`。[docs/architecture/claude-code-hooks-reference.md:972-987](docs/architecture/claude-code-hooks-reference.md:972)
- Claude 的 `PermissionDenied` 还会给出 denial reason。[docs/architecture/claude-code-hooks-reference.md:760-786](docs/architecture/claude-code-hooks-reference.md:760)
- OpenCode 也有 `session.error` 与 `session.status` 事件面。[docs/architecture/opencode-plugin-reference.md:402-413](docs/architecture/opencode-plugin-reference.md:402)

但当前 reducer 对所有 turn 失败都只落成：

- `agentState = error`
- 或 `runtimeExitReason = failed`

没有稳定字段去表达：

- API 限流
- 认证失效
- 账单问题
- 工具失败
- 用户拒绝继续
- provider 内部错误
- runtime crash

所以现在的 “Failed” 其实是一个过于宽泛的大桶，不足以穷举真实错误状态。

#### 3. `blocked` 的原因集合在类型上存在，但在真实 wiring 里没有被穷举

- 共享类型里 `BlockingReason` 已经有 `permission | elicitation | resume-confirmation | provider-error`。[src/shared/observability.ts:29-33](src/shared/observability.ts:29)
- 但当前实际 adapter / sidecar 基本只会发出 `permission`：
  - Claude 当前安装的 hook 只有 `SessionStart`、`UserPromptSubmit`、`PostToolUse`、`Stop`、`PermissionRequest`。[src/extensions/providers/claude-hook-sidecar.ts:49-57](src/extensions/providers/claude-hook-sidecar.ts:49)
  - Claude hook adapter 也只映射 `SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / PermissionRequest / Stop`，没有 `PermissionDenied`、`Elicitation`、`ElicitationResult`、`SessionEnd`、`StopFailure` 的映射。[src/core/hook-event-adapter.ts:146-168](src/core/hook-event-adapter.ts:146)
  - OpenCode sidecar 只订阅了 `session.idle`、`permission.asked`、`permission.replied`、`session.error`。[src/extensions/providers/opencode-provider.ts:31-69](src/extensions/providers/opencode-provider.ts:31)

而 Claude 文档明确还有：

- `PermissionDenied`
- `Elicitation`
- `ElicitationResult`
- `SessionEnd`

[docs/architecture/claude-code-hooks-reference.md:760-786](docs/architecture/claude-code-hooks-reference.md:760), [docs/architecture/claude-code-hooks-reference.md:1223-1295](docs/architecture/claude-code-hooks-reference.md:1223), [docs/architecture/claude-code-hooks-reference.md:1209-1220](docs/architecture/claude-code-hooks-reference.md:1209)

所以这里缺的不是一个新的大 phase，而是 **blocked 子原因的真实覆盖**。类型上已经预留了 `elicitation`，但状态机入口根本没把这类事件接进来。

#### 4. 会话结束原因没有稳定状态落点

- Claude `SessionEnd` 会明确告诉你 session 为什么结束，例如 `clear`、`resume`、`logout`、`prompt_input_exit`、`bypass_permissions_disabled`、`other`。[docs/architecture/claude-code-hooks-reference.md:1209-1220](docs/architecture/claude-code-hooks-reference.md:1209)
- 当前 Stoa 的 runtime 终止只保留：
  - `runtimeState = exited`
  - `runtimeExitReason = clean | failed`

[src/shared/project-session.ts:16](src/shared/project-session.ts:16), [src/shared/project-session.ts:47-49](src/shared/project-session.ts:47)

这会丢掉非常重要的稳定状态事实：

- 这次退出是用户主动 `/clear`
- 是 `/resume` 切换会话导致旧会话终止
- 是正常退出 CLI
- 还是权限模式变化 / logout 导致被动结束

这些都不是简单的 `clean exit`，但当前状态机没有地方保存。

#### 5. `interrupted`、`failed`、`completed` 之外还缺少“结果原因”这一层

当前 reducer 实际上已经暴露出这个问题：

- `agent.turn_completed` 会稳定落到 `idle + hasUnseenCompletion = true`
- `agent.turn_interrupted` 会稳定落到 `idle + hasUnseenCompletion = false`
- `agent.turn_failed` 会稳定落到 `error`

[src/shared/session-state-reducer.ts:121-157](src/shared/session-state-reducer.ts:121)

也就是说，系统隐含地承认了“turn 结果”至少有三种：

- completed
- interrupted
- failed

但它们没有一个统一的稳定字段，只是散落在 `agentState`、`hasUnseenCompletion`、`blockingReason` 的组合里。结果就是很多 reducer 分支必须靠组合推断，而不是直接消费一个穷举过的 turn outcome。

这是当前状态模型最值得补的维度之一。

#### 6. Codex 和 OpenCode 的“working”很多时候不是缺状态，而是缺 ingress

- Codex hooks 文档虽然有 `PreToolUse` / `PostToolUse` / `Stop` / `UserPromptSubmit`，但当前 Stoa 注册只接了 `SessionStart`、`UserPromptSubmit`、`PostToolUse`（且只匹配 `Write`）、`Stop`，根本没有注册 `PreToolUse`。[docs/architecture/codex-hooks-reference.md:187-324](docs/architecture/codex-hooks-reference.md:187), [src/extensions/providers/codex-provider.ts:43-67](src/extensions/providers/codex-provider.ts:43)
- OpenCode 文档有 `message.updated`、`tool.execute.before`、`tool.execute.after`、`session.status`，但当前 Stoa sidecar 完全没用这些事件。[docs/architecture/opencode-plugin-reference.md:402-413](docs/architecture/opencode-plugin-reference.md:402), [docs/architecture/provider-observable-information.md:643-653](docs/architecture/provider-observable-information.md:643), [src/extensions/providers/opencode-provider.ts:31-69](src/extensions/providers/opencode-provider.ts:31)

所以很多“为什么 running 漏了”的问题，并不一定要靠新增 `running` 子状态解决，而是要先承认：

- 有些 provider 根本没有把可靠的 turn-start / tool-start 证据送进 reducer
- 状态机再完整，也无法凭空表达没收到的事件

#### 7. 当前 reducer 还有一个 transition guard 漏洞，会制造“像是缺状态”的假象

设计文档明确要求：

- `blocked -> working` 不能被普通 `agent.tool_started` 随意解除
- 必须有 explicit unblock evidence

[docs/superpowers/specs/2026-04-24-session-state-model-redesign.md:142-143](docs/superpowers/specs/2026-04-24-session-state-model-redesign.md:142), [docs/superpowers/specs/2026-04-24-session-state-model-redesign.md:271-272](docs/superpowers/specs/2026-04-24-session-state-model-redesign.md:271)

但当前 reducer 的实现是：

- `agent.tool_started` -> 直接 `working`
- `agent.tool_completed` -> 也直接 `working`

[src/shared/session-state-reducer.ts:115-120](src/shared/session-state-reducer.ts:115), [src/shared/session-state-reducer.ts:190-197](src/shared/session-state-reducer.ts:190)

而测试还显式把这种行为锁死了。[src/shared/session-state-reducer.test.ts:267-297](src/shared/session-state-reducer.test.ts:267)

这说明当前问题不全是“状态少了”，还有 **guard 没穷举**。换句话说，一部分漏转换不是因为 enum 不够，而是因为 reducer 允许了本不该合法的转换。

### What Is Actually Missing

如果要把“遗漏状态”收敛成最小且有价值的一组，我建议理解成下面 4 个稳定维度，而不是继续往 `agentState` 或 `presence` 里硬塞更多 label：

#### A. Turn Outcome

当前缺少一个稳定的 turn 结果维度，至少应能区分：

- `completed`
- `interrupted`
- `failed`
- `cancelled`

`user interruption` 就属于这里，不应继续伪装成普通 `idle`。

#### B. Failure Reason

当前缺少一个稳定的失败原因维度，至少应能区分：

- `rate_limit`
- `authentication_failed`
- `billing_error`
- `invalid_request`
- `server_error`
- `max_output_tokens`
- `permission_denied`
- `tool_failed`
- `runtime_crash`
- `provider_error`

否则所有失败都只能被 UI 表达成一个粗粒度 `Failed`。

#### C. Termination Reason

当前缺少一个稳定的会话结束原因维度，至少应能区分：

- `clear`
- `resume_replaced`
- `logout`
- `prompt_input_exit`
- `normal_exit`
- `crash`

否则恢复逻辑和 UI 都只能把“被替换掉的旧会话”和“正常退出的会话”混成一个 `exited`。

#### D. Blocked Reason Coverage

当前 `blocked` 只在实装上覆盖了 `permission`，但真实需要至少覆盖：

- `permission`
- `elicitation`
- `resume-confirmation`
- `provider-error`
- 可能还需要 `auto-denied` 或 `tool-policy-denied`

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 当前状态模型只有粗粒度 runtime / agent / exit reason | `src/shared/project-session.ts` | `16-18`, `47-49` |
| `Ctrl+C` 会触发 `markAgentTurnInterrupted()` | `src/main/session-input-router.ts` | `29-43` |
| `Ctrl+C` wiring 到 runtime controller | `src/main/index.ts` | `427-444` |
| `agent.turn_interrupted` 立即归并回 idle | `src/shared/session-state-reducer.ts` | `128-133` |
| Claude `StopFailure` 暴露 typed error classes | `docs/architecture/claude-code-hooks-reference.md` | `972-987` |
| Claude `PermissionDenied` 暴露 denial reason | `docs/architecture/claude-code-hooks-reference.md` | `760-786` |
| Claude `SessionEnd` 暴露终止原因 | `docs/architecture/claude-code-hooks-reference.md` | `1209-1220` |
| Claude `Elicitation` / `ElicitationResult` 存在 | `docs/architecture/claude-code-hooks-reference.md` | `1223-1295` |
| OpenCode 事件面包含 `session.error` / `session.status` | `docs/architecture/opencode-plugin-reference.md` | `402-413` |
| OpenCode 还提供 `message.updated` / `tool.execute.before` / `tool.execute.after` | `docs/architecture/provider-observable-information.md` | `643-653` |
| 当前 OpenCode sidecar 只订阅 idle / permission / error | `src/extensions/providers/opencode-provider.ts` | `31-69` |
| Codex hooks 只注册 `SessionStart` / `UserPromptSubmit` / `PostToolUse(Write)` / `Stop` | `src/extensions/providers/codex-provider.ts` | `43-67` |
| 当前 Claude hook 安装没有 `StopFailure` / `PermissionDenied` / `Elicitation` | `src/extensions/providers/claude-hook-sidecar.ts` | `49-57` |
| 当前 Claude / Codex adapter 只映射有限 hook 集 | `src/core/hook-event-adapter.ts` | `146-189` |
| 设计文档要求 blocked 只能被 explicit unblock evidence 解开 | `docs/superpowers/specs/2026-04-24-session-state-model-redesign.md` | `142-143`, `271-272` |
| 当前 reducer 实际允许 tool started / completed 直接清 blocked | `src/shared/session-state-reducer.ts` | `115-120`, `190-197` |
| 测试已经把这个宽松 guard 锁死 | `src/shared/session-state-reducer.test.ts` | `267-297` |

### Risks / Unknowns

- [!] 现有 `research/` 里有几份 Claude 相关报告已经和当前代码不一致；后续讨论请以当前 provider wiring 为准，而不是旧研究结论。
- [!] `resume-confirmation` 和 `provider-error` 已经在 `BlockingReason` 里出现，但我这轮没有找到同等级、稳定、统一的 ingress；它们更像“类型先行，事件后补”。
- [!] 对 Codex 来说，一部分缺口是 provider hook surface 的天然限制；不能假设它会像 Claude 一样提供 `StopFailure` 或 `PermissionRequest`。

## Context Handoff: Session State Omission Audit

Start here: `research/2026-05-06-session-state-omission-audit.md`

Context only. Use the saved report as the source of truth.
