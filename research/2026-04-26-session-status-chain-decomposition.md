---
date: 2026-04-26
topic: session status chain decomposition
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Session Status Chain Decomposition

### Why This Was Gathered

为当前“真实会话明明在工作，但前端长期显示 `ready/idle`”的问题建立一套可独立验证的链路拆分方案，避免继续把 provider 输入、hook 发射、状态归约、observability、renderer 投影混在一起排查。

### Summary

当前代码里，`running` 的 authoritative 条件非常严格：必须先把 session 归约成 `agentState === 'working'`，前端才会显示 `running`。仅仅 `runtimeState === 'alive'` 对 agent provider 并不会显示 `running`，而是按设计显示 `ready`。证据在 `derivePresencePhase()` 和 `markRuntimeAlive()`：`runtime.alive` 不会把 agent 置为 `working`，而 `alive + unknown + non-shell` 会被投影为 `ready`。[src/shared/session-state-reducer.ts:19-64](src/shared/session-state-reducer.ts:19), [src/core/project-session-manager.ts:317-319](src/core/project-session-manager.ts:317)

因此，这类问题最优雅的排查方式不是继续改 UI，而是把链路拆成 7 段分别证伪。对 Claude 来说，`/hooks/claude-code` 到 UI `running/blocked/complete/ready` 的 downstream 已经有合成 E2E 证明是通的；如果真实 Claude 仍停在 `ready`，第一嫌疑已经收缩到 provider 侧配置/发 hook，而不是 reducer 或前端点位本身。[tests/e2e-playwright/session-event-journey.test.ts:309-363](tests/e2e-playwright/session-event-journey.test.ts:309), [tests/e2e/backend-lifecycle.test.ts:774-810](tests/e2e/backend-lifecycle.test.ts:774)

### Key Findings

- `running` 不是“runtime 活着”的同义词；它是 `agentState === 'working'` 的投影结果。`runtime.alive` 对 shell 投 `running`，对非 shell 投 `ready`。这意味着“新建 Claude 一开始是 ready”在当前模型里是设计结果，不是渲染 bug。[src/shared/session-state-reducer.ts:48-64](src/shared/session-state-reducer.ts:48)
- Claude hook adapter 明确把 `UserPromptSubmit`、`PreToolUse` 映射到 `agent.turn_started/agent.tool_started + working`；把 `PermissionRequest` 映射到 `blocked`；把 `Stop` 映射到 `idle + hasUnseenCompletion`；把 `StopFailure` 映射到 `error`。[src/core/hook-event-adapter.ts:4-47](src/core/hook-event-adapter.ts:4)
- SessionEventBridge 的状态路径和 evidence 路径是分开的。phase 的 authoritative 来源是 `controller.applyProviderStatePatch() -> manager.applySessionStatePatch() -> reduceSessionState() -> buildSessionPresenceSnapshot()`；`observability.ingest()` 只补证据，不负责把 `ready` 改成 `running`。[src/main/session-event-bridge.ts:57-127](src/main/session-event-bridge.ts:57), [src/main/session-runtime-controller.ts:60-64](src/main/session-runtime-controller.ts:60), [src/core/observability-service.ts:127-157](src/core/observability-service.ts:127)
- 前端列表点位基本不自己猜状态。`CommandSurface` 优先使用后端 `sessionPresenceMap`，只有缺 snapshot 时才 fallback 到 `buildSessionPresenceSnapshot(session, ...)`；`WorkspaceHierarchyPanel` 再把 `presence.phase` 直接写到 `data-session-status-testid`。[src/renderer/components/command/CommandSurface.vue:31-47](src/renderer/components/command/CommandSurface.vue:31), [src/renderer/components/command/WorkspaceHierarchyPanel.vue:310-317](src/renderer/components/command/WorkspaceHierarchyPanel.vue:310)
- Claude raw hook route 的 downstream 已被合成 E2E 打通：直接 POST `UserPromptSubmit` 会把 session 从 `ready` 推到 `running`；POST `PermissionRequest` 会变 `blocked`；POST `Stop` 会变 `complete`；点开 session 后会从 `complete` 回到 `ready`。[tests/e2e-playwright/session-event-journey.test.ts:309-419](tests/e2e-playwright/session-event-journey.test.ts:309), [tests/e2e/backend-lifecycle.test.ts:776-810](tests/e2e/backend-lifecycle.test.ts:776)
- Claude provider 侧安装的是 `.claude/settings.local.json`，包含 5 个 HTTP hook，直接发到 `/hooks/claude-code`，头里用 `${STOA_*}` 占位。如果真实 Claude 仍不发 `running` 相关状态，首先应怀疑这层是否真的生效，而不是后端 reducer。[src/extensions/providers/claude-code-provider.ts:6-66](src/extensions/providers/claude-code-provider.ts:6)
- Codex 需要额外单独拆出 “PTY 输入是否被 TUI 接受为真实 submit” 这一段；这一层已经被文档和实现明确区分，不应再和 downstream 状态机混查。[src/main/session-input-router.ts:41-145](src/main/session-input-router.ts:41), [docs/architecture/hook-signal-chain.md](docs/architecture/hook-signal-chain.md)

