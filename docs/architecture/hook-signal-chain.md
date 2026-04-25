# Hook Signal Chain

This document traces the complete signal propagation path from each CLI provider to the renderer UI, and annotates which links are verified by automated tests or live CLI capture.

## Signal Chain Overview

All providers converge on a shared downstream pipeline after producing a `CanonicalSessionEvent`:

```
CLI Provider ──transport──▶ Sidecar Script ──HTTP──▶ Webhook Server ──adapt──▶ CanonicalSessionEvent
                                                                                      │
                                                               ┌──────────────────────┤
                                                               ▼                      ▼
                                                        ① Observability      ② Session Manager
                                                          .ingest()          .applySessionEvent()
                                                               │                  │
                                                        ObservationStore    StateStore (disk)
                                                               │                  │
                                                        View Model           │
                                                        Projection           │
                                                                    │         │
                                                                    ▼         ▼
③ IPC push (real-time)
  IPC_CHANNELS.sessionEvent
        │
        ▼
Renderer (Pinia store)
        │
        ▼
    UI Update
```

## Codex Input Boundary

对 Codex 而言，上面的链路只有在 provider 真的把一次输入接受为 turn submit 后才会发生。

Windows 实测已经确认：

- 直接把整串纯文本 prompt 通过 `PTY write()` 一次性注入，并不可靠。
- 文本可能只落到 Codex draft line，而不会触发 `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `Stop`。
- 因此下游状态链路不会动，session 会停在 runtime-only 状态。

Stoa 当前对这个边界的修复策略是：

- 保持 hook / reducer / UI 状态链路不变。
- 仅在主进程输入入口，对 Codex 的纯文本输入做 provider-specific normalization。
- 纯文本 chunk 被拆成保序字符流，再进入 PTY。
- 含 `ESC` 的控制序列保持原样透传，不参与拆分。

这是一层 ingress workaround，不是状态推断逻辑。真实状态仍然必须由 provider-emitted hooks 驱动。

---

## Provider-Specific Upstream Chains

### 1. Codex — Hooks (tool-granularity)

```
codex CLI
  │ fires hook event on stdin
  ▼
hook-stoa.mjs                     [sidecar, per-workspace]
  │ reads stdin → POST raw JSON body
  ▼
POST /hooks/codex                 [webhook-server.ts:97-129]
  │ validates headers (x-stoa-session-id, x-stoa-project-id, x-stoa-secret)
  │ validates secret via getSessionSecret()
  ▼
adaptCodexHook(body, context)     [hook-event-adapter.ts:58-105]
  │ reads: hook_event_name, turn_id, tool_name, tool_use_id, model
  │ maps: SessionStart/UserPromptSubmit/PreToolUse/PostToolUse → running
  │       Stop → turn_complete
  │ produces: CanonicalSessionEvent
  ▼
[shared downstream]
```

**Events emitted**: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop

**Ingress note**: 在 Windows 上，Codex hook 是否触发取决于输入是否真的被 TUI 接受为 submit。Stoa 目前通过主进程侧的 Codex plain-text input normalization 提高这一层的可靠性；它不修改 hook payload，也不从 terminal 文本反推状态。

### 2. Codex — Notify (turn-granularity)

```
codex CLI
  │ after each agent turn, calls notify command with argv[2] = JSON payload
  ▼
notify-stoa.mjs                   [sidecar, per-workspace]
  │ filters: only agent-turn-complete events
  │ constructs CanonicalSessionEvent directly
  │ POST /events
  ▼
POST /events                      [webhook-server.ts:47-61]
  │ validates x-stoa-secret
  │ validates CanonicalSessionEvent shape
  ▼
[shared downstream]
```

**Events emitted**: agent-turn-complete (per turn, not per session)

### 3. Claude Code

```
claude-code CLI
  │ fires hook via configured command
  ▼
Settings hooks.json               [claude settings, per-workspace]
  │ invokes sidecar script
  ▼
POST /hooks/claude-code           [webhook-server.ts:63-96]
  │ validates headers + secret
  ▼
adaptClaudeCodeHook(body, ctx)    [hook-event-adapter.ts:15-56]
  │ reads: hook_event_name, session_id, tool_name, tool_use_id
  │ maps: PreToolUse → running, Stop → turn_complete
  │ produces: CanonicalSessionEvent
  ▼
[shared downstream]
```

**Events emitted**: PreToolUse, PostToolUse, Stop

### 4. OpenCode

```
opencode CLI
  │ plugin afterCommand fires
  ▼
stoa-status.ts                    [plugin, per-workspace]
  │ constructs CanonicalSessionEvent directly
  │ POST /events
  ▼
POST /events                      [webhook-server.ts:47-61]
  │ validates x-stoa-secret
  │ validates CanonicalSessionEvent shape
  ▼
