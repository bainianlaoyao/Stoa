---
date: 2026-05-29
topic: orca-ui-sync-patterns
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Orca Upstream UI Synchronization and Source-of-Truth Patterns

### Why This Was Gathered

Researching how Orca handles frontend synchronization patterns — specifically runtime vs persisted state, store architecture, polling/invalidation, and how CLI/runtime state surfaces to the UI — for potential reuse in stoia frontend sync design.

### Summary

Orca uses a single Zustand store (not TanStack Query) as the unified source of truth for all renderer state. Synchronization is primarily event-driven via IPC subscriptions to preload channels, with targeted polling for git status (3s interval) and a timer-based freshness scheduler for agent status (30-min decay). The key architectural pattern is a **dual-layer worktree state**: a "visible" layer derived from UI needs and an "authoritative" layer from `git worktree list` scans, with explicit diff-and-purge logic when the authoritative layer reports deletions that the visible layer still holds.

### Key Findings

#### 1. Single Zustand Store as Universal State Container

Orca does **not** use TanStack Query. All UI state lives in one Zustand store (`src/renderer/src/store/index.ts`, line 34) composed of ~30 slices. No `QueryClient`, no `useQuery`/`useMutation`. The store itself is the cache.

```ts
// src/renderer/src/store/index.ts:34
export const useAppStore = create<AppState>()((...a) => ({
  ...createRepoSlice(...a),
  ...createSparsePresetsSlice(...a),
  ...createWorktreeSlice(...a),
  // ... 27 more slices
}))
```

Selector caching uses `WeakMap` keyed by store slice reference identity to avoid re-running expensive flatten/map operations on every write (`src/renderer/src/store/selectors.ts:17-19`).

#### 2. Dual-Layer Worktree State (Detected vs. Visible)

This is the central source-of-truth pattern in Orca:

- **`worktreesByRepo`**: "visible" worktrees — what the UI renders. UI-derived mutations (displayName, comment, isPinned) live here.
- **`detectedWorktreesByRepo`**: "authoritative" scan results from `git worktree list`. Includes raw metadata (`ownership`, `selectedCheckout`, `visible`) that is stripped for the visible layer.

```ts
// src/renderer/src/store/slices/worktrees.ts:579-592
fetchDetectedWorktrees: async (repoId) => {
  try {
    const result = await listDetectedWorktreesForRepo(get().settings, repoId)
    set((s) =>
      areDetectedWorktreeResultsEqual(s.detectedWorktreesByRepo[repoId], result)
        ? s  // no-op if unchanged
        : { detectedWorktreesByRepo: { ...s.detectedWorktreesByRepo, [repoId]: result } }
    )
  }
}
```

The detected layer has an `authoritative: boolean` flag — true when the scan came from `git worktree list`, false when it came from the session fallback (older runtime servers only have `worktree.list`).

**Why this matters**: `worktrees.onChanged` (file watcher event from main) and `fetchWorktrees` (explicit refresh) can race. When both fire, the authoritative layer is the durable source. The renderer diffs `before` vs. `after` to detect server-side deletions and calls `purgeWorktreeTerminalState(removed)` to cascade-clean all worktree-scoped state (`tabsByWorktree`, `ptyIdsByTabId`, `openFiles`, `gitStatusByWorktree`, etc.) (`src/renderer/src/hooks/useIpcEvents.ts:558-582`).

#### 3. Event-Driven Sync via Preload IPC Subscriptions

All main→renderer state flow goes through `window.api.*` preload channels in a single centralized hook (`src/renderer/src/hooks/useIpcEvents.ts:520`). No polling for worktrees/repos/settings — only push events.

```ts
// src/renderer/src/hooks/useIpcEvents.ts:534-543
unsubs.push(
  window.api.repos.onChanged(() => {
    if (isRuntimeEnvironmentActive()) {
      // Guard: runtime server owns repo hydration when active
      return
    }
    useAppStore.getState().fetchRepos()
  })
)

unsubs.push(
  window.api.worktrees.onChanged(async (data: { repoId: string }) => {
    if (isRuntimeEnvironmentActive()) { return }
    const before = getAuthoritativeDetectedWorktreeIds(state, data.repoId) ?? ...
    await state.fetchWorktrees(data.repoId)
    const after = getAuthoritativeDetectedWorktreeIds(afterState, data.repoId)
    if (removed.length > 0) { afterState.purgeWorktreeTerminalState(removed) }
  })
)
```

