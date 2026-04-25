---
date: 2026-04-26
topic: claude live status probes in electron
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Claude Live Status Probes In Electron

### Why This Was Gathered

为当前“真实 Claude 会话在 Stoa 里为什么经常显示 `ready`、前端点位到底有没有真的进入 `running`”补齐应用内实证。上一轮已经证实 synthetic raw hook route 没问题，但还缺少“真实 Electron + 真实 Claude + 真实输入 + 真实 UI dot”的闭环证据。

### Summary

这轮 live probe 证明了 3 件事。第一，Claude provider 的 hook 安装没有问题，`.claude/settings.local.json` 会被正确写入当前 workspace，并指向当前 webhook port。第二，真实 Electron 应用里，`window.stoa.sendSessionInput()` 和真实键盘 `Enter` 都能到达 main 进程，Claude trust gate 也能被清掉。第三，在 trust gate 清除之后，真实 prompt 会让 session 先进入 `agentState: working` / UI `running`，再进入 `agentState: idle + hasUnseenCompletion` / UI `complete`。所以“Claude 永远不会显示 running”这个结论是错的；更准确的结论是：**未进入真实 prompt submit 之前，Claude 会按当前模型停在 `alive + unknown => ready`。**

同时，`docs/architecture/provider-observable-information.md` 和 `docs/architecture/hook-signal-chain.md` 各有一处关键失真或过时信息：前者把 Claude 误写成支持 `SessionStart` 状态映射，后者仍写着“repo 里没有 Claude live capture”。代码和 live probe 都不支持这两个说法。[docs/architecture/provider-observable-information.md:186-196](docs/architecture/provider-observable-information.md:186), [docs/architecture/hook-signal-chain.md:144-146](docs/architecture/hook-signal-chain.md:144), [src/extensions/providers/claude-code-provider.ts:6-6](src/extensions/providers/claude-code-provider.ts:6), [src/core/hook-event-adapter.ts:97-107](src/core/hook-event-adapter.ts:97)

### Key Findings

- Claude provider 当前实际注册的 hook 只有 5 个：`UserPromptSubmit`、`PreToolUse`、`Stop`、`StopFailure`、`PermissionRequest`。没有 `SessionStart`。这点是代码真相，不是推断。[src/extensions/providers/claude-code-provider.ts:6-6](src/extensions/providers/claude-code-provider.ts:6), [src/extensions/providers/claude-code-provider.ts:35-65](src/extensions/providers/claude-code-provider.ts:35)
- Claude adapter 也只处理上述 5 个事件；`SessionStart` 对 Claude 分支根本不会被映射。`SessionStart` 只出现在 Codex 分支。[src/core/hook-event-adapter.ts:97-107](src/core/hook-event-adapter.ts:97), [src/core/hook-event-adapter.ts:118-126](src/core/hook-event-adapter.ts:118)
- `derivePresencePhase()` 仍然是这次现象的核心解释：对非 shell provider，`runtimeState: alive + agentState: unknown` 会稳定投影为 `ready`，而不是 `running`。所以“新建 Claude session 一开始是 ready”依旧是当前模型的设计结果。[src/shared/session-state-reducer.ts:48-64](src/shared/session-state-reducer.ts:48)
- 真实 Electron 应用里，未清 trust gate 时，Claude 仍然没有任何 hook 事件可供 Stoa 归约，所以状态长期保持在 `lastStateSequence: 2 / agentState: unknown / phase: ready`。这不是 reducer 错，而是 provider 还没有发出第一条结构化事件。
- 真实 Electron 应用里，清掉 trust gate 后提交真实 prompt，会产生至少两次 authoritative 状态变化：
  - `lastStateSequence: 3`, `agentState: working`, `summary: UserPromptSubmit`, `phase: running`
  - `lastStateSequence: 4`, `agentState: idle`, `summary: Stop`, `phase: complete`
- 前端 row dot 也已经在 live probe 里跟随后端一起切换：
  - `data-session-status-testid="session-status-running"`
  - `data-session-status-testid="session-status-complete"`
  所以对于真实 Claude prompt，`running` 的 DOM 投影链路是通的，不只是 backend presence 通。
- 这意味着当前更值得修的不是 reducer/UI，而是对“trust gate / 尚未真正 submit”的认知表达。当前模型把它们都落在 `ready`，这与用户直觉不一致，但和现有状态机是一致的。

### Probe Notes

#### Probe A — Hook installation and initial ready state

在 fresh temp workspace 中创建 Claude session 后，`.claude/settings.local.json` 被正确写出，URL 指向当前 app 的 webhook port，headers 使用 `${STOA_*}` 占位。与此同时，session snapshot 为：

- `runtimeState: alive`
- `agentState: unknown`
- `lastStateSequence: 2`
- `phase: ready`

这与当前 reducer 设计完全一致。[src/extensions/providers/claude-code-provider.ts:35-65](src/extensions/providers/claude-code-provider.ts:35), [src/shared/session-state-reducer.ts:56-64](src/shared/session-state-reducer.ts:56)

#### Probe B — Input boundary inside Electron

在 trust gate 出现后：

- `window.stoa.sendSessionInput(sessionId, '\\r')` 会在 main 进程打印 `[input-debug]`，字节码为 `[13]`
- 聚焦 xterm helper textarea 后，`page.keyboard.press('Enter')` 同样会在 main 进程打印 `[input-debug]`，字节码为 `[13]`
- terminal replay 随后从 trust gate 画面推进到 Claude 正常主界面

