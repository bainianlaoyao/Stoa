---
date: 2026-06-02
topic: control-layer-architecture-audit
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Control-Layer Architecture Audit — SessionSupervisor, SessionControlServer, Control APIs & Shared Types

### Why This Was Gathered

To understand what interfaces currently exist in the control layer, and identify what new interfaces would be needed to support:
1. **Session wait** — a parent session waiting for a child session to reach a terminal state
2. **Session output/replay** — a parent session reading the accumulated terminal output or structured output of a child session
3. **Completion report readback** — a parent session reading a structured completion result from a finished child session

### Summary

The codebase has **two control servers** mounted on the same Express app: a legacy `SessionControlServer` (work-session tree CRUD + prompt) and a newer `MetaSessionControlServer` (meta-session orchestration, proposals, dispatch, context assembly). Both are mounted inside `SessionEventBridge` via the `configureApp` hook. The `SessionSupervisor` provides authority-checked CRUD + prompt dispatch on the session tree. Terminal output replay exists via `SessionRuntimeController.getTerminalReplay()` but is **not exposed through the control HTTP API** — it is only available via IPC to the renderer. There is **no concept of "wait for completion"** or "completion report" anywhere in the control layer. All three target features would require new interfaces.

### Key Findings

#### 1. Two-Layer Control Server Architecture

There are two separate control servers:

- **`SessionControlServer`** (`src/core/session-control-server.ts`) — manages the work-session tree. Provides `list`, `inspect`, `prompt`, `create`, `destroy` endpoints under `/ctl/session/*`. Delegates to `SessionSupervisor` for authority checks.
- **`MetaSessionControlServer`** (`src/core/meta-session-control-server.ts`) — manages meta-sessions (orchestrator agents), work-session lifecycle, proposals/approvals, context assembly, and dispatch. Provides `/ctl/work-sessions/*`, `/ctl/meta-sessions/*`, `/ctl/proposals/*`, `/ctl/dispatch/*`.

Both are mounted on the same Express app inside `SessionEventBridge` via the `configureApp` callback (`src/main/index.ts:710-763`).

#### 2. SessionSupervisor — Authority + CRUD Only

`SessionSupervisor` (`src/core/session-supervisor.ts`) provides:
- `listSessions(caller)` — filtered by visibility
- `inspectSession(caller, targetId)` — single node snapshot
- `promptSession(caller, targetId, text)` — sends text to PTY, returns `{ kind: 'dispatched' }` immediately
- `createChildSession(caller, request)` — creates child session in tree
- `destroySession(caller, targetId)` — archives session subtree

The `promptSession` method is **fire-and-forget**: it calls `deps.sessionInput.send(targetId, text)` and returns immediately. There is no await for response, no turn tracking, no completion notification.

#### 3. Terminal Replay Exists but Is NOT in the Control API

`SessionRuntimeController` (`src/main/session-runtime-controller.ts:129`) stores terminal backlogs in memory (up to 250K chars, ANSI-safe trimmed) and exposes `getTerminalReplay(sessionId)`. This is accessible:
- Via IPC channel `session:terminal-replay` to the renderer (`src/main/index.ts:1287-1289`)
- Via `RendererApi.getTerminalReplay` (`src/shared/project-session.ts:369`)
- Via `MainE2EDebugApi.getTerminalReplay` (`src/main/index.ts:191`)

It is **not** exposed as an HTTP endpoint in either `SessionControlServer` or `MetaSessionControlServer`.

#### 4. No "Wait for Completion" Primitive

There is no mechanism for a caller to block/poll until a session reaches a terminal state. The closest concepts are:
- `SessionPresenceSnapshot.phase` (`src/shared/observability.ts:62-89`) which can be `'complete'`, `'failure'`, `'blocked'`, `'running'`, `'ready'`
- `SessionSummary.hasUnseenCompletion` + `lastTurnOutcome` fields (`src/shared/project-session.ts:131-132`)
- `derivePresencePhase()` (`src/shared/session-state-reducer.ts:25-63`) computes phase from runtime state

But none of these have a "subscribe and wait" or "long-poll" API surface.

#### 5. No "Completion Report" Concept

There is no structured "completion report" type. The closest thing is:
- `MetaSessionContextAssembler.getFullContext()` / `getSlimContext()` (`src/core/meta-session-context-assembler.ts`) — assembles observation events + terminal replay into plain text
- `MetaSessionContextAssembler.getBundle()` — returns session + presence + events as JSON
- Observation events with `presence.complete` or `presence.failure` category/type (`src/main/session-event-bridge.ts:771-773`)

But there is no dedicated "what happened in that turn" structured result type.

#### 6. Parent-Child Session Tree and Visibility Model

- Sessions have `parentSessionId` and `createdBySessionId` fields (`src/shared/project-session.ts:123-124`)
- `SessionVisibilityService` (`src/core/session-visibility-service.ts`) computes visibility: a session can see siblings and descendants within its root tree, at its depth or deeper
- `CallerIdentity` is `{ type: 'local-user' }` or `{ type: 'session'; sessionId: string }` — sessions authenticate via token in `x-stoa-session-id` + `x-stoa-session-token` headers
- Authority actions: `inspect`, `prompt`, `create`, `destroy` — no `wait` or `read-output` action exists

#### 7. Turn Lifecycle State Machine

Turns follow: `idle` → `running` → terminal (`completed` | `interrupted` | `cancelled` | `failed`), tracked via `SessionStateIntent` values (`src/shared/project-session.ts:62-78`):
- `agent.turn_started` opens a turn
- `agent.turn_completed` / `agent.turn_interrupted` / `agent.turn_cancelled` / `agent.turn_failed` close a turn
- `agent.completion_seen` marks the completion as seen

