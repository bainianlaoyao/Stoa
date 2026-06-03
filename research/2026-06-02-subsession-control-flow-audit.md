---
date: 2026-06-02
topic: stoa-ctl subsession probe/create/wait/report server+supervisor+runtime flow audit
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Subsession Control Flow Audit (Server / Supervisor / Runtime)

### Why This Was Gathered
Pre-merge review of the current diff's subsession control-plane additions: `status`, `output`, `wait`, `completion-report` endpoints on the control server, plus `waitForSessionStateChange` waiter plumbing in the runtime controller. Goal: find serious bugs, behavior mismatches, and test gaps before the subsession flow ships.

### Summary
The subsession observation layer (status probe, output fetch, completion wait, completion report) is structurally sound and well-wired through the control server → supervisor → runtime controller stack. However, there are **two bugs that affect production behavior** (ignored PTY dimensions, asymmetric completion-seen terminality) and **one design fragility** (setActiveSession bypasses runtime controller waiter notification). The test suite covers the happy paths but misses the most important wait scenario (non-terminal → terminal transition during the wait).

---

### Key Findings

#### BUG-1: `initialCols` / `initialRows` accepted but silently ignored in control-server create

| Aspect | Detail |
|--------|--------|
| Severity | **High** — API contract violation |
| Files | `src/main/index.ts:756-764`, `src/core/session-control-server.ts:330-336` |
| Impact | A caller that specifies `--cols 132 --rows 44` via stoa-ctl gets a session launched at 120×30 (default fallback) after a 5-second timeout waiting for renderer dimensions that never arrive. |

The control server accepts `initialCols`/`initialRows` in the POST body, passes them through to `createWorkSessionWithRuntime`, which passes them to `projectSessionManager.createSession(payload)`. However, `CreateSessionRequest.initialCols/initialRows` are not persisted fields (`PersistedSession` lacks them), and `createWorkSessionWithRuntime` does NOT forward them to `launchSessionRuntimeWithGuard`'s `initialDimensions` option:

```typescript
// src/main/index.ts:966
void launchSessionRuntimeWithGuard(session.id, 'session-create', { awaitDimensions: true })
//                                                          ↑ no initialDimensions
```

The launch falls through to `waitForSessionDimensions(sessionId, 5000)` which waits for a renderer resize IPC that never comes for subsessions created via the control server, then times out to 120×30.

**Fix**: Extract `payload.initialCols`/`payload.initialRows` and pass as `initialDimensions` to `launchSessionRuntimeWithGuard`.

---

#### BUG-2: `toCompletionReport` asymmetric terminality — `completed` requires `hasUnseenCompletion` but `failed`/`interrupted`/`cancelled` do not

| Aspect | Detail |
|--------|--------|
| Severity | **Medium** — semantic inconsistency, can cause surprising wait hangs |
| Files | `src/core/session-supervisor.ts:229-235` |
| Impact | If a child session completes (`lastTurnOutcome: 'completed'`) and its completion is acknowledged (`hasUnseenCompletion: false`) before the parent's `waitForSession` checks, the wait considers the session non-terminal and continues until timeout. Failed/interrupted/cancelled sessions are always terminal regardless of `hasUnseenCompletion`. |

```typescript
// session-supervisor.ts:229-235
private toCompletionReport(session: SessionSummary): SessionCompletionReport | null {
    const isCompleted = session.lastTurnOutcome === 'completed' && session.hasUnseenCompletion  // ← double condition
    const isFailed = session.lastTurnOutcome === 'failed'        // ← single condition
    const isInterrupted = session.lastTurnOutcome === 'interrupted'
    const isCancelled = session.lastTurnOutcome === 'cancelled'
    ...
}
```

This means `isTerminalSession()` (which wraps `toCompletionReport`) can return `false` for a completed session whose completion has been acknowledged. If `waitForSession` is racing against `setActiveSession` (which auto-applies `agent.completion_seen` → `hasUnseenCompletion = false`), the wait may never see the session as terminal.

