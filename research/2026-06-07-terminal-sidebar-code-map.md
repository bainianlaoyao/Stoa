---
date: 2026-06-07
topic: terminal-page-right-sidebar-code-map
status: completed
mode: context-gathering
sources: 42
---

## Context Report: Terminal Page Right Sidebar Code Map

### Why This Was Gathered

The current task is to reason about making the terminal page's right sidebar more production-grade. This report maps the existing code boundary before any implementation work: page entry, sidebar component structure, props/emits, store and IPC dependencies, styles, and stable `data-testid` hooks.

### Summary

The "terminal page" right sidebar is not owned by `CommandSurface.vue`; it is mounted by `AppShell.vue` in the shell grid beside the command surface. `RightSidebar.vue` is a store-driven container with no props/emits; it renders registered async panels (`FileExplorer`, `SearchPanel`, `SourceControlPanel`) through `useSidebarPanels()`, and delegates tab rendering to `TabBar.vue`. Sidebar state is persisted through the renderer `sidebar` Pinia store -> preload `window.stoa` bridge -> main IPC handlers -> `~/.stoa/sidebar.json`.

### Key Findings

- Page entry boundary: `AppShell.vue` imports `RightSidebar` and renders it only when `activeSurface === 'command'`; the grid has a fixed left activity column, central viewport, and auto right column. Evidence: `src/renderer/components/AppShell.vue:8`, `src/renderer/components/AppShell.vue:44`, `src/renderer/components/AppShell.vue:48-57`, `src/renderer/components/AppShell.vue:77`.
- `RightSidebar.vue` is self-contained and store-driven: it imports `useSidebarStore`, `usePanelResize`, and `useSidebarPanels`; it has no `defineProps` or `defineEmits`, and reads `open`, `activeTab`, and `width` from Pinia. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:1-31`.
- Sidebar close vs surface switch behave differently: close keeps the sidebar mounted and CSS-hidden so child state remains alive, while leaving the command surface unmounts the whole sidebar via `AppShell`'s `v-if`. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:35-43`, `src/renderer/components/right-sidebar/RightSidebar.vue:83-95`, `src/renderer/components/AppShell.vue:77`, `src/renderer/components/AppShell.test.ts:452-468`.
- Panel registration is a module-level singleton registry with three async default panels: explorer, search, and git. Git is hidden unless there is an active project. Evidence: `src/renderer/composables/useSidebarPanels.ts:14-49`, `src/renderer/composables/useSidebarPanels.ts:77-86`, `src/renderer/components/right-sidebar/RightSidebar.test.ts:25-44`.
- Stable test topology already covers root sidebar, tab bar, panel roots, controls, and dynamic rows; any production-grade change should preserve or explicitly migrate these `data-testid` hooks. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:44-64`, `src/renderer/components/right-sidebar/TabBar.vue:45-62`, `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:463-543`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:86-213`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:133-434`.

### Component Boundary Map

```text
src/renderer/components/AppShell.vue
  -> src/renderer/components/right-sidebar/RightSidebar.vue
       -> src/renderer/components/right-sidebar/TabBar.vue
       -> dynamic <component :is="panel.component">
            explorer -> src/renderer/components/right-sidebar/explorer/FileExplorer.vue
            search   -> src/renderer/components/right-sidebar/search/SearchPanel.vue
            git      -> src/renderer/components/right-sidebar/git/SourceControlPanel.vue
