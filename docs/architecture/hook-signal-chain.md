# Hook Signal Chain

This document traces the complete signal propagation path from each CLI provider to the renderer UI, and annotates which links are verified by automated tests or live CLI capture.

## Signal Chain Overview

All providers converge on a shared downstream pipeline after producing a `CanonicalSessionEvent`:

```
CLI Provider ──transport──▶ Sidecar / Direct HTTP ──webhook──▶ Adapter ──▶ CanonicalSessionEvent
                                                                               │
                                                                               ▼
                                                        SessionEventBridge.enqueueSessionEvent()
                                                                               │
                                        ┌──────────────────────────────────────┴──────────────────────────────────────┐
                                        ▼                                                                             ▼
                         ① State path (authoritative for phase)                                     ② Evidence path (supplemental)
                         toSessionStatePatch()                                                       toObservationEvent()
                         → controller.applyProviderStatePatch()                                      → observability.ingest()
                         → manager.applySessionStatePatch()                                          → ObservationStore / evidence cache
                         → reduceSessionState()                                                      → enrich model/snippet metadata
                         → SessionSummary
                                        │                                                                             │
                                        └──────────────────────────────┬──────────────────────────────────────────────┘
                                                                       ▼
                                                     buildSessionPresenceSnapshot()
                                                                       │
                                                                       ▼
                                             IPC push (observability presence snapshots only)
                                                                       │
                                                                       ▼
                                                         Renderer store / row view model / UI
```

## Critical Boundary: PTY Input Is Not Equivalent To A Provider Turn

The diagram above only applies after the provider has actually emitted a structured event. For interactive providers, there is an earlier boundary that matters just as much:

```
Renderer keyboard / preload API
  ▼
PTY write()
  ▼
provider TUI accepts the input as a real submit
  ▼
provider hook / sidecar event fires
```

For Codex on Windows, we now have concrete counter-evidence that `PTY write()` is not a reliable proxy for “a turn really started”:

- In live Electron, `window.stoa.sendSessionInput(sessionId, 'Reply with exactly OK.\\r')` reaches `ptyHost.write(...)`.
- The Codex TUI redraws the draft input line, proving the bytes reached the process.
- But no `UserPromptSubmit`, `PreToolUse`, `Stop`, or notify webhook arrives.
- Session state stays at `runtimeState: alive`, `agentState: unknown`, `lastStateSequence: 2`.
- The same behavior reproduces in a standalone Windows `node-pty` script outside Electron.

So the broken link is upstream of the reducer and renderer:

`PTY write()` → `provider TUI accepts the input as a real submit`
 
Current Stoa mitigation for this boundary is intentionally narrow:

- keep the hook, reducer, and UI state pipeline unchanged
- normalize Codex plain-text multi-character input at the main-process ingress before PTY write
- split plain-text chunks into an ordered character stream
- keep control sequences containing `ESC` raw and unsplit

This is an ingress workaround, not state inference. Real session state still has to come from provider-emitted hooks.

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
POST /hooks/codex                 [webhook-server.ts:184-216]
  │ validates headers (x-stoa-session-id, x-stoa-project-id, x-stoa-secret)
  │ validates secret via getSessionSecret()
  ▼
adaptCodexHook(body, context)     [hook-event-adapter.ts:49-89]
  │ reads: hook_event_name, turn_id, tool_name, tool_use_id, model, thread_id
  │ maps: SessionStart/UserPromptSubmit → agent.turn_started / working
  │       PreToolUse/PostToolUse → agent.tool_started / working
  │       Stop → agent.turn_completed / idle
  │ produces: CanonicalSessionEvent
  ▼
[shared downstream]
```

**Events emitted**: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop

**Important runtime caveat**: this chain only runs once Codex itself decides a turn has started. On Windows, driving the interactive Codex TUI through `node-pty.write(...)` can leave text sitting in the draft input without actually submitting the turn. In that failure mode, none of the hook events above fire, so downstream session state stays at runtime-only `alive/unknown`. Stoa now improves this boundary by normalizing Codex plain-text input before PTY write, but it still does not infer state from terminal text or mutate hook payloads.

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
POST /events                      [webhook-server.ts:134-148]
  │ validates x-stoa-secret
  │ validates CanonicalSessionEvent shape
  ▼
[shared downstream]
```

