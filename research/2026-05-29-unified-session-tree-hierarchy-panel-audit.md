---
date: 2026-05-29
topic: unified-session-tree hierarchy panel implementation status
status: completed
mode: context-gathering
sources: 25
---

# Context Report: Unified Session Tree Hierarchy Panel Implementation Status

## Why This Was Gathered

Bounded read-only audit (depth=2) of `WorkspaceHierarchyPanel.vue`, its tests, and spec alignment from `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`. Target files: `WorkspaceHierarchyPanel.vue`, `CommandSurface.test.ts`, `WorkspaceHierarchyPanel.test.ts`, plus related store and plan.

---

## Summary

The `WorkspaceHierarchyPanel` component is largely built for the flat `Project → Sessions` model. The supporting store (`workspaces.ts`) already has `projectSessionsIntoTree` for recursive tree projection, `SessionTreeProjection` metadata, and `applySessionGraphEvent` for all 5 event kinds. However, the panel template renders a **flat `project.sessions` list**, and the archived section, recursive child nesting, child-count badges, restore flow, and the full row-action set are missing or stubbed out. The implementation is approximately **55–65% complete** relative to the spec's renderer requirements.

---

## Key Findings

### Group A — Fully Implemented

| Spec item | Evidence |
|-----------|----------|
| Basic hierarchy rendering (project rows + session child rows) | `WorkspaceHierarchyPanel.vue:343–464` — `v-for="project in hierarchy"` with session button list |
| Active state tracking (project `route-item--active`, session child active) | `WorkspaceHierarchyPanel.vue:350` `project.id === activeProjectId`, `:class="{ 'route-item--active': session.id === activeSessionId }"` |
| Status dot with tone/phase/attention data attributes | `WorkspaceHierarchyPanel.vue:421–427` — `.route-dot` with `data-tone`, `data-phase`, `data-session-status-testid`, `data-attention-reason` |
| Provider icons per session type | `WorkspaceHierarchyPanel.vue:428` — `.route-provider-icon` with `providerIcon()` |
| Session row with title + secondary label | `WorkspaceHierarchyPanel.vue:429–431` — `route-session-name` + `route-session-label` |
| Right-click context menu (restartSession, regenerateSessionTitle) | `WorkspaceHierarchyPanel.vue:116–143`, `SessionContextMenu.vue` — `handleSessionContextMenuSelect` |
| Archive action on session row | `WorkspaceHierarchyPanel.vue:435–460` — `data-testid="workspace.archive-session"`, emits `archiveSession` |
| Create session via floating card (quick click) / radial menu (long press) | `WorkspaceHierarchyPanel.vue:222–267`, `openFloatingCard` / `openRadialMenu` |
| New project button → NewProjectModal | `WorkspaceHierarchyPanel.vue:331–334` |
| Per-project collapse/expand | `WorkspaceHierarchyPanel.vue:174–194` — `collapsedProjectIds` ref, `isProjectCollapsed`, `toggleProjectCollapse` |
| Detail popover on project row | `WorkspaceHierarchyPanel.vue:196–220`, `499–508` — `detailState`, `.detail-popover` |
| Project delete button | `WorkspaceHierarchyPanel.vue:370–386` — `data-testid="workspace.delete-project"`, emits `deleteProject` |
| Store `projectSessionsIntoTree` recursive derivation from parentSessionId | `workspaces.ts:62–165` — full DFS visit with depth/childCount/descendantCount |
| Store `upsertSession` (insert unknown or update) | `workspaces.ts:408–426` |
| Store `applySessionGraphEvent` for all 5 event kinds | `workspaces.ts:484–519` |
| Store `applySessionPresenceSnapshot` + staleness check | `workspaces.ts:303–313` |
| Session row view model derivation in CommandSurface | `CommandSurface.vue:38–54` — `toSessionRowViewModel` per session |
| Persistent AI terminal deck (keeps activated sessions mounted) | `CommandSurface.vue`, `TerminalSessionDeck.vue:56–79` |
| Shell ephemeral terminal path | `CommandSurface.test.ts:384–402`, `TerminalSessionDeck.vue:91–93` |
| Test for blocked observability in status dot | `CommandSurface.test.ts:264–301` |
| Test for tone/phase projection on dot | `WorkspaceHierarchyPanel.test.ts:350–362` |
| Test for archive button aria-label | `WorkspaceHierarchyPanel.test.ts:428–432` |
| Test that archived sessions are hidden | `WorkspaceHierarchyPanel.test.ts:434–451` — `data-archived-group`/`data-archived-session` absent |
| Style contract tests (no hardcoded colors/radii) | `WorkspaceHierarchyPanel.test.ts:605–629` |
| Test passes for `regenerateSessionTitle` event | `WorkspaceHierarchyPanel.test.ts:513–525` |

