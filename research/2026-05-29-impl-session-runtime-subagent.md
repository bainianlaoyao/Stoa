---
date: 2026-05-29
topic: session-runtime-start-semantics-tree-support
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Session Runtime Start Semantics for Tree Support

### Why This Was Gathered
To understand how the current session runtime start lifecycle works, where tree-aware parent-child linkage would need to be threaded, and where a runtime-only token registry could plausibly live with the least disruption.

### Summary
The session runtime has a clean 3-layer architecture: `startSessionRuntime` (core pure function) -> `launchTrackedSessionRuntime` (main-process orchestrator) -> `SessionRuntimeController` (window bridge + terminal batching). Sessions are currently flat — there is no parent-child relationship model. A runtime-only token registry fits naturally in `SessionRuntimeController` which already holds per-session runtime maps (`terminalBacklogs`, `pendingTerminalBatches`), or as a sibling to `PtyHost.sessions`.

### Key Findings

#### 1. Current Start/Runtime Lifecycle

The lifecycle flows through three layers:

**Layer 1: `startSessionRuntime`** (`src/core/session-runtime.ts:66-185`)
- Pure async function. No class, no mutable state.
- Accepts `StartSessionRuntimeOptions` containing a `session` object with all runtime context including `externalSessionId`, `hookLeasePath`, `hookSpawnOwnerInstanceId`, `hookSpawnGeneration`.
- Lifecycle sequence:
  1. `provider.installSidecar(target, context)` — line 92
  2. Resume vs fresh-start decision based on `descriptor.supportsResume`, `provider.supportsResume()`, `session.externalSessionId`, and `session.runtimeState` — lines 95-113
  3. `manager.markRuntimeStarting(session.id, summary, activeExternalSessionId)` — line 134
  4. `ptyHost.start(session.id, command, onData, onExit, shellIntegration)` — line 145
  5. `manager.markRuntimeAlive(session.id, activeExternalSessionId)` — line 182
  6. On process exit (via callback): `manager.markRuntimeExited(session.id, exitCode, summary)` — line 163
- The `onData` callback forwards to `manager.appendTerminalData({ sessionId, data })` — line 149
- Stale exit protection via `launchToken` / `isLaunchTokenCurrent` — lines 153-158
- Synchronous exit during start is handled: `exitObservedDuringStart` flag skips `markRuntimeAlive` — lines 176-179
- `requireExternalSessionIdForResume` option throws if a resumable session has no external ID — lines 102-109

**Layer 2: `launchTrackedSessionRuntime`** (`src/main/launch-tracked-session-runtime.ts:37-102`)
- Orchestrator that resolves dependencies before calling `startSessionRuntime`.
- Looks up session and project from `ProjectSessionManager.snapshot()` — lines 38-47
- Resolves provider descriptor and gets provider — lines 49-50
- Calls `hookLeaseManager.ensureLease(...)` to get a runtime lease — lines 52-57
- Registers session secret with `sessionEventBridge` — lines 59-61
- Registers codex launch intent for codex sessions — lines 63-69
- Assembles the full `StartSessionRuntimeOptions` and delegates to `startSessionRuntime` — lines 71-99
- Returns `true` if launched, `false` if session/project not found.

**Layer 3: `SessionRuntimeController`** (`src/main/session-runtime-controller.ts:27-167`)
- Implements `SessionRuntimeManager` interface.
- Delegates state transitions to `ProjectSessionManager` and pushes events to the renderer window.
- Owns three runtime-only maps:
  - `terminalBacklogs: Map<string, string>` — accumulated terminal output per session — line 28
  - `pendingTerminalBatches: Map<string, string>` — batched terminal data pending flush — line 29
  - `batchFlushTimer` — throttles terminal data sends at 16ms intervals — line 30
- Each state transition method calls `finishSessionStateChange(sessionId)` which:
  1. `pushSessionEvent(sessionId)` — sends `sessionEvent` IPC with full session snapshot — lines 124-136
  2. `pushObservabilitySnapshots(sessionId)` — sends observability updates — lines 138-166
  3. `onSessionStateChanged` callback — line 121
- Terminal data is batched: `appendTerminalData` accumulates into `pendingTerminalBatches`, flushed every 16ms via `scheduleBatchFlush` / `flushTerminalBatch`.

**SessionRuntimeManager Interface** (`src/core/session-runtime.ts:6-12`):
```typescript
export interface SessionRuntimeManager {
  markRuntimeStarting: (sessionId: string, summary: string, externalSessionId: string | null) => Promise<void>
  markRuntimeAlive: (sessionId: string, externalSessionId: string | null) => Promise<void>
  markRuntimeExited: (sessionId: string, exitCode: number | null, summary: string) => Promise<void>
  markRuntimeFailedToStart: (sessionId: string, summary: string) => Promise<void>
  appendTerminalData: (chunk: { sessionId: string; data: string }) => Promise<void>
}
```

