---
date: 2026-05-29
topic: session-frontend-topology
status: completed
mode: context-gathering
sources: 26
---

## Context Report: Session Frontend Topology

### Why This Was Gathered
Bounded read-only context for designing frontend-visible management of new sub sessions controlled by `stoa-ctl`, with emphasis on current workspace/project/session topology, hydration and refresh flow, and metasession-specific UI logic.

### Summary
The current renderer topology is built around a flat `projects[]` + `sessions[]` store that derives a two-level `projectHierarchy` and tracks only `activeProjectId` / `activeSessionId`; there is no parent/child session field in the shared session shape today (`src/shared/project-session.ts:122-145`, `src/renderer/stores/workspaces.ts:31-34`, `src/renderer/stores/workspaces.ts:64-87`). The primary frontend-visible session surfaces are `CommandSurface` with `WorkspaceHierarchyPanel` + `TerminalSessionDeck`, `ArchiveSurface`, and a separate metasession surface/store stack; bootstrap is one-shot via `getBootstrapState()`, and traced refresh is push-based through `session:event` and observability channels rather than a periodic session list refresh loop (`src/renderer/components/workspace/CommandSurface.vue:76-101`, `src/renderer/app/App.vue:224-252`, `src/preload/index.ts:61`, `src/preload/index.ts:183-221`, `src/main/session-runtime-controller.ts:124-166`).

### Key Findings

#### 1. Current session list/tree/panel topology

- `useWorkspaceStore` is the canonical renderer store for workspaces/projects/sessions. It keeps flat `projects` and `sessions` refs, derives `projectHierarchy` by grouping sessions under `project.id`, and stores selection only as `activeProjectId` and `activeSessionId` (`src/renderer/stores/workspaces.ts:31-34`, `src/renderer/stores/workspaces.ts:64-87`).
- The main renderer shell is `AppShell.vue`, which switches among surface views inside a three-column layout. The session-focused surface is `command`, which renders `CommandSurface`; `archive` renders `ArchiveSurface`; `meta-session` renders `MetaSessionSurface` (`src/renderer/components/AppShell.vue:51-88`).
- `CommandSurface.vue` is the main workspace/session management surface. It renders `WorkspaceHierarchyPanel` on the left and `TerminalSessionDeck` on the right, and forwards session actions upward through emits (`src/renderer/components/workspace/CommandSurface.vue:76-101`).
- `WorkspaceHierarchyPanel.vue` is the primary visible project/session tree. It owns per-project collapse state, renders session rows with tone/presence state, and exposes the current per-session UI actions: archive, restart, and regenerate-title (`src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:54`, `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:116-143`, `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:420-443`).
- `TerminalSessionDeck.vue` is the active-session content surface attached to that tree, and it currently separates persistent vs ephemeral sessions rather than parent vs child sessions (`src/renderer/components/workspace/TerminalSessionDeck.vue:81-94`).
- Archived sessions are projected out of `projectHierarchy` into a separate archive surface path in `AppShell.vue` (`src/renderer/components/AppShell.vue:37-45`, `src/renderer/components/AppShell.vue:51-88`).
- The right sidebar is not a session tree. It is project/file scoped through `useSidebarStore` and tracks `selectedProjectId` for explorer/search/git tabs (`src/renderer/components/RightSidebar.vue:12`, `src/renderer/stores/sidebar.ts:16`).
- There is a panel-extension registry, but the current registry only defines a workspace debug summary panel rather than a session-management tree (`src/extensions/panels/index.ts:12-21`).
- `WorkspaceList.vue` exists as a legacy single-column project/session list with create/select emits, but the current shell surfaces are driven by `AppShell.vue` rather than this component (`src/renderer/components/WorkspaceList.vue:25-32`, `src/renderer/components/WorkspaceList.vue:112-154`, `src/renderer/components/AppShell.vue:51-88`).

#### 2. Hydration and refresh flow

