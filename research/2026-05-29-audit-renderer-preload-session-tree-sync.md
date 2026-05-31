---
date: 2026-05-29
topic: renderer-preload-session-tree-sync-audit
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Renderer/Preload Session Tree Sync Audit

### Why This Was Gathered
Support the "unified session tree" renderer sync implementation. Goal: audit the 6 specified files for red points, identify parallel-edit conflicts, and produce an implementation checklist.

---

### Summary

The renderer bridge (`src/preload/index.ts`) is **missing `onSessionGraphEvent`** despite `RendererApi` declaring it (optional) and App.vue already subscribing to it. The `workspaces.ts` store has `applySessionGraphEvent` wired. Tests have a **structural mismatch**: `projectHierarchy` projections are asserted with `treeDepth`/`treeRootSessionId` fields that are not defined on `ProjectHierarchyNode`.

---

### Key Findings

#### F1: Preload missing `onSessionGraphEvent` bridge method
**File:** `src/preload/index.ts`
**Status:** NOT implemented
**Evidence:** `src/shared/project-session.ts:375` declares `onSessionGraphEvent?: (callback: (event: SessionGraphEvent) => void) => () => void` in `RendererApi`. `src/preload/index.ts` has `onSessionEvent` (lines 183-186) but no `onSessionGraphEvent` mapping. No IPC channel `session-graph-event` exists in `src/core/ipc-channels.ts`.

#### F2: App.vue already wires graph events (with fallback)
**File:** `src/renderer/app/App.vue`
**Status:** Already done
**Evidence:** Lines 224-232:
```typescript
if (window.stoa.onSessionGraphEvent) {
  unsubscribeSessionGraphEvents = window.stoa.onSessionGraphEvent((event: SessionGraphEvent) => {
    workspaceStore.applySessionGraphEvent(event)
  })
} else {
  unsubscribeSessionEvents = window.stoa.onSessionEvent((event) => {
    workspaceStore.updateSession(event.session.id, event.session)
  })
}
```
`unsubscribeSessionGraphEvents` is declared at line 156 and cleaned up in `onBeforeUnmount` (lines 262-270. No parallel-edit conflict).

#### F3: workspaces.ts has `applySessionGraphEvent`
**File:** `src/renderer/stores/workspaces.ts`
**Status:** Already done
**Evidence:** Lines 323-378 handle `'created' | 'updated' | 'archived' | 'restored' | 'destroyed'` kinds. `setActiveSession` is called only for renderer-origin creates (line 338). This correctly preserves active selection for background/session-origin creates.

#### F4: Test structural mismatch — `ProjectHierarchyNode` missing tree fields
**Files:** `src/renderer/stores/workspaces.ts`, `src/renderer/stores/workspaces.test.ts`
**Status:** Red point requiring fix
**Evidence:** `workspaces.test.ts:1495-1516` asserts `session.treeDepth`, `session.treeRootSessionId`, `session.treeChildCount`, `session.treeDescendantCount` on `ProjectHierarchyNode` sessions. But `workspaces.ts:11-15` defines `ProjectHierarchyNode.sessions` as `Array<SessionSummary & { active: boolean }>` — `SessionSummary` has no tree fields. `SessionNodeSnapshot` (`src/shared/project-session.ts:310-313`) has the tree via `tree: SessionTreeMeta`, but it is never projected into `ProjectHierarchyNode`.

**Fix needed:** Add tree fields to `ProjectHierarchyNode` projection in `projectHierarchy` computed (lines 64-87 in workspaces.ts).

#### F5: App.test.ts has graph event tests
**File:** `src/renderer/app/App.test.ts`
**Status:** Already updated
**Evidence:**
- Lines 553-587: fallback test with `onSessionGraphEvent: undefined`
- Lines 589-626: main graph event subscription test with `graphListener` variable

No parallel-edit conflict.

#### F6: workspaces.test.ts has `applySessionGraphEvent` tests
**File:** `src/renderer/stores/workspaces.test.ts`
**Status:** Tests exist but have structural mismatch (see F4)
**Evidence:** Lines 1374-1746 cover created/updated/archived/restored/destroyed events. The recursive hierarchy test (lines 1437-1517) asserts `treeDepth` etc.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `RendererApi` declares `onSessionGraphEvent` | `src/shared/project-session.ts:375` | `src/shared/project-session.ts` |
| Preload missing `onSessionGraphEvent` | `src/preload/index.ts` | entire file |
| No IPC channel for session graph event | `src/core/ipc-channels.ts` | lines 1-95 |
| App.vue wires graph events | `src/renderer/app/App.vue` | lines 224-232 |
| workspaces.ts has `applySessionGraphEvent` | `src/renderer/stores/workspaces.ts` | lines 323-378 |
| `ProjectHierarchyNode` missing tree fields | `src/renderer/stores/workspaces.ts` | lines 11-15 |
| Test asserts tree fields on hierarchy | `src/renderer/stores/workspaces.test.ts` | lines 1495-1516 |

---

### Risks / Unknowns

- [!] **F4 structural mismatch will cause test failure** — `workspaces.test.ts` line 1495 asserts `session.treeDepth` but `ProjectHierarchyNode.sessions` does not include tree fields from `SessionNodeSnapshot.tree`. This test will fail.
- [?] The IPC channel `sessionGraphEvent` does not exist in `ipc-channels.ts`. Main process must emit via the new channel. This is a separate backend task.
- [?] Whether `onSessionEvent` fallback is removed or kept permanently is a product decision — current App.vue code handles both.

---

## Implementation Checklist

### Step 1: Fix `ProjectHierarchyNode` to include tree metadata
**File:** `src/renderer/stores/workspaces.ts`

- [ ] Add `SessionTreeMeta` import from `@shared/project-session`
- [ ] Extend `ProjectHierarchyNode` to include tree fields on sessions:
  ```typescript
  sessions: Array<(SessionSummary & { active: boolean }) & Partial<SessionTreeMeta>>
  archivedSessions: Array<(SessionSummary & { active: boolean }) & Partial<SessionTreeMeta>>
  ```
- [ ] Update `projectHierarchy` computed (lines 64-87) to spread `node.tree` into each session projection
- [ ] Verify `workspaces.test.ts` lines 1495-1516 now pass

### Step 2: Add `onSessionGraphEvent` to preload bridge
**File:** `src/preload/index.ts`

- [ ] Add `sessionGraphEvent` IPC channel to `src/core/ipc-channels.ts` (separate backend work)
- [ ] Add `onSessionGraphEvent` method in preload `api` object (after `onSessionEvent`, around line 187):
  ```typescript
  onSessionGraphEvent(callback: (event: SessionGraphEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, event: SessionGraphEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.sessionGraphEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionGraphEvent, handler)
  },
  ```
- [ ] Note: `SessionGraphEvent` must be imported from `@shared/project-session`

### Step 3: Update `App.test.ts` mock
**File:** `src/renderer/app/App.test.ts`

- [ ] Verify `setupStoa()` at line 188 includes `onSessionGraphEvent` in the mock (already covered by `...overrides` spread at line 243, but explicit addition recommended for clarity)

### Step 4: Run tests to verify
- [ ] `npx vitest run src/renderer/stores/workspaces.test.ts`
- [ ] `npx vitest run src/renderer/app/App.test.ts`
- [ ] Full suite: `npm run test:all`