Key pattern: before-and-after diff on authoritative detected ids to catch out-of-band deletions (CLI `orca worktree rm`, other window, remote runtime RPC). Without this, `ptyIdsByTabId` retains zombie entries and SessionsStatusSegment misclassifies dead PTYs as bound.

#### 4. Git Status Polling (3s Interval)

Explicit polling exists for git status (`src/renderer/src/components/right-sidebar/useGitStatusPolling.ts:12`):

```ts
// src/renderer/src/components/right-sidebar/useGitStatusPolling.ts:12
const POLL_INTERVAL_MS = 3000
```

Polling respects window visibility via `installWindowVisibilityInterval` — pauses when hidden, runs when visible/unfocused (second-display workflows need fresh status). Keeps at most one poll in flight; coalesces skipped ticks into one trailing pass to avoid process pileups.

Conflict operation (merge/rebase) is polled separately for non-active worktrees at the same 3s interval — lightweight fs-only check, not full git status.

#### 5. Agent Status Freshness Scheduler (Timer-Based, Not Polling)

Agent status entries decay from "fresh" to "stale" after `AGENT_STATUS_STALE_AFTER_MS` (30 minutes). The scheduler (`src/renderer/src/store/slices/agent-status-freshness-scheduler.ts:32-66`) maintains one `setTimeout` for the nearest expiry, advances the `agentStatusEpoch` on fire, then reschedules:

```ts
// src/renderer/src/store/slices/agent-status-freshness-scheduler.ts:32-66
const schedule = (): void => {
  clear()
  const entries = deps.getEntries()
  let nextExpiryAt = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const expiryAt = entry.updatedAt + AGENT_STATUS_STALE_AFTER_MS
    if (expiryAt > now) {
      nextExpiryAt = Math.min(nextExpiryAt, expiryAt)
    }
  }
  const delayMs = nextExpiryAt - now + 1  // +1 ensures firing strictly after boundary
  timer = setTimeout(() => {
    deps.bumpEpochs()
    schedule()
  }, delayMs)
}
```

`agentStatusEpoch` is a monotonic counter. Components that need staleness-aware rendering select this epoch and re-evaluate. Entries already past the stale boundary at insertion time skip rescheduling (the insertion already bumped the epoch).

#### 6. Remote Workspace Sync with Revision-Based Conflict Detection

Cross-device workspace sync uses a snapshot/revision system (`src/renderer/src/hooks/useIpcEvents.ts:350-394`):

- `applyRemoteWorkspaceSnapshot` merges remote session state into local store via `hydrateWorkspaceSession`, `hydrateTabsSession`, `hydrateEditorSession`, `hydrateBrowserSession`
- `remoteWorkspaceSnapshotApplyDepth` and `REMOTE_WORKSPACE_SNAPSHOT_WRITE_SUPPRESS_MS` (1s) prevent self-originated writes from bouncing back as fresh revisions
- Self-origination is detected by comparing `event.sourceClientId` against the local client ID from `window.api.remoteWorkspace.clientId()`
- Conflict detection: `result.reason === 'stale-revision'` triggers a `conflict` phase; the UI shows "Workspace changed on another device" with no auto-overwrite

#### 7. Persistence Layer (JSON File, Schema-Migrated)

`src/main/persistence.ts` handles all main-process state persistence:

- JSON files on disk with schema versioning
- `getDefaultPersistedState()` provides all defaults
- Migration functions run on load
- `workspaceSessionReady` flag gates the renderer startup sequence — UI mounts without session, then `hydrateWorkspaceSession` runs after settings/repos are fetched (`src/renderer/src/App.tsx:529-542`)