- Renderer bootstrap starts in `App.vue`, which calls `window.stoa.getBootstrapState()` on mount and hydrates `useWorkspaceStore` with the returned snapshot (`src/renderer/app/App.vue:228-247`, `src/renderer/stores/workspaces.ts:89-98`).
- Preload exposes that bootstrap as an IPC invoke on `IPC_CHANNELS.projectBootstrap`; main resolves it by returning `projectSessionManager.snapshot()` (`src/preload/index.ts:61`, `src/main/index.ts:1251-1258`).
- `BootstrapState` contains `activeProjectId`, `activeSessionId`, `projects`, `sessions`, and `terminalWebhookPort`, which matches the store fields written during `hydrate()` (`src/shared/project-session.ts:265-271`, `src/renderer/stores/workspaces.ts:89-98`).
- `hydrateObservability()` in the workspace store immediately subscribes to observability push listeners and backfills presence/project/app observability state for the hydrated project/session set (`src/renderer/stores/workspaces.ts:101-162`).
- Live session changes arrive through `window.stoa.onSessionEvent(...)` in `App.vue`; the handler updates the store with `workspaceStore.updateSession(event.session.id, event.session)` (`src/renderer/app/App.vue:224-226`, `src/preload/index.ts:183-186`, `src/renderer/stores/workspaces.ts:261-268`).
- Main emits those session updates from `SessionRuntimeController.pushSessionEvent()`, and the same state-change path also sends the three observability push channels (`src/main/session-runtime-controller.ts:118-166`).
- In the traced code path, session/project refresh is driven by bootstrap plus push subscriptions. I did not find a periodic session list polling loop in the cited renderer refresh path (`src/renderer/app/App.vue:224-252`, `src/renderer/stores/workspaces.ts:101-162`, `src/preload/index.ts:183-221`).
- Session-management UI actions ultimately cross IPC through preload/main handlers for create, set-active, archive, restore, restart, regenerate-title, delete-project, and open-workspace (`src/preload/index.ts:63-107`, `src/main/index.ts:1261-1504`, `src/shared/project-session.ts:330-425`).

#### 3. Metasession-specific frontend logic

- Metasessions are a separate frontend stack. `MetaSessionSurface.vue` renders its own three-column layout with `MetaSessionSessionList`, `MetaSessionTerminalDeck`, and `MetaSessionInspectorPanel` (`src/renderer/components/meta-session/MetaSessionSurface.vue:1-37`).
- `MetaSessionSessionList.vue` is a separate list UI backed by `useMetaSessionStore`, with its own active-session state and archive/restore flows (`src/renderer/components/meta-session/MetaSessionSessionList.vue:11-12`, `src/renderer/components/meta-session/MetaSessionSessionList.vue:175-241`).
- Proposal actions are surfaced in `MetaSessionActionPanel.vue` through `approveProposal`, `rejectProposal`, `approveAndDispatchProposal`, and `archiveSession` (`src/renderer/components/meta-session/MetaSessionActionPanel.vue:21-49`).
- The metasession Pinia store bootstraps independently from the workspace store via `getMetaSessionBootstrapState()` plus `listMetaSessionProposals()`, and subscribes to its own `onMetaSessionEvent()` channel (`src/renderer/stores/meta-session.ts:136-152`, `src/renderer/stores/meta-session.ts:188-192`).
- The metasession data model is proposal-target based, not parent/child session based: `MetaSessionProposal` links a metasession to `targetSessionIds[]`, while `SessionSummary` itself still has no `parentSessionId` / `childSessionIds` field (`src/shared/meta-session.ts:58-98`, `src/shared/project-session.ts:122-145`).
- The renderer-facing metasession bridge is still the preload/IPC API (`src/core/ipc-channels.ts:17-28`, `src/preload/index.ts:108-140`). Separately, `stoa-ctl` uses HTTP control routes exposed by `MetaSessionControlServer` (`src/core/meta-session-control-server.ts:156-160`, `tools/stoa-ctl/index.ts:510-617`).

#### 4. Where the UI must change to support parent/child session management

