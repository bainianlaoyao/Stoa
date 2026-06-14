---
date: 2026-06-12
topic: renderer-ui-and-state-boundary-audit-for-web-migration
status: completed
mode: context-gathering
sources: 24
---

## Context Report: Renderer UI & State Boundary Audit for Browser Served SPA Migration

### Why This Was Gathered

To audit the current Electron/Vue renderer composition, store/composable boundaries, and exact `window.*`/IPC dependencies that would need to move behind a real browser page served by `stoa-server`. This audit complements the prior migration reports (`2026-06-12-stoa-server-web-client-migration-audit-v2.md`, `…-audit.md`, `…-web-ui-routes-testids-e2e-coverage.md`, `…-playwright-web-ui-parity-context.md`, `…-electron-e2e-and-generated-journey-tests-migration-inventory.md`) by zooming into the **renderer internals** — what code paths inside Vue components, Pinia stores, and composables reference Electron-only globals, what can be lifted unchanged, and what needs a new adapter or a breaking rewrite.

### Summary

The renderer is a single-page Vue 3 (`<script setup>` Composition API) + Pinia app, bootstrapped from `src/renderer/main.ts` (4 lines) and rooted at `App.vue` (1 event-bus root). It has **35 Vue components** organized into 8 surface clusters (TitleBar, ActivityBar, Command/Archive/Settings surfaces, RightSidebar with 3 panels, Memory/Update overlays) and **5 Pinia stores** (`workspaces`, `settings`, `sidebar`, `update`, `git`, `search`) plus 5 composables (`useFileTree`, `useFileOperations`, `usePanelResize`, `useSidebarPanels`, `useSidebarShortcuts`, `useGitStatusPolling`). The renderer is built by **`electron-vite`** (NOT plain Vite) with three outputs: main, preload, renderer. There is **no Vue Router** — navigation is purely state-based on `activeSurface: 'command' | 'archive' | 'settings'`. All cross-process data flows through the global `window.stoa` exposed by `src/preload/index.ts` via `contextBridge.exposeInMainWorld('stoa', api)` implementing the `RendererApi` interface (100+ methods spanning bootstrap, projects, sessions, terminal I/O, settings, dialogs, file system, git, observability, updates, window controls, sidecar). The `StoaClient` HTTP+WS library and `StoaClientPreloadAdapter` (`src/renderer/lib/stoa-client*.ts`) already implement the **full `RendererApi` surface over HTTP/WS**, with stubs/warnings for desktop-only methods. A partial feature-flagged dual-path is wired in `workspaces.ts`, `settings.ts`, `sidebar.ts` via `isStoaClientMode()` / `getStoaClient()` (gated by `VITE_USE_STOA_CLIENT=1`), but `App.vue` still calls `window.stoa.*` unconditionally. Browser-only/Node-only assumptions: `window.matchMedia` for theme detection, `document.addEventListener('keydown')` for shortcuts, `ResizeObserver` and `requestAnimationFrame` for xterm viewport, `navigator.clipboard`, drag-and-drop `DataTransfer`, `<Teleport to="body">` for context menus — all standard browser APIs that work in both Electron renderer and a browser SPA.

---

### Key Findings

#### 1. Root Composition & Bootstrap

| File | Role | Notes |
|------|------|-------|
| `src/renderer/main.ts:1-10` | Entry: `createApp(App).use(createPinia()).use(i18n).mount('#app')` | 4 lines, no `window` access, no router, no error boundary |
| `src/renderer/app/App.vue:1-316` | Root component | Wires 5 stores (`workspaces`, `settings`, `update`, `memoryNotifications`, `sidebar`), registers `useSidebarShortcuts`, subscribes to `window.stoa.onUpdateState / onMemoryNotification / onTitleGenerationNotification / onSessionGraphEvent / onSessionEvent` (8 unsubscribers), and calls `window.stoa.getBootstrapState()` → `workspaceStore.hydrate(bootstrapState)` → `workspaceStore.hydrateObservability()` + `settingsStore.loadSettings()` + `updateStore.refresh()` + `sidebarStore.hydrate()` in `onMounted`. **Every IPC call is unconditional `window.stoa.*` — no dual path.** |
| `src/renderer/components/AppShell.vue:1-80` | Layout shell | Owns `activeSurface: 'command' \| 'archive' \| 'settings'` ref (no router). Renders `<TitleBar>` + grid(56px 1fr auto) of `<GlobalActivityBar>` + main `<section data-testid="app-viewport">` + `<RightSidebar>`. |

**Entry points in `App.vue:218-273` (`onMounted`):**
- `window.stoa.getBootstrapState()` → `workspaceStore.hydrate(state)`
- `window.stoa.onUpdateState(cb)`, `onMemoryNotification(cb)`, `onTitleGenerationNotification(cb)`, `onSessionGraphEvent(cb)` / `onSessionEvent(cb)` — wired unconditionally
- `settingsStore.loadSettings()` (which has dual path internally)
- `updateStore.refresh()` (still uses `window.stoa.getUpdateState()` unconditionally)

**Verdict for web migration:** Main.ts is reusable as-is. `App.vue` needs a rewrite of its `onMounted` to call `initStoaClientForStores(baseUrl, token)` first (read from `?token=` query or env-injected), then call `workspaceStore.hydrateFromStoaClient()` and `workspaceStore.subscribeToSessionGraphViaStoaClient()`. `AppShell.vue` is reusable unchanged.