### Group B — Partially Implemented (Deviating or Stubbed)

| Spec item | Status | Evidence |
|-----------|--------|----------|
| Recursive session tree rendering (nested child sessions) | **Not implemented** — panel template renders flat `project.sessions[]` list only | `WorkspaceHierarchyPanel.vue:403–462` — single `v-for="session in project.sessions"`, no nesting of child rows inside parent rows |
| Archived section per project in command surface | **Not implemented** — `archivedSessions` exists on `ProjectHierarchyNode` but panel has no `v-for` for it | `workspaces.ts:34–35` defines `archivedSessions: ProjectHierarchySessionNode[]`; `WorkspaceHierarchyPanel.vue` has zero references to `archivedSessions` |
| `treeChildCount` / `treeDescendantCount` badges on session rows | **Not implemented** — no child-count display in panel | `workspaces.ts:17–22` defines `SessionTreeProjection` with `treeChildCount`/`treeDescendantCount`; these are stored on `SessionRecord` but never rendered in `WorkspaceHierarchyPanel.vue` |
| Restore action on session row | **Not implemented** — no `restoreSession` emit or UI in panel | `workspaces.ts:478–482` has `restoreSession`; `WorkspaceHierarchyPanel.vue` emits only `archiveSession`, never `restoreSession` |
| Create Child action in session context menu | **Not implemented** — context menu only has restart + regenerate-title | `WorkspaceHierarchyPanel.vue:116–127` — `sessionContextMenuItems()` returns only 2 items |
| Inspect / Prompt / Destroy actions in session context menu | **Not implemented** — no session-scoped actions beyond archive | `WorkspaceHierarchyPanel.vue` has no `inspectSession`, `promptSession`, `destroySession` emits |
| Archived section collapsed by default + same recursive row renderer | **Not implemented** — archived sessions are entirely hidden per test | `WorkspaceHierarchyPanel.test.ts:449–450` asserts `[data-archived-group]` and `[data-archived-session]` do not exist |
| Parent auto-expand on `kind="created"` event | **Not implemented** — `applySessionGraphEvent` for `'created'` only upserts; no collapse-toggle logic | `workspaces.ts:488–494` |
| Background child create does not steal active session | **Partially implemented** — `applySessionGraphEvent` switches active only when `origin === 'renderer'` | `workspaces.ts:491–493` — correct behavior, but no test for it |
| Context menu `destroySession` (stop/archive as single path) | **Stubbed** — archive button exists but `destroy` is not the primary path per spec | `WorkspaceHierarchyPanel.vue:435` archive button present; spec §Session Row Actions says "Destroy is only main-path action" and "Archive row action no longer exists in parallel" |

### Group C — Missing (Not Yet Started)

| Spec item | Location |
|-----------|----------|
| `inspectSession(projectId, sessionId)` emit + handler wiring | Not in `defineEmits` of `WorkspaceHierarchyPanel.vue` |
| `promptSession(sessionId, text)` emit + handler wiring | Not in `defineEmits` |
| `destroySession(sessionId)` emit (replaces archive-only path) | `defineEmits` has `archiveSession` only |
| `restoreSession(sessionId)` emit + handler wiring | Not in `defineEmits` |
| `createChildSession(projectId, parentSessionId, type)` emit | Not in `defineEmits` — only `createSession` which takes `projectId` + `type` |
| Archived subtree section UI (collapsed by default, expandable) | Panel template has no archived rendering branch |
| Child session row nesting under parent session row (recursive tree) | Flat `v-for="session in project.sessions"` — no recursive component |
| Child count badge rendering on session rows | `SessionTreeProjection.treeChildCount` is stored but not rendered |
| Descendant count badge rendering on session rows | `SessionTreeProjection.treeDescendantCount` is stored but not rendered |
| `kind="created"` parent auto-expand logic in panel | No `handleCreatedEvent` or collapse-toggle on `SessionGraphEvent` |
| Test for `upsertSession` inserting unknown child from graph event | No test in `workspaces.test.ts` for `'created'` with unknown session |
| Test for recursive hierarchy projection | No test in `workspaces.test.ts` for parent/child nesting |
| Test for parent auto-expand on `kind="created"` | No test |
| Test for background child create not stealing active session | No test for `applySessionGraphEvent` origin filtering |
| Test for archived section (collapsed, recursive rows, restore visible) | No test for archived rendering branch |
| E2E: background child session auto-appears in tree without refresh | Not in e2e suite |
| E2E: child session context menu has destroy + restore | Not in e2e suite |

