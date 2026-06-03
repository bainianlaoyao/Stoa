---
date: 2026-06-02
topic: SessionSupervisor / SessionControlServer / API handler test audit (wait, output/replay, completion report)
status: completed
mode: context-gathering
sources: 18
---

## Context Report: SessionSupervisor + SessionControlServer + API Handler Test Audit (wait / output-replay / completion-report)

### Why This Was Gathered
Downstream implementation will add three new control-plane capabilities — synchronous `wait` for terminal/phase transitions, structured `output` / `replay` access, and a `completion report` surface — to `SessionSupervisor` and `SessionControlServer`. The receiving agent needs a cited, current map of (a) which paths are already covered by passing tests, (b) which code paths exist for these features, and (c) the minimal failing tests that will lock the new behavior in. This report stays read-only and surfaces gaps only.

### Summary
The control plane has 7 working endpoints (`/ctl/health`, `/whoami`, `/capabilities`, `/session/list`, `/session/:id/inspect`, `/session/:id/prompt`, `/session/:id/destroy`, `/session/create`) and `SessionSupervisor` exposes 5 verbs (`listSessions`, `inspectSession`, `promptSession`, `createChildSession`, `destroySession`). None of these currently support `wait`, `output`/`replay`, or `completion report`. The runtime does have a separate IPC channel `session:terminal-replay` backed by `SessionRuntimeController.getTerminalReplay()` (`src/main/session-runtime-controller.ts:129-131`), but that backlog is **not** plumbed through `SessionSupervisorDeps` or `SessionControlServerDeps`. Completion reporting exists as state (`SessionSummary.hasUnseenCompletion`, `lastTurnOutcome`, `lastStateSequence`, `summary`) plus the `agent.turn_completed` reducer branch (`src/shared/session-state-reducer.ts:146-159`), but there is no structured payload method anywhere. The minimal new failing tests are listed in §"Minimal new failing tests needed".

