---
date: 2026-06-02
topic: completed-session-completion-report-semantics
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Completed Session & Completion Report Semantics

### Why This Was Gathered

The stoa-ctl subsession diff added four new CLI commands (`status`, `output`, `wait`, `report`) and two create fields (`--external-session-id`, `--cols`/`--rows`). The review needed to verify that a **completed session whose completion has already been seen** (`hasUnseenCompletion=false`) is still handled correctly by the control plane — specifically whether `status.hasCompletionReport`, `completion-report` endpoint, and `wait` still treat it as a completed session.

### Summary

The completion semantic chain is **sound**: `toCompletionReport()` gates purely on `lastTurnOutcome ∈ {completed, failed, interrupted, cancelled}` and ignores `hasUnseenCompletion`. The `wait`, `status.hasCompletionReport`, and `report` endpoints all derive from this function, so seen completions are correctly treated as completed. However, there is one latent edge case in the event reducer: `isTerminalOutcome()` excludes `'completed'`, which means a duplicate `agent.turn_completed` event on the same epoch would not be deduplicated and could re-flip `hasUnseenCompletion` back to `true`. This is not triggered by the current diff but is a semantic gap worth noting.

### Key Findings

#### F1. `toCompletionReport()` — report availability is independent of "seen" status ✅

The supervisor's `toCompletionReport()` at `src/core/session-supervisor.ts:228-253` checks only `lastTurnOutcome`:

```typescript
const isCompleted = session.lastTurnOutcome === 'completed'
const isFailed = session.lastTurnOutcome === 'failed'
const isInterrupted = session.lastTurnOutcome === 'interrupted'
const isCancelled = session.lastTurnOutcome === 'cancelled'
```

It returns a valid `SessionCompletionReport` for any of these outcomes regardless of `hasUnseenCompletion`. This is the **correct** semantic: the report is factual data about what happened, not about whether the user has acknowledged it.

#### F2. `status.hasCompletionReport` — correctly derived from `toCompletionReport()` ✅

At `src/core/session-supervisor.ts:224`:

```typescript
hasCompletionReport: this.toCompletionReport(session) !== null
```

So when `lastTurnOutcome='completed'` and `hasUnseenCompletion=false`:
- `hasCompletionReport` = `true` (correct — the report exists)
- `phase` = `'ready'` (correct — the UI presence indicates "not new/unseen")

This is a deliberate and sound semantic split. The `phase` field is a UI presence indicator; `hasCompletionReport` is a factual API field.

#### F3. `wait` resolves immediately for seen completions ✅

`isTerminalSession()` at `src/core/session-supervisor.ts:255-258` uses:

```typescript
return !!node && this.toCompletionReport(node.session) !== null
```

This returns `true` for any session with a terminal `lastTurnOutcome`, including seen completions. The `waitForSession()` method (line 134-158) checks `isTerminalSession()` first and skips the wait loop if already terminal. The returned `report` also comes from `toCompletionReport()`, which is non-null. **No waiter logic deviation.**

#### F4. `report` endpoint returns data for seen completions ✅

`getCompletionReport()` at `src/core/session-supervisor.ts:125-132` throws `no_completion_yet` only when `toCompletionReport()` returns null. For a seen completion, the report is returned with `hasUnseenCompletion: false` embedded in it.

#### F5. `derivePresencePhase()` — intentional phase demotion after seen ⚠️ (by design, not a bug)

At `src/shared/session-state-reducer.ts:43-45` and `:54-56`:

```typescript
if (input.hasUnseenCompletion && input.lastTurnOutcome === 'completed') {
  return 'complete'
}
```

Both the "not alive" branch (line 43) and the "alive" branch (line 54) require `hasUnseenCompletion=true` to produce `'complete'`. After `agent.completion_seen` sets `hasUnseenCompletion=false`, phase drops to `'ready'`. This is the UI signal that "the user has acknowledged this completion." Tested at `src/shared/session-state-reducer.test.ts:109-150`.

#### F6. ⚠️ `isTerminalOutcome()` does not include `'completed'` — potential duplicate event issue

At `src/shared/session-state-reducer.ts:269-271`:

```typescript
function isTerminalOutcome(outcome: TurnOutcome): boolean {
  return outcome === 'interrupted' || outcome === 'cancelled' || outcome === 'failed'
}
```

This function is used in `isCurrentTurnTerminal()` (line 254-258) to guard against duplicate terminal events. The guard is applied in:
- `agent.turn_completed` handler (line 147-149)
- `agent.turn_failed` handler (line 183-185)

