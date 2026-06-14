# Vitest Failures: App Bridge Guard & IPC Push Harness

**Date:** 2026-06-14
**Scope:** Two failing Vitest files, read-only investigation (no edits made).
**Method:** `context-research` skill; direct file reads + `git diff HEAD` + live `vitest run` for failure output.

---

## TL;DR

Both failures originate from the **same uncommitted work-in-progress** in the working tree.
That WIP (a) refactored `handleSessionSelect` from synchronous `void` to `async`/`await`,
and (b) tightened the `isSessionPresenceSnapshot` runtime validator to require
`turnState` / `turnEpoch` / `lastTurnOutcome`. The test fixtures were not brought in line.

| # | File | Failing assertion | Root cause |
|---|------|-------------------|------------|
| 1 | `tests/e2e/app-bridge-guard.test.ts:333` | `expect(() => $emit('selectSession')).toThrowError(msg)` | `handleSessionSelect` is now `async` (`App.vue:55-60`), so the synchronous throw from `requireRendererApi()` becomes a rejected Promise instead of a synchronous throw. |
| 2 | `tests/e2e/ipc-push-harness.test.ts:334` | `expect(store.activeSessionPresence?.runtimeState).toBe('alive')` | The pushed `baseSnapshot` (lines 298-321) lacks `turnState`/`turnEpoch`/`lastTurnOutcome`; the validator `isSessionPresenceSnapshot` (`workspaces.ts:60-82`) rejects it, so `applySessionPresenceSnapshot` returns early and the store keeps the hydrate-derived `'created'`. |

---

## Failure 1 — App Bridge Guard: sync-throw contract broken by async handler

### Intended async test contract

The test encodes a **synchronous throw** contract. Authoritative evidence:

- `tests/e2e/app-bridge-guard.test.ts:329-333`:
  ```ts
  // handleSessionSelect uses `void requireRendererApi().setActiveSession(...)`.
  expect(() => {
    appShell.vm.$emit('selectSession', 's1')
  }).toThrowError(missingRendererBridgeMessage)
  ```
- The comment names the exact pattern the code must use: `void requireRendererApi().setActiveSession(...)` — i.e. a **non-async** handler where `requireRendererApi()` is evaluated synchronously, so its throw propagates through Vue's synchronous `$emit`.
- The sibling `handleProjectSelect` test (`app-bridge-guard.test.ts:292-307`) asserts the identical contract and **passes**, because `handleProjectSelect` is still synchronous — `App.vue:50-53`:
  ```ts
  function handleProjectSelect(projectId: string): void {
    workspaceStore.setActiveProject(projectId)
    void requireRendererApi().setActiveProject(projectId)   // sync throw propagates
  }
  ```

The uncommitted test diff (`git diff HEAD -- tests/e2e/app-bridge-guard.test.ts`) confirms this contract was **deliberately refreshed** (not a leftover): both `handleProjectSelect` and `handleSessionSelect` cases were updated from `.toThrow(TypeError)` to `.toThrowError(missingRendererBridgeMessage)`, and the comments were rewritten to say `void requireRendererApi()...`. The test author expects both handlers to share the sync `void requireRendererApi()` pattern.

### Why it fails — exact code/path evidence

`src/renderer/app/App.vue:55-60` (current working tree):
```ts
async function handleSessionSelect(sessionId: string): Promise<void> {
  workspaceStore.setActiveSession(sessionId)
  await requireRendererApi().setActiveSession(sessionId)   // <- throws here
  await workspaceStore.hydrateFromStoaClient()
  await workspaceStore.hydrateObservability()
}
```

`requireRendererApi()` throws synchronously at `src/renderer/stores/stoa-store-plugin.ts:48`:
```ts
throw new Error('Renderer bridge unavailable: window.stoa is missing and StoaClient is not initialized.')
```

But because `handleSessionSelect` is `async`, any synchronous throw inside it is **auto-wrapped into a rejected Promise**. `$emit` therefore returns normally; `expect(() => {...}).toThrowError(...)` observes no throw and fails. The thrown error surfaces instead as an **Unhandled Rejection** (confirmed in live vitest output):

```
Error: Renderer bridge unavailable: window.stoa is missing and StoaClient is not initialized.
❯ requireRendererApi src/renderer/stores/stoa-store-plugin.ts:48:11
❯ handleSessionSelect src/renderer/app/App.vue:57:9
❯ callWithErrorHandling …/runtime-core.cjs.js:200:19
❯ emit …/runtime-core.cjs.js:4421:5
❯ tests/e2e/app-bridge-guard.test.ts:332:21
```

Live assertion output:
```
- Expected: null      (i.e. expected a thrown error)
+ Received: undefined (i.e. nothing thrown synchronously)
❯ tests/e2e/app-bridge-guard.test.ts:333:10
```

### Regression proof