#### 2. Major UI Surfaces / Panels / Routes / Entry Points

There is **no Vue Router** (`vue-router` is not in `package.json`). Navigation is purely a 3-value ref. All entry points are hardcoded component imports, not URL-driven.

| Surface | Owner Component | Sub-Components | URL Equivalent Needed |
|---------|------------------|----------------|----------------------|
| TitleBar (window controls + brand) | `TitleBar.vue` (lines 1-118) | — | None — desktop-only |
| Global activity bar | `GlobalActivityBar.vue` (1-153) | — | None |
| **Command surface** (default) | `command/CommandSurface.vue:1-130` | `WorkspaceHierarchyPanel`, `TerminalSessionDeck` | `/` (or `/workspace`) |
|  ↳ Workspace hierarchy panel | `command/WorkspaceHierarchyPanel.vue` (1-100+) | `NewProjectModal`, `ProviderFloatingCard`, `ProviderRadialMenu`, `SessionContextMenu` | embedded |
|  ↳ Terminal session deck | `command/TerminalSessionDeck.vue:1-80+` | `TerminalViewport` | embedded |
|  ↳ Terminal viewport (xterm.js) | `TerminalViewport.vue:1-410` | `WorkspaceQuickActions` | embedded |
| **Archive surface** | `archive/ArchiveSurface.vue:1-279` | — | `/archive` |
| **Settings surface** | `settings/SettingsSurface.vue:1-344` | `SettingsTabBar`, `GeneralSettings`, `TerminalSettings`, `ProvidersSettings`, `AdvancedSettings`, `AboutSettings` | `/settings` and nested `/settings/:tabId` |
| **Right sidebar** (only on command surface) | `right-sidebar/RightSidebar.vue:1-97` | `TabBar`, `FileExplorer`, `SearchPanel`, `SourceControlPanel` (3 panels via `useSidebarPanels` registry) | embedded — sidebar panels are not top-level routes |
| Memory toast host (overlay) | `memory/MemoryToastHost.vue` | — | global overlay |
| Update prompt (modal) | `update/UpdatePrompt.vue` | — | global modal |
| Workspace list (test) | `WorkspaceList.vue` | — | unused in production |
| Panel extensions (test) | `PanelExtensions.vue` | — | unused in production |
| Inbox queue (placeholder) | `inbox/InboxQueueSurface.vue` | — | placeholder, no IPC |
| Context tree (placeholder) | `tree/ContextTreeSurface.vue` | — | placeholder, no IPC |
| Provider floating card | `command/ProviderFloatingCard.vue` | — | embedded |
| Provider radial menu | `command/ProviderRadialMenu.vue` | — | embedded |
| Session context menu | `command/SessionContextMenu.vue` | — | embedded (Teleport) |
| Primitives (reusable) | `primitives/BaseModal.vue`, `GlassFormField.vue`, `GlassPathField.vue`, `GlassListbox.vue` | — | — |

**Sidebar panel registry** (`src/renderer/composables/useSidebarPanels.ts:1-96`): 3 hardcoded panels (`explorer`, `search`, `git`) registered in module scope with `defineAsyncComponent`. A new web app should keep this registry but may add a new "tree" or "settings" panel by importing `useSidebarPanels().registerPanel(...)`.

**Verdict for web migration:** The surface tree maps directly to URL paths, but **the renderer has no router today**. Adding `vue-router` (or any other router) is a breaking change to `AppShell.vue`'s `activeSurface` ref. The cleanest migration is to either (a) keep the no-router state model and serve `/`, `/archive`, `/settings` as query params (or hash routes), or (b) introduce a router and replace `activeSurface` with a route read.

#### 3. Pinia Stores — Detailed Boundary Map