```

| Boundary | Source | Evidence |
|---|---|---|
| `AppShell.vue` imports `RightSidebar` | `src/renderer/components/AppShell.vue` | `src/renderer/components/AppShell.vue:8` |
| Shell layout uses `grid-cols-[56px_1fr_auto]` | `src/renderer/components/AppShell.vue` | `src/renderer/components/AppShell.vue:44` |
| `CommandSurface` is the command/terminal surface and is `v-show`-gated | `src/renderer/components/AppShell.vue` | `src/renderer/components/AppShell.vue:48-57` |
| `RightSidebar` is rendered only on command surface | `src/renderer/components/AppShell.vue` | `src/renderer/components/AppShell.vue:77` |
| `RightSidebar` loops over `visiblePanels` and `v-show`s only the active panel | `src/renderer/components/right-sidebar/RightSidebar.vue` | `src/renderer/components/right-sidebar/RightSidebar.vue:74-77` |

### Props / Emits

| Component | Props | Emits | Evidence |
|---|---|---|---|
| `RightSidebar.vue` | none | none | No `defineProps` / `defineEmits` in `src/renderer/components/right-sidebar/RightSidebar.vue:1-31`; state comes from `useSidebarStore()` at `src/renderer/components/right-sidebar/RightSidebar.vue:10-11` |
| `TabBar.vue` | `activeTab: string` | `select: [tab: string]` | `src/renderer/components/right-sidebar/TabBar.vue:4-12` |
| `WorkspaceQuickActions.vue` external toggle | `project`, `session` | `openWorkspace`, `copySelection`; sidebar toggle is direct store call | `src/renderer/components/command/WorkspaceQuickActions.vue:9-17`, `src/renderer/components/command/WorkspaceQuickActions.vue:20-21`, `src/renderer/components/command/WorkspaceQuickActions.vue:94-102` |

### Store / Composable Dependencies

| Dependency | Used By | Role | Evidence |
|---|---|---|---|
| `useSidebarStore` | `RightSidebar`, `App.vue`, `WorkspaceQuickActions`, `FileExplorer`, shortcuts | open/close, active tab, width, session-list width, reveal path, persistence | `src/renderer/stores/sidebar.ts:14-149`, `src/renderer/components/right-sidebar/RightSidebar.vue:4-11`, `src/renderer/app/App.vue:20-31`, `src/renderer/components/command/WorkspaceQuickActions.vue:20-21`, `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:3-15` |
| `useSidebarPanels` | `RightSidebar`, `TabBar` | panel registry and visibility | `src/renderer/components/right-sidebar/RightSidebar.vue:6-12`, `src/renderer/components/right-sidebar/TabBar.vue:1-12`, `src/renderer/composables/useSidebarPanels.ts:53-96` |
| `usePanelResize` | `RightSidebar`, also reusable for command surface panels | drag-resize with rAF throttling and DOM writes during drag | `src/renderer/components/right-sidebar/RightSidebar.vue:5`, `src/renderer/components/right-sidebar/RightSidebar.vue:15-23`, `src/renderer/composables/useSidebarResize.ts:17-117` |
| `useSidebarShortcuts` | root `App.vue` | global Ctrl/Cmd+B and Ctrl/Cmd+Shift+E/F/G handlers | `src/renderer/app/App.vue:20-31`, `src/renderer/composables/useSidebarShortcuts.ts:16-54` |
| `useWorkspaceStore` | panels registry and all right-sidebar panels | active project controls panel visibility and project path | `src/renderer/composables/useSidebarPanels.ts:2`, `src/renderer/composables/useSidebarPanels.ts:77-86`, `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:3-14`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:4-13`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:4-18` |
| `useSearchStore` | `SearchPanel.vue` | query, filters, results, search execution | `src/renderer/components/right-sidebar/search/SearchPanel.vue:5-14`, `src/renderer/stores/search.ts:5`, `src/renderer/stores/search.ts:42` |
| `useGitStore` | `SourceControlPanel.vue` | status, branch, log, staging, commit, sync operations | `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:5-18`, `src/renderer/stores/git.ts:5`, `src/renderer/stores/git.ts:38-205` |

### Persistence / IPC Boundary

| Layer | File | Role | Evidence |
|---|---|---|---|
| Renderer store hydrate/persist | `src/renderer/stores/sidebar.ts` | reads and writes sidebar state through `window.stoa` | `src/renderer/stores/sidebar.ts:97-128` |
| Root bootstrap | `src/renderer/app/App.vue` | calls `sidebarStore.hydrate()` during app startup | `src/renderer/app/App.vue:260-264` |
| Preload bridge | `src/preload/index.ts` | exposes `getSidebarState` / `setSidebarState` | `src/preload/index.ts:234-238` |
| IPC constants | `src/core/ipc-channels.ts` | `sidebar:get-state` and `sidebar:set-state` | `src/core/ipc-channels.ts:55-56` |
| Main handlers | `src/main/index.ts` | handles sidebar get/set | `src/main/index.ts:1465-1472` |
| Core file store | `src/core/sidebar-state-store.ts` | writes `~/.stoa/sidebar.json` with tmp and backup files | `src/core/sidebar-state-store.ts:7-24`, `src/core/sidebar-state-store.ts:107-140` |
| Shared bridge type | `src/shared/project-session.ts` | Renderer API contract includes sidebar methods | `src/shared/project-session.ts:475-476` |
| Shared sidebar type | `src/shared/sidebar-types.ts` | `SidebarTab`, `SidebarState`, `SidebarPanelDefinition` | `src/shared/sidebar-types.ts:3-23` |

### Panel-Specific Boundary

| Panel | Component | Key Dependencies | Stable Hooks | Evidence |
|---|---|---|---|---|
| Explorer | `src/renderer/components/right-sidebar/explorer/FileExplorer.vue` | workspace store, sidebar store, `useFileTree`, `useFileOperations`, direct `window.stoa.fsOpenFile` | `file-explorer`, `toolbar-new-file`, `toolbar-new-folder`, `toolbar-collapse`, `toolbar-refresh`, `file-tree-container`, `file-row-*` | `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:1-15`, `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:60-63`, `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:463-543` |
| Search | `src/renderer/components/right-sidebar/search/SearchPanel.vue` | workspace store, search store, direct `window.stoa.fsOpenFile` for result open | `search-panel`, `search-input`, `search-button`, `toggle-case`, `toggle-whole-word`, `toggle-regex`, `search-file-*`, `search-match-*` | `src/renderer/components/right-sidebar/search/SearchPanel.vue:1-14`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:27-39`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:68-70`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:86-213` |
| Git | `src/renderer/components/right-sidebar/git/SourceControlPanel.vue` | workspace store, git store, `useGitStatusPolling`, document click listener, error timer | `source-control-panel`, `git-branch-selector`, `git-commit-input`, `git-commit-button`, `git-staged-section`, `git-changes-section`, `git-untracked-section`, `git-file-*` | `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:1-23`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:105-129`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:133-434` |