[shared downstream]
```

**Events emitted**: explicit state-changing statuses only (running, turn_complete, awaiting_input, exited)

### 5. Local Shell (no hooks)

```
bash / zsh
  │ stdout/stderr → PTY
  ▼
PTY Host                          [pty-host.ts]
  │ onData callback
  ▼
Session Runtime Controller        [session-runtime-controller.ts]
  │ markSessionStarting / markSessionRunning / markSessionExited
  │ pushes IPC directly (no webhook involved)
  ▼
[shared downstream from pushSessionEvent]
```

**Events emitted**: starting, running, exited (lifecycle only)

---

## Shared Downstream

All paths produce a `CanonicalSessionEvent` which enters the shared pipeline at `SessionEventBridge.onEvent()`:

```
CanonicalSessionEvent
  │
  ▼
SessionEventBridge.onEvent()           [session-event-bridge.ts:49-57]
  │
  ├─▶ observability.ingest()           [ObservationEvent production]
  │     maps status → category/severity/retention
  │     writes to ObservationStore
  │
  ├─▶ controller.applySessionEvent()   [session-runtime-controller.ts:69-82]
  │     ├─▶ manager.applySessionEvent()
  │     │     updates session status in state-store.json (disk)
  │     │     reconciles externalSessionId
  │     │
  │     ├─▶ pushSessionEvent()
  │     │     win.webContents.send(IPC_CHANNELS.sessionEvent)
  │     │          │
  │     │          ▼
  │     │     Renderer Pinia store (workspaces.ts)
  │     │          │
  │     │     UI reactivity
  │     │
  │     └─▶ pushObservabilitySnapshots()
  │           secondary observability push for state snapshots
  │
  └─▶ onSessionStateChanged()          [callback for interested parties]