---

## Evidence Chain

| Claim | Source | Location |
|-------|--------|----------|
| Panel renders flat project.sessions only | `WorkspaceHierarchyPanel.vue` | lines 343–464 |
| archivedSessions is defined but never rendered | `workspaces.ts:35`, `WorkspaceHierarchyPanel.vue` grep for `archivedSessions` returns 0 matches | `workspaces.ts:35`, not in panel template |
| SessionTreeProjection fields exist but aren't rendered | `workspaces.ts:17–22` defines fields; grep for `treeChildCount\|treeDescendantCount` in panel returns 0 | `workspaces.ts:18,20`, `WorkspaceHierarchyPanel.vue` |
| Context menu only has restart + regenerate-title | `WorkspaceHierarchyPanel.vue:116–127` | lines 116–127 |
| `applySessionGraphEvent` handles all 5 event kinds | `workspaces.ts:484–519` | lines 484–519 |
| Active session switch only on `origin === 'renderer'` | `workspaces.ts:491–493` | lines 491–493 |
| Archived sessions are hidden (not rendered) | `WorkspaceHierarchyPanel.test.ts:449–450` asserts `data-archived-group` absent | lines 449–450 |
| projectSessionsIntoTree implements recursive projection | `workspaces.ts:62–165` | lines 62–165 |
| Restore action in store but not exposed via panel | `workspaces.ts:478–482`, `WorkspaceHierarchyPanel.vue` defineEmits | store line 478, panel line 40–49 |
| Session row view models are computed in CommandSurface | `CommandSurface.vue:38–54` | lines 38–54 |
| Style contracts pass (no hardcoded values) | `WorkspaceHierarchyPanel.test.ts:605–629` | lines 605–629 |

---

## Recommended Next Implementation Order

1. **Add archived section rendering to panel** — render `project.archivedSessions` in a collapsible "Archived" group below live sessions, collapsed by default, same row renderer. Add `restoreSession` emit + button. Add tests: archived section exists, collapsible, restore button visible, restore emits correct event.
2. **Add child-count / descendant-count badges** — render `session.treeChildCount` (e.g. "3") on session rows when > 0. Add tests for badge visibility rules.
3. **Replace archive action with destroy action** — change `archiveSession` to `destroySession` on row. Add `restoreSession` as separate action on archived subtree roots. Add tests.
4. **Add session context menu actions** — add `createChildSession`, `inspectSession`, `promptSession` to context menu items + emits. Tests for menu item visibility and emit payloads.
5. **Implement recursive session tree** — change panel rendering to support nested child sessions under parent rows, or use a recursive row component. Tests for nested structure.
6. **Add parent auto-expand on `kind="created"`** — wire `applySessionGraphEvent('created')` to uncollapse the parent project. Test: background child create causes parent to expand.
7. **Add E2E coverage** — background child auto-appears in tree, restore flow, destroy flow.

---

## Risks / Unknowns

- [!] The flat `projectHierarchy` projection (`workspaces.ts:202–225`) groups sessions by `projectId` + `!archived` filter — it does not yet produce a nested parent→child tree. The `projectSessionsIntoTree` function derives tree metadata but the result is still a flat `SessionRecord[]`. The panel treats it as flat. Full recursive nesting requires changing either the store projection or the panel rendering to handle `parentSessionId` chains.
- [!] `CommandSurface.test.ts` (lines 303–357) tests `archiveSession` and `restartSession` forwarding but has no tests for `restoreSession`, `createChildSession`, `inspectSession`, or `promptSession`.
- [?] The plan (`2026-05-29-unified-session-tree-implementation.md`) task 5 step 3 says "active/focus rules for background-created child sessions" — the store logic is correct (`origin !== 'renderer'` skips active switch) but no unit test validates this invariant.
- [?] `SessionContextMenu.vue` has no `danger` styling for destroy action (currently only restart is present). No `data-testid` for create-child or inspect or prompt in context menu items.
- [?] The spec requires `stoa-ctl` env injection (covered in Task 3/4 backend work) but renderer-to-`/ctl/*` direct calls are forbidden — all session actions must go through IPC. The preload bridge (`src/preload/index.ts`) is not audited here but must expose the new session control IPC channels.

---

## Context Handoff: Unified Session Tree Hierarchy Panel

Start here: `D:\Data\DEV\ultra_simple_panel\.worktrees\unified-session-tree\research\2026-05-29-unified-session-tree-hierarchy-panel-audit.md`