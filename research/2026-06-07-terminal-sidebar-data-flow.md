---
date: 2026-06-07
topic: terminal-page right sidebar data flow — backend → IPC → store → panel
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Terminal Page Right Sidebar Data Flow

### Why This Was Gathered

Understanding the full data flow from backend/core through preload/IPC to renderer stores and right-sidebar panels, to identify inconsistencies, missing links, and architectural gaps before making changes to the terminal page's right sidebar.

### Summary

The right sidebar is mounted inside `AppShell.vue` only when `activeSurface === 'command'` (the terminal/command page). It hosts three panels — **Explorer**, **Search**, and **Source Control (Git)** — each backed by its own data path. The workspace store (`activeProject`) is the central dependency: all three panels derive `selectedProjectPath` from `workspaceStore.activeProject?.path`. The sidebar's open/tab state is persisted via IPC to `~/.stoa/sidebar.json`. A significant gap exists: the `fsChanged` push event is exposed in preload but **never subscribed to** in the renderer, so file-tree auto-refresh on external file changes is dead code.

---

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Process                           │
│  sidebar-fs-handlers.ts  sidebar-git-handlers.ts            │
│  sidebar-state-store.ts  index.ts (IPC registrations)       │
│       │        │              │                              │
│       │ fsReadDir gitStatus   │ sidebarGetState/SetState     │
│       │ fsCreate  gitStage    │ fsOpenFile shellShowItem     │
│       │ fsRename  gitCommit   │                              │
│       │ fsSearch  gitPush...  │                              │
│       │ fsChanged (push)      │                              │
└───────┼────────┼──────────────┼──────────────────────────────┘
        │ IPC    │              │
┌───────┼────────┼──────────────┼──────────────────────────────┐
│       ▼        ▼              ▼          Preload             │
│  preload/index.ts → contextBridge.exposeInMainWorld('stoa') │
│  60+ IPC methods + 8 push event listeners                   │
└───────┬────────┬──────────────┬──────────────────────────────┘
        │        │              │