Turn outcomes and epochs are tracked per session in `SessionSummary`.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Two control servers on same Express app | `src/main/index.ts` | lines 710-763 |
| SessionSupervisor authority CRUD | `src/core/session-supervisor.ts` | lines 37-121 |
| SessionControlServer HTTP routes | `src/core/session-control-server.ts` | lines 43-308 |
| MetaSessionControlServer HTTP routes | `src/core/meta-session-control-server.ts` | lines 156-669 |
| Terminal replay exists in runtime controller | `src/main/session-runtime-controller.ts` | lines 78-131 |
| Terminal replay NOT in control HTTP API | `src/core/session-control-server.ts` + `src/core/meta-session-control-server.ts` | full files — no `/ctl/session/:id/output` or similar route |
| No wait/completion-report concepts | All control layer files | no `wait`, `subscribe`, `completion-report`, or `await` patterns |
| Presence phase derivation | `src/shared/session-state-reducer.ts` | lines 25-63 |
| Turn lifecycle state machine | `src/shared/session-state-reducer.ts` | lines 65-209 |
| Session tree visibility model | `src/core/session-visibility-service.ts` | lines 16-121 |
| CallerIdentity type | `src/core/session-supervisor.ts` | lines 4-6 |
| SessionSummary fields (parentSessionId, turnState, etc.) | `src/shared/project-session.ts` | lines 122-147 |
| SessionPresenceSnapshot | `src/shared/observability.ts` | lines 62-89 |
| MetaSessionContextAssembler | `src/core/meta-session-context-assembler.ts` | lines 48-163 |
| IPC channels (no control-wait channel) | `src/core/ipc-channels.ts` | full file |

### Risks / Unknowns

- [!] The terminal backlog is **in-memory only** (`SessionRuntimeController.terminalBacklogs` Map). If the runtime controller is recycled, the replay is lost. A `wait` + `readback` flow would need to account for this.
- [!] `MetaSessionControlServer` already has `/ctl/work-sessions/:sessionId/context` with `level=slim|full|bundle` — this is very close to what a "completion report readback" endpoint would look like, but it's not scoped for parent→child access from a session caller identity.
- [?] Whether the control server should use SSE/WebSocket for wait notifications vs. long-polling is an open design question. The current architecture is purely request-response HTTP.
- [?] Whether a completion report should be structured JSON or derived from observation events + terminal replay (which is what `getBundle()` already does).

### Gap Analysis: Interfaces Needed

#### For Session Wait

1. **New `AuthorityAction`**: Add `'wait'` to `AuthorityAction` union (`src/core/session-visibility-service.ts:3`)
2. **New `SessionSupervisor` method**: `waitForTurnCompletion(caller, targetId, options): Promise<TurnCompletionResult>`
3. **New HTTP endpoint**: `GET /ctl/session/:id/wait` or `GET /ctl/work-sessions/:id/wait` — long-polls or SSE-streams until `phase` reaches a terminal state (`complete`, `failure`, `ready` with non-running `turnState`)
4. **New type**: `TurnCompletionResult` carrying `outcome: TurnOutcome`, `summary: string`, `turnEpoch: number`
5. **New capability flag**: Add `sessionWait: true` to the capabilities endpoint

#### For Session Output/Replay

1. **New `AuthorityAction`**: Add `'read-output'` to `AuthorityAction` union
2. **New `SessionSupervisor` method**: `getSessionOutput(caller, targetId): Promise<string>`
3. **New HTTP endpoint**: `GET /ctl/session/:id/output` or `GET /ctl/work-sessions/:id/output` — returns terminal replay string (needs wiring to `SessionRuntimeController.getTerminalReplay`)
4. **Dependency injection**: `SessionControlServerDeps` / `MetaSessionControlServerOptions` needs a `getTerminalReplay` dependency
5. **New capability flag**: Add `sessionOutput: true` to the capabilities endpoint

#### For Completion Report Readback

1. **New type**: `SessionCompletionReport` with structured fields: `outcome`, `summary`, `turnEpoch`, `failureReason?`, `evidenceSnippet?`
2. **New `SessionSupervisor` method**: `getCompletionReport(caller, targetId): Promise<SessionCompletionReport | null>` (returns null if session has not completed a turn)
3. **New HTTP endpoint**: `GET /ctl/session/:id/completion` or `GET /ctl/work-sessions/:id/completion`
4. **New capability flag**: Add `sessionCompletionReport: true` to the capabilities endpoint
5. **Alternative approach**: Reuse `MetaSessionContextAssembler.getBundle()` scoped to the last completed turn, with a parent-session access guard

### Recommended Approach

The cleanest path would be to extend the **`MetaSessionControlServer`** surface (which already has richer session read endpoints like `/ctl/work-sessions/:id/context`) rather than the legacy `SessionControlServer`, and add:

1. `GET /ctl/work-sessions/:id/wait?timeout=30000` — blocks until turn terminal state, returns `TurnCompletionResult`
2. `GET /ctl/work-sessions/:id/output` — returns `{ text: string, truncated: boolean }` from terminal replay
3. `GET /ctl/work-sessions/:id/completion` — returns structured `SessionCompletionReport | null`

All three would need:
- Authority check for session callers (parent can read/wait child within visibility tree)
- New dependency injection for `getTerminalReplay` and a `waitForTurnState` primitive
- New capability flags in `/ctl/capabilities`
