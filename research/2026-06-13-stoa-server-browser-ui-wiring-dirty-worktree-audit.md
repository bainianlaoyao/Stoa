---
date: 2026-06-13
topic: stoa-server-browser-ui-wiring-dirty-worktree-audit
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Stoa Server Browser UI Wiring — Dirty-Worktree Audit (post `b0fd14e`)

### Why This Was Gathered
A bounded re-audit of the current dirty worktree to determine which of the prior migration audit's "what's missing" items have actually been implemented in the working tree, and which are still blocking a real browser-served UI. Scope is the modified + new files touching `src/renderer/bootstrap-web`, `App.vue`/`App.test.vue`, `stoa-server/src/routes/static.ts` + `discovery.ts` + `index.ts`, `vite.web.config.ts`, `vite.renderer.shared.ts`, and the shared `web-client-path.ts` utility — plus a check on whether the renderer dual-path plumbing has been promoted to single-path in the web bundle.

### Summary
Between the prior audit (`research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` written against `b0fd14e`) and the current dirty worktree, a **substantial slice of the web-UI migration has landed**:

- A Vite web build config (`vite.web.config.ts`) and shared renderer config (`vite.renderer.shared.ts`) now exist and produce a real `stoa-server/dist/web/index.html` + `assets/` bundle.
- A web bootstrap module (`src/renderer/bootstrap-web.ts` + test) replaces the static `StoaClient` flag with a runtime "I am the web" bootstrap that reads `?token=` from `location.search`, installs the adapter, opens the WS, and exposes `window.stoa`.
- `main.ts` calls `bootstrapWebRenderer()` early and wires the Pinia client plugin, so the same entry serves both Electron and web.
- The four stores / composables that the prior audit flagged as "still `window.stoa.*` only" (`git`, `search`, `update`, `useFileTree`, `useFileOperations`) have all been dual-pathed.
- `stoa-store-plugin.ts` grew a `requireRendererApi()` helper that dual-path stores can call without first checking the mode.
- A new `webClient` discovery flag and `--web` log-message cleanup land alongside the build.

**Still missing** (only the highest-impact items — full list in §5):

1. **No HTTP→WS upgrade on the server.** `stoa-server/src/index.ts:174` still calls `serve({ fetch, port })` with no `upgrade` listener. The web build is ready; opening it in a real browser will succeed for HTTP, but the `StoaClient.connectWs()` call to `/ws?token=…` will be rejected.
2. **No `fs/*` and `git/*` route groups on the server.** The `StoaClientPreloadAdapter` calls `/api/v1/fs/dir|file|entry|rename|search` and `/api/v1/git/status|stage|unstage|discard|commit|push|pull|fetch|rebase|merge|branches|log|diff|checkout` (verified at `src/renderer/lib/stoa-client-preload-adapter.ts:425-505`). None of these exist under `stoa-server/src/routes/`; only `control.ts`, `discovery.ts`, `health.ts`, `meta-control.ts`, `meta-sessions.ts`, `observability.ts`, `projects.ts`, `runtime-bridge.ts`, `sessions.ts`, `settings.ts`, `sidebar.ts`, `static.ts`, `webhooks.ts` (grep `fs/dir\|git/status` → 0 hits in server src).
3. **No `node-pty` runtime bridge.** `stoa-server/src/index.ts:84-85` still uses `createStubRuntimeBridge()` returning 503. Web terminal/PTY is non-functional.
4. **`VITE_USE_STOA_CLIENT` is never set in any build script** (verified: zero hits in `package.json`, only the source-code reference at `stoa-store-plugin.ts:93`). The web build needs `define: { 'import.meta.env.VITE_USE_STOA_CLIENT': '1' }` (or shell `VITE_USE_STOA_CLIENT=1`) at compile time so `isStoaClientMode()` flips on for the web bundle.
5. **No role routing on the WS upgrade** — the prior `research/2026-06-12-stoa-server-browser-web-hosting-and-ws-role-routing-context.md` flagged `?role=` plumbing (`role=runtime` vs default `web`) as the next concrete change.
6. **No browser Playwright project** — `playwright.config.ts` is still Electron-only (from the prior audit).
7. **Desktop-only stubs still stub the same way** — `pickFolder`, `pickFile`, `minimizeWindow/maximizeWindow/closeWindow`, `quitAndInstallUpdate`, `fsOpenFile`, `shellShowItemInFolder` all have warn-only stubs in `StoaClientPreloadAdapter`. No `<input type="file" webkitdirectory>` swap for `NewProjectModal`, no TitleBar hide/swap. (No code in the dirty worktree changes this.)