`git diff HEAD -- src/renderer/app/App.vue` shows the uncommitted change that caused the drift:
```diff
-function handleSessionSelect(sessionId: string): void {
+async function handleSessionSelect(sessionId: string): Promise<void> {
   workspaceStore.setActiveSession(sessionId)
-  void window.stoa.setActiveSession(sessionId)
+  await requireRendererApi().setActiveSession(sessionId)
+  await workspaceStore.hydrateFromStoaClient()
+  await workspaceStore.hydrateObservability()
 }
```
Before this WIP, the function matched the test's contract exactly (sync, `void`).
The hydration calls (`hydrateFromStoaClient`, `hydrateObservability`) are the reason it became `async`.

### Likely fix direction (for the implementation agent)

Keep the handler synchronous and preserve the hydration, by moving the hydration into a fire-and-forget `.then()` chain off the `setActiveSession` promise (the `requireRendererApi()` call stays on a synchronous line so it still throws through `$emit`):

```ts
function handleSessionSelect(sessionId: string): void {
  workspaceStore.setActiveSession(sessionId)
  void requireRendererApi()
    .setActiveSession(sessionId)
    .then(() => workspaceStore.hydrateFromStoaClient())
    .then(() => workspaceStore.hydrateObservability())
}
```

This satisfies the test's `void requireRendererApi().setActiveSession(...)` contract, keeps hydration ordered after the active-session IPC, and matches the existing fire-and-forget posture of `handleProjectSelect` / the old committed version. (No edits were made in this research run.)

---

## Failure 2 — IPC Push Harness: presence snapshot rejected by tightened validator

### Trace through the store projection / presence merge logic

1. **Hydrate seeds `'created'` into presence.** `store.hydrate(...)` (`src/renderer/stores/workspaces.ts:280-291`) iterates sessions and calls `syncSessionPresenceFromSummary(session)` (line 289). For the test's `createSessionSummary()` (`tests/e2e/ipc-push-harness.test.ts:49-71`), `runtimeState: 'created'`, so `buildSessionPresenceSnapshot` (`src/shared/observability-projection.ts:51-108`) copies `session.runtimeState` straight through (line 88: `runtimeState: session.runtimeState`) and stores it in `sessionPresenceById['session_op_1']` (`workspaces.ts:642-667`). After hydrate, `activeSessionPresence.runtimeState === 'created'`.

   - Note: `syncSessionPresenceFromSummary` does **not** run `isSessionPresenceSnapshot` on its own output, so the incomplete summary (it also lacks `turnState`/`turnEpoch`/`lastTurnOutcome`) still produces a stored snapshot — that is why hydrate "works" while the push path below does not.

2. **Push path validates.** The test pushes a snapshot with `runtimeState: 'alive'` (`ipc-push-harness.test.ts:327-332`) via `api.onSessionPresenceChanged((s) => store.applySessionPresenceSnapshot(s))` (line 323-325). `applySessionPresenceSnapshot` (`workspaces.ts:461-481`) starts with a guard:
   ```ts
   function applySessionPresenceSnapshot(snapshot: SessionPresenceSnapshot): void {
     if (!isSessionPresenceSnapshot(snapshot)) {   // <- returns false here
       return
     }
     ...
   ```

3. **The validator rejects the test snapshot.** `isSessionPresenceSnapshot` (`workspaces.ts:60-82`) requires:
   ```ts
   && typeof candidate.turnState === 'string'      // MISSING in baseSnapshot
   && typeof candidate.turnEpoch === 'number'       // MISSING in baseSnapshot
   && typeof candidate.lastTurnOutcome === 'string' // MISSING in baseSnapshot
   ```
   The test's `baseSnapshot` (`ipc-push-harness.test.ts:298-321`) does **not** include `turnState`, `turnEpoch`, or `lastTurnOutcome`. So the type guard short-circuits to `false`, `applySessionPresenceSnapshot` returns at `workspaces.ts:463`, and `sessionPresenceById['session_op_1']` is never updated.

4. **Result.** `activeSessionPresence` (`workspaces.ts:244-250`) still returns the hydrate-derived snapshot → `runtimeState === 'created'`. Live vitest output:
   ```
   AssertionError: expected 'created' to be 'alive'
   Expected: "alive"
   Received: "created"
   ❯ tests/e2e/ipc-push-harness.test.ts:334:55
   ```

### Schema-evolution evidence (why the fixture is now stale)

- The `SessionPresenceSnapshot` **type** (`src/shared/observability.ts:62-89`) already requires `turnState` (line 71), `turnEpoch` (line 72), `lastTurnOutcome` (line 73). `src/shared/observability.ts` is **not** in the uncommitted diff — this type requirement is committed.
- The `SessionSummary` type (`src/shared/project-session.ts:122-144`) likewise requires `turnState`/`turnEpoch`/`lastTurnOutcome` (lines 129-131).
- `git blame -L 66,81 src/renderer/stores/workspaces.ts` shows the `turnState`/`turnEpoch`/`lastTurnOutcome` checks in `isSessionPresenceSnapshot` are **"Not Committed Yet"** — the validator was tightened in the current WIP to actually enforce the already-required type fields.
- `tests/e2e/ipc-push-harness.test.ts` is **not** in the uncommitted diff — the fixture was never updated when the type (and now the validator) gained those fields. The canonical fixture in `src/shared/test-fixtures.ts:27-29` shows the expected shape (`turnState: 'idle'`, `turnEpoch: 0`, `lastTurnOutcome: 'none'`).

