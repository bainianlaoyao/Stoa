---
date: 2026-05-29
topic: Task 3 — SessionVisibilityService and runtime auth/token entry points
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Task 3 — Visibility Service And Runtime Auth

### Why This Was Gathered

Task 3 of the unified session tree plan requires:
1. A new `SessionVisibilityService` that computes "same-depth-plus-descendants" visible sets and collapses invisible targets to `unknown_session`
2. A runtime ephemeral token registry in the controller with registration/invalidation lifecycle
3. `STOA_CTL_SESSION_TOKEN` env propagation to all provider sessions via existing command env path

This research identifies the minimal correct entry points and existing infrastructure to extend.

### Summary

`SessionVisibilityService` is a new pure-computation module with no filesystem or IPC dependencies. It should consume `SessionSummary[]` snapshots (which already carry lineage fields from Tasks 1-2) and the manager's `deriveSessionTreeMeta()`. The runtime auth layer extends the existing hook-lease secret flow: the `commandEnv` injection path in `launch-tracked-session-runtime.ts` already merges env into provider commands — the `sessionSecret` from the hook lease is the natural `STOA_CTL_SESSION_TOKEN` value. The ephemeral token registry belongs in `SessionRuntimeController` which already owns session lifecycle orchestration.

### Key Findings

1. **SessionVisibilityService is entirely new — no existing equivalent.** Nothing in the codebase computes visibility scope or authority from session lineage. The closest helpers are all private methods on `ProjectSessionManager`: `getSessionSubtree()`, `deriveSessionTreeMeta()`, `buildChildrenByParentMap()`, `getSessionsInTreeOrder()` (`src/core/project-session-manager.ts:856-955`).

2. **The service should be pure computation.** It takes `SessionSummary[]` (from `manager.snapshot().sessions`) plus a target session ID, and returns the visible set. No manager dependency, no IPC, no persistence. The plan's test shape confirms this: `new SessionVisibilityService(sessionNodes)`.

3. **Session secret/auth infrastructure already exists end-to-end:**
   - **Lease creation**: `hook-lease-manager.ts:57-111` → `ensureLease()` acquires a lease with `sessionSecret`
   - **Secret registration**: `launch-tracked-session-runtime.ts:59-61` → `registerSessionSecret(session.id, hookLease.lease.sessionSecret)`
   - **In-memory store**: `session-event-bridge.ts:65` → `sessionSecrets = new Map<string, string>()`
   - **Hook validation**: `webhook-server.ts:300-304, 361-364, 441-443` → validates `x-stoa-secret` header against stored secrets
   - **CLI port file secret**: `stoa-ctl-port-file.ts:18-19` → `generateSecret()` creates a 64-char hex token, written to `~/.stoa/ctl.json` (`src/main/index.ts:636-654`)

4. **`commandEnv` is the injection path for `STOA_CTL_SESSION_TOKEN`.** `launch-tracked-session-runtime.ts:30,71` already accepts `commandEnv?: Record<string, string>` and passes it through to `startSessionRuntime`, which merges it into the provider command env at `session-runtime.ts:115-119`. The existing `meta-session-command-env.ts` shows the pattern: it builds `STOA_CTL_BASE_URL`, `STOA_META_SESSION`, `STOA_SESSION_ID`, `PATH`.

5. **The ephemeral token registry belongs in `SessionRuntimeController`.** This class (`src/main/session-runtime-controller.ts:27`) already owns session lifecycle callbacks (`markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited`) and terminal data management. A `Map<string, string>` for session tokens with registration on start and invalidation on exit fits naturally here. The controller's constructor would grow by one field.

6. **Manager has no public `getSession()` accessor.** Individual session lookup is done inline via `manager.snapshot().sessions.find(...)` everywhere. The plan's test example uses `manager.getSession(child.id)` which doesn't exist yet — tests should use the snapshot pattern or a new getter may be needed.