### External IPC Used By Panels

| Capability | Renderer entry | Preload / Contract / Channel Evidence |
|---|---|---|
| File tree read | `window.stoa.fsReadDir` in `useFileTree` | `src/renderer/composables/useFileTree.ts:51`, `src/preload/index.ts:241-242`, `src/shared/project-session.ts:478`, `src/core/ipc-channels.ts:58` |
| File create/rename/delete | `window.stoa.fsCreate`, `fsRename`, `fsDelete` in `useFileOperations` | `src/renderer/composables/useFileOperations.ts:49-71`, `src/preload/index.ts:250-257`, `src/shared/project-session.ts:481-483`, `src/core/ipc-channels.ts:61-63` |
| Search | `window.stoa.fsSearch` in search store | `src/renderer/stores/search.ts:42`, `src/preload/index.ts:259-260`, `src/shared/project-session.ts:484`, `src/core/ipc-channels.ts:65` |
| Git | `window.stoa.git*` in git store | `src/renderer/stores/git.ts:38-205`, `src/preload/index.ts:275-318`, `src/shared/project-session.ts:490-504`, `src/core/ipc-channels.ts:69-83` |

### Styles / Design Constraints

| Scope | Current Styling | Evidence |
|---|---|---|
| Right sidebar root | Tailwind utility classes, inline width from store, `bg-mica`, left border token | `src/renderer/components/right-sidebar/RightSidebar.vue:39-52` |
| Close/hide styling | scoped CSS: transition width/opacity; closed class sets `width: 0 !important`, hidden overflow, no pointer events | `src/renderer/components/right-sidebar/RightSidebar.vue:83-95` |
| Tab bar | tokenized line, radius, text, accent, active fill; manually inlined SVG icons | `src/renderer/components/right-sidebar/TabBar.vue:14-30`, `src/renderer/components/right-sidebar/TabBar.vue:41-67` |
| Panel controls | many inline token styles, but also hardcoded compact heights/pixels in controls and rows | `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:463-543`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:86-213`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:133-434` |
| Global design language | Fluent 2, token-first, stable test topology, no hardcoded visual primitives when a token should exist | `docs/engineering/design-language.md:9-21`, `docs/engineering/design-language.md:35-40`, `docs/engineering/design-language.md:71-81`, `docs/engineering/design-language.md:108-110` |

### Related `data-testid`