- The shared session type and workspace store projection are the first required change points, because the current frontend hierarchy can only express `Project -> Sessions`, and `projectHierarchy` is computed only from `projectId` plus archived state (`src/shared/project-session.ts:122-145`, `src/renderer/stores/workspaces.ts:64-87`).
- The primary workspace session tree will need change in `WorkspaceHierarchyPanel.vue`, because that component currently renders only one session-row level and owns the visible per-session action entry points (`src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:116-143`, `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:420-443`).
- The action-plumbing path for workspace sessions will also need change wherever new management actions enter the UI, because current workspace session actions flow through `WorkspaceHierarchyPanel` emits into `CommandSurface`, then into shell/app handlers that call preload IPC (`src/renderer/components/workspace/CommandSurface.vue:8-17`, `src/renderer/components/workspace/CommandSurface.vue:76-101`, `src/renderer/app/App.vue:224-247`, `src/preload/index.ts:63-107`).
- Any parent/child-aware active-session presentation will likely need change in `TerminalSessionDeck.vue`, because the active content surface is currently organized around persistent vs ephemeral session groups rather than hierarchical relationships (`src/renderer/components/workspace/TerminalSessionDeck.vue:81-94`).
- Any archived-child visibility change will touch the archive path, because archived sessions are currently flattened out of `projectHierarchy` into the separate archive surface (`src/renderer/components/AppShell.vue:37-45`, `src/renderer/components/AppShell.vue:51-88`).
- If parent/child management must also be visible in the metasession area, the separate metasession list/store/inspector/action path is a second UI stack that would need explicit change; it does not reuse `useWorkspaceStore` today (`src/renderer/components/meta-session/MetaSessionSurface.vue:1-37`, `src/renderer/components/meta-session/MetaSessionSessionList.vue:11-12`, `src/renderer/stores/meta-session.ts:34-274`).
- New frontend-visible management actions cannot ride an existing `stoa-ctl` renderer bridge today based on the cited code alone. The current renderer bridge is Electron preload/IPC, while `stoa-ctl` is wired to HTTP control routes; I did not find a cited renderer client for those `/ctl/*` routes (`src/preload/index.ts:61-221`, `src/core/meta-session-control-server.ts:156-160`, `tools/stoa-ctl/index.ts:510-617`).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Workspace store keeps flat `projects` / `sessions` refs and active IDs | `src/renderer/stores/workspaces.ts` | `31-34` |
| Workspace hierarchy is derived as `ProjectHierarchyNode[]` | `src/renderer/stores/workspaces.ts` | `64-87` |
| Store hydration writes bootstrap snapshot into refs | `src/renderer/stores/workspaces.ts` | `89-98` |
| App shell selects command/archive/meta-session surfaces | `src/renderer/components/AppShell.vue` | `51-88` |
| App shell computes archived sessions from hierarchy | `src/renderer/components/AppShell.vue` | `37-45` |
| Command surface renders hierarchy panel plus terminal deck | `src/renderer/components/workspace/CommandSurface.vue` | `76-101` |
| Workspace tree owns project collapse state | `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue` | `54` |
| Workspace tree exposes restart/regenerate actions | `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue` | `116-143` |
| Workspace tree exposes archive button on session rows | `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue` | `420-443` |
| Terminal deck groups sessions by persistent/ephemeral | `src/renderer/components/workspace/TerminalSessionDeck.vue` | `81-94` |
| Right sidebar is project/file scoped | `src/renderer/components/RightSidebar.vue` | `12` |
| Sidebar store tracks `selectedProjectId` | `src/renderer/stores/sidebar.ts` | `16` |
| Panel registry only defines workspace debug summary | `src/extensions/panels/index.ts` | `12-21` |
| Legacy workspace list still exists | `src/renderer/components/WorkspaceList.vue` | `25-32`, `112-154` |
| App bootstrap calls `getBootstrapState()` | `src/renderer/app/App.vue` | `228-247` |
| Preload forwards bootstrap invoke | `src/preload/index.ts` | `61` |
| Main bootstrap handler returns `projectSessionManager.snapshot()` | `src/main/index.ts` | `1251-1258` |
| `BootstrapState` contains active IDs, projects, sessions, webhook port | `src/shared/project-session.ts` | `265-271` |
| App subscribes to `onSessionEvent` | `src/renderer/app/App.vue` | `224-226` |
| Preload exposes `onSessionEvent` and observability listeners | `src/preload/index.ts` | `183-221` |
| Main pushes session + observability events from runtime controller | `src/main/session-runtime-controller.ts` | `118-166` |
| SessionSummary has no parent/child session fields | `src/shared/project-session.ts` | `122-145` |
| MetaSessionProposal uses `targetSessionIds[]` | `src/shared/meta-session.ts` | `58-98` |
| MetaSession surface is a separate 3-column UI | `src/renderer/components/meta-session/MetaSessionSurface.vue` | `1-37` |
| MetaSession store bootstraps independently | `src/renderer/stores/meta-session.ts` | `136-152`, `188-192` |
| `stoa-ctl` uses control-server routes rather than renderer IPC | `src/core/meta-session-control-server.ts` | `156-160` |
| `stoa-ctl` CLI commands target meta sessions/proposals over HTTP | `tools/stoa-ctl/index.ts` | `510-617` |

### Risks / Unknowns

- [?] Unknown whether new sub sessions should appear in the existing workspace session tree, the separate metasession surface, or both. The current code keeps those UI stacks separate (`src/renderer/components/AppShell.vue:51-88`, `src/renderer/stores/meta-session.ts:136-152`).
- [?] Unknown whether frontend-visible management should invoke new Electron IPC methods, consume `stoa-ctl` control routes indirectly, or stay entirely backend-driven. The cited code shows Electron preload/IPC on the renderer side and HTTP control routes for `stoa-ctl`, but no direct bridge between them (`src/preload/index.ts:61-221`, `src/core/meta-session-control-server.ts:156-160`, `tools/stoa-ctl/index.ts:510-617`).
- [?] Unknown how parent/child relationships should interact with existing archive, restart, regenerate-title, and active-session semantics. Those actions exist today, but only for flat project-contained sessions (`src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:116-143`, `src/renderer/components/workspace/WorkspaceHierarchyPanel.vue:420-443`, `src/renderer/stores/workspaces.ts:231-321`).

## Context Handoff: Session Frontend Topology

Start here: `research/2026-05-29-session-frontend-topology.md`

Context only. Use the saved report as the source of truth.