| Store | File | `window.stoa` Direct Calls | Dual-Path (StoaClient) | Stateful local logic reusable as-is |
|------|------|------------------------------|-------------------------|-------------------------------------|
| **workspaces** (the spine) | `src/renderer/stores/workspaces.ts:1-657` | Yes — legacy `getSessionPresence`, `getProjectObservability`, `getAppObservability`, `listSessionObservationEvents` paths (lines 343-461) | **Partial** — `hydrateFromStoaClient` (243-251), `subscribeToSessionGraphViaStoaClient` (253-260), `subscribeToObservabilityViaStoaClient` (262-283), `isStoaClientMode()` branch in `hydrateObservability` (286-340) | All projection logic (`projectSessionsIntoTree` 63-166, `applySessionGraphEvent` 586-622), computed `projectHierarchy` 203-226, `activeSessionPresence` 192-198, `syncSessionPresenceFromSummary` 540-565 — **all platform-agnostic** |
| **settings** | `src/renderer/stores/settings.ts:1-302` | Yes — `pickFolder` (226), `pickFile` (230) only | **Yes** — every read/write goes through `fetchSettings()` (36-45) and `persistSetting()` (47-56), `detectShell/Provider/Vscode` (58-89), `subscribeToSettingsChangedViaStoaClient` (91-99) | `loadSettings()` (130-161) key-by-key apply, `applyRemoteSettingChange` (101-128), `applyTheme` (260-270), `handleSystemThemeChange` (272-276) — reusable; i18n/locale/theme logic is platform-agnostic |
| **sidebar** | `src/renderer/stores/sidebar.ts:1-178` | None in body — only `fetchSidebarState/persistSidebarState` (100-124) which DO have dual path | **Yes** — `isStoaClientMode()` branch in `fetchSidebarState` (101-113) and `persistSidebarState` (115-124) | `setOpen/toggle/setActiveTab/setWidth/commitWidth` width clamping, `revealInExplorer`, `restoreProjectTab` watch on active project — all reusable |
| **update** | `src/renderer/stores/update.ts:1-85` | **Yes — every method** (refresh 48, checkForUpdates 54, downloadUpdate 60, quitAndInstallInstall 66, dismissUpdate 70) | **No** — even desktop-only stubs would need a new `subscribeToUpdateChanged` path | `applyState`, `dismissPrompt`, `shouldShowPrompt` (computed), `createPromptKey` — reusable |
| **memory-notifications** | `src/renderer/stores/memory-notifications.ts:1-79` | None — pure toast queue | N/A | **All reusable** — 100% in-renderer state (timers, max-notifications, status-based timeout) |
| **git** | `src/renderer/stores/git.ts:1-244` | **Yes — every method** (refreshStatus 38, refreshBranches 46, refreshLog 54, stageFile 74, unstageFile 87, discardFile 100, commit 113, push 127, pull 140, fetch 153, checkoutBranch 166, createBranch 179, rebase 192, merge 205) | **No** — every method calls `window.stoa.gitX` directly | Computed `staged/unstaged/untracked/hasChanges/currentBranch`, `clearError` — all reusable |
| **search** | `src/renderer/stores/search.ts:1-77` | **Yes — `search()`** (42) calls `window.stoa.fsSearch(options)` | **No** | Query state, `latestSearchId` cancellation guard, computed `hasResults` — all reusable |
| **observability-view-models** (pure functions, not a store) | `src/renderer/stores/observability-view-models.ts:1-94` | None | N/A | **All reusable** — pure functions `toSessionRowViewModel`, `toActiveSessionViewModel`, `confidenceLabel`, `explanationForPresence`, `formatRelativeAge` |
| **stoa-store-plugin** (Pinia plugin) | `src/renderer/stores/stoa-store-plugin.ts:1-56` | None | This IS the dual-path glue | Reusable — wires `$stoaClient` into stores |