So: the committed `SessionPresenceSnapshot` type required these fields; the WIP finally enforced them at runtime; the stale test fixture (committed earlier without the fields) is now rejected.

### Likely minimal fix (for the implementation agent)

The validator and type are correct for the evolved schema; the test fixture is stale. The faithful minimal fix is to complete the fixture so it satisfies the `SessionPresenceSnapshot` contract — this is fixture-data alignment with an already-committed type, not weakening an assertion:

In `tests/e2e/ipc-push-harness.test.ts`, add the three missing fields to **both** `baseSnapshot` literals (the one at lines 109-132 and the one at lines 298-321):

```ts
const baseSnapshot: SessionPresenceSnapshot = {
  sessionId: 'session_op_1',
  projectId: 'project_alpha',
  providerId: 'opencode',
  providerLabel: 'OpenCode',
  modelLabel: null,
  phase: 'running',
  runtimeState: 'starting',          // (or 'alive' as in the second literal)
  agentState: 'unknown',             // note: also absent from SessionPresenceSnapshot type — see note below
  turnState: 'idle',                 // ADD
  turnEpoch: 0,                      // ADD
  lastTurnOutcome: 'none',           // ADD
  ...
}
```

Also update `createSessionSummary()` (`ipc-push-harness.test.ts:49-71`) to include `turnState: 'idle'`, `turnEpoch: 0`, `lastTurnOutcome: 'none'` — currently it only survives the hydrate path because `syncSessionPresenceFromSummary` does not validate, but it is type-incorrect against the committed `SessionSummary`.

> **Note on `agentState`:** the test snapshot includes `agentState: 'working'` (e.g. line 307/330) and asserts `store.activeSessionPresence?.agentState` (line 335), but `agentState` is **not** a field of the `SessionPresenceSnapshot` type (`src/shared/observability.ts:62-89`) — it rides through on the `[extra: string]: unknown` index signature. That assertion currently passes only because `sessionPresenceById` stores the whole object. If/when the store narrows stored values, that assertion would also need attention. Out of scope for this minimal fix, but flagged.

> **On the CLAUDE.md "fix code, not the test" rule:** that rule targets hiding real bugs by weakening assertions or skipping tests. Here the code (validator + type) is internally consistent and correct for the evolved schema; the test *input data* is stale relative to an already-committed type. Aligning the fixture with the type contract is the faithful fix. The worse alternative — loosening `isSessionPresenceSnapshot` to drop the three checks — would make the runtime validator inconsistent with the `SessionPresenceSnapshot` type and weaken a real guard against malformed pushes; not recommended.

---

## Common root and verification recipe

- **Single WIP caused both.** `git diff HEAD --stat` shows `src/renderer/stores/workspaces.ts` (+106), `src/shared/project-session.ts` (+26), `tests/e2e/app-bridge-guard.test.ts` (+19), `src/renderer/app/App.vue` (async refactor) are all uncommitted. The WIP (a) made `handleSessionSelect` async (broke Failure 1's contract) and (b) tightened `isSessionPresenceSnapshot` (broke Failure 2's stale fixture).
- **No files were edited in this run.** All findings are from reads + `git diff HEAD` + one read-only `npx vitest run`.

### Reproduce
```bash
npx vitest run tests/e2e/app-bridge-guard.test.ts tests/e2e/ipc-push-harness.test.ts
# → 2 failed | 15 passed (17), plus 1 unhandled rejection from app-bridge-guard
```

### Verify after fix
```bash
npx vitest run tests/e2e/app-bridge-guard.test.ts tests/e2e/ipc-push-harness.test.ts
# expect 17 passed, 0 unhandled rejections
npx vitest run                       # full gate
```

---

## Context Handoff

**Report path:** `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-vitest-failures-app-bridge-and-ipc-push.md`

**Handoff for the implementation agent:**
1. **Failure 1 (`app-bridge-guard.test.ts:333`):** revert `handleSessionSelect` (`src/renderer/app/App.vue:55-60`) to a **synchronous** function using `void requireRendererApi().setActiveSession(...)`, with the `hydrateFromStoaClient` + `hydrateObservability` calls relocated to a `.then()` chain off that promise. Do **not** change the test — its contract (sync throw via `void requireRendererApi()`) is correct and matches the passing `handleProjectSelect` sibling.
2. **Failure 2 (`ipc-push-harness.test.ts:334`):** add `turnState: 'idle'`, `turnEpoch: 0`, `lastTurnOutcome: 'none'` to both `baseSnapshot` literals and to `createSessionSummary()` in `tests/e2e/ipc-push-harness.test.ts` so the fixture satisfies the committed `SessionPresenceSnapshot` / `SessionSummary` type contracts that `isSessionPresenceSnapshot` now enforces. Do **not** loosen the validator — it is consistent with the type.
3. After both edits: `npx vitest run tests/e2e/app-bridge-guard.test.ts tests/e2e/ipc-push-harness.test.ts`, then the full `npx vitest run` gate.
