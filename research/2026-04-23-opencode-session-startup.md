---
date: 2026-04-23
topic: opencode session startup semantics
status: completed
mode: context-gathering
sources: 10
---

## Context Report: OpenCode Session 启动语义为什么和“先开 Shell 再手动执行 opencode”不一致

### Why This Was Gathered
定位当前项目里 OpenCode session 的启动语义偏差，解释为什么应用内直接启动的 OpenCode session 和“先开 shell session，再手动输入 `opencode`”表现不一致。

### Summary
根因有两层。第一层也是主要问题：项目当前强制把 OpenCode 启动命令写成 `opencode --pure`，而 CLI 帮助明确说明 `--pure` 表示“不加载 external plugins”；这和手动在 shell 里输入 `opencode` 的默认语义不同，也会直接抵消我们自己写入 `.opencode/plugins/stoa-status.ts` 的 sidecar 插件。第二层是启动形态差异：应用不是先让用户进入交互 shell，再在同一 shell 内输入 `opencode`，而是把 OpenCode 包装成一次性 shell 命令执行，PowerShell 用 `-Command`，cmd 用 `/c`，POSIX shell 用 `-lc "exec ..."`, 这只能逼近 shell 环境，不等价于手动操作语义。

### Key Findings

- **OpenCode provider 当前无条件附加 `--pure`。**
  `buildStartCommand()` 返回 `['--pure']`，`buildResumeCommand()` 返回 `['--pure', '--session', externalSessionId]`，fresh start 和 resume 都一样。来源：`src/extensions/providers/opencode-provider.ts:52-56`

- **我们一边强制 `--pure`，一边又把状态桥接插件写到 `.opencode/plugins`，这是内部自相矛盾。**
  sidecar 安装逻辑会把 `stoa-status.ts` 写入项目目录下的 `.opencode/plugins`，并依赖插件把 provider 事件 POST 回本地 webhook。来源：`src/extensions/providers/opencode-provider.ts:31-40`, `src/extensions/providers/opencode-provider.ts:61-62`

- **状态同步链路依赖 sidecar 事件，而 fresh start 自身不会生成 externalSessionId。**
  runtime 在 fresh start 时会把 `activeExternalSessionId` 置为 `null`；后续要靠 webhook 事件把真实 provider session id 写回 manager。来源：`src/core/session-runtime.ts:67-81`, `src/main/session-event-bridge.ts:35-41`

- **测试已经把这两个互相冲突的前提同时固化了。**
  现有 provider 集成测试既断言 `buildStartCommand()` / `buildResumeCommand()` 必须带 `--pure`，又断言 `stoa-status.ts` 必须被写出并且包含 `externalSessionId`/状态桥接逻辑。来源：`tests/e2e/provider-integration.test.ts:135-210`, `tests/e2e/provider-integration.test.ts:238-312`

- **应用内启动并不是“先进入 shell，再手动执行 opencode”，而是“把 opencode 包装成 shell 的一次性命令”。**
  main process 会先解析 `shellPath` / `providerPath`，然后 `startSessionRuntime()` 对 opencode 分支调用 `wrapCommandForShell()`。来源：`src/main/index.ts:64-87`, `src/main/index.ts:119-141`, `src/core/session-runtime.ts:77-80`

- **不同 shell family 的包装方式都是非交互式单次执行。**
  PowerShell 使用 `-Command '& ...'`，cmd 使用 `/d /s /c ...`，POSIX shell 使用 `-lc "exec ..."`. 这意味着应用内 OpenCode session 只是借 shell 做命令解析/环境注入，不等价于用户先落进交互 shell 再手动输入命令。来源：`src/core/shell-command.ts:51-98`

- **本机 CLI 帮助把 `--pure` 明确解释为关闭 external plugins。**
  本地命令 `opencode --help` 的输出包含 `--pure         run without external plugins`。这与手动执行裸 `opencode` 的默认语义不同，也解释了为什么应用内启动和手动启动会偏离。来源：本机命令 `opencode --help`（2026-04-23 本次排查时执行）

### Root Cause

