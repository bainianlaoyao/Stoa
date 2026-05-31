---
date: 2026-05-29
topic: session-frontend-components
status: completed
mode: context-gathering
sources: 25
---

## Context Report: Session Frontend Components

### Why This Was Gathered
Bounded read-only research on current frontend-visible session list/tree/panel components for workspaces/projects/sessions display. Needed: concrete Vue components, layout/panel registry entries, tree/list rendering, selection state, and session-management actions exposed in the renderer.

### Summary
The app uses a Pinia `workspaces` store as the single source of truth for projects and sessions, projected through `projectHierarchy` computed into `ProjectHierarchyNode[]` trees. Three primary surfaces display this tree: `CommandSurface` → `WorkspaceHierarchyPanel` (240px sidebar), `ArchiveSurface` (full-width card grid), and `MetaSessionSurface` → `MetaSessionSessionList` (sidebar list). The right sidebar is file/project-centric, not session-centric. Selection state flows upward via emits; no store-level "select" action — only `setActiveProject` and `setActiveSession`. Session management actions (archive, restore, regenerate, restart, delete) are all event-driven from the command surface tree.

### Key Findings

1. **Primary data source**: `useWorkspaceStore` in `src/renderer/stores/workspaces.ts` holds all projects/sessions in flat refs, derives `projectHierarchy` as a `ProjectHierarchyNode[]`. Selection tracked as `activeProjectId` and `activeSessionId` refs.

2. **Main layout**: `AppShell.vue` owns the 3-column grid `[GlobalActivityBar (56px) | main surface | RightSidebar]`. Five `AppSurface` states toggle via `activeSurface` ref: `command`, `meta-session`, `archive`, `settings`.

3. **Command surface tree**: `CommandSurface.vue` renders a 2-column layout with `WorkspaceHierarchyPanel` (240px left) + `TerminalSessionDeck` (right). `WorkspaceHierarchyPanel.vue` is the primary session tree with per-project collapse, per-session status dot, provider icon, archive button.

4. **Session status dot**: `sessionTone()` derives from `SessionRowViewModel` (tone: `neutral|success|accent|warning|danger`). `sessionPhase()` maps from presence snapshot. Both come from `observability-view-models.ts` (wrapping `@shared/observability-projection`).

5. **Meta session list**: `MetaSessionSessionList.vue` renders a separate session list from `useMetaSessionStore` (not `useWorkspaceStore`). Has its own `activeMetaSessionId`, archive/restore per session. Uses `MetaSessionBackendSessionType` enum.

6. **Archive surface**: `ArchiveSurface.vue` takes `ArchivedSessionEntry[]` computed from flattening `hierarchy[*].archivedSessions` with project context attached. Renders full-width cards with restore buttons.

7. **Right sidebar**: `RightSidebar.vue` renders file-explorer/search/git tabs via `useSidebarStore` (`activeTab: 'explorer'|'search'|'git'`). The sidebar tracks `selectedProjectId` for file-tree context but does not list sessions.

8. **Panel registry**: `src/extensions/panels/index.ts` defines `PanelExtensionDefinition[]` via `listPanels()`. Currently returns only a "Workspace Debug Summary" panel with `workspaceCount` and `activeWorkspaceId`. Not wired to the session tree UI.

9. **Session actions**: All session management (archive, restore, regenerate title, restart, delete project) is emitted upward from `WorkspaceHierarchyPanel` → `CommandSurface` → `AppShell` → `App.vue`. No store-level action exists for archive/restore — only direct mutation of session.archived.

10. **WorkspaceList.vue**: Legacy component at `src/renderer/components/WorkspaceList.vue`. Renders the same project/session hierarchy in a flat single-column layout with inline create forms. Emits `selectProject`, `selectSession`, `createProject`, `createSession`. Not used in current AppShell grid — appears to be a standalone fallback.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `useWorkspaceStore` holds flat `projects`/`sessions` refs | workspaces.ts | line 31-32 |
| `projectHierarchy` computed derives `ProjectHierarchyNode[]` | workspaces.ts | lines 64-87 |
| `activeProjectId`/`activeSessionId` are raw refs, not computed | workspaces.ts | lines 33-34 |
| `setActiveProject` cascades active session if needed | workspaces.ts | lines 231-236 |
| `setActiveSession` cascades projectId from session | workspaces.ts | lines 238-246 |
| `archiveSession` mutates `session.archived = true` | workspaces.ts | lines 308-315 |
| `restoreSession` mutates `session.archived = false` | workspaces.ts | lines 317-321 |
| `removeProject` removes project + its sessions | workspaces.ts | lines 248-259 |
| AppShell 3-column grid with `activeSurface` | AppShell.vue | lines 51-88 |
| Five AppSurface types | GlobalActivityBar.vue | line 6 |
| CommandSurface 2-column: tree + terminal deck | CommandSurface.vue | lines 76-101 |
| WorkspaceHierarchyPanel per-project collapse via `collapsedProjectIds` ref | WorkspaceHierarchyPanel.vue | line 54 |
| Session status dot via `sessionTone()` / `data-tone` attr | WorkspaceHierarchyPanel.vue | lines 420-427 |
| Provider icon via `providerIcon()` mapping | WorkspaceHierarchyPanel.vue | lines 76-84 |
| Session archive emits `archiveSession` up via button click | WorkspaceHierarchyPanel.vue | lines 435-443 |
| Context menu: restart, regenerate title | WorkspaceHierarchyPanel.vue | lines 116-143 |
| `toSessionRowViewModel` wraps `buildSessionRowViewModel` | observability-view-models.ts | lines 14-24 |
| `sessionPresenceMap` is a computed from store | CommandSurface.vue | line 36 |
| `TerminalSessionDeck` splits persistent vs ephemeral sessions | TerminalSessionDeck.vue | lines 81-94 |
| Archive surface computes `archivedSessions` from hierarchy | AppShell.vue | lines 37-45 |
| `MetaSessionSessionList` uses separate `useMetaSessionStore` | MetaSessionSessionList.vue | line 11 |
| `MetaSessionSessionList` has own `activeMetaSessionId` | MetaSessionSessionList.vue | line 12 |
| Right sidebar uses `useSidebarStore` | RightSidebar.vue | line 12 |
| Right sidebar tracks `selectedProjectId` for file context | sidebar.ts | line 16 |
| `listPanels()` returns workspace debug panel only | panels/index.ts | lines 12-21 |
| PanelExtensionContext has `activeWorkspaceId` | panels/index.ts | line 2 |
| Legacy WorkspaceList.vue single-column layout | WorkspaceList.vue | lines 112-154 |
| WorkspaceList emits createProject/createSession | WorkspaceList.vue | lines 25-32 |

### Risks / Unknowns

- [!] `WorkspaceList.vue` appears to be unused in the current AppShell layout — it's not rendered in any of the five `activeSurface` panels. Confirm whether it should be removed or is used elsewhere.
- [!] `PanelExtensionDefinition` registry is minimal (only one panel) and not integrated into any UI surface. The `PanelExtensions.vue` component exists but is not rendered in AppShell.
- [?] Meta session and workspace session are completely separate stores and UIs — no shared state between them. Is there intent for convergence?
- [?] `sessionPresenceMap` is built per-session from the global store's `sessionPresenceById`, but the tree only shows sessions from `projectHierarchy` which filters by `!session.archived`. Archived sessions appear only in the Archive surface.

## Context Handoff: Session Frontend Components

Start here: `research/2026-05-29-session-frontend-components.md`

Context only. Use the saved report as the source of truth.