### Verification Matrix

| Segment | Boundary | Source Of Truth | Independent verification | Expected signal | Failure signature |
|---------|----------|-----------------|--------------------------|-----------------|------------------|
| S0 | Provider config install -> workspace hook files | provider installer output | 检查 `.claude/settings.local.json` / `.codex/hooks.json` / `.codex/config.toml` 是否写入正确 URL、headers、events | 文件里包含当前 webhook port 与 `${STOA_*}` headers | provider 根本不发 hook；后端完全无请求 |
| S1 | Renderer input -> preload/main IPC | `TerminalViewport.onData()` + `preload.sendSessionInput()` + `ipcMain.handle(sessionInput)` | 观察 `xterm.onData` 是否触发，或在 E2E/debug 下检查 `INPUT_DEBUG` 日志 | main 收到正确 `sessionId + data` | 真键盘输入没有离开 renderer |
| S2 | Main input -> PTY -> provider TUI 接受为 turn | provider 本体行为 | 对真实 interactive provider 做 live repro；Codex 还可用 standalone `node-pty` 复现 | provider 自己进入 working/tool turn | draft line 有字，但 provider 不起 turn、不发 hook |
| S3 | Provider hook/sidecar -> webhook ingress | `/hooks/claude-code` / `/hooks/codex` / `/events` | 直接用 `postClaudeHookEvent()` 或 `postWebhookEvent()` 发合成请求 | HTTP 202，且 session state 立刻变化 | 400/401，或 202 但后端状态不动 |
| S4 | Webhook adapter -> session reduction | `adapt*Hook()` + `reduceSessionState()` | 直接发 `UserPromptSubmit`/`PreToolUse`/`Stop` 到本地 webhook；检查 main debug state 里的 session | `agentState` 变 `working/blocked/idle`，`hasUnseenCompletion` 正确 | snapshot 仍是 `unknown/idle`；说明后端状态路径坏了 |
| S5 | Session summary -> presence snapshot | `buildSessionPresenceSnapshot()` | 比较 manager `SessionSummary` 与 `getSessionPresence()` 输出 | `working -> running`，`idle+unseen -> complete`，active select 后 `complete -> ready` | summary 已对，但 presence phase 仍错 |
| S6 | Presence snapshot -> renderer store | `getSessionPresence()` + `onSessionPresenceChanged()` + workspaces store | 调 `window.stoa.getSessionPresence(sessionId)`，再看 store 是否收到 `observabilitySessionPresenceChanged` | store 中 `sessionPresenceById[sessionId].phase` 正确 | main 对、renderer 没拿到 |
| S7 | Renderer row projection -> DOM dot | `CommandSurface` + `WorkspaceHierarchyPanel` | 直接检查 `[data-testid=\"session-status-dot\"]` 的 `data-session-status-testid` | phase 与 dot 一致，如 `running -> session-status-running` | store 对，DOM 仍显示旧 phase |

### Minimum Diagnostic Ladder

推荐按下面的顺序排查，不要跳步：

1. 先证伪 S3-S7：直接向本地 `/hooks/claude-code` 发 `UserPromptSubmit`。
   期望：HTTP `202`，main debug state 里 `agentState: working`，UI dot 变 `session-status-running`。
   这条链路已被现有 Playwright/E2E 证明可行，可直接复用同样办法做现场验证。[tests/e2e-playwright/session-event-journey.test.ts:348-363](tests/e2e-playwright/session-event-journey.test.ts:348), [tests/e2e/backend-lifecycle.test.ts:776-810](tests/e2e/backend-lifecycle.test.ts:776)

2. 如果第 1 步通过，再证伪 S0：检查当前 workspace 下 `.claude/settings.local.json` 是否真的是 Stoa 安装器写出的那份，是否包含 `UserPromptSubmit` / `PreToolUse` / `Stop` / `StopFailure` / `PermissionRequest`，以及正确的 URL 与 headers。[src/extensions/providers/claude-code-provider.ts:35-66](src/extensions/providers/claude-code-provider.ts:35)

3. 如果配置没问题，再证伪 S2-S3 之间：让真实 Claude 跑起来，然后确认它是否真的向 `/hooks/claude-code` 发了请求。
   最小观测面：main debug state 提供当前 `webhookPort` 和 `sessionSecrets`；可据此在同一会话里旁路验证请求是否能被接受。[tests/e2e-playwright/fixtures/electron-app.ts:197-271](tests/e2e-playwright/fixtures/electron-app.ts:197)

4. 只有当第 1 步失败时，才往下查 reducer / observability / renderer。
   因为这说明问题已经不在 Claude 本体，而在 Stoa downstream 自己。

### High-Value Existing Probes

