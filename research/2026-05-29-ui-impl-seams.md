---
date: 2026-05-29
topic: renderer unified session tree UI closure - ui-impl-seams
status: completed
mode: context-gathering
sources: 24
---

## Context Report: renderer unified session tree UI closure

### Why This Was Gathered
Identify the smallest coherent interface changes needed to: (1) move archive back into command surface, (2) render recursive live+archived trees, and (3) preserve non-focus-stealing background child graph events.

### Summary
Archive currently lives in a separate `AppShell` surface rendered via `v-if="activeSurface === 'archive'"` alongside `CommandSurface`. `workspaces.ts` already splits `sessions` vs `archivedSessions` in `ProjectHierarchyNode` and `projectHierarchy` computed. The gap is that `WorkspaceHierarchyPanel` only renders `project.sessions` (line 404-463) and does not show archived sessions at all. `TerminalSessionDeck` builds its `sessionLookup` from all sessions in `props.hierarchy` (lines 41-54) but only mounts TerminalViewports for active sessions via `persistentAiEntries` (lines 81-85) and `activeEphemeralSession` (lines 91-102). The background child graph event behavior is already correct: `applySessionGraphEvent` only calls `setActiveSession` when `origin === 'renderer'` (lines 491-493), so non-renderer origins (e.g., `origin: 'session'`) do NOT steal focus.

### Key Findings

#### F1: Archive surface lives outside CommandSurface
`AppShell.vue:6` imports `ArchiveSurface`, and lines 73-77 conditionally render it with `v-if="activeSurface === 'archive'"`. It is a sibling, not a child, of `CommandSurface`. The `archivedSessions` prop is computed at AppShell level by flattening `project.archivedSessions` from hierarchy (lines 36-44).

#### F2: Store already splits live/archived in projectHierarchy
`workspaces.ts:32-36` defines `ProjectHierarchyNode` with both `sessions: ProjectHierarchySessionNode[]` and `archivedSessions: ProjectHierarchySessionNode[]`. The `projectHierarchy` computed (lines 202-225) already filters on `!session.archived` vs `session.archived` into the correct arrays. `applySessionGraphEvent` (lines 484-520) handles `archived` and `restored` events correctly.

#### F3: WorkspaceHierarchyPanel only renders live sessions
`WorkspaceHierarchyPanel.vue:404-463` — the session rendering block is `v-for="session in project.sessions"` inside `<template v-if="!isProjectCollapsed(project.id)">`. Archived sessions are excluded from this render path entirely. There is no collapsed-archived section, no restore button in the hierarchy panel, and the test at line 434-451 explicitly asserts `data-archived-group` and `data-archived-session` do NOT exist.

#### F4: TerminalSessionDeck operates on full hierarchy
`TerminalSessionDeck.vue:41-54` — `sessionLookup` is built from ALL `project.sessions` across all projects in `props.hierarchy`. The hierarchy prop currently contains both live and archived sessions per project. However, the mounted `TerminalViewport` instances are filtered to only those in `persistentAiEntries` (lines 81-85) and `activeEphemeralSession` (lines 91-102). Archived sessions never reach `activatedAiSessionIds`, so they are never mounted. **Terminal rendering for archived sessions is already gated by session activation, not by a filter flag.**

#### F5: Background child graph events are already non-focus-stealing
`workspaces.ts:489-493` — `applySessionGraphEvent` for `kind: 'created'` only calls `setActiveSession(incoming.id)` when `origin === 'renderer'`. Non-renderer origins (e.g., `origin: 'session'`) skip focus stealing. The test at lines 1490-1552 explicitly validates: "non-renderer-origin create does not steal active session" and "background session should still be added to store."

