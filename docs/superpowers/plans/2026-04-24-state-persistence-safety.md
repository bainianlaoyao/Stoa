# State Persistence Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the current state-persistence data-loss path where transient read failures or interleaved writes can overwrite `global.json` / `sessions.json` with incomplete data.

**Architecture:** Harden the persistence contract in four passes. First add immediate write-path safety so the app stops destroying valid data. Then change read semantics so startup distinguishes first-run from real read failure. After that serialize `persist()` so overlapping state mutations cannot interleave. Finally remove webhook-port persistence because it is runtime-only state and should not trigger disk writes.

**Tech Stack:** TypeScript, Electron main process, Node `fs/promises`, Vitest, Playwright

---

### Task 1: Lock Current Failure Modes With Tests

**Files:**
- Modify: `src/core/state-store.test.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `tests/e2e/error-edge-cases.test.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`

- [ ] **Step 1: Replace silent-fallback expectations with explicit safety-contract tests**

Add tests that define the new contract:
- `readGlobalState()` returns defaults only for `ENOENT`
- corrupt JSON throws instead of returning `DEFAULT_GLOBAL_STATE`
- wrong schema/version throws instead of returning defaults
- `readProjectSessions()` returns empty sessions only for missing file
- `readAllProjectSessions()` does not silently drop non-ENOENT failures

- [ ] **Step 2: Add manager tests for startup and persist safety**

Add tests that verify:
- `ProjectSessionManager.create()` retries once on transient read failure
- `ProjectSessionManager.create()` rejects on corrupt or unreadable persisted state
- `persist()` refuses to replace a previously non-empty project list with an empty one
- `setTerminalWebhookPort()` updates runtime snapshot but does not write to disk

- [ ] **Step 3: Add concurrency regression tests before touching implementation**

Add tests that trigger overlapping `persist()` callers, for example:
- `applySessionEvent()` racing with `setActiveProject()`
- `markSessionRunning()` racing with `archiveSession()`

Assert the final on-disk state contains a valid merged snapshot rather than whichever write finished last.

- [ ] **Step 4: Run focused tests and confirm they fail first**

Run:
```bash
npx vitest run src/core/state-store.test.ts src/core/project-session-manager.test.ts tests/e2e/error-edge-cases.test.ts tests/e2e/backend-lifecycle.test.ts
```

Expected:
- failures on corruption tests because current readers silently return defaults
- failures on webhook-port persistence tests because `setTerminalWebhookPort()` still calls `persist()`
- failures on concurrency tests because `persist()` has no serialization

### Task 2: Phase 1 Safety Net On The Write Path

**Files:**
- Modify: `src/core/state-store.ts`
- Modify: `src/core/project-session-manager.ts`

- [ ] **Step 1: Add atomic write helper and route all writes through it**

Implementation target:
- add a private `atomicWriteFile()` helper in `src/core/state-store.ts`
- write to a temp file in the same directory
- `rename()` the temp file onto the target
- best-effort cleanup of temp files on failure

This task covers:
- `writePersistedState()`
- `writeGlobalState()`
- `writeProjectSessions()`

- [ ] **Step 2: Add an empty-project overwrite guard in `persist()`**

Implementation target:
- track whether the manager successfully booted from a non-empty project set
- if that flag is set, refuse to write a new `global.json` snapshot with `projects.length === 0`
- log the refusal loudly so the error is observable during development and tests

This guard is intentionally narrow: it blocks catastrophic overwrite, not legitimate first-run empty-state persistence.

- [ ] **Step 3: Wrap the write path in `try/catch`**

Implementation target:
- keep the actual write body isolated in `doPersist()`
- `persist()` catches write failures, records/logs the error, and rethrows only if the chosen contract requires it
- avoid partially swallowing errors inside lower-level write helpers

Decision for this repository:
- read-path failures should abort startup
- write-path failures should be observable and fail the triggering action, not silently vanish

- [ ] **Step 4: Re-run the focused tests**

Run:
```bash
npx vitest run src/core/state-store.test.ts src/core/project-session-manager.test.ts tests/e2e/error-edge-cases.test.ts
```

Expected:
- atomic write tests pass
- empty-project overwrite guard passes
- corruption/read-contract tests still fail until Task 3 lands

### Task 3: Phase 2 Read Contract Hardening

**Files:**
- Modify: `src/core/state-store.ts`
- Modify: `src/core/project-session-manager.ts`
- Possibly modify: `src/main/index.ts`

- [ ] **Step 1: Introduce explicit read error types**

Implementation target:
- add `StateReadError`
- include `filePath`
- include low-level `cause`
- include an `isTransient` discriminator derived from `ErrnoException.code`

Suggested transient bucket for the prototype:
- `EBUSY`
- `EACCES`
- `EPERM`
- `EAGAIN`
- `EMFILE` / `ENFILE` if encountered during tests

- [ ] **Step 2: Rewrite `readGlobalState()` to distinguish first-run from failure**

Contract:
- `ENOENT` => return `DEFAULT_GLOBAL_STATE`
- invalid JSON / wrong version / missing `projects` => throw `StateReadError`
- transient file access errors => throw `StateReadError` with `isTransient = true`
- other I/O errors => throw `StateReadError` with `isTransient = false`

- [ ] **Step 3: Rewrite project-session readers with the same policy**

Contract:
- `readProjectSessions(projectPath)` returns `{ project_id: '', sessions: [] }` only for missing file
- invalid or unreadable `sessions.json` throws
- `readAllProjectSessions(projects)` must stop startup on any non-ENOENT project read failure instead of silently dropping that project

Recommended implementation:
- call `readProjectSessions()` inside `readAllProjectSessions()`
- do not duplicate parsing logic in three places

- [ ] **Step 4: Update manager startup flow to retry transient read errors once**

Implementation target:
- `ProjectSessionManager.create()` wraps `readGlobalState()`
- if the thrown error is transient, wait a short fixed delay and retry once
- if the retry still fails, rethrow
- do not fall back to empty state after any non-ENOENT failure

- [ ] **Step 5: Decide and implement the main-process startup failure surface**

Current behavior:
- `app.whenReady().then(async () => { ... })` does not catch `ProjectSessionManager.create()` failures

Plan:
- keep the breaking behavior that startup fails on unreadable/corrupt persistence
- optionally add a top-level catch that logs a precise message and shows a blocking error dialog before exit

### Task 4: Phase 3 Persist Serialization

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `tests/e2e/store-lifecycle-sync.test.ts`

- [ ] **Step 1: Add a simple promise queue or mutex inside `ProjectSessionManager`**

Requirements:
- only one `persist()` body may execute at a time
- concurrent callers should queue, not race
- the lock must be private to the manager instance

- [ ] **Step 2: Refactor `persist()` into snapshot capture plus serialized execution**

Implementation detail:
- keep the persisted snapshot derived from current in-memory state inside the serialized section
- avoid taking a stale snapshot before waiting on the mutex, otherwise later writes can still lose newer state

- [ ] **Step 3: Add regression tests for overlapping mutations**

Test cases:
- webhook event update + active project change
- session archive + runtime status update
- multiple rapid `createSession()` calls under one project

Expected result:
- final disk state is structurally valid
- no session/project disappears because of write interleaving

### Task 5: Phase 4 Remove Webhook-Port Persistence

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/index.ts`
- Modify: tests touching startup/debug state

