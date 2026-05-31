---
date: 2026-05-29
topic: orca-frontend-child-visibility
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Orca Frontend/Control-Plane Patterns for Child Session/Agent Visibility

### Why This Was Gathered
Implementing unified-session-tree's sidebar/tab/session-list rendering for backend-created child sessions. Need to understand how Orca handles async appearance of agent rows, worktree lineage, and visibility filtering.

### Summary
Orca uses a **push-based, upsert-in-store** architecture. The main process runs a loopback HTTP hook server that receives agent status events from CLI hooks; these are relayed to the renderer via `webContents.send('agentStatus:set', ...)`. The renderer subscribes via preload IPC, calls `store.setAgentStatus()` (a Zustand upsert), and derived selectors compute per-worktree agent rows, visibility lists, and smart-sort ordering. There is **no polling** for agent status. Snapshot hydration happens once at startup. Lineage (parent-child worktree relationships) is rendered as indented tree rows in the sidebar via `worktree-list-groups.ts`.

### Key Findings

#### 1. Data Flow: Hook Server → IPC Push → Zustand Upsert

- Main process runs `AgentHookServer` (loopback HTTP) that receives status from agent CLI hooks
- Main registers a `setListener` callback in `src/main/index.ts:526-577` that calls `mainWindow.webContents.send('agentStatus:set', payload)`
- Renderer subscribes via `window.api.agentStatus.onSet()` in `src/renderer/src/hooks/useIpcEvents.ts:2199`
- Events are routed to `store.setAgentStatus(paneKey, payload)` — a **per-paneKey upsert** in `src/renderer/src/store/slices/agent-status.ts`

#### 2. No Polling — Push + One-Time Snapshot

- Agent status is **push-only** from main→renderer
- On startup, renderer pulls a one-time snapshot via `window.api.agentStatus.getSnapshot()` (IPC invoke to `agentStatus:getSnapshot`) in `useIpcEvents.ts:2151-2170`
- Snapshot is requested only after `workspaceSessionReady` is true, preventing early-startup races
- No periodic polling of agent status exists

#### 3. Per-Worktree Agent Row Derivation (Derived Grouping)

- `useWorktreeAgentRows.ts` provides a per-worktree hook that derives `DashboardAgentRow[]` from the store
- Uses **indexed per-worktree selectors** via `selectLiveAgentStatusEntriesForWorktree(state, worktreeId)` — avoids O(worktrees^2) re-renders
- Agent rows are built from three sources:
  - **Live entries**: `agentStatusByPaneKey` — active hook-reported status
  - **Migration-unsupported entries**: legacy PTY panes without stable pane keys
  - **Retained entries**: snapshots of finished agents kept visible until user dismissal
- Rows are stale-decayed: entries older than `AGENT_STATUS_STALE_AFTER_MS` (30 min) decay from `working`→`idle`

#### 4. Agent Lineage (Parent-Child Agent Trees)

- `WorktreeCardAgents.tsx` renders inline agent rows per worktree card
- `buildAgentLineageModel()` in `WorktreeCardAgents.tsx:72-120` builds parent-child trees from `entry.orchestration?.parentPaneKey`
- Cycle detection prevents infinite recursion
- Root agents render flat; children render nested under expandable parents
- Orchestration context (`taskId`, `dispatchId`, `parentPaneKey`, `coordinatorHandle`) is carried on `AgentStatusEntry.orchestration`

#### 5. Worktree Lineage (Parent-Child Worktree Trees in Sidebar)

- `WorktreeLineage` type in shared/types tracks `parentWorktreeId` + instance IDs
- `computeVisibleWorktreeIds()` in `visible-worktrees.ts` uses `addVisibleLineageAncestors()` — ensures filtered children never become orphans by force-including their parent
- `worktree-list-groups.ts` renders lineage as indented `WorktreeRow` objects with `depth`, `lineageTrail`, `lineageChildCount`, `lineageGroupKey`
- Lineage rows support collapse/expand per parent

#### 6. Visibility Filtering Pipeline