#### F6: CommandSurface is the natural integration point for unified tree
`CommandSurface.vue:78-101` already passes `hierarchy` to both `WorkspaceHierarchyPanel` and `TerminalSessionDeck`. Adding archive rendering to `WorkspaceHierarchyPanel` would require no change to `CommandSurface`'s prop surface — it already owns the layout.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| ArchiveSurface is separate surface | `AppShell.vue` | lines 6, 73-77 |
| archivedSessions computed at AppShell level | `AppShell.vue` | lines 36-44 |
| ProjectHierarchyNode has sessions + archivedSessions | `workspaces.ts` | lines 32-36 |
| projectHierarchy splits live/archived | `workspaces.ts` | lines 202-225 |
| WorkspaceHierarchyPanel only renders project.sessions | `WorkspaceHierarchyPanel.vue` | lines 404-463 |
| Archived sessions NOT rendered (test contract) | `WorkspaceHierarchyPanel.test.ts` | lines 434-451 |
| TerminalSessionDeck builds lookup from full hierarchy | `TerminalSessionDeck.vue` | lines 41-54 |
| Persistent AI entries from activated ids | `TerminalSessionDeck.vue` | lines 81-85 |
| Ephemeral session lookup | `TerminalSessionDeck.vue` | lines 91-102 |
| Background child origin does NOT steal focus | `workspaces.ts` | lines 489-493 |
| Background child graph event test | `workspaces.test.ts` | lines 1490-1552 |
| applySessionGraphEvent archived/restored | `workspaces.ts` | lines 500-509 |
| CommandSurface already owns command layout | `CommandSurface.vue` | lines 78-101 |

### Smallest Interface Changes Required

#### Change 1: WorkspaceHierarchyPanel — add collapsed archive section per project
Add a second `v-for` block after the live sessions, below the collapsed check, that renders `project.archivedSessions` with a distinct visual treatment (e.g., muted, indented, with restore action instead of archive action). No new props needed — `project.archivedSessions` is already available.

**Props delta**: None. Both `hierarchy`, `activeSessionId`, `sessionRowViewModels` already flow in.

**Emit delta**: Add `restoreSession: [sessionId: string]` to the existing emit definition (line 40-49). CommandSurface already forwards this from AppShell (line 30), and AppShell forwards it to App (line 30).

**Template delta**: One new `v-for="session in project.archivedSessions"` block inside the existing project block, with conditional render (always visible, or under an "archived" toggle). Add `restore` action next to each row.

#### Change 2: WorkspaceHierarchyPanel — restoreSession emit
Add a restore button/icon per archived session row that emits `restoreSession`. Already wired through CommandSurface → AppShell → App.

**Template delta**: An `<button>` in the archived session row with `@click.stop="emit('restoreSession', session.id)"`.

#### Change 3: CommandSurface — add restoreSession to emit
Update emit definition (lines 23-33) to include `restoreSession`. No other change needed — AppShell already handles it.

#### Change 4: Optional — TerminalSessionDeck archived terminal rendering
Currently archived sessions are never mounted because they never enter `activatedAiSessionIds`. This is likely the correct behavior (you don't want background AI terminals running when archived). **If the requirement is to show archived terminals without activating them**, the simplest change is in `TerminalSessionDeck`: add an `else-if` path for archived sessions that mounts them in a visually distinct (dimmed) container.

**Template delta**: Add a `v-else-if` block with `v-for="entry in archivedEntries"` where `archivedEntries` filters `sessionLookup` to sessions with `archived: true`, rendering with `v-show` and dimmed styling.

**Props delta**: None — hierarchy already includes archived sessions.

### Risks / Unknowns
- [!] The test at `WorkspaceHierarchyPanel.test.ts:434-451` explicitly asserts archived sessions are NOT shown. This test contract will need to be updated (or the assertion inverted to check they ARE shown when the collapsed-archive section is rendered).
- [!] The `TerminalSessionDeck` behavior of pruning terminals when sessions disappear (test at line 282-316) may interact with archiving if archived sessions should remain mounted but hidden. Verify that `v-show` (keep mounted) vs conditional mount is the right choice.
- [!] The separate `ArchiveSurface` view in `AppShell` is still functional when the user navigates to the archive activity. Decide if it should be removed (breaking change) or kept as a separate full-page archive view.
- [?] Whether archived sessions should be expandable/collapsible under the live sessions section, or shown as a separate "Archived" group label, is a UX decision not specified in the task.
- [?] Whether archived sessions should be selectable (activating them restores and shows in terminal deck) — current `restoreSession` flow sets `archived: false` but does not auto-activate. Clarify if selection should trigger restore + activate.