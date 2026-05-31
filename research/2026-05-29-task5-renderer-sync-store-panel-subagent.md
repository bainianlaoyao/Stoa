---
date: 2026-05-29
topic: unified-session-tree Task 5 renderer sync gaps audit
status: completed
mode: context-gathering
sources: 4
---

## Context Report: Unified Session Tree Task 5 — Renderer Sync Gaps

### Why This Was Gathered

Task 5 ("Renderer Session Tree And Meta-Session Removal") requires the store to upsert unknown child sessions from `SessionGraphEvent` and the hierarchy panel to render them asynchronously. The implementation plan (step 1) defines concrete expected behaviors that do not yet exist in the codebase. This audit identifies every gap between the current store/panel and the spec tree/read-model expectations.

---

### Summary

The current `workspaces.ts` store has no `applySessionGraphEvent`, `upsertSession`, or recursive tree-projection — only flat project→session filtering via `projectHierarchy`. `WorkspaceHierarchyPanel.vue` renders a flat `sessions[]` array with no support for child session rows or parent auto-expand. The `ProjectHierarchyNode` type lacks a `children` field. The spec explicitly expects `store.projectHierarchy[0].sessions[0].children[0].session.id` to resolve for background-created child sessions, which the current implementation cannot produce.

---

### Key Findings

#### Finding 1 — Store lacks `applySessionGraphEvent` / `upsertSession`

The store exposes `addSession(session)` and `updateSession(id, patch)` but **no upsert path** that can insert a session whose `parentSessionId` references a session not yet in `sessions.value`.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| No `applySessionGraphEvent` in store | `src/renderer/stores/workspaces.ts` | lines 30–353 (entire store) |
| No `upsertSession` in store | `src/renderer/stores/workspaces.ts` | same |
| `addSession` only does `sessions.value.push(session)` | `src/renderer/stores/workspaces.ts:265–268` | `addSession` function |
| `updateSession` only mutates found session | `src/renderer/stores/workspaces.ts:270–275` | `updateSession` function |
| Spec expects `applySessionGraphEvent(childCreatedEvent)` | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | Task 5 step 1 |

**Gap**: An async child session created by a provider (origin `'session'`) arrives as a `SessionGraphEvent` with `kind='created'` before its parent is in `sessions.value`. The store must handle this insertion.

---

#### Finding 2 — `ProjectHierarchyNode` has no `children` field

The current `ProjectHierarchyNode` interface is:

```ts
export interface ProjectHierarchyNode extends ProjectSummary {
  active: boolean
  sessions: Array<SessionSummary & { active: boolean }>
  archivedSessions: Array<SessionSummary & { active: boolean }>
}
```

The spec test expects `.children[0].session.id` on a session node (implying a recursive tree), but `sessions` is a flat array. No `children` field exists on individual session nodes.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| `ProjectHierarchyNode` has no `children` field | `src/renderer/stores/workspaces.ts` | lines 11–15 |
| `projectHierarchy` derives flat session arrays | `src/renderer/stores/workspaces.ts:64–87` | computed property |
| Spec expects `.children[0].session.id` | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | Task 5 step 1 test assertion |

**Gap**: Even if a child session were upserted, the tree projection would not place it under its parent's `.children[]` — it would appear as a flat sibling in `project.sessions[]`.

---

#### Finding 3 — `projectHierarchy` is a flat project→session filter, not a tree

`projectHierarchy` currently maps each project to flat `sessions` and `archivedSessions` arrays filtered by `projectId`:

```ts
const projectSessions = sessions.value
  .filter((session) => session.projectId === project.id && !session.archived)
  .map((session) => ({ ...session, active: session.id === activeSessionId.value }))
```

The spec expects recursive tree projection (`depth=2, max_depth=2`). There is no grouping by `parentSessionId`, no tree node construction, no depth limit.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| Flat `filter` by `projectId` | `src/renderer/stores/workspaces.ts:66–71` | `projectHierarchy` computed |
| No `parentSessionId` grouping | `src/renderer/stores/workspaces.ts` | entire store |
| Spec expects `depth=2, max_depth=2` | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | plan header context |

**Gap**: The read model cannot represent parent→child tree relationships needed for the unified session tree.

---

#### Finding 4 — No parent auto-expand on `kind='created'` event

The implementation plan specifies: "parent auto-expand on `kind='created'`". No mechanism exists in `workspaces.ts` to track which project rows should auto-expand when a child session is inserted.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| No collapse-state integration with graph events | `src/renderer/stores/workspaces.ts` | entire store |
| Panel tracks collapse state independently | `src/renderer/components/command/WorkspaceHierarchyPanel.vue:54` | `collapsedProjectIds` ref |
| Spec expects parent auto-expand | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | Task 5 step 1 |

**Gap**: When a child session is upserted via `applySessionGraphEvent`, the store has no action or signal to tell the panel to expand the parent project row.

---

#### Finding 5 — No active-session-stealing rule for background-created children

The spec step 1 test explicitly asserts: "background child create does not steal active session". The current `setActiveSession` does not guard against inadvertently selecting a newly-inserted child when the current active session remains alive.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| `setActiveSession` selects without guards | `src/renderer/stores/workspaces.ts:238–246` | `setActiveSession` |
| No check for `kind='created'` background session | `src/renderer/stores/workspaces.ts` | entire store |
| Spec expects child does not steal active | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | Task 5 step 1 |