7. **`SessionNodeSnapshot` and `SessionTreeMeta` already exist** from Task 1 (`src/shared/project-session.ts:303-321`). `SessionNodeSnapshot` pairs a `SessionSummary` with `SessionTreeMeta`. The visibility service should operate on `SessionNodeSnapshot[]` for richer tree metadata.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Visibility service doesn't exist | Grep returns no matches | `src/**/*` |
| Tree helpers are private on manager | `getSessionSubtree`, `deriveSessionTreeMeta`, `buildChildrenByParentMap` | `src/core/project-session-manager.ts:856-955` |
| Hook lease creates session secret | `ensureLease` returns `sessionSecret` | `src/main/hook-lease-manager.ts:57-111` |
| Secret registered on bridge | `registerSessionSecret` call | `src/main/launch-tracked-session-runtime.ts:59-61` |
| Secrets stored in Map | `sessionSecrets = new Map<string, string>()` | `src/main/session-event-bridge.ts:65` |
| Webhook validates x-stoa-secret | Three validation checkpoints | `src/core/webhook-server.ts:300-304, 361-364, 441-443` |
| CLI port file secret generation | `generateSecret()` | `src/core/stoa-ctl-port-file.ts:18-19` |
| commandEnv injection path | Option accepted and merged | `src/main/launch-tracked-session-runtime.ts:30,71`, `src/core/session-runtime.ts:115-119` |
| Existing meta-session env pattern | `STOA_CTL_BASE_URL`, `STOA_META_SESSION` etc. | `src/core/meta-session-command-env.ts:10-24` |
| Controller owns lifecycle callbacks | `markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited` | `src/main/session-runtime-controller.ts:39-53` |
| `SessionNodeSnapshot` and `SessionTreeMeta` defined | Shared types | `src/shared/project-session.ts:303-321` |
| Lineage fields on `SessionSummary` | `parentSessionId`, `createdBySessionId` | `src/shared/project-session.ts:125-126` |
| No public `getSession()` on manager | Grep returns no matches | `src/core/project-session-manager.ts` |
| Port file wiring in main/index.ts | `generateSecret`, `writePortFile` | `src/main/index.ts:636-654` |

### Risks / Unknowns

- [!] **Manager has no public tree-meta accessor.** `deriveSessionTreeMeta()` is private. The visibility service either needs a public wrapper on the manager, or must recompute tree meta from the snapshot. The latter is cleaner for a stateless service but duplicates work.
- [?] **Whether token = lease secret or a new value.** The plan says "env propagation using existing live session secret as `STOA_CTL_SESSION_TOKEN`", which implies reusing the hook lease `sessionSecret`. But the plan also says "runtime-controller ephemeral token registry" with "registration/invalidation lifecycle", which implies a separate token. Need to confirm: is `STOA_CTL_SESSION_TOKEN` the hook lease secret, or a new ephemeral token? If new, the registry should generate it on `markRuntimeAlive` and clear it on `markRuntimeExited`.
- [?] **Visibility service input shape.** The plan shows `new SessionVisibilityService(sessionNodes)` with a constructor arg. This could be `SessionSummary[]` (requiring tree derivation) or `SessionNodeSnapshot[]` (with pre-computed tree). The latter is better if the manager provides a `getAllNodeSnapshots()` method, but that method doesn't exist yet.
- [!] **Test file `src/main/session-runtime-controller.test.ts` currently tests only observability and terminal behavior.** Token lifecycle tests would be the first security-sensitive tests in this file.

### Implementation Entry Points (Minimal Correct Path)

#### 1. `src/core/session-visibility-service.ts` (NEW)
- Pure function or lightweight class
- Input: `SessionSummary[]` from snapshot, compute visible set for a given session ID
- Uses lineage fields (`parentSessionId`, `createdBySessionId`) already on `SessionSummary`
- Algorithm: find target depth, collect same-depth peers and all descendants
- For invisible targets, return `unknown_session` sentinel

#### 2. `src/main/session-runtime-controller.ts` (MODIFY)
- Add `private readonly sessionTokens = new Map<string, string>()`
- Add `registerSessionToken(sessionId, token)` — called during launch
- Add `invalidateSessionToken(sessionId)` — called on `markRuntimeExited`
- Add `getSessionToken(sessionId)` — used by control server (Task 4)

#### 3. `src/main/launch-tracked-session-runtime.ts` (MODIFY)
- After `hookLease` is acquired, add `STOA_CTL_SESSION_TOKEN` to `options.commandEnv`
- Pattern: `commandEnv.STOA_CTL_SESSION_TOKEN = hookLease?.lease.sessionSecret ?? ''`

#### 4. `src/core/session-runtime.ts` (MODIFY)
- No structural changes needed — `commandEnv` merge already works
- Possibly add `STOA_CTL_SESSION_ID` alongside existing `STOA_SESSION_ID` for clarity

### Missing Test Surface

1. **`src/core/session-visibility-service.test.ts`** (NEW) — visibility scope computation, depth calculation, invisible target collapse
2. **`src/core/session-runtime.test.ts`** (MODIFY) — token registration/invalidation lifecycle, `STOA_CTL_SESSION_TOKEN` in provider env
3. **`src/main/session-runtime-controller.test.ts`** (MODIFY) — ephemeral token registry, invalidation on exit

The existing test for `commandEnv` merge (`session-runtime.test.ts:659-718`) is the template for the new `STOA_CTL_SESSION_TOKEN` test. It already verifies that `commandEnv` is merged into the provider command env before PTY spawn.