For `interrupted`/`cancelled`/`failed` outcomes, `isTerminalOutcome` returns `true`, so a second `agent.turn_completed` event on the same epoch is correctly ignored. But for `completed` outcomes, `isTerminalOutcome('completed')` returns `false`, meaning a duplicate `agent.turn_completed` with the same epoch **would pass through** and re-set `hasUnseenCompletion=true`.

**Impact**: A duplicate completion event could "resurrect" the unseen flag, causing the phase to return to `'complete'` after the UI already marked it seen. This is not triggered by the current diff (stoa-ctl is a CLI consumer, not an event producer), but it is a latent inconsistency in the event reducer.

#### F7. Test coverage for the "seen completion" path ✅

The supervisor test at `src/core/session-supervisor.test.ts:440-465` (`'getCompletionReport returns completed reports even after completion has been seen'`) explicitly creates a session with `lastTurnOutcome: 'completed'` and `hasUnseenCompletion: false` and verifies:
- `getCompletionReport()` returns a valid report
- `getSessionStatus().hasCompletionReport` is `true`

The reducer test at `src/shared/session-state-reducer.test.ts:109-150` verifies the phase demotion from `'complete'` to `'ready'` after `agent.completion_seen`.

The `waitForSession` test at `src/core/session-supervisor.test.ts:370-410` also uses `hasUnseenCompletion: false` in the `waitForSessionStateChange` callback, confirming that wait correctly resolves when the session reaches completion (even with unseen=false).

#### F8. stoa-ctl CLI tests — no coverage for "seen completion" scenario ⚠️

The stoa-ctl diff tests mock the HTTP response and do not exercise the edge case where the control plane returns a completion report with `hasUnseenCompletion: false`. The CLI test for `report` (line 423-442 in `tools/stoa-ctl/index.test.ts`) returns a generic completed session but does not verify behavior differences between seen/unseen. This is a **test gap**, though it is not a code bug — the CLI passes through whatever the server returns.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Report availability independent of seen status | `session-supervisor.ts` | `:228-253` |
| `hasCompletionReport` derived from `toCompletionReport()` | `session-supervisor.ts` | `:224` |
| `isTerminalSession()` uses `toCompletionReport()` | `session-supervisor.ts` | `:255-258` |
| `wait` skips loop for terminal sessions | `session-supervisor.ts` | `:142-147` |
| `wait` returns report from `toCompletionReport()` | `session-supervisor.ts` | `:150-157` |
| `report` endpoint gates on `toCompletionReport() !== null` | `session-supervisor.ts` | `:128-129` |
| Phase requires `hasUnseenCompletion=true` for `'complete'` | `session-state-reducer.ts` | `:43-45, :54-56` |
| `isTerminalOutcome()` excludes `'completed'` | `session-state-reducer.ts` | `:269-271` |
| Duplicate `agent.turn_completed` not deduped for `completed` | `session-state-reducer.ts` | `:147-149` |
| Test: seen completion returns report | `session-supervisor.test.ts` | `:440-465` |
| Test: wait resolves for seen completion | `session-supervisor.test.ts` | `:370-410` |
| Test: phase demotion after seen | `session-state-reducer.test.ts` | `:109-150` |
| `TurnOutcome` type definition | `project-session.ts` | `:46` |
| `SessionStatusSnapshot.hasCompletionReport` field | `project-session.ts` | `:328` |
| `SessionCompletionReport.hasUnseenCompletion` field | `project-session.ts` | `:348` |
| stoa-ctl report test — no seen/unseen distinction | `index.test.ts` | `:423-442` |

### Risks / Unknowns

- [!] **F6 — `isTerminalOutcome` excludes `'completed'`**: A duplicate `agent.turn_completed` event on the same epoch would not be deduplicated and would re-set `hasUnseenCompletion=true`. This is a semantic inconsistency but not triggered by the current diff. Impact would be a phase flicker in the UI (back to `'complete'` after user already acknowledged).
- [?] Whether event sources in production can emit duplicate `agent.turn_completed` events is unknown — if providers are well-behaved, this is theoretical. But it is a defensive coding gap.
- [!] **F8 — stoa-ctl test gap**: The CLI test for `report` and `wait` does not verify the `hasUnseenCompletion` field in mocked responses, leaving the "seen completion" CLI path unexercised. Low risk since the CLI is a pass-through, but the gap exists.