**Gap**: An `applySessionGraphEvent` handler that calls `setActiveSession` would wrongly switch the active session when a background child is created.

---

#### Finding 6 — `SessionSummary` has lineage fields but store never uses them for tree derivation

`SessionSummary` (from `@shared/project-session.ts:122–147`) already carries `parentSessionId: string | null` and `createdBySessionId: string | null`. These fields exist but are never used by `projectHierarchy` for tree construction.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| `SessionSummary` has `parentSessionId` field | `src/shared/project-session.ts:125` | `SessionSummary` interface |
| `SessionSummary` has `createdBySessionId` field | `src/shared/project-session.ts:126` | `SessionSummary` interface |
| `projectHierarchy` ignores `parentSessionId` | `src/renderer/stores/workspaces.ts:64–87` | computed property |

**Gap**: The data model supports tree lineage but the read model does not consume it.

---

#### Finding 7 — `RendererApi` has no `onSessionGraphEvent` subscription channel

The preload bridge (`RendererApi`, `src/shared/project-session.ts:356–451`) has `onSessionEvent` (for `SessionSummaryEvent`) but no channel for `SessionGraphEvent`. The unified control plane generates `SessionGraphEvent` objects (spec, lines 315–321) that need a renderer subscription path.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| `RendererApi` has `onSessionEvent` | `src/shared/project-session.ts:374` | `RendererApi` interface |
| No `onSessionGraphEvent` in `RendererApi` | `src/shared/project-session.ts` | entire interface |
| Spec defines `SessionGraphEvent` shape | `src/shared/project-session.ts:315–321` | `SessionGraphEvent` interface |
| No subscription hook for graph events | `src/renderer/stores/workspaces.ts` | entire store |

**Gap**: Even if the store had `applySessionGraphEvent`, there is no IPC subscription channel to deliver `SessionGraphEvent` from main process to renderer.

---

#### Finding 8 — Panel renders flat sessions; no child rows or nested indent

`WorkspaceHierarchyPanel.vue` template iterates `project.sessions` as a flat list with a single `route-session-row` per session. There is no recursive rendering, no `v-if="!isProjectCollapsed" && session.children?.length"` check, and no visual nesting for child sessions.

Evidence:

| Claim | Source | Location |
|-------|--------|----------|
| Flat `v-for="session in project.sessions"` | `src/renderer/components/command/WorkspaceHierarchyPanel.vue:403–463` | template |
| No `children` property on session nodes | `src/renderer/components/command/WorkspaceHierarchyPanel.vue:33–38` | `ProjectHierarchyNode` prop type |
| Panel does not react to graph events | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | entire component |

**Gap**: The panel is structurally unable to render child session rows without both the store adding `children` to `ProjectHierarchyNode` and the panel adding a nested `v-for`.

---

### Risks / Unknowns

- **[!]** `SessionGraphEvent` is defined in `src/shared/project-session.ts:315–321` but the `RendererApi` interface has no channel to deliver it to the renderer. This is a **preload/IPC gap**, not just a store gap.
- **[?]** It is unclear whether the `projectHierarchy` read model should be replaced with a true tree (`Array<TreeNode>`) or augmented with a parallel `sessionTree` computed. The spec says `depth=2, max_depth=2` but does not specify whether the existing flat `sessions[]` array should coexist with a new tree structure.
- **[?]** The plan references `parent auto-expand on kind='created'` but does not define whether the store emits a panel action or the panel subscribes to a store mutation. This needs a coordination contract.
- **[?]** Whether `applySessionGraphEvent` should run inside `hydrateObservability()` (after existing subscriptions) or as a standalone IPC subscription is unspecified. The current `subscribeToObservability` only hooks `SessionPresenceSnapshot`, `ProjectObservabilitySnapshot`, and `AppObservabilitySnapshot`.

---

### Minimal File-Local Modification Suggestions (Not Implemented)

1. **`src/renderer/stores/workspaces.ts`** — Add `applySessionGraphEvent(event: SessionGraphEvent)` that calls `upsertSession` (insert-or-update logic using `parentSessionId`), add `upsertSession` that does `sessions.value.find ? Object.assign : sessions.value.push`, add a `sessionTree` computed that groups sessions by `parentSessionId` into a recursive `TreeNode` structure, guard `setActiveSession` to not switch when `activeSessionId` is already set and incoming session `kind='created'`.

2. **`src/shared/project-session.ts`** — Add `onSessionGraphEvent?: (callback: (event: SessionGraphEvent) => void) => () => void` to `RendererApi`.

3. **`src/renderer/components/command/WorkspaceHierarchyPanel.vue`** — Add `children` to `ProjectHierarchyNode` prop type, add nested `v-for` for child session rows, add a watcher/reactivity for store-driven expand events.

4. **`testing/behavior/`** — Add test declarations for `session_graph_event_sync` behavior per Task 6 spec.

---

## Context Handoff: unified-session-tree Task 5 renderer sync gaps audit

Start here: `D:\Data\DEV\ultra_simple_panel\.worktrees\unified-session-tree\research\2026-05-29-task5-renderer-sync-store-panel-subagent.md`

Context only. Use the saved report as the source of truth.