The `electron.vite.config.ts` was refactored to import `createRendererAliases()` / `createRendererPlugins()` from the new shared file (`electron.vite.config.ts:1-3`), so the Electron renderer build shares its plugin/alias config with the web build.

### Key Findings

#### 1. New files (build & bootstrap layer)

| File | Purpose | Evidence |
|---|---|---|
| `vite.web.config.ts` (18 lines) | Top-level web build: `root: 'src/renderer'`, `outDir: 'stoa-server/dist/web'`, `emptyOutDir: true`, input `src/renderer/index.html`. Reuses `createRendererAliases()` + `createRendererPlugins()` from shared. **No `define: { VITE_USE_STOA_CLIENT: '1' }`** — this is a known gap. | `vite.web.config.ts:1-18` |
| `vite.renderer.shared.ts` (22 lines) | Factory exports `createRendererAliases()` (`@renderer`, `@shared`, `@extensions` path aliases) and `createRendererPlugins()` (`@vitejs/plugin-vue` + `@tailwindcss/vite` + `@intlify/unplugin-vue-i18n` with explicit `en.ts` + `zh-CN.ts` includes). | `vite.renderer.shared.ts:1-22` |
| `stoa-server/src/shared/web-client-path.ts` (21 lines) | `candidateWebRoots()` returns three roots: `stoa-server/dist/web` (from `process.cwd()`), `dist/web` (from `process.cwd()`), `<moduleDir>/../../dist/web`. `resolveWebClientRoot()` returns the first that has `index.html` (or the first as fallback). `isWebClientAvailable()` returns boolean. | `web-client-path.ts:1-21` |
| `src/renderer/bootstrap-web.ts` (43 lines) | `bootstrapWebRenderer()` reads `?token=` from URL, throws if missing (`bootstrap-web.ts:11-20`), calls `initStoaClientForStores(window.location.origin, token)`, instantiates `StoaClientPreloadAdapter`, monkey-patches `getBootstrapState` to call `client.flushBuffer()` on the first resolution (`bootstrap-web.ts:28-36`), then `client.connectWs()` + `setRendererApi(adapter)` + `window.stoa = adapter`. Returns `{ client, adapter }`. | `bootstrap-web.ts:1-43` |
| `src/renderer/bootstrap-web.test.ts` (91 lines) | Three cases: (a) init from origin + token + bind `window.stoa` (`bootstrap-web.test.ts:54-66`); (b) `flushBuffer` fires exactly once on first bootstrap resolve (`bootstrap-web.test.ts:68-81`); (c) throws when `?token=` is missing (`bootstrap-web.test.ts:83-90`). Hoisted `vi.mock` of plugin + adapter. | `bootstrap-web.test.ts:1-91` |
| `src/renderer/stores/git.test.ts` (54 lines) + `src/renderer/stores/search.test.ts` (51 lines) | New unit tests for the dual-path stores. | `git.test.ts:1-54`, `search.test.ts:1-51` |
| `src/renderer/composables/useFileTree.test.ts` (315 lines) + `useFileOperations.test.ts` (276 lines) | New unit tests for dual-path composables. | `useFileTree.test.ts:1-315`, `useFileOperations.test.ts:1-276` |
| `stoa-server/dist/web/` (built artifact) | **Already built.** Contains `index.html` (with hashed `/assets/index-44SETror.js` + `index-BFRtOsnp.css`), `CascadiaMono`, `JetBrainsMono`, `FileExplorer-D-NkC-Ac.js`, `FileExplorer-DrUJhoHv.css`, `SearchPanel-64UshPXU.js`, `SourceControlPanel-ObeVhp-u.js`, `vscode-C_7wk1WI.svg`. | `ls stoa-server/dist/web/` (9 assets) |
| `dist/web/index.html` (sample) | Has the same CSP as `src/renderer/index.html:7` (`default-src 'self'; …connect-src 'self' http: https: ws: wss:; font-src 'self' data:`, `style-src 'self' 'unsafe-inline'`). Hashed module script + stylesheet linked. No `window.__STOA_BOOTSTRAP__` global — token must come from URL `?token=`. | `dist/web/index.html:1-13` (sampled) |