#### Root Cause 1: Forced `--pure` changes OpenCode semantics
- 手动流程：用户进入 shell 后执行的是裸 `opencode`
- 应用流程：provider 永远执行 `opencode --pure`
- 结果：应用内 session 主动关闭 external plugins，和手动流程的默认行为不同

#### Root Cause 2: Shell wrapping is command-mode, not interactive-shell mode
- 手动流程：先建立交互 shell，会保留 prompt、交互状态、可能的 shell 层上下文
- 应用流程：shell 只负责执行一次命令，然后让 provider 占用 PTY
- 结果：即便工作目录和环境变量相同，启动语义也不是“用户先拿到 shell，再自己输入命令”

### Most Likely User-Visible Consequences

- OpenCode sidecar 插件可能根本不生效，因此 webhook 状态推送和 `externalSessionId` 绑定不稳定
- 应用恢复逻辑依赖的真实 external session id 可能拿不到，resume 语义会变弱
- 用户自己的 OpenCode 插件/项目级插件不会按手动启动那样参与启动过程
- 即使 shellPath 被正确探测，应用内行为依然只是“shell 包一层命令”，不是完整复现手动 shell 工作流

### Minimal Fix Direction

- **第一优先级：移除 OpenCode provider 上的强制 `--pure`。**
  这是最小且直接对应根因的修复。修复位置：`src/extensions/providers/opencode-provider.ts`

- **同步更新所有把 `--pure` 当成既定行为的测试。**
  重点包括：
  `src/extensions/providers/opencode-provider.test.ts`
  `src/core/shell-command.test.ts`
  `tests/e2e/provider-integration.test.ts`
  `tests/e2e/backend-lifecycle.test.ts`
  `src/core/session-runtime.test.ts`

- **如果目标是完全复现“先开 shell，再手动输入 opencode”的交互语义，还需要另一个设计决策。**
  当前 `wrapCommandForShell()` 只能做到“借 shell 启动 provider”。如果要完整复现用户手工流程，需要改成先启动 shell，再向 shell 写入 `opencode` 命令；这会改变 runtime/PTY 生命周期模型，属于比去掉 `--pure` 更大的 breaking change。

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| OpenCode fresh start uses `--pure` | opencode-provider.ts | src/extensions/providers/opencode-provider.ts:52-53 |
| OpenCode resume uses `--pure --session` | opencode-provider.ts | src/extensions/providers/opencode-provider.ts:55-56 |
| Sidecar plugin is written into `.opencode/plugins` | opencode-provider.ts | src/extensions/providers/opencode-provider.ts:31-40 |
| Sidecar install is always invoked before launch | session-runtime.ts | src/core/session-runtime.ts:63-65 |
| Fresh start keeps `externalSessionId` null until later event sync | session-runtime.ts | src/core/session-runtime.ts:67-81 |
| Webhook bridge writes sidecar-provided `externalSessionId` into state | session-event-bridge.ts | src/main/session-event-bridge.ts:35-41 |
| OpenCode launch path passes through shell wrapping | session-runtime.ts | src/core/session-runtime.ts:77-80 |
| Shell wrapper uses PowerShell `-Command`, cmd `/c`, POSIX `-lc exec` | shell-command.ts | src/core/shell-command.ts:51-98 |
| Tests currently expect `--pure` | provider-integration.test.ts | tests/e2e/provider-integration.test.ts:135-210 |
| Tests also expect the sidecar bridge plugin contents | provider-integration.test.ts | tests/e2e/provider-integration.test.ts:238-312 |

### Risks / Unknowns
- [!] 去掉 `--pure` 后，用户自己的 OpenCode 插件也会参与启动流程；这会让行为更接近手动启动，但也会降低“完全可控”的假设
- [!] 如果产品目标不是“贴近手动 shell 语义”，而是“尽量稳定地独立托管 OpenCode”，那是否还要保留 command-mode shell 包装，需要单独设计
- [?] 本次排查已经能解释当前语义差异，但还没把修复真正落地到代码和测试

## Context Handoff: OpenCode Session Startup Semantics

Start here: `research/2026-04-23-opencode-session-startup.md`

Context only. Use the saved report as the source of truth.