**Events emitted**: agent-turn-complete (per turn, not per session)

### 3. Claude Code

```
claude-code CLI
   │ interpolates ${STOA_*} env vars into headers
   │ HTTP POST directly to webhook (no sidecar)
   ▼
POST /hooks/claude-code           [webhook-server.ts:150-182]
   │ validates headers (x-stoa-session-id, x-stoa-project-id, x-stoa-secret)
   │ validates secret via getSessionSecret()
   ▼
adaptClaudeCodeHook(body, ctx)    [hook-event-adapter.ts:4-47]
   │ reads: hook_event_name, session_id, tool_name, last_assistant_message, stop_hook_active
   │ maps: UserPromptSubmit → agent.turn_started/working
   │       PreToolUse → agent.tool_started/working
   │       PermissionRequest → agent.permission_requested/blocked
   │       Stop → agent.turn_completed/idle
   │       StopFailure → agent.turn_failed/error
   │ produces: CanonicalSessionEvent
   ▼
[shared downstream]
```

**Events emitted**: UserPromptSubmit, PreToolUse, Stop, StopFailure, PermissionRequest (no PostToolUse — Claude Code hooks API doesn't have it)

**Verification note**: the mapping above is code-level truth (`hook-event-adapter.ts`), but Claude Code has no live CLI capture in this repo yet. We have unit coverage for the adapter branches, not proof that real Claude runs reliably deliver the `UserPromptSubmit` / `PreToolUse` events that are required to move a session from `idle`/UI `ready` to `working`/UI `running`.

### 4. OpenCode

```
opencode CLI
  │ plugin afterCommand fires
  ▼
stoa-status.ts                    [plugin, per-workspace]
  │ constructs CanonicalSessionEvent directly
  │ POST /events
  ▼
POST /events                      [webhook-server.ts:134-148]
  │ validates x-stoa-secret
  │ validates CanonicalSessionEvent shape
  ▼
[shared downstream]
```

**Events emitted**: explicit state-changing events only (agent.turn_completed, agent.permission_requested, agent.permission_resolved, agent.turn_failed)

### 5. Local Shell (no hooks)

```
bash / zsh
  │ stdout/stderr → PTY
  ▼
PTY Host                          [pty-host.ts]
  │ onData callback
  ▼
Session Runtime Controller        [session-runtime-controller.ts]
  │ markRuntimeStarting / markRuntimeAlive / markRuntimeExited
  │ pushes IPC directly (no webhook involved)
  ▼
[shared downstream from session summary + observability snapshot pushes]
```

**Events emitted**: runtime.created, runtime.starting, runtime.alive, runtime.exited_clean (lifecycle only)

---

## Shared Downstream

All provider hooks and sidecars eventually produce a `CanonicalSessionEvent`. From that point onward, the repo has two parallel downstream paths with different responsibilities:

### 1. State path — the authoritative source of session phase

This path is what actually determines whether the UI is `preparing`, `running`, `ready`, `complete`, `blocked`, `failed`, or `exited`.

```
CanonicalSessionEvent
  │
  ▼
SessionEventBridge.enqueueSessionEvent()     [session-event-bridge.ts]
  │
  ▼
toSessionStatePatch()
  │
  ▼
controller.applyProviderStatePatch()         [session-runtime-controller.ts]
  │
  ▼
manager.applySessionStatePatch()             [project-session-manager.ts]
  │
  ▼
reduceSessionState()                         [session-state-reducer.ts]
  │
  ▼
SessionSummary persisted to state store
  │
  ▼
buildSessionPresenceSnapshot()               [observability-projection.ts]
  │
  ▼
ObservabilityService.pushObservabilitySnapshots()
  │
  ▼
IPC push via observabilitySessionPresenceChanged → renderer store.applySessionPresenceSnapshot()
```

Important detail: `derivePresencePhase()` reads from reduced session state (`runtimeState`, `agentState`, `hasUnseenCompletion`, exit metadata). `observability.ingest()` does not directly set the phase. The renderer does **not** derive phase locally — it consumes the pre-computed `SessionPresenceSnapshot` from the backend.

### 2. Evidence path — metadata enrichment only

This path adds supporting evidence such as model label or assistant snippet, but it is not the primary state machine for phase transitions.

```
CanonicalSessionEvent
  │
  ▼
SessionEventBridge.toObservationEvent()
  │
  ▼
observability.ingest()                       [observability-service.ts]
  │
  ▼
ObservationStore append + evidence cache update
  │
  ▼
ObservabilityService.rebuildSnapshots()
  │
  ▼
buildSessionPresenceSnapshot() with enriched evidence
```

Important detail: `ObservabilityService` rebuilds presence snapshots from `SessionSummary` plus evidence. Evidence can enrich the snapshot, but phase still derives from reduced session state.

### 3. Renderer fallback behavior

The renderer consumes backend-pushed presence snapshots via `applySessionPresenceSnapshot()`. If a backend snapshot is unavailable for a session during initial hydration, `workspaces.ts` locally calls `buildSessionPresenceSnapshot(session, ...)` from the current `SessionSummary`. This fallback still derives phase from the reduced session state, not from raw observation events.

There is no longer a separate `sessionEvent` IPC channel. All status updates flow through the single `observabilitySessionPresenceChanged` channel.

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
| Sidecar reads stdin/argv correctly | 🔬 live-captured | ✅ E2E spawn | N/A (direct HTTP hook) | ✅ E2E | N/A |
| Sidecar POSTs to correct endpoint | 🔬 live-captured | ✅ E2E spawn | N/A (direct HTTP hook) | ✅ E2E | N/A |
| Webhook receives & authenticates | ✅ 34 tests | ✅ 34 tests | ✅ 34 tests | ✅ 34 tests | N/A |

### Interactive Ingress: UI / PTY → Actual Provider Turn

This link sits before the table above. It decides whether the provider ever emits any structured event at all.

| Link | Codex | Claude Code | OpenCode | Local Shell |
|---|---|---|---|---|
| Renderer keyboard / preload API reaches `pty.write()` | 🔬 verified in live Electron | ⬜ | ⬜ | ✅ E2E |
| `pty.write()` text appears in provider TUI draft/input | 🔬 verified in live Electron and standalone `node-pty` | ⬜ | ⬜ | ✅ E2E |
| Provider treats PTY-written submit as a real turn start | ❌ currently disproven on Windows live Codex (`codex-cli 0.125.0`) | ⬜ | ⬜ | ✅ E2E shell commands execute |

This distinction matters because the current green tests only verify sidecar execution and webhook ingestion once a structured event already exists. They do not prove that a real interactive Codex session driven through PTY input will ever emit those events.

### Adapter: Raw Payload → CanonicalSessionEvent

| Adapter Function | Test Coverage | Live Capture |
|---|---|---|
| `adaptCodexHook()` — SessionStart | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — UserPromptSubmit | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — PreToolUse (tool_name, tool_use_id) | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — PostToolUse (tool_name, tool_use_id, model) | ✅ unit test | 🔬 captured |
| `adaptCodexHook()` — Stop → agent.turn_completed/idle | ✅ unit test | 🔬 captured |
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
| `thread_id` | `body.thread_id` → `externalSessionId` | 🔬 present in hook payloads | ✅ |
| `tool_input` | not read by adapter | 🔬 `{command: "..."}` | ⬜ unread |
| `tool_response` | not read by adapter | 🔬 string | ⬜ unread |
| `last_assistant_message` | not read by adapter (Stop hook) | 🔬 present in Stop payload | ⬜ unread |
| `permission_mode` | not read by adapter | 🔬 `"bypassPermissions"` | ⬜ unread |
| `stop_hook_active` | not read by adapter | 🔬 `false` | ⬜ unread |

### Downstream: CanonicalSessionEvent → UI

| Link | Test Coverage |
|---|---|
| `SessionEventBridge.enqueueSessionEvent()` → observability ingest | ✅ bridge unit test |
| `SessionEventBridge.enqueueSessionEvent()` → controller.applyProviderStatePatch | ✅ bridge unit test |
| `SessionEventBridge.toObservationEvent()` — intent mapping | ✅ bridge unit test |
| `SessionEventBridge` — secret validation round-trip | ✅ bridge unit test |
| `controller.applyProviderStatePatch()` — state update + IPC push | ✅ controller unit test |
| `manager.applySessionStatePatch()` — disk persistence | ✅ E2E backend-lifecycle |
| `manager.applySessionStatePatch()` — externalSessionId reconciliation | ✅ E2E webhook-runtime-integration |
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
| `.claude/settings.local.json` — HTTP hooks config | ✅ E2E provider-integration |
| `.opencode/plugins/stoa-status.ts` — correct content | ✅ E2E provider-integration |
| Shared sidecar reads session identity from env (not baked) | ✅ E2E all providers |
| Double install keeps shared plugin without session-baked values | ✅ E2E opencode |

### E2E Spawn Trigger Tests (real process execution)

| Test | Status |
|---|---|
| hook-stoa.mjs + SessionStart → event delivered | ✅ pass |
| hook-stoa.mjs + PreToolUse → tool details delivered | ✅ pass |
| hook-stoa.mjs + Stop → agent.turn_completed produced | ✅ pass |
| hook-stoa.mjs without env vars → silent exit, no events | ✅ pass |
| hook-stoa.mjs with wrong secret → no events | ✅ pass |
| notify-stoa.mjs + agent-turn-complete → event delivered | ✅ pass |
| notify-stoa.mjs + non-agent event → silent exit | ✅ pass |
| notify-stoa.mjs without env vars → silent exit | ✅ pass |

---

## Known Gaps

### Proven Codex Runtime Gap: interactive PTY submit on Windows

- Current documentation and tests previously overstated the certainty of the Codex hook chain.
- We have now reproduced a stricter failure:
  - Codex boots normally in the Stoa terminal.
  - Prompt text written through PTY appears in the draft input.
  - But the submit is not accepted as a real turn.
  - Therefore `UserPromptSubmit` / `PreToolUse` / `Stop` never fire.
- This reproduces both:
  - inside the Electron app
  - in a standalone Windows `node-pty` reproduction outside Electron
- So the immediate fault is not renderer phase derivation, state reduction, or webhook parsing.
- Any future architecture doc must separate:
  - provider ingress reliability
  - structured event parsing
  - session state reduction

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

### Known Claude Code failure mode

- The current implementation assumes Claude `UserPromptSubmit` or `PreToolUse` will arrive before `Stop` and move `agentState` to `working`.
- That assumption is covered by unit tests and synthetic event-path tests, but not by live Claude capture in this repo.
- If real Claude runs do not reliably emit those running-causing hooks, the reducer will leave the session at `agentState = idle`, and the UI will stay at phase `ready` except when a later `PermissionRequest`, `Stop`, or `StopFailure` arrives.

---

## Test File Index

| File | Tests | Covers |
|---|---|---|
| `src/core/hook-event-adapter.test.ts` | 14 | adaptCodexHook + adaptClaudeCodeHook unit tests |
| `src/core/webhook-server.test.ts` | 6 | Webhook server endpoint tests (auth, validation) |
| `src/core/webhook-server-validation.test.ts` | 28 | All event validation rejection branches |
| `src/main/session-event-bridge.test.ts` | 8 | Bridge: secret, adapt, observability, IPC |
| `src/main/session-runtime-controller.test.ts` | 11 | Controller: state update + IPC push |
| `tests/e2e/provider-integration.test.ts` | 59 | Provider registry, command building, sidecar generation, spawn triggers |
| `tests/e2e/webhook-runtime-integration.test.ts` | 7 | Full webhook→manager→state pipeline with real disk |
| `tests/e2e/backend-lifecycle.test.ts` | 19 | Full backend lifecycle including session runtime |
| `tests/e2e/frontend-store-projection.test.ts` | 41 | Real backend → Pinia store → computed properties |