- [ ] **Step 1: Stop treating `terminalWebhookPort` as persisted state**

Rationale:
- `PersistedGlobalStateV3` does not contain the port
- `BootstrapState` does contain the port
- this proves the port is runtime-only process state, not durable user data

- [ ] **Step 2: Change `setTerminalWebhookPort()` to be in-memory only**

Implementation target:
- update `this.state.terminalWebhookPort`
- remove the `await this.persist()` call

- [ ] **Step 3: Verify startup and shutdown flows still expose the correct live port**

Test cases:
- after `SessionEventBridge.start()`, `snapshot().terminalWebhookPort` matches the bound server port
- after `SessionEventBridge.stop()`, `snapshot().terminalWebhookPort` becomes `null`
- no `global.json` write occurs for either transition

### Task 6: Align Existing Tests With The New Contract

**Files:**
- Modify: `tests/e2e/error-edge-cases.test.ts`
- Modify: `src/core/state-store.test.ts`
- Modify: any outdated descriptions that still refer to legacy `state.json`

- [ ] **Step 1: Remove tests that enshrine silent corruption recovery**

These current expectations must change:
- corrupt `global.json` booting into an empty manager
- wrong-version `global.json` booting into defaults
- malformed persisted shape booting into defaults

New expectation:
- startup fails loudly and does not mutate persisted files

- [ ] **Step 2: Keep and strengthen first-run / file-missing behavior**

Still supported:
- no `global.json` => clean bootstrap
- no per-project `sessions.json` => empty sessions for that project

- [ ] **Step 3: Fix stale terminology in tests**

The repository now persists `global.json` plus per-project `sessions.json`. Test names/comments that still say `state.json` should be updated where they refer to the current manager persistence path.

### Task 7: Full Verification Gate

**Files:**
- Regenerate: `tests/generated/**/*` if behavior assets change
- Modify: `testing/behavior/*`, `testing/topology/*`, `testing/journeys/*` only if the user-visible startup/error behavior is formalized there

- [ ] **Step 1: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: exit `0`

- [ ] **Step 2: Run deterministic generator step**

Run:
```bash
npm run test:generate
```

Expected: deterministic output only; no hand edits under `tests/generated/`

- [ ] **Step 3: Run unit and integration tests**

Run:
```bash
npx vitest run
```

Expected: exit `0`

- [ ] **Step 4: Run real Electron journeys**

Run:
```bash
npm run test:e2e
```

Expected: exit `0`

- [ ] **Step 5: Run behavior coverage gate**

Run:
```bash
npm run test:behavior-coverage
```

Expected: exit `0`

### Notes For Implementation

- `research/2026-04-24-state-persistence-safety.md` is directionally correct, but one detail should not be copied forward into code comments or tests: the current empty-project branch does write `projects: []`; it does not omit the field entirely.
- Do not add compatibility migrations. This repository is in prototype stage and the required behavior change is intentionally breaking: unreadable or corrupt persisted state must fail startup instead of silently resetting user data.
- `readPersistedState()` / `writePersistedState()` are legacy helpers for `state.json`. If they remain in the tree, harden them with the same atomic-write and explicit-read semantics or remove them in a separate cleanup task.