### Key Findings
- `SessionSupervisor` (lines `src/core/session-supervisor.ts:37-121`) has 5 verbs — `listSessions`, `inspectSession`, `promptSession`, `createChildSession`, `destroySession` — and 1 error type `SessionControlError` with codes `unknown_session` | `forbidden_authority_scope`. No `wait`, no `getOutput`, no `getCompletionReport`.
- `SessionSupervisorDeps` (lines `src/core/session-supervisor.ts:19-25`) requires `getSnapshot`, `visibilityService`, `sessionInput`, `createChildSession`, `destroySession`. No `getTerminalReplay`, no `waitForState`, no completion-summary accessor.
- `SessionControlServer` (`src/core/session-control-server.ts`) wires exactly 7 endpoints and one `capabilities.supports` block listing `health`, `sessionList`, `sessionInspect`, `sessionPrompt`, `sessionCreate`, `sessionDestroy` (`src/core/session-control-server.ts:85-97`). Anything new must add both a route and a capability flag.
- Terminal replay exists but is renderer-only: `IPC_CHANNELS.sessionTerminalReplay` (`src/core/ipc-channels.ts:8`) → `ipcMain.handle(IPC_CHANNELS.sessionTerminalReplay, ...)` in `src/main/index.ts:1287-1289` → `SessionRuntimeController.getTerminalReplay(sessionId)` (`src/main/session-runtime-controller.ts:129-131`). Backlog is bounded to 250 000 chars and trimmed safely across CSI / OSC / generic ESC boundaries (`src/main/session-runtime-controller.ts:169-331`).
- Completion surface is *state-only*: `hasUnseenCompletion`, `lastTurnOutcome`, `turnEpoch`, `turnState`, `summary`, `runtimeExitCode` on `SessionSummary` (`src/shared/project-session.ts` — types only referenced by tests). The reducer flips `hasUnseenCompletion = true` on `agent.turn_completed` and clears it on `agent.completion_seen` (`src/shared/session-state-reducer.ts:146-159, 196-198`). Nothing in the codebase produces a structured completion payload (no last-assistant-message, tool-name, evidence path) as an API response.
- `wait` is absent end-to-end. The closest pattern in the codebase is the in-process polling helper `waitForValue` used only by the packaged smoke flow in `src/main/index.ts:1093-1096`, not by `SessionSupervisor` or `SessionControlServer`.
- `meta-session-control-server` (`src/core/meta-session-control-server.ts`) already exposes a `/ctl/state/brief` route that delegates to `MetaSessionContextAssembler` (`src/core/meta-session-context-exporter.ts:60`), which already calls `runtimeController.getTerminalReplay(sessionId)` and feeds it as `terminalReplay` into the assembled brief (`src/core/session-context-exporter.ts:60-70, 117-139`). The control server does not.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionSupervisor` has 5 verbs, no wait/output/replay/completion-report | `src/core/session-supervisor.ts` | lines 37-121 |
| `SessionSupervisorDeps` is 5 fields; no replay or completion deps | `src/core/session-supervisor.ts` | lines 19-25 |
| `SessionControlServerDeps` extends `SessionSupervisorDeps` plus `ctlSecret` + `sessionTokenRegistry` | `src/core/session-control-server.ts` | lines 7-10 |
| 7 control-server routes + capability list | `src/core/session-control-server.ts` | lines 72-97, 99-282 |
| `getTerminalReplay` is in `SessionRuntimeController`, returns backlog string | `src/main/session-runtime-controller.ts` | lines 78-86, 129-131, 169-331 |
| Terminal backlog capped at 250 000 chars, ANSI-safe trim | `src/main/session-runtime-controller.ts` | lines 169-331 |
| IPC channel `session:terminal-replay` registered in main | `src/main/index.ts` | lines 1287-1289 |
| Preload exposes `getTerminalReplay` only over IPC | `src/preload/index.ts` | lines 80-82 |
| `SessionSummary` carries `hasUnseenCompletion`, `lastTurnOutcome`, `turnEpoch`, `summary` | `src/shared/project-session.ts` (types used in tests) | e.g. `src/core/session-supervisor.test.ts:6-34` |
| Reducer sets `hasUnseenCompletion = true` on `agent.turn_completed` | `src/shared/session-state-reducer.ts` | lines 146-159 |
| Reducer clears `hasUnseenCompletion` on `agent.completion_seen` | `src/shared/session-state-reducer.ts` | lines 196-198 |
| `SessionEventBridge` enqueues events, generates `SessionStatePatchEvent` sequences | `src/main/session-event-bridge.ts` | lines 149-366 |
| `SessionRuntimeController` tests already lock terminal replay behavior (capacity, ANSI trim) | `src/main/session-runtime-controller.test.ts` | lines 372-447 |
| Existing supervisor tests cover the 5 current verbs, auth, and 404/403 codes | `src/core/session-supervisor.test.ts`, `src/core/session-control-server.test.ts` | full files (318 + 469 lines) |
| Meta-session control server already returns assembled brief including `terminalReplay` | `src/core/meta-session-control-server.ts`, `src/core/session-context-exporter.ts` | exporter lines 60-70, 117-139 |
| `waitForValue` exists as a private helper in main, not a supervisor primitive | `src/main/index.ts` | lines 1093-1096 |
| `SessionEventBridge` dispatches `agent.turn_completed` observability event for completion | `src/main/session-event-bridge.ts` | lines 760-794 (`mapIntentToObservation`) |
| `applyProviderStatePatch` test asserts `hasUnseenCompletion: true` on completion | `src/main/session-runtime-controller.test.ts` | lines 138-167, 204-233 |

### Tests already covering related areas (so any new test must be additive, not duplicative)

**Supervisor verbs (`src/core/session-supervisor.test.ts`)**
- `listSessions` for local-user and session caller (lines 88-108)
- `inspectSession` for existing / missing / invisible (lines 110-136)
- `promptSession` dispatch + 4 rejection paths (lines 138-193)
- `createChildSession` local-user root + child, session-caller rewrite, authority + unknown rejection (lines 195-264)
- `destroySession` local-user + session-caller descendant + peer rejection (lines 266-316)

**Control server routes (`src/core/session-control-server.test.ts`)**
- Auth: secret / session token / invalid / unknown (lines 131-161)
- `/ctl/health`, `/ctl/whoami`, `/ctl/capabilities` (lines 163-202)
- `/ctl/session/list` (lines 204-212)
- `/ctl/session/:id/inspect` — 200, 404, 404 from invisible (lines 214-245)
- `/ctl/session/:id/prompt` — 200, 403, 404 (lines 247-286)
- `/ctl/session/:id/destroy` — 200, 403 (lines 288-312)
- `/ctl/session/create` — 9 paths covering local-user root, child, missing projectId, type validation, session-caller, runtime snapshot mutation (lines 314-468)

**Terminal replay and runtime patches (control plane side)**
- `getTerminalReplay` returns backlog, isolation, ANSI-safe CSI / OSC / ESC trimming: `src/main/session-runtime-controller.test.ts:372-447`
- `markRuntimeExited` preserves `hasUnseenCompletion: true` and pushes a `phase: 'complete'` presence snapshot: `src/main/session-runtime-controller.test.ts:138-167`
- `setActiveSession` on a complete session transitions to `phase: 'ready'` and clears unseen flag: `src/main/session-runtime-controller.test.ts:204-233`

**What is NOT yet covered (gaps that justify the new failing tests)**
1. No `SessionSupervisor.wait(...)` method, no `getOutput(...)` / `getReplay(...)` method, no `getCompletionReport(...)` method.
2. No HTTP endpoint on `SessionControlServer` exposes the existing terminal replay backlog to non-renderer callers.
3. No HTTP endpoint returns a structured completion report (turnEpoch, lastTurnOutcome, hasUnseenCompletion, summary, runtimeExitCode, lastStateSequence, evidenceRefs).
4. No supervisor-level rejection codes for wait-timeouts or replay-for-unknown-session, so no 404/408/403 contract to lock.
5. No `capabilities.supports` flags for `wait`, `output`, `completionReport` (`src/core/session-control-server.ts:85-97`).
6. No `SessionSupervisorDeps` injection point for an output/replay source or a completion-report builder.

### Minimal new failing tests needed

> Naming assumes the new surface lands in `SessionSupervisor` and `SessionControlServer` consistent with current verb / route shape. Adjust when contracts are finalized.

**A. `SessionSupervisor` — wait**
1. `await supervisor.wait(caller, sessionId, { until: 'complete', timeoutMs: 5000 })` resolves with `{ kind: 'complete', lastTurnOutcome: 'completed' }` once a `turn_completed` patch lands.
2. Rejects `unknown_session` for missing target (matches current error code at `src/core/session-supervisor.ts:97-105`).
3. For session-caller, throws `forbidden_authority_scope` when authority is denied.
4. Times out with `wait_timeout` (new code) and returns the last-seen phase snapshot.
5. Returns immediately when target is already in requested phase.
6. Rejects unknown `until` value with `invalid_request` (new code).

**B. `SessionSupervisor` — output / replay**
1. `await supervisor.getOutput(caller, sessionId)` returns the trimmed backlog string.
2. Filters backlog for an unrelated sessionId (isolation guarantee, parallel to `getTerminalReplay keeps session backlogs isolated` at `src/main/session-runtime-controller.test.ts:383-393`).
3. Enforces `MAX_TERMINAL_BACKLOG_CHARS` (250 000) and trims without exposing a partial CSI / OSC / ESC sequence — three sub-cases mirroring the controller's tests at `src/main/session-runtime-controller.test.ts:395-447`.
4. Returns empty string for unknown session instead of throwing (current `inspectSession` returns `null`; supervisors should pick a documented contract for the new verb).
5. Throws `forbidden_authority_scope` when session-caller target is outside visibility.
6. Throws `unknown_session` when the session never existed.

**C. `SessionSupervisor` — completion report**
1. After `agent.turn_completed` is applied, `getCompletionReport(caller, sessionId)` returns `{ turnEpoch, lastTurnOutcome, hasUnseenCompletion, summary, runtimeExitCode, runtimeExitReason, lastStateSequence, occurredAt }`.
2. Throws `forbidden_authority_scope` for unauthorized session-caller.
3. Throws `unknown_session` for missing session.
4. Returns `null` (or new code `no_completion_yet`) when `hasUnseenCompletion === false` — pin contract explicitly.
5. Honors `agent.completion_seen` reduction: subsequent call reflects cleared flag.

**D. `SessionControlServer` — three new HTTP routes + capability flags**
1. `GET /ctl/session/:id/wait?until=complete&timeoutMs=5000` returns `{ ok, data: { kind, lastTurnOutcome } }` with `200` for success and `408` for timeout.
2. `GET /ctl/session/:id/output` returns the trimmed backlog; `404` for unknown, `403` for forbidden.
3. `GET /ctl/session/:id/completion-report` returns the structured completion payload; `404` for unknown, `409` (`no_completion_yet`) when nothing is pending, `403` for forbidden.
4. `GET /ctl/capabilities` lists the new flags: `sessionWait`, `sessionOutput`, `sessionCompletionReport`.
5. Auth still required: unauthenticated request → `401` on the new routes (mirrors `auth` block at `src/core/session-control-server.test.ts:131-161`).
6. Session-caller token still gates the new routes (mirrors prompt test at `src/core/session-control-server.test.ts:256-285`).

**E. `SessionControlServerDeps` injection smoke (failing until deps grow)**
1. `createSessionControlServer` requires a `getOutput` or `terminalReplayProvider` dep on `SessionSupervisorDeps` — failing today because the dep is not declared (`src/core/session-supervisor.ts:19-25`).
2. Passing in a `getOutput` dep without wiring the route returns backlog as `''` on the future route (regression guard against forgetting to register the route).

### Risks / Unknowns
- [!] Contract for `wait` timeouts (`408` vs custom code `wait_timeout`) and for `output` on unknown session (empty string vs `null` vs 404) is **not** locked in any spec — pick one before writing the tests or they will drift.
- [!] The terminal-replay backlog lives in `SessionRuntimeController` (process-memory). Routing it through `SessionControlServer` requires either (a) injecting the controller into `SessionSupervisorDeps` or (b) introducing a new `terminalReplayProvider` port. Either way, the test must inject a fake provider, because the controller is not directly composable in the current `createSessionControlServer` signature (`src/core/session-control-server.ts:43-47`).
- [!] Completion report has no agreed schema. Tests should pin the *minimal* field set, leaving extras to later work, to avoid blocking refactors.
- [?] Existing `agent.completion_seen` patches arrive from the renderer via `setActiveSession` (`src/core/project-session-manager.ts:453-463`) and from a direct supervisor call; test for the report must not assume a single entry path.
- [?] Whether `wait` is event-driven (subscribe to `SessionEventBridge`) or polling (`setInterval` reading `SessionSummary.turnState`) is undecided; tests above do not assume either, only that the verb resolves within the timeout when a transition occurs.
- [?] The current `SessionControlServer` is loopback-only (`controlTransport: 'loopback-http'` at `src/core/session-control-server.ts:88`), so auth scope questions for the new routes are bounded to the existing two caller types (`local-user`, `session`).

### Recommended next step
Implement the three new supervisor verbs first, then the three HTTP routes, with the new capability flags, then convert the test list in §"Minimal new failing tests needed" into Vitest cases. Keep all new tests in `src/core/session-supervisor.test.ts` and `src/core/session-control-server.test.ts` (TDD: write each test, watch it fail, then add the smallest production change that makes it pass). Do not touch `SessionRuntimeController`'s existing replay behavior — the supervisor-side tests should be additive and exercise a dep seam, not a refactor of the controller.
