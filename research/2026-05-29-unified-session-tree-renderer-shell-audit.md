---
date: 2026-05-29
topic: unified-session-tree renderer UI implementation audit
status: completed
mode: context-gathering
sources: 15 evidence items
---

## Context Report: Unified Session Tree Renderer UI Implementation Status

### Why This Was Gathered

Bounded read-only audit of renderer UI surface implementation status against `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` (spec). Focus on AppShell, GlobalActivityBar, and related renderer components.

### Summary

The renderer shell has made solid structural progress: meta-session UI files deleted, `SessionGraphEvent` push infrastructure wired up, tree projection store functions exist, archive moved into command surface. However, **the recursive session tree is not implemented** — `WorkspaceHierarchyPanel` still renders a flat session list per project with no depth hierarchy, no child row actions (Inspect/Prompt/Destroy), and no tree-structured archived section. The preload has a bug where `onSessionGraphEvent` subscribes to the wrong IPC channel.

---

### Key Findings

#### Already Implemented

| Item | Evidence |
|------|----------|
| Session model extended with `parentSessionId` / `createdBySessionId` | `src/shared/project-session.ts:125-126` |
| `SessionTreeMeta`, `SessionNodeSnapshot`, `SessionGraphEvent` interfaces | `src/shared/project-session.ts:303-321` |
| `session:graph-event` IPC channel defined | `src/core/ipc-channels.ts:32` |
| Independent meta-session UI files deleted | git status shows `D src/renderer/components/meta-session/**` |
| Tree projection via `projectSessionsIntoTree()` | `src/renderer/stores/workspaces.ts:62-165` |
| `upsertSession()` with tree meta hint storage | `src/renderer/stores/workspaces.ts:408-426` |
| `applySessionGraphEvent()` handler (created/updated/archived/restored/destroyed) | `src/renderer/stores/workspaces.ts:484-519` |
| App.vue subscribes to `onSessionGraphEvent` | `src/renderer/app/App.vue:225-228` |
| Archive shown inside CommandSurface (not separate meta-surface) | `src/renderer/components/AppShell.vue:73-78` |
| GlobalActivityBar: command/archive/settings with sidebar toggle | `src/renderer/components/GlobalActivityBar.vue:34-74` |
| AppShell 3-column grid: `[56px_1fr_auto]` | `src/renderer/components/AppShell.vue:50` |
| Sidebar store wired to activity bar toggle button | `src/renderer/components/GlobalActivityBar.vue:132` |

#### Missing or Deviating from Spec

| # | Spec Requirement | Current State | Gap |
|---|-----------------|---------------|-----|
| 1 | **Recursive session tree** — `WorkspaceHierarchyPanel` must be a recursive tree renderer with project → root sessions → child sessions | Renders flat `project.sessions` array with no parent-child linkage | `WorkspaceHierarchyPanel.vue:404-462` iterates flat list; no recursive row component |
| 2 | **Depth-scaled indentation** — sub session rows must indent proportionally to `treeDepth` | Only fixed `.child` class with `20px` left padding | `WorkspaceHierarchyPanel.vue:575-579` has fixed indent, not depth-scaled |
| 3 | **Session row actions per spec §Session Row 动作** — Create Child / Inspect / Prompt / Destroy must be on the row | Only `archive` row action plus context menu with Regenerate/Restart | `WorkspaceHierarchyPanel.vue:434-461` has archive only; no Create Child/Inspect/Prompt/Destroy |
| 4 | **Child count / descendant count display** — rows must show `treeChildCount` / `treeDescendantCount` | No count badges on session rows | `WorkspaceHierarchyPanel.vue:403-462` — no count data rendered |
| 5 | **TreeDepth visual indicator** — rows must show depth context | No depth display | Session rows have no depth indicator |
| 6 | **Archived section tree-structured in command surface** — spec §4.3 says archived must remain in same command surface with tree structure, collapsible by default | Archive is a separate `v-if` surface with flat card list | `AppShell.vue:73-77` uses separate `ArchiveSurface`; spec wants it inside CommandSurface |
| 7 | **Collapse/expand per sub session node** — spec §左侧 Session Tree says each session row can expand to show children | No per-session expand/collapse | `WorkspaceHierarchyPanel.vue` only has project-level collapse |
| 8 | **Backend derives tree metadata** — spec says `rootSessionId`/`depth`/`childCount`/`descendantCount` come from backend as `SessionTreeMeta`, not frontend-derived | `workspaces.ts:62-165` derives tree metadata in frontend via `projectSessionsIntoTree()` | Frontend inference may differ from backend authority |
| 9 | **Preload subscription bug** — `onSessionGraphEvent` registers listener on `IPC_CHANNELS.sessionEvent` instead of `IPC_CHANNELS.sessionGraphEvent` | `src/preload/index.ts:191` uses wrong channel | Will receive wrong event type |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Flat session list rendering | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | lines 404-462: `v-for="session in project.sessions"` — no recursive child rendering |
| Fixed indent (not depth-scaled) | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | lines 575-579: `.child { padding: 2px 8px 2px 20px }` — constant 20px |
| Only archive row action | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | lines 434-461: only archive button in `route-row-actions` |
| Context menu has Regenerate/Restart only | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | lines 116-127: `sessionContextMenuItems()` — missing Inspect/Prompt/Destroy |
| No child count display | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | No `treeChildCount` / `treeDescendantCount` in template |
| Archive is separate surface | `src/renderer/components/AppShell.vue` | lines 73-77: `v-if="activeSurface === 'archive'"` with separate `ArchiveSurface` |
| Preload uses wrong channel for graph event | `src/preload/index.ts` | line 191: `ipcRenderer.on(IPC_CHANNELS.sessionEvent, handler)` — should be `sessionGraphEvent` |
| App.vue prefers graph event but with fallback | `src/renderer/app/App.vue` | lines 225-239: checks `window.stoa.onSessionGraphEvent` first |
| Tree projection in store | `src/renderer/stores/workspaces.ts` | lines 62-165: `projectSessionsIntoTree()` |
| ArchiveSurface is flat list | `src/renderer/components/archive/ArchiveSurface.vue` | lines 32-64: `v-for="session in archivedSessions"` flat iteration |