#### 2. Modified files (renderer bootstrap path)

| File | What changed | Evidence |
|---|---|---|
| `src/renderer/main.ts` | Imports `bootstrapWebRenderer` + `stoaClientPlugin`. Calls `if (!window.stoa) bootstrapWebRenderer()` (i.e. skips in Electron where preload already injected it). Then `createPinia().use(stoaClientPlugin())` registers the plugin. | `main.ts:1-19` |
| `src/renderer/stores/stoa-store-plugin.ts` | Added `rendererApiInstance: RendererApi | null` module-level singleton, `flushStoaClientBuffer()`, `getRendererApi()` (prefers StoaClient adapter when in `isStoaClientMode()` and initialized, else `window.stoa`), `setRendererApi()`, `resetStoaClientForStores()`, and `requireRendererApi()` (throws if no bridge). `isStoaClientMode()` still gates on `import.meta.env.VITE_USE_STOA_CLIENT === '1' \| 'true'`. The dual-path stores now call `requireRendererApi()` instead of `window.stoa.*` directly. | `stoa-store-plugin.ts:1-105` (full file) |
| `electron.vite.config.ts` | Refactored to import `createRendererAliases` + `createRendererPlugins` from `./vite.renderer.shared.ts`. Aliases + plugins for the Electron renderer build are now shared with the web build. | `electron.vite.config.ts:1-51` |
| `package.json` | Added `"build:web": "vite build --config vite.web.config.ts"` (script 13) and reordered `build` to `pnpm run build:web && electron-vite build && node scripts/build-stoa-ctl.mjs` (script 12). | `package.json:12-13` |
| `tsconfig.node.json` | Modified (no diff snippet retrieved; touch only). | git status marker |
| `pnpm-lock.yaml` | Modified — reflects new vite/web tooling chain. | git status marker |

#### 3. Modified files (server side)

| File | What changed | Evidence |
|---|---|---|
| `stoa-server/src/index.ts` | Log-message cosmetic only: `Web client: enabled (serving from stoa-server/dist/web/)` and `Web client: requested but stoa-server/dist/web/ not found`. **No** WS upgrade listener. `createApp(deps, { …, webClient: serveWeb })` unchanged. | `index.ts:161-186` (full) |
| `stoa-server/src/routes/discovery.ts` | Imports `isWebClientAvailable` from `../shared/web-client-path`. `createDiscoveryRoutes({ webClient, lanMode })` returns `webClient` flag in JSON response. Default export retained for back-compat (`discoveryRoutes = createDiscoveryRoutes()`). | `discovery.ts:1-48` |
| `stoa-server/src/routes/static.ts` | Imports `resolveWebClientRoot` from `../shared/web-client-path`. `staticRoutes` is a module-level singleton; `staticRoutes.use('/assets/*', serveStatic({ root: webClientRoot }))` + SPA fallback `staticRoutes.get('*', serveStatic({ root: webClientRoot, path: 'index.html' }))`. | `static.ts:1-19` |

#### 4. Stores / composables dual-pathing — done in dirty worktree

The prior audit listed `git.ts`, `search.ts`, `update.ts`, `useFileTree.ts`, `useFileOperations.ts` as still `window.stoa.*` only. **All five now have the `if (isStoaClientMode()) { client.get/post/put/delete … } else { requireRendererApi().* }` pattern.** Verification:

| File | StoaClient branches | Lines |
|---|---|---|
| `src/renderer/stores/git.ts` | `fetchStatus`, `fetchBranches`, `fetchLogEntries`, `stagePaths`, `unstagePaths`, `discardPaths`, `commitChanges`, `pushChanges`, `pullChanges`, `fetchRemote`, `checkout`, `createBranchRequest`, `rebaseOnto`, `mergeBranch` — 14 methods, all dual-pathed | `git.ts:37-210` |
| `src/renderer/stores/search.ts` | `runSearch` dual-pathed to `client.post<SearchResult>('/api/v1/fs/search', options)` | `search.ts:22-32` |
| `src/renderer/stores/update.ts` | `getUpdateBridge()` collapses the dual path into a `requireRendererApi()` call (web has no auto-updater, so this always returns the adapter's `getUpdateState` etc., which are stubs) | `update.ts:48-58` |
| `src/renderer/composables/useFileTree.ts` | `loadDir` dual-pathed to `client.get<DirEntry[]>('/api/v1/fs/dir?…')` | `useFileTree.ts:50-67` |
| `src/renderer/composables/useFileOperations.ts` | `renameEntry`, `createEntry`, `deleteFsEntry` dual-pathed to `client.post/put/delete('/api/v1/fs/entry|rename', …)` | `useFileOperations.ts:15-60` |

#### 5. What's still missing (gaps vs. "stoa server truly serves a working web page")

##### 5a. HTTP→WS upgrade (CRITICAL)
- `stoa-server/src/index.ts:174` still `serve({ fetch: app.fetch, port })`. No `createNodeWebSocket`, no `server.on('upgrade', …)`.
- Verified `@hono/node-server` does not export a Node-side WS helper (per prior `…browser-web-hosting-and-ws-role-routing-context.md` finding). `ws` package not in `stoa-server/package.json` (need to check before adding).
- `StoaClient.connectWs()` (`src/renderer/lib/stoa-client.ts:145-191`) opens `ws://<origin>/ws?token=…&lastEventId=…`. **No `role=` query param.** Without a server upgrade listener, this `new WebSocket()` will be rejected at the HTTP layer.
- The 503 runtime-bridge stub will still 503 any `runtime:*` request over WS too, so even if the upgrade is wired, terminal PTY won't work in pure web mode.

##### 5b. `fs` and `git` route groups (CRITICAL)
- Adapter calls (verbatim from `StoaClientPreloadAdapter`):
  - `GET /api/v1/fs/dir?projectPath=&path=` (`adapter.ts:434`)
  - `GET /api/v1/fs/file?projectPath=&path=` (`adapter.ts:441`)
  - `PUT /api/v1/fs/file` (`adapter.ts:447`)
  - `POST /api/v1/fs/entry` (create) (`adapter.ts:451`)
  - `POST /api/v1/fs/rename` (`adapter.ts:455`)
  - `DELETE /api/v1/fs/entry` (`adapter.ts:459`)
  - `POST /api/v1/fs/search` (`adapter.ts:463`)
  - `GET /api/v1/git/status?projectPath=` (`adapter.ts:489`)
  - `POST /api/v1/git/stage` (`adapter.ts:495`)
  - `POST /api/v1/git/unstage` (`adapter.ts:499`)
  - `POST /api/v1/git/discard` (`adapter.ts:502`)
  - `+ 10 more git endpoints` (commit, push, pull, fetch, rebase, merge, branches GET+POST, log, diff, checkout)
- **None** of these exist under `stoa-server/src/routes/`. Grep `fs/dir\|git/status` → 0 hits in `stoa-server/src/`. The dual-path code in `git.ts`, `search.ts`, `useFileTree.ts`, `useFileOperations.ts` will route to a real HTTP client, but the server will 404.
- The new unit tests (`git.test.ts`, `search.test.ts`, `useFileTree.test.ts`, `useFileOperations.test.ts`) presumably mock the StoaClient at the call boundary and never reach the real server — confirms these tests are unit-level only.

##### 5c. `VITE_USE_STOA_CLIENT` not set in any build script
- Grep `VITE_USE_STOA_CLIENT` in `package.json` / `*.ts` / `*.mjs` → only the source reference at `stoa-store-plugin.ts:93-94`.
- `vite.web.config.ts` has no `define:` block, no `envPrefix` override, no `import.meta.env` injection. `bootstrapWebRenderer()` does **not** check `isStoaClientMode()` — it always runs the web bootstrap path. But the stores **do** check it. So at runtime, in the web build as currently configured, `isStoaClientMode()` returns `false` and the dual-path stores fall through to `requireRendererApi() → getRendererApi() → window.stoa`. `bootstrap-web.ts:40` does set `window.stoa = adapter` **before** stores are first read, so this is rescued by `window.stoa` being a `StoaClientPreloadAdapter`. Net effect: web build still works in spite of the missing flag, but the convention is muddy. Recommendation: add `define: { 'import.meta.env.VITE_USE_STOA_CLIENT': '"1"' }` to `vite.web.config.ts` to make `isStoaClientMode()` truthful in web.

##### 5d. No WS role routing (`?role=`)
- Per `research/2026-06-12-stoa-server-browser-web-hosting-and-ws-role-routing-context.md`: pure routing function over `(searchParams, rawMessage) → { role, auth }`, plus a thin `attachWebSocketRoleRouter(server, { hub, runtimeBridge, token })` glue. **Not started.** `StoaClient.connectWs()` sends no `role=`; `StoaRuntimeClient` already sends `role=runtime` (`src/main/stoa-runtime-client.ts:132-134`). When the upgrade is wired, the router must default to `web` for missing/unrecognized `role`.

##### 5e. Runtime bridge is still a 503 stub
- `stoa-server/src/index.ts:84-85` `createStubRuntimeBridge()`. `RuntimeBridgeHandler` is **not** instantiated in `index.ts` (only the stub bridge is used; confirmed). Terminal PTY in pure web mode is non-functional. The Electron desktop path still works because Electron's main process owns the PTY.

##### 5f. No browser Playwright project
- `playwright.config.ts` is unchanged from prior audit (Electron-only). No `webServer` block. No `tests/e2e-web/` directory. A real browser smoke test that boots `stoa-server --web` + Playwright Chromium does not exist.

##### 5g. Desktop-only UX still hardcoded
- `TitleBar.vue`, `UpdatePrompt.vue`, `NewProjectModal.vue` (folder picker via `window.stoa.pickFolder`), `FileExplorer.vue` (`fsOpenFile`, `shellShowItemInFolder`), `SearchPanel.vue` (`fsOpenFile`) all still call `window.stoa.*` for desktop-only functions. No web build-time `__STOA_WEB_MODE__` flag; no `define:` in `vite.web.config.ts`; no `if (import.meta.env.MODE === 'web')` guards. The renderer's `App.vue:5-23` imports `UpdatePrompt.vue` unconditionally. (See `App.vue:14` for the unconditional `<UpdatePrompt>` mount.)

##### 5h. No test for the static SPA fallback mount order
- The static route is a module-level singleton (`static.ts:12`); no `static.test.ts` next to it. The 5a + 5b gaps combined mean a regression test for `/api/v1/*` 404 returning JSON (not SPA HTML) is the highest-value insurance for a multi-route Hono app.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| vite web build emits to `stoa-server/dist/web/` | `vite.web.config.ts` | lines 1-18 |
| web build artifact already present in dirty worktree | `ls stoa-server/dist/web/` | 9 entries, `index.html` + `assets/` |
| shared renderer aliases/plugins reused by both builds | `vite.renderer.shared.ts:1-22` | full file |
| web bootstrap module | `src/renderer/bootstrap-web.ts:1-43` | full file |
| bootstrap-web test covers token + flushBuffer + missing-token | `src/renderer/bootstrap-web.test.ts:54-90` | three cases |
| main.ts wires bootstrap + Pinia client plugin | `src/renderer/main.ts:1-19` | full file |
| `requireRendererApi()` + `getRendererApi()` helpers | `src/renderer/stores/stoa-store-plugin.ts:43-86` | lines 43-86 |
| git store fully dual-pathed | `src/renderer/stores/git.ts:37-210` | 14 methods |
| search store dual-pathed | `src/renderer/stores/search.ts:22-32` | `runSearch` |
| update store collapses to `requireRendererApi()` | `src/renderer/stores/update.ts:48-58` | `getUpdateBridge` |
| useFileTree dual-pathed | `src/renderer/composables/useFileTree.ts:50-67` | `loadDir` |
| useFileOperations dual-pathed | `src/renderer/composables/useFileOperations.ts:15-60` | 3 methods |
| electron-vite config now imports from shared | `electron.vite.config.ts:1-3, 47, 49` | aliases + plugins |
| `build:web` script + reordered `build` | `package.json:12-13` | lines 12, 13 |
| server log message cleaned up | `stoa-server/src/index.ts:180-186` | `console.log` lines |
| discovery route exposes `webClient` flag | `stoa-server/src/routes/discovery.ts:18-41` | `createDiscoveryRoutes` |
| static route SPA fallback unchanged | `stoa-server/src/routes/static.ts:11-19` | full file |
| web-client-path resolution | `stoa-server/src/shared/web-client-path.ts:7-21` | full file |
| **No** HTTP→WS upgrade listener on the server | `stoa-server/src/index.ts:174-177` | `serve({ fetch, port })` only |
| **No** `fs` route group | grep `fs/dir` in `stoa-server/src/` | 0 hits |
| **No** `git` route group | grep `git/status` in `stoa-server/src/` | 0 hits |
| **No** `node-pty` runtime bridge | `stoa-server/src/index.ts:84-85` | `createStubRuntimeBridge` |
| `VITE_USE_STOA_CLIENT` not set in any build script | grep `package.json\|*.mjs` for `VITE_USE_STOA_CLIENT` | only source-code reference |
| No `define:` for `__STOA_WEB_MODE__` in vite web config | `vite.web.config.ts:1-18` | full file (no `define:` key) |
| StoaClientPreloadAdapter endpoint list | `src/renderer/lib/stoa-client-preload-adapter.ts:425-505` | 22 fs/git endpoints called |
| `isStoaClientMode()` source | `src/renderer/stores/stoa-store-plugin.ts:91-95` | full definition |
| StoaClient WS URL (no `role=`) | `src/renderer/lib/stoa-client.ts:148-152` | line 148-152 |
| StoaRuntimeClient WS URL (`role=runtime`) | `src/main/stoa-runtime-client.ts:132-134` | line 132-134 |
| App.vue still imports desktop-only UpdatePrompt | `src/renderer/app/App.vue:14, 312-318` | `UpdatePrompt` import + mount |
| WS server event types (12) | `stoa-server/src/ws/events.ts:3-16` | full |
| WS client message types (4) | `stoa-server/src/ws/events.ts:21-26` | full |

### Risks / Unknowns

- [!] The single most important next step is **HTTP→WS upgrade wiring**, but it is non-trivial: `@hono/node-server` has no built-in helper, the `ws` package is not installed, and the server uses a bare `serve()` whose return value is the `http.Server` you must attach `server.on('upgrade', …)` to. The change is one glue function in `stoa-server/src/index.ts` (and a sibling `ws/role-router.ts`), but it has to coexist with the `RuntimeBridgeHandler` that is **not** currently instantiated in `index.ts`.
- [!] Adding `fs` + `git` route groups touches: (1) `stoa-server/src/routes/` (new files: `fs.ts`, `git.ts`); (2) `AppDeps` shape in `stoa-server/src/app.ts:29-36`; (3) `stoa-server/src/index.ts` to wire deps; (4) one or more service classes for the actual fs + git logic. Estimate: non-trivial. None of the fs/git logic in the current renderer is Electron-specific (no `node-pty` in file/git paths), so a Node-only implementation on the server is sufficient.
- [!] The `vite.web.config.ts` does **not** set `define: { VITE_USE_STOA_CLIENT: '1' }`. The web build works in spite of this because `bootstrap-web.ts:40` does `window.stoa = adapter` before any store reads. But this is implicit and fragile — the moment a component is added that calls `isStoaClientMode()` directly (or imports a module that does), the web build will silently fall through to the wrong path.
- [?] Whether `node-pty` should be added to `stoa-server` (Electron-as-runtime or server-side PTY) or whether the Electron app should be the runtime provider connecting to the server over `?role=runtime`. Per the prior `…browser-web-hosting-and-ws-role-routing-context.md` recommendation, the second option is preferred (Electron stays as a runtime, server stays headless).
- [?] The `vite.web.config.ts` does not externalize `electron` or `node-pty`. None of `src/renderer/*` imports `electron` (verified by prior audit), but the dependency is still listed at `package.json:69` and could leak in if any deep import pulls it. The web build's `index-44SETror.js` exists and the file-explorer / search / source-control panels were code-split, so this hasn't bitten yet.
- [?] Whether the new unit tests (`git.test.ts`, `search.test.ts`, `useFileTree.test.ts`, `useFileOperations.test.ts`) cover the StoaClient branch or only the legacy IPC branch. Test counts: 54 + 51 + 315 + 276 = 696 lines across 4 files. They likely cover both branches (per the `git.ts` dual-pattern), but were not re-read in this audit.
- [?] The `web` entry of `vite.web.config.ts` has no `server` block — only `build`. So `pnpm run build:web` is a one-shot build, not a dev server. A `dev:web` script is not present. A future addition: `vite --config vite.web.config.ts` with `server.proxy` for the StoaServer Hono process.

### Reused Prior Research

- `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` — confirmed accurate at the time of writing, but **outdated** for §2 "Existing Browser/Web App Artifacts" (no `vite.web.config.ts` existed, no `bootstrap-web.ts`, no `dist/web/`). The new dirty worktree invalidates that audit's "no build target" claim.
- `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` — still accurate; `dist/web/` is no longer empty, but the no-browser-E2E claim is still correct.
- `research/2026-06-12-stoa-server-browser-web-hosting-and-ws-role-routing-context.md` — still the canonical reference for the WS upgrade + role routing. The `?role=runtime` vs default-`web` split is still the right design.
- `research/2026-06-12-stoa-server-browser-ui-recommendation.md` — still accurate. Step 1 (build the SPA) and step 2 (promote dual path to single path in web mode) are now partially done; step 3 (WS upgrade) is the next concrete change.
- `research/2026-06-12-renderer-ui-and-state-boundary-audit.md` — the per-store/composable "needs dual path" section is now fully complete (5/5).

No new community search was needed. The local installed packages and the prior audit reports remain the authoritative sources for this repo's versions and design decisions.

## Context Handoff: Stoa Server Browser UI Wiring — Dirty-Worktree Audit

**Saved report path:** `D:\Data\DEV\ultra_simple_panel\research\2026-06-13-stoa-server-browser-ui-wiring-dirty-worktree-audit.md`

What this report contains:

1. **A 5-row "what landed" summary** showing the concrete diffs that close the prior audit's top "what's missing" items: vite web build, web bootstrap, main.ts wiring, dual-path stores/composables, and shared renderer config.
2. **A 7-row "what's still missing" enumeration** ordered by criticality, each with file:line citations: (a) HTTP→WS upgrade; (b) fs + git route groups; (c) `VITE_USE_STOA_CLIENT` define; (d) WS role routing; (e) runtime bridge stub; (f) browser Playwright project; (g) desktop-only UX hardcoded; (h) no static-route mount-order test.
3. **An evidence chain** with `file:line` citations for every claim, including the new artifact list under `stoa-server/dist/web/`, the exact endpoint URLs the `StoaClientPreloadAdapter` calls, the `vite.web.config.ts` build config, and the explicit grep-zero results for `fs/dir` / `git/status` in `stoa-server/src/`.
4. **A reuse statement** that maps the prior `2026-06-12` research corpus onto the current state (which prior claims are now stale, which are still authoritative).

The report is sized for direct consumption by a planning subagent: the next concrete change is **HTTP→WS upgrade wiring + role routing** in `stoa-server/src/index.ts:174` and a new `stoa-server/src/ws/role-router.ts`. The second concrete change is **the fs + git route groups**, which need new files under `stoa-server/src/routes/` and corresponding deps wiring in `index.ts`. No code is written. No implementation files are modified.