**Session state flow** (`src/shared/project-session.ts`):
- `SessionRuntimeState = 'created' | 'starting' | 'alive' | 'exited' | 'failed_to_start'` — line 44
- `TurnState = 'idle' | 'running'` — line 45
- State transitions are applied through `SessionStatePatchEvent` with `SessionStateIntent` — lines 62-79

**Resume decision logic** (`src/core/session-runtime.ts:95-113`):
- `hasResumeBoundary` = session runtimeState is not 'created' or 'starting' — line 95
- `canResume` requires all of: `descriptor.supportsResume`, `provider.supportsResume()`, `session.externalSessionId` present, and `hasResumeBoundary` — lines 96-100
- Provider descriptors define `supportsResume` and `seedsExternalSessionId` per session type (`src/shared/provider-descriptors.ts`).

**External session ID handling** (`src/shared/project-session.ts:143-151`):
- `createSessionExternalId`: if `externalSessionId` explicitly provided, use it; otherwise if `seedsExternalSessionId` is true, generate a UUID; else null.
- Only `claude-code` seeds external session IDs at creation time.

#### 2. Where Tree-Aware Start Semantics Need to be Threaded

**`StartSessionRuntimeOptions.session` shape** (`src/core/session-runtime.ts:25-53`):
- Currently flat. No `parentId`, `childIds`, or `treeRole` field.
- Tree linkage fields would need to be added here first.

**Insertion points for tree-aware start semantics (ordered by layer):**

1. **`src/shared/project-session.ts` — `SessionSummary` / `PersistedSession`** (lines 122-186):
   - Add optional `parentId: string | null` and `treeRole: 'root' | 'child' | 'standalone'` fields.
   - `PersistedSession` needs the same for disk persistence.
   - `CreateSessionRequest` (line 279) could accept `parentId`.

2. **`src/core/project-session-manager.ts` — `createSession`** (line 483):
   - When creating a child session, validate `parentId` exists and belongs to the same project.
   - Store the relationship.

3. **`src/core/session-runtime.ts` — `StartSessionRuntimeOptions`** (line 24):
   - Add `parentId?: string` and any tree-specific context (e.g., `treeToken` for linking).
   - The `toProviderTarget` function (line 55) maps session fields to `ProviderRuntimeTarget` — tree context could be propagated to providers via this target or the `ProviderCommandContext`.

4. **`src/core/session-runtime.ts` — `ProviderCommandContext`** (`src/shared/project-session.ts:440-455`):
   - Tree context (parent session ID, tree token) could be added as env vars in the command context, so providers can be aware of their tree position.

5. **`src/main/launch-tracked-session-runtime.ts`** (line 37):
   - When launching a child session, resolve the parent's runtime state first.
   - May need to wait for parent to reach `alive` before starting children.
   - Hook lease resolution may need to reference the parent's lease.

6. **`src/main/session-runtime-controller.ts`** (line 27):
   - Tree-aware event propagation: when a child session state changes, may need to notify the parent's consumers.
   - The `finishSessionStateChange` method (line 118) could trigger parent-level aggregation.

7. **`src/core/pty-host.ts`** (line 84):
   - Currently no tree awareness. The `sessions` map is flat `Map<string, IPty>`.
   - If tree semantics require coordinated PTY lifecycle (e.g., kill children when parent exits), this is where to add it.

8. **`src/main/index.ts`** — where `launchTrackedSessionRuntime` is called (lines 815, 990):
   - Bootstrap recovery plan (`buildBootstrapRecoveryPlan` at `src/core/project-session-manager.ts:328`) would need tree-aware ordering: parents before children.

#### 3. Where a Runtime-Only Token Registry Could Live

**Option A: Inside `SessionRuntimeController`** (least disruption)
- The controller already owns runtime-only maps: `terminalBacklogs` and `pendingTerminalBatches` (`src/main/session-runtime-controller.ts:28-29`).
- Adding a `treeTokens: Map<string, string>` (or more structured registry) follows the existing pattern.
- The controller already receives all session state transitions, so it can maintain token-to-session mappings.
- Token lifecycle naturally aligns with session lifecycle: register on `markRuntimeAlive`, clear on `markRuntimeExited`.

**Option B: Inside `PtyHost`** (`src/core/pty-host.ts:84`)
- `PtyHost` already has `runtimeTokens: Map<string, number>` for generation tracking (line 87).
- A tree token registry could be a sibling map, but this mixes concerns — PTY management vs session tree topology.

**Option C: New standalone class in `src/main/`**
- A dedicated `SessionTreeRegistry` or similar, constructed alongside `SessionRuntimeController` in `src/main/index.ts` (line 544).
- Cleanest separation of concerns, but adds a new dependency to thread through.

**Recommendation**: Option A is least disruptive. The `SessionRuntimeController` already:
- Is injected into `launchTrackedSessionRuntime` via `runtimeController` parameter.
- Receives all lifecycle transitions (`markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited`).
- Has the window handle for pushing tree-aware events to the renderer.
- Is the natural bridge between `ProjectSessionManager` (persistence) and the renderer (UI).