### Risks / Unknowns

- [!] **Preload channel bug** — `onSessionGraphEvent` at `src/preload/index.ts:191` uses `sessionEvent` channel instead of `sessionGraphEvent`. This means if the backend ever starts sending `SessionGraphEvent` on the correct channel, the preload will not receive it correctly. Current fallback behavior in `App.vue:230-238` silently handles missing graph event support by falling back to flat `onSessionEvent`, but this bypasses the tree structure entirely.
- [!] **Backend tree metadata not confirmed** — the spec says backend should provide `SessionNodeSnapshot.tree` with authoritative `rootSessionId`/`depth`/`childCount`/`descendantCount`. This audit did not verify whether the main process actually provides these on bootstrap or event push. Frontend tree projection (`projectSessionsIntoTree`) currently derives these values locally, which may conflict with backend authority.
- [?] **Archive integration point** — spec §4.3 says archived section must be inside command surface as collapsible section. Current implementation uses a separate `ArchiveSurface` toggled by `activeSurface === 'archive'`. Whether this should be refactored into the command surface or if the spec should be updated to match current behavior is an open question.
- [?] **Create Child call path** — `CreateSessionRequest` at `src/shared/project-session.ts:287` includes optional `parentSessionId`, but `WorkspaceHierarchyPanel` only emits `{projectId, type, title}` without a parent. No UI exists to trigger child session creation with a parent reference.

### Recommended Implementation Order

Based on spec §实现顺序 and gap analysis:

1. **Fix preload bug** (`src/preload/index.ts:191`) — swap `sessionEvent` → `sessionGraphEvent` for the graph event listener
2. **Implement recursive session tree renderer** — replace flat `project.sessions` iteration with a recursive `SessionTreeNode` component in `WorkspaceHierarchyPanel` that renders children based on `parentSessionId`
3. **Add depth-scaled indentation** — compute indent from `treeDepth` field (e.g., `20px + depth * 16px`)
4. **Add child count / descendant count badges** — render `treeChildCount` / `treeDescendantCount` on each session row
5. **Add row actions** — Create Child, Inspect, Prompt, Destroy buttons/menu items on session rows (matching spec §Session Row 动作)
6. **Add collapse/expand per session node** — each row can expand to show/hide direct children
7. **Integrate archived section into command surface** — move archived tree rendering inside `CommandSurface` as a collapsible per-project section per spec §4.3
8. **Verify backend tree metadata authority** — confirm main process sends `SessionNodeSnapshot.tree` on bootstrap and events, then remove frontend derivation
9. **Wire up Create Child IPC** — add `createSession` call with `parentSessionId` from the UI