```

---

## Verification Status

### Legend

- ✅ **Test-verified**: Covered by automated unit/E2E tests that pass
- 🔬 **Live-captured**: Verified by real CLI execution with payload capture
- ⬜ **Untested**: No automated or manual verification yet
- ⚠️ **Partial**: Some paths tested, others not

### Upstream: CLI → Sidecar → Webhook Server

| Link | Codex Hooks | Codex Notify | Claude Code | OpenCode | Local Shell |
|---|---|---|---|---|---|
| CLI emits hook payload | 🔬 live-captured | ⬜ | ⬜ | ⬜ | N/A |
| Sidecar reads stdin/argv correctly | 🔬 live-captured | ✅ E2E spawn | ⬜ | ✅ E2E | N/A |
| Sidecar POSTs to correct endpoint | 🔬 live-captured | ✅ E2E spawn | ⬜ | ✅ E2E | N/A |
| Webhook receives & authenticates | ✅ 34 tests | ✅ 34 tests | ✅ 34 tests | ✅ 34 tests | N/A |

### Adapter: Raw Payload → CanonicalSessionEvent

| Adapter Function | Test Coverage | Live Capture |
|---|---|---|
| `adaptCodexHook()` — SessionStart | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — UserPromptSubmit | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — PreToolUse (tool_name, tool_use_id) | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — PostToolUse (tool_name, tool_use_id, model) | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — Stop → turn_complete | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — unknown event → null | ✅ unit test | 🔬 captured (PostToolResult) |
| `adaptCodexHook()` — UUID fallback when no turn_id | ✅ unit test | 🔬 captured (SessionStart) |
| `adaptClaudeCodeHook()` — all branches | ✅ 6 unit tests | ⬜ |
| notify-stoa.mjs — agent-turn-complete construction | ✅ E2E spawn | ⬜ |
| notify-stoa.mjs — non-agent event silently exits | ✅ E2E spawn | ⬜ |

### Field Naming Verification (snake_case)

| Field | Expected by Adapter | Real Codex Payload | Match |
|---|---|---|---|
| `hook_event_name` | `body.hook_event_name` | 🔬 `"SessionStart"`, `"PreToolUse"`, etc. | ✅ |
| `turn_id` | `body.turn_id` | 🔬 UUID or absent | ✅ |
| `tool_name` | `body.tool_name` | 🔬 `"Bash"` or absent | ✅ |
| `tool_use_id` | `body.tool_use_id` | 🔬 `"call_..."` or absent | ✅ |
| `model` | `body.model` | 🔬 `"gpt-5.4"` | ✅ |
| `session_id` | not used by adapter (uses context) | 🔬 UUID present in payload | N/A |
| `tool_input` | not read by adapter | 🔬 `{command: "..."}` | ⬜ unread |
| `tool_response` | not read by adapter | 🔬 string | ⬜ unread |
| `last_assistant_message` | not read by adapter (Stop hook) | 🔬 present in Stop payload | ⬜ unread |
| `permission_mode` | not read by adapter | 🔬 `"bypassPermissions"` | ⬜ unread |
| `stop_hook_active` | not read by adapter | 🔬 `false` | ⬜ unread |

### Downstream: CanonicalSessionEvent → UI

| Link | Test Coverage |
|---|---|
| `SessionEventBridge.onEvent()` → observability ingest | ✅ bridge unit test |
| `SessionEventBridge.onEvent()` → applySessionEvent | ✅ bridge unit test |
| `SessionEventBridge.toObservationEvent()` — status mapping | ✅ bridge unit test |
| `SessionEventBridge` — secret validation round-trip | ✅ bridge unit test |
| `controller.applySessionEvent()` — state update + IPC push | ✅ controller unit test |
| `manager.applySessionEvent()` — disk persistence | ✅ E2E backend-lifecycle |
| `manager.applySessionEvent()` — externalSessionId reconciliation | ✅ E2E webhook-runtime-integration |
| IPC → Renderer store hydration | ✅ E2E frontend-store-projection |
| Store → UI computed properties | ✅ E2E frontend-store-projection |

### Sidecar File Generation

| File | Test Coverage |
|---|---|
| `.codex/hooks.json` — 5 event registrations | ✅ E2E provider-integration |
| `.codex/config.toml` — codex_hooks feature flag | ✅ E2E provider-integration |
| `.codex/hook-stoa.mjs` — correct content | ✅ E2E provider-integration |
| `.codex/notify-stoa.mjs` — correct content | ✅ E2E provider-integration |
| `.codex/notify-stoa.mjs` — last-assistant-message as snippet | ✅ E2E provider-integration |
| `.claude/settings.json` — hooks config | ✅ E2E provider-integration |
| `.opencode/plugins/stoa-status.ts` — correct content | ✅ E2E provider-integration |
| Shared sidecar reads session identity from env (not baked) | ✅ E2E all providers |
| Double install keeps shared plugin without session-baked values | ✅ E2E opencode |

### E2E Spawn Trigger Tests (real process execution)

| Test | Status |
|---|---|
| hook-stoa.mjs + SessionStart → event delivered | ✅ pass |
| hook-stoa.mjs + PreToolUse → tool details delivered | ✅ pass |
| hook-stoa.mjs + Stop → turn_complete produced | ✅ pass |
| hook-stoa.mjs without env vars → silent exit, no events | ✅ pass |
| hook-stoa.mjs with wrong secret → no events | ✅ pass |
| notify-stoa.mjs + agent-turn-complete → event delivered | ✅ pass |
| notify-stoa.mjs + non-agent event → silent exit | ✅ pass |
| notify-stoa.mjs without env vars → silent exit | ✅ pass |

---

## Known Gaps

### Unread Fields in Codex Hook Payloads

The following fields are present in real Codex payloads but not consumed by `adaptCodexHook`:

| Field | Present In | Potential Use |
|---|---|---|
| `tool_input` | PreToolUse, PostToolUse | Display command before execution |
| `tool_response` | PostToolUse | Show tool output in session detail |
| `last_assistant_message` | Stop | Session summary, turn content |
| `permission_mode` | All events | Capability detection |
| `stop_hook_active` | Stop | Hook chain control |
| `prompt` | UserPromptSubmit | User intent display |
| `source` | SessionStart | Distinguish startup vs resume |
| `transcript_path` | All events | Session file location |

### Untested Paths

- Claude Code: No live CLI capture or E2E spawn test (requires Claude Code CLI installed)
- OpenCode: No live CLI capture (requires opencode installed)
- Codex notify: No live CLI capture (notify didn't fire in exec mode — only fires in interactive multi-turn sessions)
- `tool_input` / `tool_response` fields: Present in payloads but not forwarded through adapter

---

## Test File Index

| File | Tests | Covers |
|---|---|---|
| `src/core/hook-event-adapter.test.ts` | 14 | adaptCodexHook + adaptClaudeCodeHook unit tests |
| `src/core/webhook-server.test.ts` | 6 | Webhook server endpoint tests (auth, validation) |
| `src/core/webhook-server-validation.test.ts` | 28 | All event validation rejection branches |
| `src/main/session-event-bridge.test.ts` | 6 | Bridge: secret, adapt, observability, IPC |
| `src/main/session-runtime-controller.test.ts` | 11 | Controller: state update + IPC push |
| `tests/e2e/provider-integration.test.ts` | 59 | Provider registry, command building, sidecar generation, spawn triggers |
| `tests/e2e/webhook-runtime-integration.test.ts` | 7 | Full webhook→manager→state pipeline with real disk |
| `tests/e2e/backend-lifecycle.test.ts` | 19 | Full backend lifecycle including session runtime |
| `tests/e2e/frontend-store-projection.test.ts` | 14 | Real backend → Pinia store → computed properties |