| Test ID | Owner | Evidence |
|---|---|---|
| `right-sidebar` | `RightSidebar.vue` root | `src/renderer/components/right-sidebar/RightSidebar.vue:44` |
| `sidebar-resize-handle` | `RightSidebar.vue` resize handle | `src/renderer/components/right-sidebar/RightSidebar.vue:49` |
| `sidebar-close-btn` | `RightSidebar.vue` close button | `src/renderer/components/right-sidebar/RightSidebar.vue:64` |
| `sidebar-tab-bar` | `TabBar.vue` root | `src/renderer/components/right-sidebar/TabBar.vue:45` |
| `sidebar-tab-${panel.id}` => `sidebar-tab-explorer`, `sidebar-tab-search`, `sidebar-tab-git` | `TabBar.vue` buttons | `src/renderer/components/right-sidebar/TabBar.vue:48-62`, `src/renderer/components/right-sidebar/RightSidebar.test.ts:25-44` |
| `workspace.sidebar-toggle` | command quick action toggle | `src/renderer/components/command/WorkspaceQuickActions.vue:94-102` |
| `file-explorer` | Explorer root | `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:463` |
| `toolbar-new-file`, `toolbar-new-folder`, `toolbar-collapse`, `toolbar-refresh` | Explorer toolbar | `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:465-507` |
| `file-tree-container`, `file-row-${relativePath}` | Explorer tree | `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:523-543` |
| `search-panel`, `search-input`, `search-button`, `toggle-case`, `toggle-whole-word`, `toggle-regex` | Search panel controls | `src/renderer/components/right-sidebar/search/SearchPanel.vue:86-134` |
| `search-file-${relativePath}`, `search-match-${relativePath}-${line}` | Search results | `src/renderer/components/right-sidebar/search/SearchPanel.vue:184-213` |
| `source-control-panel`, `git-branch-selector`, `git-commit-input`, `git-commit-button` | Git panel header/commit controls | `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:133-141`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:281-300` |
| `git-staged-section`, `git-changes-section`, `git-untracked-section`, `git-file-${entry.path}` | Git status sections and rows | `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:317-434` |

### Current Test Coverage

| Test File | Covered Behavior | Evidence |
|---|---|---|
| `src/renderer/components/AppShell.test.ts` | sidebar closed by default, removed on non-command surfaces, remount behavior on command return | `src/renderer/components/AppShell.test.ts:440-526` |
| `src/renderer/components/right-sidebar/RightSidebar.test.ts` | tabbar rendering, git visibility with active project, active tab ARIA, select emit, close class, open state, resize handle, close button | `src/renderer/components/right-sidebar/RightSidebar.test.ts:20-78`, `src/renderer/components/right-sidebar/RightSidebar.test.ts:126-272` |
| `src/renderer/components/right-sidebar/explorer/FileExplorer.test.ts` | Explorer testids, file open, keyboard/navigation, context menu, create/rename/delete paths | `src/renderer/components/right-sidebar/explorer/FileExplorer.test.ts:104-135`, `src/renderer/components/right-sidebar/explorer/FileExplorer.test.ts:162-196`, `src/renderer/components/right-sidebar/explorer/FileExplorer.test.ts:508-685` |
| `src/renderer/components/right-sidebar/search/SearchPanel.test.ts` | Search testids, query/filter interactions, search result click | `src/renderer/components/right-sidebar/search/SearchPanel.test.ts:43-60`, `src/renderer/components/right-sidebar/search/SearchPanel.test.ts:75-168`, `src/renderer/components/right-sidebar/search/SearchPanel.test.ts:222-274` |
| `src/renderer/stores/sidebar.test.ts` | store defaults, open/tab/width actions, hydration and persistence | `src/renderer/stores/sidebar.test.ts:21-285` |
| `src/renderer/composables/useSidebarShortcuts.test.ts` | shortcut behavior | `src/renderer/composables/useSidebarShortcuts.test.ts:16-163` |

### Risks / Unknowns For Production-Grade Work

- Mount lifecycle is inconsistent: close preserves child panel state through CSS hiding, while surface switch unmounts the sidebar entirely. This may surprise users if Explorer expanded dirs/Search results/Git local UI state survive close but not Settings/Archive navigation. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:35-43`, `src/renderer/components/AppShell.vue:77`, `src/renderer/components/AppShell.test.ts:452-526`.
- `RightSidebar` is tightly coupled to Pinia and is not prop-driven. This is straightforward for app state but makes isolated reuse and component-level state injection harder. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:1-31`.
- `useSidebarPanels` uses a module-level mutable singleton `registry`. It supports `registerPanel` / `unregisterPanel`, so tests or future plugins can mutate shared state unless carefully reset. Evidence: `src/renderer/composables/useSidebarPanels.ts:14-16`, `src/renderer/composables/useSidebarPanels.ts:53-68`.
- All panels stay mounted when sidebar is closed, so watchers/timers/listeners inside panels can keep running. Search clears only debounce on unmount, and Git has document listeners plus error timers cleaned up on unmount; CSS-hidden close does not trigger unmount. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:35-43`, `src/renderer/components/right-sidebar/search/SearchPanel.vue:27-43`, `src/renderer/components/right-sidebar/git/SourceControlPanel.vue:105-129`.
- Resize does direct DOM writes during drag and commits only on mouseup/blur. This keeps store churn down, but any production change needs to preserve the final `onWidthChange`/`commitWidth` contract and the dynamic max-width behavior (`window.innerWidth - minNonSidebarArea`, default 320). Evidence: `src/renderer/composables/useSidebarResize.ts:39-84`, `src/renderer/composables/useSidebarResize.ts:87-108`.
- Visual implementation is token-heavy but not purely tokenized: several durations, row heights, font sizes, and SVG icons are hardcoded in components. The design-language doc requires token-first Fluent 2 treatment and stable test topology. Evidence: `src/renderer/components/right-sidebar/RightSidebar.vue:83-95`, `src/renderer/components/right-sidebar/TabBar.vue:14-30`, `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:541-543`, `docs/engineering/design-language.md:13-21`.

### Context Handoff

Start here: `research/2026-06-07-terminal-sidebar-code-map.md`

Context only. Use this saved report as the source of truth for the terminal page right-sidebar code boundary.