所以 `renderer/preload/main -> PTY write -> Claude TUI 接收 Enter` 对 Claude trust gate 是通的；此前“Enter 没清掉 trust gate”的判断是采样时机过早导致的误判。输入确实到了，也确实生效了。[docs/architecture/hook-signal-chain.md:35-47](docs/architecture/hook-signal-chain.md:35)

#### Probe C — Real prompt state sequence

在 trust gate 清除后提交长一点的 prompt，使用 100ms 轮询 session snapshot 与 presence，捕获到：

- `+123ms`: `lastStateSequence=3`, `agentState=working`, `summary=UserPromptSubmit`, `phase=running`
- `+12899ms`: `lastStateSequence=4`, `agentState=idle`, `summary=Stop`, `phase=complete`

这说明真实 Claude live turn 在当前 app 中已经按设计走通 `ready -> running -> complete`。[src/core/hook-event-adapter.ts:97-105](src/core/hook-event-adapter.ts:97), [src/shared/session-state-reducer.ts:40-53](src/shared/session-state-reducer.ts:40)

#### Probe D — Real DOM dot sequence

对同一条长 prompt 再采一层 DOM，row dot 变化为：

- `session-status-running` / `data-phase="running"` / row 文案 `Running 0s ago`
- `session-status-complete` / `data-phase="complete"` / row 文案 `Complete 0s ago`

说明 backend presence 到 renderer row 的末端投影也已被真实应用内证实，不只是 synthetic test 里成立。[src/renderer/components/command/CommandSurface.vue:31-47](src/renderer/components/command/CommandSurface.vue:31), [src/renderer/components/command/WorkspaceHierarchyPanel.vue:310-317](src/renderer/components/command/WorkspaceHierarchyPanel.vue:310)

### Doc Corrections

- `docs/architecture/provider-observable-information.md` 的 Claude mapping table 有误。
  - 文档写了 `\"SessionStart\" -> running -> \"claude-code.SessionStart\"`。
  - 但当前 provider 没注册 `SessionStart`，adapter 也不处理 `SessionStart`。
  - 这条应该删除，或者明确标注为“Claude docs capability, not current Stoa wiring”。[docs/architecture/provider-observable-information.md:188-196](docs/architecture/provider-observable-information.md:188), [src/extensions/providers/claude-code-provider.ts:6-6](src/extensions/providers/claude-code-provider.ts:6), [src/core/hook-event-adapter.ts:97-107](src/core/hook-event-adapter.ts:97)
- `docs/architecture/hook-signal-chain.md` 的 Claude verification note 已过时。
  - 文档仍写“repo 里没有 Claude live CLI capture”。
  - 但现在已经有真实 Electron 内 probe，且已观测到 `UserPromptSubmit -> running` 与 `Stop -> complete`。
  - 该段应更新为“已有 live Electron evidence；trust gate 前仍无 hook，因此 session 会留在 ready”。[docs/architecture/hook-signal-chain.md:144-146](docs/architecture/hook-signal-chain.md:144)

### What This Means For The Bug

- 如果用户说“新建 Claude session 一直是 ready”，这在当前模型里未必是 bug。只要还没出现真实 provider 事件，它就应该是 `ready`，尤其是在 trust gate 尚未清除时。
- 如果用户说“Claude 在真正处理 prompt 的几秒/十几秒里还是 ready”，这条说法已经被当前 live probe 反证。至少在当前工作区和这组真实输入下，session 会进入 `running`，而且 UI dot 会同步变绿。
- 因此，接下来的产品/架构问题不再是“running 状态坏了没有”，而是：
  - 是否要把 Claude trust gate 单独建模为一种可见状态或提示
  - 是否要把“尚未提交第一条 prompt 的 Claude ready”做成更明确的文案/辅助说明
  - 是否要补自动化测试，覆盖真实 prompt 期间 row dot 的 `running` 断言

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Claude provider 实际只注册 5 个 hook | `src/extensions/providers/claude-code-provider.ts` | `6`, `35-65` |
| Claude adapter 不支持 `SessionStart` | `src/core/hook-event-adapter.ts` | `97-107` |
| `working -> running` | `src/shared/session-state-reducer.ts` | `48-49` |
| `alive + unknown + non-shell -> ready` | `src/shared/session-state-reducer.ts` | `60-61` |
| renderer 优先使用 backend presence | `src/renderer/components/command/CommandSurface.vue` | `31-47` |
| row dot 直接反映 phase | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | `310-317` |
| provider-observable-information 错把 Claude 写成支持 `SessionStart` | `docs/architecture/provider-observable-information.md` | `188-196` |
| hook-signal-chain 仍说 Claude 没有 live capture | `docs/architecture/hook-signal-chain.md` | `144-146` |
| trust/input boundary 是 shared early boundary，不只属于 Codex | `docs/architecture/hook-signal-chain.md` | `35-47` |
| live Electron probe 里清 trust 后 prompt 能进入 `running` 再进入 `complete` | 本报告 Probe C / Probe D | `33-41`, `43-51` |

### Risks / Unknowns

- [!] 本轮 live probe 没覆盖 Claude `PermissionRequest` 的真实应用内表现；当前只确认了 `UserPromptSubmit` 和 `Stop` 路径。
- [!] 这轮结论只证明“当前机器、当前 Claude 版本、当前工作区”下的真实链路是通的，不等于每个 workspace 都没有 trust / login / account gating。
- [!] 如果用户实际观察到“长时间 working 仍是 ready”，更可能是另一类场景，例如未清 trust gate、没有真正 submit、或者观察的是别的 provider。

## Context Handoff: Claude Live Status Probes In Electron

Start here: `research/2026-04-26-claude-live-status-probes.md`

Context only. Use the saved report as the source of truth.