**Cross-store patterns:**
- `stoa-store-plugin.ts` exports `initStoaClientForStores(baseUrl, token)`, `getStoaClient()`, `isStoaClientMode()` (gated by `import.meta.env.VITE_USE_STOA_CLIENT`). This is the singleton pattern that web mode needs to bootstrap during `App.vue` `onMounted`.
- `useWorkspaceStore.hydrate(bootstrapState)` is the single ingestion point for `BootstrapState` (`{ activeProjectId, activeSessionId, projects, sessions, terminalWebhookPort }`).
- `terminalWebhookPort` is loaded but not used in the renderer for output — it's a legacy field, the web SPA doesn't need a port (the WS URL is the server's own `/ws?token=`).

#### 4. Composables — Detailed Boundary Map

| Composable | File | Browser-only API calls | StoaClient aware? | Reusable as-is for web? |
|-----------|------|-------------------------|--------------------|------------------------|
| `useFileTree` | `src/renderer/composables/useFileTree.ts:1-162` | `window.stoa.fsReadDir` (51) | **No** | **Almost** — only one method (`loadDir` 51) needs `window.stoa.fsReadDir` → `client.get('/api/v1/fs/dir?…')`. The tree-cache state machine (expanded dirs, dir cache, flat-row DFS projection) is 100% reusable. The slice/format of `dirPath` on Windows backslashes (line 95) already handles both forward/backslash. |
| `useFileOperations` | `src/renderer/composables/useFileOperations.ts:1-87` | `window.stoa.fsRename` (49), `window.stoa.fsCreate` (54), `window.stoa.fsDelete` (71) | **No** | **Almost** — the 3 IPC calls map to `client.post/put/delete` to `/api/v1/fs/entry` etc. Inline-input state machine is reusable. |
| `usePanelResize` | `src/renderer/composables/useSidebarResize.ts:1-117` | `document.body.style.cursor`, `document.createElement('div')`, `document.body.appendChild`, `window.innerWidth`, `requestAnimationFrame`, `window.addEventListener('blur')` | **No** | **Yes** — pure DOM manipulation, works in browser. No IPC. |
| `useSidebarPanels` | `src/renderer/composables/useSidebarPanels.ts:1-96` | None | **No** | **Yes** — pure module-level registry of async components. Reusable. |
| `useSidebarShortcuts` | `src/renderer/composables/useSidebarShortcuts.ts:1-55` | `document.addEventListener('keydown')` | **No** | **Yes** — pure DOM event handling. Reusable. |
| `useGitStatusPolling` | `src/renderer/composables/useGitStatusPolling.ts:1-75` | `document.addEventListener('visibilitychange')` | **No** | **Yes** — orchestrates `useGitStore` calls. Reusable. |
| `provider-icons` | `src/renderer/composables/provider-icons.ts` | None | **No** | **Yes** — pure constants. |

#### 5. Exact Electron/Preload-Only Dependencies

**`window.stoa` calls by surface (152 hits across 35 files):**

| Method group | Calls in renderer | Has HTTP/WS equivalent? | Adapter has stub? | Notes |
|--------------|-------------------|--------------------------|--------------------|-------|
| `getBootstrapState / createProject / deleteProject / setActiveProject / setActiveSession / openWorkspace` | 7+ (App.vue + child) | **Yes** | Yes | Reusable via `StoaClientPreloadAdapter` |
| `createSession / archiveSession / restoreSession / restartSession / regenerateSessionTitle / listArchivedSessions / getTerminalReplay / sendSessionInput / sendSessionBinaryInput / sendSessionResize` | 8+ | **Yes** | Yes | All reusable |
| `onTerminalData / onMemoryNotification / onTitleGenerationNotification / onSessionEvent / onSessionGraphEvent / onSessionPresenceChanged / onProjectObservabilityChanged / onAppObservabilityChanged / onUpdateState / onWindowMaximizeChange / onFsChanged` | 11 WS subscriptions | **Yes** (WS) | Yes | All mapped to `client.subscribe(...)` |
| `getSessionPresence / getProjectObservability / getAppObservability / listSessionObservationEvents` | 4 observability reads | **Yes** | Yes | |
| `getSettings / setSetting / titleGenerationFetchModels / detectShell / detectProvider / detectVscode` | 7+ settings | **Yes** | Yes | |
| **`pickFolder / pickFile`** | 2 (NewProjectModal:25, AdvancedSettings) | **NO** — server has no `dialog:*` route | **Yes — stub with `console.warn` and `null`** | Web needs `input type="file" webkitdirectory` or path-text fallback |
| **`minimizeWindow / maximizeWindow / closeWindow / isWindowMaximized / onWindowMaximizeChange`** | 5 (TitleBar.vue) | **NO** | **Yes — stubs** | Web has no BrowserWindow. Replace TitleBar with a browser header or omit. |
| `uninstallSidecars / listSessionEvidence / contextExportFullText / contextExportSlimText` | 4+ | **Yes** | Yes | |
| `getUpdateState / checkForUpdates / downloadUpdate / quitAndInstallInstall / dismissUpdate` | 5 (update store + AboutSettings) | **NO** | **Yes — stubs** | Web has no auto-updater. Either hide AboutSettings updates section or redirect to a URL. |
| **`fsOpenFile`** | 2 (FileExplorer.vue:62, SearchPanel.vue:70) | **NO** | **Yes — stub with `console.warn`** | Web can use `window.open()` for known file types or `file://` URL (browser-permission gated). |
| **`shellShowItemInFolder`** | 1 (FileExplorer.vue:230) | **NO** | **Yes — stub** | Web cannot reveal in OS file manager. Replace with "download" or hide. |
| `fsReadDir / fsReadFile / fsWriteFile / fsCreate / fsRename / fsDelete / fsSearch` | 7+ | **Yes** (HTTP `/api/v1/fs/*`) | Yes | All reusable |
| `gitStatus / gitStage / gitUnstage / gitDiscard / gitCommit / gitPush / gitPull / gitFetch / gitRebase / gitMerge / gitBranches / gitLog / gitDiff / gitCheckout / gitCreateBranch` | 15+ | **Yes** (HTTP `/api/v1/git/*`) | Yes | All reusable |
| `getSidebarState / setSidebarState` | 2+ | **Yes** | Yes | |
| `getServerInfo` | 1 (AboutSettings.vue:101) | **Yes** (via `/api/v1/discovery` + client.baseUrl) | Yes | Already implemented in adapter |
| `windowsBuildNumber` | 1 (TerminalViewport.vue:171) | **No** | Adapter sets `undefined` (matches Electron renderer when not on Windows) | Used only by xterm settings resolver |

**BrowserWindow assumptions (main process only — not visible in renderer):**
- `src/main/index.ts:460-487` `createMainWindow()` sets `frame: false`, loads `loadFile('../renderer/index.html')` or `loadURL(process.env.ELECTRON_RENDERER_URL)`, uses `webPreferences: { preload: '../preload/index.cjs', contextIsolation: true, nodeIntegration: false, sandbox: false }`.
- These are **invisible to the renderer** — the renderer only sees `window.stoa` injected by `contextBridge.exposeInMainWorld('stoa', api)` at `src/preload/index.ts:326`.

**Terminal embedding assumptions (xterm.js + IPC):**
- `src/renderer/terminal/xterm-runtime.ts:1-50+` creates a full xterm.js runtime with FitAddon, ClipboardAddon, SearchAddon, SerializeAddon, Unicode11Addon, WebLinksAddon, WebglAddon, ShellIntegrationAddon. **Pure browser, no Electron assumption** — already portable.
- `TerminalViewport.vue:151-357` (`setupTerminal()`) does the heavy lifting: `localTerminal.open(container)`, `localTerminal.attachCustomKeyEventHandler(...)`, `localTerminal.onData(data) → stoa.sendSessionInput(sessionId, data)`, `localTerminal.onBinary(data) → stoa.sendSessionBinaryInput(...)`, `stoa.onTerminalData(chunk) → enqueueWrite(chunk.data)`, `getTerminalReplay(sessionId)`, `sendSessionResize(sessionId, cols, rows)`.
- The 1-second replay-fallback timer at `TerminalViewport.vue:326-333` ensures the terminal is usable even if replay is slow.
- All xterm call sites use the `RendererApi` interface; replacing `window.stoa` with `StoaClientPreloadAdapter` is a one-line swap per call. **xterm.js itself is already browser-native** (`@xterm/xterm` 6.1.0).

**Other Electron-only assumptions in renderer:**
- `process.platform` and `os.release()` for Windows build number — only at `src/preload/index.ts:53-55`, not in renderer code.
- `electron` imports — none in renderer; the only `import 'electron'` is in `src/preload/index.ts:1` and `src/main/index.ts:1`.

**Feature-flag (`VITE_USE_STOA_CLIENT=1`) status:**
- Read at `src/renderer/stores/stoa-store-plugin.ts:43-47` via `import.meta.env`.
- **`initStoaClientForStores(baseUrl, token)` is exported but never called** anywhere in `src/renderer` (verified by grep — only definition site is in `stoa-store-plugin.ts:28`). The `stoaClientPlugin()` Pinia plugin is also defined but not registered in `main.ts`.
- `isStoaClientMode()` is called in `workspaces.ts` (1 site), `settings.ts` (5 sites), `sidebar.ts` (2 sites) — but only the `else` branch (legacy `window.stoa`) is exercised today because the flag is not set and `initStoaClientForStores` is not called.
- **Conclusion:** the dual-path plumbing is in place but inert. A web build would need to (1) set `VITE_USE_STOA_CLIENT=1` at build time, (2) call `initStoaClientForStores(baseUrl, token)` early, (3) make `App.vue` consume the dual path too.

**`stoaServerEnabled` setting + `STOA_USE_SERVER` env var:**
- `src/main/index.ts:1383-1387` `useStoaServer = persistedSettings?.stoaServerEnabled === true || process.env.STOA_USE_SERVER === 'true'`.
- When true, `StoaServerSpawner` starts a Stoa Server on a free port and `getServerInfo()` returns the URL+token.
- `AdvancedSettings.vue` exposes a toggle for `stoaServerEnabled`; `AboutSettings.vue` shows the URL/token for the user to copy.

#### 6. Reuse vs Adapter vs Breaking Rewrite — by Layer

| Layer | Reusable as-is for web SPA | Needs a new adapter | Needs a breaking rewrite |
|-------|------------------------------|----------------------|---------------------------|
| **Main entry** | `src/renderer/main.ts` (4 lines) | Add `initStoaClientForStores` + `connectWs` + `stoaClientPlugin` registration | — |
| **Root component** | `AppShell.vue`, `GlobalActivityBar.vue` | `App.vue` needs to call `workspaceStore.hydrateFromStoaClient()` and `subscribeToSessionGraphViaStoaClient()` instead of `window.stoa.getBootstrapState()` and `onSessionEvent` | — |
| **Title bar** | — | — | `TitleBar.vue` must be removed or replaced — it is 100% Electron `BrowserWindow` controls. Web has no frame at all (CSS already sets `-webkit-app-region: drag` which is a no-op in browsers). |
| **Command surface** | `CommandSurface.vue`, `WorkspaceHierarchyPanel.vue`, `TerminalSessionDeck.vue`, `WorkspaceQuickActions.vue`, `NewProjectModal.vue` (replace `pickFolder` with `<input type="file" webkitdirectory>` or text path), `ProviderFloatingCard.vue`, `ProviderRadialMenu.vue`, `SessionContextMenu.vue` | — | — |
| **Terminal viewport** | `TerminalViewport.vue` (already xterm.js, all IPC goes through `window.stoa` which is the same shape as `StoaClientPreloadAdapter`) | — | — |
| **Archive surface** | `ArchiveSurface.vue` (pure presentation, no IPC) | — | — |
| **Settings surface** | `SettingsSurface.vue`, `SettingsTabBar.vue`, `GeneralSettings.vue`, `TerminalSettings.vue`, `ProvidersSettings.vue`, `AdvancedSettings.vue`, `AboutSettings.vue` (update section can be hidden) | — | — |
| **Right sidebar** | `RightSidebar.vue`, `TabBar.vue`, `useSidebarPanels.ts` | `FileExplorer.vue` — `fsOpenFile` and `shellShowItemInFolder` need new adapter (browser limitations) | — |
| **Search panel** | `SearchPanel.vue` (with `fsOpenFile` adapter for file open) | — | — |
| **Source control panel** | `SourceControlPanel.vue`, `useGitStatusPolling.ts`, `useGitStore` (after `git.ts` is dual-pathed) | `git.ts` store needs full dual-path (currently all `window.stoa.gitX` direct) | — |
| **Memory toast host** | `MemoryToastHost.vue`, `useMemoryNotificationsStore` (100% reusable) | — | — |
| **Update prompt** | `UpdatePrompt.vue` (presentation only) | `useUpdateStore` needs full dual-path or `stoaClient` stubs to no-op | — |
| **Workspaces store** | All projection / computed / apply methods | `hydrate`, `hydrateObservability`, `applySessionPresenceSnapshot` paths need a single non-conditional StoaClient branch (dual path can stay as fallback) | — |
| **Settings store** | All key-by-key apply logic | Already dual-pathed | — |
| **Sidebar store** | Width clamping, watch logic, persistence calls | Already dual-pathed | — |
| **Git store** | Computed `staged/unstaged/untracked/hasChanges/currentBranch` | **Needs full dual-path** — every method (`stageFile`, `unstageFile`, `discardFile`, `commit`, `push`, `pull`, `fetch`, `checkoutBranch`, `createBranch`, `rebase`, `merge`) calls `window.stoa.gitX` directly | — |
| **Search store** | `searchId` cancellation, query state | `search()` method needs dual path (currently `window.stoa.fsSearch` direct) | — |
| **Update store** | `applyState`, `dismissPrompt`, `shouldShowPrompt` computed | **Needs dual path** — all 5 methods use `window.stoa.*` | — |
| **Composables** | `usePanelResize`, `useSidebarPanels`, `useSidebarShortcuts`, `useGitStatusPolling`, `provider-icons` | `useFileTree` (1 IPC call), `useFileOperations` (3 IPC calls) | — |
| **Routing** | — | — | **No router today.** Adding `vue-router` (or keeping state-based surfaces) is a choice. |
| **Build** | `electron.vite.config.ts` Vue plugin + Tailwind + VueI18n plugin can be reused for a new `vite.web.config.ts` | A new `vite.web.config.ts` with `base: '/'`, `build.outDir: 'dist/web'`, and `@vitejs/plugin-vue` is needed | — |
| **Auth** | — | A new token-bootstrap step: read token from URL `?token=`, `localStorage`, or injected global. Server already has Bearer + session-scoped auth (`stoa-server/src/middleware/auth.ts:19-49`). | — |

**Top reuse opportunities (no rewrite):**
- All `src/renderer/terminal/xterm-runtime.ts` — xterm.js with all addons is already browser-native.
- All observability view models (`observability-view-models.ts`) — pure functions.
- All sidebar and panel logic — width clamping, panels registry, shortcut handling, polling.
- All session/project tree projection in `workspaces.ts:63-226` — pure functions of store state.
- All Tailwind classes, design tokens, typography, brand assets — these are CSS-only, work in any browser.

**Top new-adapter requirements (small code, no rewrite):**
- `useFileTree.loadDir` → call `StoaClient.fsReadDir` instead of `window.stoa.fsReadDir`
- `useFileOperations.{commitInput, deleteEntry}` → call `StoaClient.fsX` instead of `window.stoa.fsX`
- `useSearchStore.search` → call `StoaClient.fsSearch`
- `useGitStore.{stageFile, unstageFile, discardFile, commit, push, pull, fetch, checkoutBranch, createBranch, rebase, merge, refreshStatus, refreshBranches, refreshLog}` → 15 methods, all `StoaClient.gitX`
- `useUpdateStore.{refresh, checkForUpdates, downloadUpdate, dismissUpdate}` → all return stubs (web has no auto-updater); `quitAndInstallUpdate` not callable
- `App.vue` bootstrap → call `workspaceStore.hydrateFromStoaClient()` and `workspaceStore.subscribeToSessionGraphViaStoaClient()` plus `settingsStore`, `sidebarStore`, `updateStore` paths
- `NewProjectModal.browseProjectPath` → either `useFileSystemAccess.showDirectoryPicker()` (Chromium-only) or fall back to path text input
- `FileExplorer.openFile` (`fsOpenFile`) and `revealInSystemExplorer` (`shellShowItemInFolder`) → either browser download or no-op
- `TitleBar` → **remove or replace with browser-only header** (5 `window.stoa.minimizeWindow/maximizeWindow/closeWindow` calls)

**Breaking rewrites (intrusive):**
- None strictly required. The biggest design choice is **introducing or not introducing a router**. The current state-based navigation works; URL-based routing is a separable addition.
- The `pickFolder` / `pickFile` desktop dialogs: web equivalent is the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (`showDirectoryPicker()`) which is Chromium-only and not yet a stable cross-browser feature. This is a UX gap, not a code rewrite.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 35 Vue components in renderer | Glob | `src/renderer/components/**/*.vue` |
| 5 Pinia stores | `src/renderer/stores/*.ts` | `workspaces.ts`, `settings.ts`, `sidebar.ts`, `update.ts`, `memory-notifications.ts`, `git.ts`, `search.ts`, `observability-view-models.ts`, `stoa-store-plugin.ts` |
| 6 composables | `src/renderer/composables/*.ts` | `useFileTree.ts`, `useFileOperations.ts`, `useSidebarResize.ts`, `useSidebarPanels.ts`, `useSidebarShortcuts.ts`, `useGitStatusPolling.ts`, `provider-icons.ts` |
| No vue-router | `package.json:40-58` dependencies | Not present |
| No router references | Grep for `vue-router\|useRouter\|useRoute` in `src/renderer` | None |
| Bootstrap is 4 lines | `src/renderer/main.ts:1-10` | |
| App.vue has 5 store hooks + 8 window.stoa subscriptions | `src/renderer/app/App.vue:1-316` | lines 218-273 |
| AppShell uses state-based `activeSurface` ref | `src/renderer/components/AppShell.vue:34, 49, 68-74` | |
| TitleBar uses BrowserWindow controls | `src/renderer/components/TitleBar.vue:16-34` | 5 `window.stoa.windowX` calls |
| TerminalViewport has full xterm.js + IPC | `src/renderer/components/TerminalViewport.vue:151-357` | `setupTerminal()` |
| xterm runtime is pure browser | `src/renderer/terminal/xterm-runtime.ts:1-50+` | |
| `workspaces` store has dual path | `src/renderer/stores/workspaces.ts:243-340` | `hydrateFromStoaClient`, `subscribeToSessionGraphViaStoaClient`, `subscribeToObservabilityViaStoaClient`, `isStoaClientMode()` |
| `settings` store has dual path | `src/renderer/stores/settings.ts:36-99` | `fetchSettings`, `persistSetting`, `detectShell`, `detectProvider`, `detectVscode`, `subscribeToSettingsChangedViaStoaClient` |
| `sidebar` store has dual path | `src/renderer/stores/sidebar.ts:100-124` | `fetchSidebarState`, `persistSidebarState` |
| `update` store is `window.stoa.*` only | `src/renderer/stores/update.ts:48-71` | 5 IPC methods |
| `git` store is `window.stoa.*` only | `src/renderer/stores/git.ts:36-211` | 15+ IPC methods |
| `search` store is `window.stoa.*` only | `src/renderer/stores/search.ts:42` | 1 IPC call |
| `stoa-store-plugin` exports but isn't called | `src/renderer/stores/stoa-store-plugin.ts:28-56` | `initStoaClientForStores`, `stoaClientPlugin` defined but unused |
| VITE_USE_STOA_CLIENT env flag | `src/renderer/stores/stoa-store-plugin.ts:43-47` | |
| BrowserWindow assumptions in main | `src/main/index.ts:460-487` | `createMainWindow()` |
| Preload exposes `window.stoa` | `src/preload/index.ts:326` | `contextBridge.exposeInMainWorld('stoa', api)` |
| `RendererApi` interface (100+ methods) | `src/shared/project-session.ts:608-709` | |
| `StoaClientPreloadAdapter` implements full `RendererApi` | `src/renderer/lib/stoa-client-preload-adapter.ts:64-650` | 650 lines |
| `StoaClient` HTTP+WS client | `src/renderer/lib/stoa-client.ts:61-286` | fetch + WebSocket + reconnect |
| Desktop-only stubs in adapter | `src/renderer/lib/stoa-client-preload-adapter.ts:259-366` | `pickFolder`, `pickFile`, window controls, update methods |
| Sidebar panel registry (3 hardcoded) | `src/renderer/composables/useSidebarPanels.ts:20-49` | explorer, search, git |
| `STOA_USE_SERVER` env var | `src/main/index.ts:1387` | `useStoaServer` check |
| `stoaServerEnabled` setting | `src/renderer/stores/settings.ts:29` | Toggled in AdvancedSettings |
| `getServerInfo` IPC | `src/main/index.ts:1779-1799` | Returns `srSpawner.getPort()` + token |
| Web build target (dist/web) | `stoa-server/src/routes/discovery.ts:48` | `isWebClientAvailable()` checks `dist/web/index.html` |
| Static route SPA fallback | `stoa-server/src/routes/static.ts:14-17` | |
| Web client flag (--web) | `stoa-server/src/index.ts:41, 161-168, 180-186` | |

---

### Risks / Unknowns

- [!] **`VITE_USE_STOA_CLIENT` is not set anywhere in the build pipeline.** `package.json:33-37` scripts never set it. A web build needs to inject it. The renderer would have to detect at build time that it is being served by the Stoa Server (vs by Electron) and bootstrap `initStoaClientForStores` accordingly. One approach: bake a `window.__STOA_WEB_BOOTSTRAP__` global from `stoa-server`'s index.html template.
- [!] **Token bootstrap mechanism is undefined.** Electron's `getServerInfo()` is called from `AboutSettings.vue` to fetch the URL+token at runtime. In a web SPA, the user must already be authenticated when the page loads. Options: (1) include token in the URL as `?token=…` (not ideal — leaks in referer headers), (2) serve a small bootstrap page that POSTs credentials and sets a `Set-Cookie: stoa-token=…` (preferred), (3) use the existing `x-stoa-session-id` + `x-stoa-session-token` session-scoped auth for browser-only access. No plan has chosen yet.
- [!] **No Vue Router today.** URL-based navigation is not wired. Surface-switching is a ref in `AppShell.vue`. Adding `/archive` and `/settings` paths requires either (a) introducing `vue-router` and migrating `activeSurface` to a route read, or (b) a hash/query-param based minimal router. Both are breaking changes to `AppShell.vue` and `GlobalActivityBar.vue`.
- [!] **`FileExplorer` and `SearchPanel` use `window.stoa.fsOpenFile`** (Electron `shell.openPath`) which has no direct browser equivalent. Web UX would be "open in browser" via `window.open(file://…)` (limited) or download (`<a download>`).
- [!] **`NewProjectModal` uses `window.stoa.pickFolder`** (Electron `dialog.showOpenDialog`). Web equivalent is `FileSystemAccess.showDirectoryPicker()` (Chromium-only since 2024, no Firefox/Safari). A graceful fallback is a text input where the user pastes an absolute path.
- [!] **Runtime bridge is a 503 stub on the server.** `stoa-server/src/routes/runtime-bridge.ts:54-80` `createStubRuntimeBridge()` rejects all calls with 503. Web SPA cannot start or interact with sessions until either (1) an Electron runtime provider connects to the server's `/ws?token=…&role=runtime` and registers, or (2) the server gets a node-pty runtime directly. PTY features (xterm data, session input/resize) are non-functional in pure-web mode.
- [!] **Update notifications are desktop-only.** `update.ts` store has no `onUpdateState` equivalent on the server. The web SPA's About page must either hide the Updates section or poll the server for a release URL.
- [!] **BrowserWindow / window controls are dead in web.** `TitleBar.vue` calls `window.stoa.minimizeWindow/maximizeWindow/closeWindow` which are stubs in the adapter. The web SPA must either omit the TitleBar entirely or replace it with a browser header (no min/max/close buttons).
- [!] **xterm.js `windowsBuildNumber` flag** (`TerminalViewport.vue:171` passes `stoa.windowsBuildNumber` to `createTerminalRuntime`). In web mode, `StoaClientPreloadAdapter.windowsBuildNumber = undefined` (line 65), matching what the renderer would see on non-Windows — should be fine.
- [!] **Drag-and-drop in `FileExplorer.vue:264-363`** uses `DataTransfer.setData('application/x-stoa-file-path', path)`. In web, this works but only within the same browser tab; cross-tab or cross-app drag is not possible. The `revealInSystemExplorer` is a no-op in web.
- [!] **The dual-path plumbing is partial.** Only 3 of 5 stores have it. `git.ts` (15 methods), `update.ts` (5 methods), and `search.ts` (1 method) need full dual paths. `App.vue` bootstrap is still `window.stoa.*` only.
- [?] **CSS has Electron-specific `-webkit-app-region: drag` markers** in `TitleBar.vue:43, 45, 60` which are no-ops in browsers. Cosmetic — should be removed.
- [?] **Workspace list (`WorkspaceList.vue`) and Panel extensions (`PanelExtensions.vue`) are unused in production** based on `AppShell.vue` not importing them. They appear to be test/explorer surfaces — may be safely dropped from a web build.
- [?] **CORS is conditionally enabled** in `stoa-server/src/app.ts:53-55`. If the SPA is served from the same origin (which it is, via `static.ts`), CORS is not needed. If served from a different origin, CORS must be on.
- [?] **No `dist/web/` build target exists.** A new `vite.web.config.ts` (or extending `electron.vite.config.ts` with a fourth `web` mode) is needed. The `electron-vite` build currently has 3 modes: main, preload, renderer. Adding web is a config addition, not a rewrite.

---

### Migration Plan (Top-Level, No Implementation)

1. **Add a web build mode** to `electron.vite.config.ts` (or a sibling `vite.web.config.ts`) producing `dist/web/index.html` + assets. Inject `VITE_USE_STOA_CLIENT=1` at build time. Reuse Vue, Tailwind, i18n plugins as-is.
2. **Token bootstrap.** In `stoa-server/src/routes/static.ts`, conditionally serve an HTML wrapper that inlines `<script>window.__STOA_BOOTSTRAP__ = { token, baseUrl, … }</script>` before loading the SPA bundle. (Or use `Set-Cookie` + same-origin.) `src/renderer/main.ts` reads this global and calls `initStoaClientForStores(baseUrl, token)`.
3. **Wire `stoaClientPlugin` in `main.ts`.** Add `.use(stoaClientPlugin())` to the Pinia setup. Connect `StoaClient.connectWs()` and `flushBuffer()` after `App.vue` mounts.
4. **Rewrite `App.vue` `onMounted`** to call `workspaceStore.hydrateFromStoaClient()`, `workspaceStore.subscribeToSessionGraphViaStoaClient()`, and a new `workspaceStore.subscribeToSessionEventsViaStoaClient()` (replaces the `onSessionEvent` no-op stub).
5. **Add dual paths to `git.ts`, `update.ts`, `search.ts`.** Mirror the `if (isStoaClientMode())` pattern from `settings.ts`.
6. **Add dual paths to composables** `useFileTree` (1 call) and `useFileOperations` (3 calls).
7. **Replace `window.stoa.pickFolder` in `NewProjectModal.vue`** with a `<input type="text">` absolute-path input + optional `showDirectoryPicker()` for Chromium.
8. **Replace `window.stoa.fsOpenFile` and `shellShowItemInFolder` in `FileExplorer.vue` and `SearchPanel.vue`** with browser-friendly fallbacks (download link, no-op).
9. **Remove or rewrite `TitleBar.vue`** — web has no window controls. Replace with a simpler brand-only header.
10. **Decide on routing.** Either keep state-based surfaces and serve `/`, `/archive`, `/settings` as hash/query paths, or introduce `vue-router` (breaking change to `AppShell.vue`).
11. **Ensure `stoa-server` runtime bridge has a real provider.** Today it is a 503 stub. Without an Electron runtime provider connecting, web SPA cannot interact with sessions (PTY) — only data-management flows work.
12. **Tests.** Existing `tests/e2e-playwright/` and `tests/generated/playwright/` are Electron-only. Add a parallel `tests/e2e-web/` project (per `research/2026-06-12-playwright-web-ui-parity-context.md` plan) that boots `stoa-server --web` + a real browser.
13. **CSP in `dist/web/index.html`.** Electron's CSP at `src/renderer/index.html:6-8` allows `connect-src 'self' http://127.0.0.1:*`; web SPA must allow `connect-src 'self' ws: wss:` for the WS hub.

---

## Context Handoff: Renderer UI & State Boundary Audit for Browser Served SPA

Start here: `research/2026-06-12-renderer-ui-and-state-boundary-audit.md`

Context only. Use the saved report as the source of truth. Companion reports that cover adjacent angles:

- `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` — server-side gaps (no WS upgrade, no Vite web build, fs/git routes missing, runtime bridge stub)
- `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` — full HTTP/WS route map and test-id topology
- `research/2026-06-12-playwright-web-ui-parity-context.md` — Playwright config and browser fixture plan
- `research/2026-06-12-electron-e2e-and-generated-journey-tests-migration-inventory.md` — Electron E2E / generated journey tests inventory