┌───────┼────────┼──────────────┼──────────────────────────────┐
│       ▼        ▼              ▼          Renderer            │
│                                                             │
│  App.vue                                                     │
│  ├── hydrate workspaceStore (bootstrap)                      │
│  ├── hydrate sidebarStore                                    │
│  ├── hydrate settingsStore                                   │
│  └── subscribe: sessionGraphEvent, observability...          │
│       │                                                      │
│  AppShell.vue                                                │
│  ├── props: hierarchy, activeProject/Session                 │
│  └── RightSidebar (v-if="activeSurface==='command'")         │
│       ├── sidebarStore (open, activeTab, width)              │
│       ├── TabBar (explorer / search / git)                   │
│       └── visiblePanels (useSidebarPanels)                   │
│            ├── FileExplorer.vue                              │
│            │   ├── useWorkspaceStore → activeProject.path    │
│            │   ├── useSidebarStore → pendingRevealPath       │
│            │   ├── useFileTree(projectPath)                  │
│            │   │    └── fsReadDir IPC                        │
│            │   └── useFileOperations(projectPath, invalidate)│
│            │        └── fsCreate/fsRename/fsDelete IPC       │
│            ├── SearchPanel.vue                               │
│            │   ├── useWorkspaceStore → activeProject.path    │
│            │   └── useSearchStore → fsSearch IPC             │
│            └── SourceControlPanel.vue                        │
│                ├── useWorkspaceStore → activeProject.path    │
│                ├── useGitStore → gitStatus/Stage/Commit IPC  │
│                └── useGitStatusPolling (30s interval)        │
└─────────────────────────────────────────────────────────────┘
```

---

### Data Flow by Store

#### 1. WorkspaceStore (`workspaces.ts`)

**Hydration path:**
1. `App.vue:248` → `window.stoa.getBootstrapState()` (IPC `project:bootstrap`)
2. `App.vue:253` → `workspaceStore.hydrate(bootstrapState)`
3. `workspaces.ts:227-238` — populates `projects`, `sessions`, `activeProjectId`, `activeSessionId`, `terminalWebhookPort`

**Key computed properties consumed by sidebar panels:**
- `activeProject` (`workspaces.ts:183-185`) — derived from `projects[activeProjectId]`
- `activeSession` (`workspaces.ts:187-189`) — derived from `sessions[activeSessionId]`
- `projectHierarchy` (`workspaces.ts:202-225`) — passed as prop to `AppShell`

**Sidebar consumption:**
- `FileExplorer.vue:11` → `computed(() => workspaceStore.activeProject?.path ?? null)`
- `SearchPanel.vue:11` → `computed(() => workspaceStore.activeProject?.path ?? null)`
- `SourceControlPanel.vue:10` → `computed(() => workspaceStore.activeProject?.path ?? null)`
- `useSidebarPanels.ts:79` → `workspaceStore.activeProject !== null` (controls git panel visibility)

**Update triggers:**
- `sessionGraphEvent` push (via `App.vue:233`) → `workspaceStore.applySessionGraphEvent` → upsert/delete sessions
- Direct store calls: `setActiveProject`, `setActiveSession`, `addProject`, `removeProject`, `archiveSession`, `restoreSession`
- Observability push subscriptions hydrate `sessionPresenceById`, `projectObservabilityById`, `appObservability`

#### 2. SidebarStore (`sidebar.ts`)

**Hydration path:**
1. `App.vue:263` → `sidebarStore.hydrate()`
2. `sidebar.ts:97-113` → `window.stoa.getSidebarState()` (IPC `sidebar:get-state`)
3. Backend reads from `~/.stoa/sidebar.json` via `sidebar-state-store.ts:72-105`

**State:**
- `open` (boolean) — controls visibility
- `activeTab` (`'explorer' | 'search' | 'git'`) — which panel is shown
- `width` (number) — pixel width (220–800)
- `sessionListWidth` (number) — left sidebar session list width (160–480)
- `activeTabByProject` (Record<string, string>) — per-project tab memory
- `pendingRevealPath` (string | null) — reveal-in-explorer support

**Persistence:**
- Every `setOpen`, `setActiveTab`, `commitWidth`, `commitSessionListWidth` → `persistState()` → IPC `sidebar:set-state`
- Backend uses atomic write (temp file + rename) via `sidebar-state-store.ts:107-140`

**Per-project tab restore:**
- `sidebar.ts:87-95` — watches `workspaceStore.activeProject?.path` and restores remembered tab on project switch

**Keyboard shortcuts:**
- `useSidebarShortcuts.ts` — Ctrl+B toggle, Ctrl+Shift+E/F/G tab jumps

#### 3. GitStore (`git.ts`)

**All operations are request/response via IPC:**
- `refreshStatus` → `window.stoa.gitStatus(projectPath)` → IPC `git:status`
- `refreshBranches` → `window.stoa.gitBranches(projectPath)` → IPC `git:branches`
- `refreshLog` → `window.stoa.gitLog(projectPath, 50)` → IPC `git:log`
- Mutations: `stageFile`, `unstageFile`, `discardFile`, `commit`, `push`, `pull`, `fetch`, `checkoutBranch`, `createBranch`, `rebase`, `merge`

**Computed properties:**
- `staged`, `unstaged`, `untracked` — filtered from `status.entries`
- `hasChanges` — `entries.length > 0`
- `currentBranch` — `status.branch ?? branches.current`

**Polling:**
- `useGitStatusPolling.ts` — 30s interval, resets on project path change, pauses when window hidden

**Trigger in SourceControlPanel:**
- `SourceControlPanel.vue:22-23` — `watch(selectedProjectPath, path => gitStore.refreshAll(path), { immediate: true })`
- `useGitStatusPolling(selectedProjectPath)` — starts polling on mount

#### 4. SearchStore (`search.ts`)

**All operations are request/response via IPC:**
- `search(rootPath)` → `window.stoa.fsSearch(options)` → IPC `fs:search`
- Backend tries `rg` (ripgrep) first, falls back to `git grep` (`sidebar-fs-handlers.ts:380-390`)

**State:**
- `query`, `caseSensitive`, `wholeWord`, `useRegex`, `includePattern`, `excludePattern` — search parameters
- `results`, `searching`, `error` — search output
- `hasResults` computed

**Debounced auto-search:**
- `SearchPanel.vue:28-39` — 300ms debounce on `query` change → `searchStore.search(path)`

#### 5. FileTree Composable (`useFileTree.ts`)

**Module-level shared state** (NOT per-instance):
- `dirCache` (`ref<Record<string, DirCache>>`) — cached directory listings
- `expandedDirs` (`ref<Set<string>>`) — which dirs are expanded

**Operations via IPC:**
- `loadDir` → `window.stoa.fsReadDir(projectPath, relativePath)` → IPC `fs:read-dir`
- Backend also starts a chokidar watcher per project path on first `fsReadDir` call (`sidebar-fs-handlers.ts:494`)

**Auto-refresh:**
- `watch(projectPath, newPath => refreshTree(), { immediate: true })` (`useFileTree.ts:142-149`)

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Right sidebar only shown on command surface | `AppShell.vue` | `:77` |
| Three panel registry (explorer, search, git) | `useSidebarPanels.ts` | `:20-49` |
| Git panel hidden when no active project | `useSidebarPanels.ts` | `:77-87` |
| Workspace bootstrap hydration | `App.vue` | `:248-264` |
| Sidebar state hydration from disk | `App.vue` → `sidebar.ts` | `:263`, `:97-113` |
| Sidebar state persisted to `~/.stoa/sidebar.json` | `sidebar-state-store.ts` | `:107-140` |
| All panels derive `selectedProjectPath` from `workspaceStore.activeProject?.path` | FileExplorer/SearchPanel/SourceControlPanel | `:11`, `:11`, `:10` |
| File tree uses module-level shared `dirCache` | `useFileTree.ts` | `:17-18` |
| Git polling at 30s interval with visibility pause | `useGitStatusPolling.ts` | `:4`, `:52-58` |
| `fsChanged` push event exposed in preload but never consumed in renderer | `preload/index.ts:265-269` vs renderer grep | `:265-269` |
| Chokidar watcher starts on first `fsReadDir` per project but never stopped | `sidebar-fs-handlers.ts:494` | `:494`, `:472-486` |
| `startFsWatcher` and `stopFsWatcher` exported but only `start` is called | `sidebar-fs-handlers.ts` | `:421`, `:472` |
| Git handlers call `git` CLI via `execFile` (synchronous child_process) | `sidebar-git-handlers.ts` | `:24-38` |
| Search falls back from ripgrep to git grep | `sidebar-fs-handlers.ts` | `:380-390` |
| Per-project tab memory and restore on project switch | `sidebar.ts` | `:21`, `:79-95` |
| `pendingRevealPath` for reveal-in-explorer support | `sidebar.ts:67-71`, `FileExplorer.vue:392-438` | `:67-71`, `:392-438` |
| `RendererApi` type in shared defines all preload method signatures | `shared/project-session.ts` | imports sidebar-types |
| `fsOpenFile` ignores line/column parameters (only calls `shell.openPath`) | `src/main/index.ts:1461-1463` | `:1461-1463` |
| Observability subscriptions in workspace store | `workspaces.ts:287-301` | `:287-301` |
| Session graph event bridge updates sessions in real-time | `App.vue:232-246` | `:232-246` |

---

### Key Findings

#### 1. `fsChanged` Push Event is Dead Code

The preload exposes `onFsChanged` (`preload/index.ts:265-269`) which subscribes to the `fs:changed` IPC push channel. The backend's chokidar watcher fires these events (`sidebar-fs-handlers.ts:206`). **However, no renderer component or composable ever calls `window.stoa.onFsChanged()`** — the `grep` for `onFsChanged` in `src/renderer` returns zero results.

**Impact:** External file changes (e.g., git operations, editor saves from another process) are detected by the watcher but never reach the UI. The file tree, git status, and search panels only refresh on explicit user action or timer (git polling).

#### 2. `stopFsWatcher` is Never Called

`sidebar-fs-handlers.ts:472-486` exports `stopFsWatcher` but `src/main/index.ts` only calls `registerFilesystemHandlers` (which internally starts watchers). The watcher is started on first `fsReadDir` per project path (`:494`) but the cleanup path is never wired. Watchers accumulate for every project path that was ever browsed.

**Impact:** Memory leak for chokidar watchers; file handles not released on project switch or window close.

#### 3. `fsOpenFile` Ignores Line/Column Parameters

`src/main/index.ts:1461-1463` receives `filePath`, `line?`, and `column?` but only calls `shell.openPath(filePath)`. The line/column arguments are silently dropped. `SearchPanel.vue:70` passes line and column on match click, but the target editor never receives the position.

**Impact:** Clicking a search result opens the file but cannot jump to the specific line/match.

#### 4. Shared Module-Level State in `useFileTree`

`useFileTree.ts:17-18` declares `dirCache` and `expandedDirs` as module-level `ref`s (outside the composable function). This means all instances of the composable share the same cache and expansion state. If multiple components used `useFileTree` with different project paths, they would conflict.

**Current mitigation:** Only `FileExplorer.vue` uses this composable, so the shared state is benign in practice. But it's a latent coupling risk.

#### 5. No Reactive Cross-Panel Coordination

The three sidebar panels operate independently — each derives `selectedProjectPath` and makes its own IPC calls. When the active project changes:
- `FileExplorer` clears cache and reloads (`useFileTree` watcher)
- `SearchPanel` does **not** clear previous search results (stale results from old project remain visible until new search)
- `SourceControlPanel` calls `gitStore.refreshAll` via the watcher, but `useGitStatusPolling` also restarts polling — creating a potential double-fetch race

---

### Risks / Unknowns

- [!] **fsChanged dead code** — Watcher events generated but never consumed. The file explorer will not auto-refresh on external changes.
- [!] **Watcher leak** — `stopFsWatcher` exists but is never called. No cleanup on project switch or app shutdown.
- [!] **fsOpenFile drops line/column** — Search result clicks cannot navigate to specific lines.
- [?] **Double-fetch on project change** — `SourceControlPanel.vue:22-23` watches `selectedProjectPath` and calls `refreshAll` immediately, while `useGitStatusPolling` also restarts its interval timer on the same watch. Both fire at the same time.
- [?] **SearchPanel stale results** — When switching projects, the search store keeps results from the previous project. No `clearResults()` is called on project change.
- [?] **dirCache not invalidated by project delete** — `workspaceStore.removeProject` removes the project from the store but does not clear `useFileTree`'s `dirCache` for the deleted project path.