In practice, Node.js microtask ordering makes the exact race unlikely (the waiter's Promise microtask runs before the next I/O callback that would trigger `setActiveSession`), but the semantic asymmetry is a correctness concern and should be documented or resolved.

**Recommendation**: Either (a) make terminality consistent across all outcomes, or (b) document that `completed` is only terminal while unseen, and add a dedicated `isTerminal()` check that doesn't conflate "has a completion report" with "is done."

---

#### FRAGILITY-1: `setActiveSession` auto-applies `agent.completion_seen` bypassing runtime controller waiter notification

| Aspect | Detail |
|--------|--------|
| Severity | **Low-Medium** — design fragility, currently latent due to Node.js event loop ordering |
| Files | `src/main/index.ts:1281-1285`, `src/core/project-session-manager.ts:461-467` |
| Impact | If a future change introduces async work between state change notification and waiter check, or if the completion_seen event arrives via a path that doesn't go through `finishSessionStateChange`, waits can hang. |

The IPC handler for `sessionSetActive` calls `projectSessionManager.setActiveSession()` directly:

```typescript
// index.ts:1281-1285
ipcMain.handle(IPC_CHANNELS.sessionSetActive, async (_event, sessionId: string) => {
    await projectSessionManager?.setActiveSession(sessionId)  // ← bypasses runtimeController
    ...
})
```

While the runtime controller has `setActiveSession()` with waiter notification, it is not used here. The `ProjectSessionManager.setActiveSession()` auto-applies `agent.completion_seen` (line 464-466) without calling `finishSessionStateChange`, so waiters in the runtime controller's `sessionStateWaiters` map are never notified.

**Fix**: Route `sessionSetActive` through `runtimeController.setActiveSession()` instead of directly calling `projectSessionManager.setActiveSession()`.

---

#### FINDING-3: `waitForSession` triple visibility check can produce misleading errors

| Aspect | Detail |
|--------|--------|
| Severity | **Low** — edge case |
| Files | `src/core/session-supervisor.ts:134-158` |

`waitForSession` calls `requireVisibleSession` at three points:
1. Line 139: initial check (action: `'wait'`)
2. Line 149: post-wait re-fetch (action: `'wait'`)
3. Inside `getSessionOutput` at line 150 (action: `'read-output'`)

If the target session is archived between the wait completing and the output fetch, the caller receives an `unknown_session` error even though the wait "succeeded." This is technically correct (the session is gone) but semantically confusing for the caller — the wait resolved, but the response is an error.

---

### Missing Tests

| # | Gap | Priority |
|---|-----|----------|
| 1 | **`waitForSession` non-terminal → terminal transition during wait** — The most important wait path. No test exercises the state-change-driven wake-up that transitions a session from running to completed while a wait is in flight. | **High** |
| 2 | **`getCompletionReport` for `interrupted` and `cancelled` outcomes** — Only `failed` is tested. `interrupted` and `cancelled` are untested terminal paths. | Medium |
| 3 | **`getSessionStatus` at supervisor level** — `toStatusSnapshot` and `derivePresencePhase` integration is untested in the supervisor unit tests. The control server HTTP test covers the endpoint but not the supervisor logic. | Medium |
| 4 | **`waitForSession` with unknown or forbidden target** — Error paths for wait are untested at both supervisor and HTTP level. | Medium |
| 5 | **`waitForSession` with `timeoutMs: 0`** — Edge case for immediate timeout. | Low |
| 6 | **Concurrent waits on same session** — Multiple waiters should all be notified. No test validates this. | Low |
| 7 | **`getSessionOutput` when `getTerminalReplay` throws** — Error propagation is untested. | Low |
| 8 | **`waitForSession` when session archived during wait** — The post-wait visibility check failure path is untested. | Low |

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `initialCols`/`initialRows` not forwarded to launch | `src/main/index.ts` | `:756-766, :966` |
| `toCompletionReport` asymmetric `hasUnseenCompletion` check | `src/core/session-supervisor.ts` | `:229-235` |
| `setActiveSession` bypasses runtime controller | `src/main/index.ts` | `:1281-1285` |
| `ProjectSessionManager.setActiveSession` auto-applies completion_seen | `src/core/project-session-manager.ts` | `:464-466` |
| `SessionRuntimeController.setActiveSession` exists with waiter notification | `src/main/session-runtime-controller.ts` | `:74-77` |
| `waitForSessionStateChange` waiter mechanism | `src/main/session-runtime-controller.ts` | `:134-155` |
| `finishSessionStateChange` fires all waiters | `src/main/session-runtime-controller.ts` | `:157-166` |
| Visibility service grants `wait` and `read-output` same as `inspect` | `src/core/session-visibility-service.ts` | `:70` |
| `derivePresencePhase` determines phase from session state | `src/shared/session-state-reducer.ts` | `:25-63` |
| `SessionWaitResult` allows `report: null` | `src/shared/project-session.ts` | `:356-361` |
| Control server error handler boilerplate for new endpoints | `src/core/session-control-server.ts` | `:123-261` |
| `stoa-ctl` CLI commands for status/output/wait/report | `tools/stoa-ctl/index.ts` | `:326-385` |

### Risks / Unknowns

- **[!] BUG-1 is user-visible**: Anyone using `stoa-ctl session create --cols N --rows N` will see their dimensions ignored. This should be fixed before shipping.
- **[!] BUG-2 is a semantic trap**: The `completed` vs `failed` terminality asymmetry will surprise callers. At minimum, it needs explicit documentation in the API contract.
- **[?] No test for the most important wait path** (non-terminal → terminal transition). This is the core value proposition of `wait` and should be tested with a mock that transitions state after a delay.
- **[?] `waitForSessionStateChange` is optional in `SessionSupervisorDeps`** — the polling fallback (25ms interval) only runs when the dep is absent. In production it's always provided via the controller, but tests that don't provide it will poll aggressively.