The closest existing runtime maps are:
| Map | Location | Purpose |
|-----|----------|---------|
| `terminalBacklogs` | `session-runtime-controller.ts:28` | Per-session terminal output accumulation |
| `pendingTerminalBatches` | `session-runtime-controller.ts:29` | Per-session pending terminal data for batch flush |
| `PtyHost.sessions` | `pty-host.ts:85` | `Map<string, IPty>` — active PTY processes by session ID |
| `PtyHost.runtimeTokens` | `pty-host.ts:87` | `Map<string, number>` — generation counter for stale-exit protection |
| `PtyHost.exitWaiters` | `pty-host.ts:86` | `Map<string, ExitWaiter>` — exit promise per session |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| startSessionRuntime lifecycle: installSidecar -> resume decision -> markRuntimeStarting -> ptyHost.start -> markRuntimeAlive | `src/core/session-runtime.ts` | lines 66-185 |
| SessionRuntimeManager interface (5 methods) | `src/core/session-runtime.ts` | lines 6-12 |
| StartSessionRuntimeOptions shape (session, provider, ptyHost, manager, launchToken, etc.) | `src/core/session-runtime.ts` | lines 24-53 |
| Resume decision: supportsResume + externalSessionId + hasResumeBoundary | `src/core/session-runtime.ts` | lines 95-113 |
| Stale exit protection via launchToken | `src/core/session-runtime.ts` | lines 153-158 |
| Synchronous exit during start skips markRuntimeAlive | `src/core/session-runtime.ts` | lines 176-179 |
| requireExternalSessionIdForResume throws on missing external ID | `src/core/session-runtime.ts` | lines 102-109 |
| SessionRuntimeController implements SessionRuntimeManager | `src/main/session-runtime-controller.ts` | line 27 |
| Controller runtime-only maps: terminalBacklogs, pendingTerminalBatches | `src/main/session-runtime-controller.ts` | lines 28-30 |
| Controller finishSessionStateChange pushes sessionEvent + observability + callback | `src/main/session-runtime-controller.ts` | lines 118-166 |
| Terminal data batched at 16ms intervals | `src/main/session-runtime-controller.ts` | lines 75-112 |
| launchTrackedSessionRuntime resolves deps then calls startSessionRuntime | `src/main/launch-tracked-session-runtime.ts` | lines 37-102 |
| Hook lease resolution in launch layer | `src/main/launch-tracked-session-runtime.ts` | lines 52-57 |
| Codex launch intent registration | `src/main/launch-tracked-session-runtime.ts` | lines 63-69 |
| PtyHost.sessions map (Map<string, IPty>) | `src/core/pty-host.ts` | line 85 |
| PtyHost.runtimeTokens generation counter | `src/core/pty-host.ts` | line 87 |
| SessionRuntimeState = created/starting/alive/exited/failed_to_start | `src/shared/project-session.ts` | line 44 |
| TurnState = idle/running | `src/shared/project-session.ts` | line 45 |
| SessionSummary shape (flat, no parent field) | `src/shared/project-session.ts` | lines 122-145 |
| PersistedSession shape (flat, no parent field) | `src/shared/project-session.ts` | lines 163-186 |
| CreateSessionRequest accepts projectId, type, title, externalSessionId | `src/shared/project-session.ts` | lines 279-286 |
| ProviderCommandContext shape | `src/shared/project-session.ts` | lines 440-455 |
| ProviderDescriptor: supportsResume, seedsExternalSessionId per type | `src/shared/provider-descriptors.ts` | lines 3-13, 15-60 |
| Controller constructed in main/index.ts | `src/main/index.ts` | line 544 |
| launchTrackedSessionRuntime called in main/index.ts | `src/main/index.ts` | lines 815, 990 |
| Bootstrap recovery plan is flat session list | `src/core/project-session-manager.ts` | lines 328-340 |
| createSessionExternalId: seeds UUID for claude-code only | `src/core/project-session-manager.ts` | lines 143-151 |

### Risks / Unknowns

- [!] The `SessionRuntimeManager` interface is used as the `manager` parameter in `startSessionRuntime` AND as the type for `runtimeController` in `launchTrackedSessionRuntime`. Adding tree methods to this interface will require all implementations (test mocks, `SessionRuntimeController`) to be updated.
- [!] `toProviderTarget` maps session fields to `ProviderRuntimeTarget`. Adding tree fields here affects the provider interface contract.
- [?] The `hookSpawnOwnerInstanceId` and `hookSpawnGeneration` fields in `StartSessionRuntimeOptions.session` already carry some parent-child semantics (owner instance tracking). Whether these can be reused or must be extended for tree support needs investigation.
- [?] Whether providers (claude-code, codex, opencode) need to be aware of their tree position via environment variables or command arguments is an open design question.
- [?] The `PtyHost.runtimeTokens` map is for generation/stale-exit tracking, not session relationships. A separate tree registry is needed.