```ts
// src/renderer/src/App.tsx:529-542
await actions.fetchSettings()
await actions.fetchRepos()
// ... fetch all worktrees ...
for (const repo of repos) {
  await store.fetchWorktrees(repo.id)
}
actions.hydrateWorkspaceSession(session)
store.setWorkspaceSessionReady(true)
```

#### 8. Runtime Environment Guard Pattern

Many IPC subscriptions check `isRuntimeEnvironmentActive()` before applying local state:

```ts
// src/renderer/src/hooks/useIpcEvents.ts:547-550
window.api.worktrees.onChanged(async (data: { repoId: string }) => {
  if (isRuntimeEnvironmentActive()) {
    // Why: local worktree events carry local repo ids. Fetching the
    // active runtime with those ids can purge or overwrite server state.
    return
  }
```

This separates local disk events from remote runtime events. The runtime owns state for its connected targets; local IPC events are suppressed while a runtime is active.

#### 9. Selector Caching with WeakMap

Hot-path selectors (e.g., `useAllWorktrees`, `useWorktreeMap`) use WeakMap caching keyed by store slice identity:

```ts
// src/renderer/src/store/selectors.ts:17-19
const worktreeSnapshotCache = new WeakMap<AppState['worktreesByRepo'], WorktreeSnapshot>()
const hasAnyWorktreesCache = new WeakMap<AppState['worktreesByRepo'], boolean>()
```

When `worktreesByRepo` is replaced (new object reference), the old cache entry becomes eligible for GC. Deduplication of worktree IDs (handles race between `createWorktree` and `fetchWorktrees` producing duplicates) is also in the cache helper.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Zustand store, no TanStack Query | `src/renderer/src/store/index.ts` | line 1-34 |
| Dual-layer worktree state | `src/renderer/src/store/slices/worktrees.ts` | lines 567-592 |
| Authoritative scan results | `src/renderer/src/store/slices/worktrees.ts` | line 581 (`authoritative: boolean`) |
| Worktree event + diff purge | `src/renderer/src/hooks/useIpcEvents.ts` | lines 546-582 |
| Git status polling (3s) | `src/renderer/src/components/right-sidebar/useGitStatusPolling.ts` | line 12 |
| Agent status freshness scheduler | `src/renderer/src/store/slices/agent-status-freshness-scheduler.ts` | lines 32-66 |
| Remote workspace revision sync | `src/renderer/src/hooks/useIpcEvents.ts` | lines 350-394 |
| Session write suppress during apply | `src/renderer/src/hooks/useIpcEvents.ts` | lines 386-392 |
| Persistence layer | `src/main/persistence.ts` | lines 1-120+ |
| Startup sequence | `src/renderer/src/App.tsx` | lines 529-542 |
| Runtime environment guard | `src/renderer/src/hooks/useIpcEvents.ts` | lines 547-550 |
| Selector WeakMap caching | `src/renderer/src/store/selectors.ts` | lines 17-39 |
| IPC channel subscriptions (central) | `src/renderer/src/hooks/useIpcEvents.ts` | lines 520-2255 |

### Risks / Unknowns

- [!] Orca uses Electron IPC channels for sync. Stoia may use different IPC mechanism (webview bridge, shared worker). The pattern (subscribe to preload events, diff before/after) is transferable; the channel names are not.
- [!] Remote workspace sync uses relay-based cross-device session. This is a complex subsystem that Orca doesn't fully expose in the vendored tree — the relay and cloud sync logic is in a separate service.
- [?] No TanStack Query means no automatic retry/backoff on fetch failures. Orca's approach is: swallow errors on background fetches, rely on the next event or poll to refresh. This works when events are reliable; less so if they're lossy.
- [?] Agent status freshness is timer-based (30 min). For stoia, the freshness requirements may be different (e.g., much faster for CLI state).
- [?] The dual-layer detected/visible pattern adds complexity. Whether it's needed depends on how reliable the file watcher events are in stoia's context.

---

## Context Handoff: Orca UI Sync Patterns

Start here: `research/2026-05-29-orca-ui-sync-patterns-subagent.md`

Context only. Use the saved report as the source of truth.