- `computeVisibleWorktreeIds()` applies a **pure pipeline**:
  1. Filter archived worktrees
  2. Filter default-branch workspaces (if `hideDefaultBranchWorkspace`)
  3. Filter by selected repos (`filterRepoIds`)
  4. Filter sleeping/inactive workspaces (if `!showSleepingWorkspaces`)
  5. Sort by cached order (smart/manual), new items appended at end
  6. Force-include lineage ancestors of visible children
- Sidebar and Cmd+1-9 shortcuts share the same `computeVisibleWorktreeIds()` function to prevent numbering drift
- WorktreeList caches its sort order via `sortedIds / sortEpoch` with a 3-second settle delay

#### 7. Smart Sort (Attention-Based Ordering)

- `smart-attention.ts` assigns ordinal classes 1-4:
  - Class 1: needs user attention (`blocked`, `waiting`)
  - Class 2: done
  - Class 3: working
  - Class 4: idle
- Within-class ordering by attention timestamp
- Freshness scheduler (`agent-status-freshness-scheduler.ts`) bumps `agentStatusEpoch` when entries cross the 30-min stale boundary, forcing re-sort

#### 8. Store Architecture (Zustand Slices)

- `agent-status.ts` slice manages: `agentStatusByPaneKey`, `migrationUnsupportedByPtyId`, `retainedAgentsByPaneKey`, `retentionSuppressedPaneKeys`, `agentStatusEpoch`
- `setAgentStatus` is a full upsert: checks `updatedAt` for staleness, preserves identity fields (agentType, terminalTitle, orchestration), builds rolling state history
- Drop operations (`dropAgentStatus`, `dropAgentStatusByTabPrefix`, `dropAgentStatusByWorktree`) also suppress future re-retention

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Hook server → IPC push via setListener | `src/main/index.ts` | `index.ts:526-577` |
| Preload IPC bridge for agentStatus | `src/preload/index.ts` | `index.ts:3277-3313` |
| Renderer subscribes via onSet | `src/renderer/src/hooks/useIpcEvents.ts` | `useIpcEvents.ts:2122-2234` |
| Store upsert with state history | `src/renderer/src/store/slices/agent-status.ts` | `agent-status.ts:150-300` |
| Per-worktree agent row derivation | `src/renderer/src/components/sidebar/useWorktreeAgentRows.ts` | full file |
| Agent lineage model (parent-child) | `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx` | `WorktreeCardAgents.tsx:72-120` |
| Worktree lineage ancestor inclusion | `src/renderer/src/components/sidebar/visible-worktrees.ts` | `visible-worktrees.ts:computeVisibleWorktreeIds` |
| Sidebar row grouping with lineage depth | `src/renderer/src/components/sidebar/worktree-list-groups.ts` | `worktree-list-groups.ts:58-64, 265-285` |
| Smart sort attention classes | `src/renderer/src/components/sidebar/smart-attention.ts` | `smart-attention.ts:1-80` |
| Orchestration coordinator (task dispatch) | `src/main/runtime/orchestration/coordinator.ts` | full file |
| Agent status types with orchestration context | `src/shared/agent-status-types.ts` | `agent-status-types.ts:1-100` |
| Startup snapshot hydration | `src/renderer/src/hooks/useIpcEvents.ts` | `useIpcEvents.ts:2151-2170` |
| Hook server with persistence | `src/main/agent-hooks/server.ts` | full file |
| Orchestration groups for agent management | `src/main/runtime/orchestration/groups.ts` | full file |

### Risks / Unknowns

- [!] Orca's orchestration coordinator (`coordinator.ts`) uses a **polling loop** (default 2s) for monitoring dispatched tasks, but this is main-process only — the renderer never polls
- [?] The `agentStatusByPaneKey` map lives only in renderer memory (not persisted). Persistence is at the main-process `last-status.json` level, replayed on restart via snapshot
- [?] How SSH relay events propagate — `ingestRemote` path exists but details were not fully traced
- [?] Mobile/web session sync uses a different path (`web-session-tabs-sync.ts`, `sync-runtime-graph.ts`) not fully analyzed here