- `getMainE2EDebugState()`：可直接读 main 进程当前 `snapshot`、`webhookPort`、`sessionSecrets`，适合核对 manager 层是否已经变成 `working/idle/blocked`。[tests/e2e-playwright/fixtures/electron-app.ts:197-203](tests/e2e-playwright/fixtures/electron-app.ts:197)
- `postClaudeHookEvent()`：直接绕过真实 Claude，只测 raw hook route 以下所有链路。[tests/e2e-playwright/fixtures/electron-app.ts:248-270](tests/e2e-playwright/fixtures/electron-app.ts:248)
- `postWebhookEvent()`：直接绕过 adapter，只测 canonical event route 以下所有链路。[tests/e2e-playwright/fixtures/electron-app.ts:227-245](tests/e2e-playwright/fixtures/electron-app.ts:227)
- `window.stoa.getSessionPresence(sessionId)`：直接看 renderer 拉到的 backend presence，而不是只看 row dot。[src/preload/index.ts:89-107](src/preload/index.ts:89), [src/main/index.ts:666-668](src/main/index.ts:666)
- `[data-testid="session-status-dot"]` 上的 `data-session-status-testid`：这是 UI 末端最小可断言输出。[src/renderer/components/command/WorkspaceHierarchyPanel.vue:310-317](src/renderer/components/command/WorkspaceHierarchyPanel.vue:310)

### Likely Root-Cause Partition

如果症状是：

- “真实 Claude working 时 UI 一直是 `ready`”

那么按当前证据，最可能的分区是：

- **更可能：S0-S3 上游问题**
  - Claude 没有真正装上 Stoa 的 hooks
  - Claude 装了 hooks，但真实运行时没有发 `UserPromptSubmit` / `PreToolUse`
  - 请求发了，但上下文/header/secret 不对

- **相对没那么可能：S4-S7 下游问题**
  - 因为 synthetic raw hook -> `running/blocked/complete/ready` 已经有现成测试证明可达

对 Codex 则需要额外保留一个独立判断：

- **S2 可能单独坏掉**
  - PTY 写入到了 TUI，但 TUI 不把它当 submit
  - 这时 downstream 再正确也不会动

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `runtime.alive` 不会把 agent 设为 `working` | `src/core/project-session-manager.ts` | `317-319` |
| `alive + unknown + non-shell => ready` | `src/shared/session-state-reducer.ts` | `56-64` |
| `agentState === working => running` | `src/shared/session-state-reducer.ts` | `48-49` |
| Claude hooks 到 patch 的映射 | `src/core/hook-event-adapter.ts` | `16-45`, `97-107` |
| Bridge 把 event 同时送到 observability 和 provider state patch | `src/main/session-event-bridge.ts` | `57-76` |
| controller 通过 `applyProviderStatePatch()` 推 session summary 和 observability IPC | `src/main/session-runtime-controller.ts` | `60-64`, `101-134` |
| phase 是从 session summary 推导，不是从 evidence 直接改 | `src/shared/observability-projection.ts` | `58-107` |
| renderer 优先使用 backend presence snapshot，缺失时才 fallback | `src/renderer/components/command/CommandSurface.vue` | `31-47` |
| UI dot 直接反映 `sessionPhase(session)` | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | `310-317` |
| preload 暴露 `getSessionPresence()` 与 `onSessionPresenceChanged()` | `src/preload/index.ts` | `89-117` |
| main 暴露 `observabilityGetSessionPresence` IPC | `src/main/index.ts` | `660-668` |
| Claude provider 安装 `.claude/settings.local.json`，注册 5 个 HTTP hooks | `src/extensions/providers/claude-code-provider.ts` | `6-66` |
| Codex input normalization 仅作用于 main 输入 ingress | `src/main/session-input-router.ts` | `41-145` |
| Claude synthetic raw hook 可把 `ready` 推成 `running` | `tests/e2e-playwright/session-event-journey.test.ts` | `309-363` |
| Claude synthetic raw hook 可把 session 推成 `blocked` | `tests/e2e-playwright/session-event-journey.test.ts` | `370-419` |
| Claude backend synthetic hook lifecycle 已覆盖 `ready -> running -> blocked -> running -> complete -> ready` | `tests/e2e/backend-lifecycle.test.ts` | `774-810` |
| E2E fixture 可直接读 main debug state | `tests/e2e-playwright/fixtures/electron-app.ts` | `197-203` |
| E2E fixture 可直接 POST Claude raw hook | `tests/e2e-playwright/fixtures/electron-app.ts` | `248-270` |

### Risks / Unknowns

- [!] 对真实 Claude CLI 的 live hook capture 仍然缺失。当前 repo 里已验证的是 synthetic raw hook route，不是“Claude 本体一定会发这些 hook”。
- [!] 如果真实 Claude 只发 `Stop` 而不发 `UserPromptSubmit/PreToolUse`，当前模型就会长期停在 `ready`，直到 `Stop` 才变 `complete`。
- [!] 当前 main/workspace 里已有不少未提交研究和调试改动，后续实现前需要先明确哪些调试探针要保留、哪些要清理。

## Context Handoff: Session Status Chain Decomposition

Start here: `research/2026-04-26-session-status-chain-decomposition.md`

Context only. Use the saved report as the source of truth.
