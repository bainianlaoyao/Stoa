---
date: 2026-06-13
topic: playwright-browser-test-migration-progress-audit
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Playwright / Browser Test Migration Progress Audit (current dirty worktree)

### Why This Was Gathered

To audit the **current uncommitted changes** (`git status` = 14 modified + 14 untracked) and answer one bounded question: **what Playwright/browser test migration progress has landed in the dirty worktree, and is the current state enough to run web UI end-to-end tests against `stoa-server`?** All conclusions are grounded in the dirty diffs vs. `b0fd14e` (last commit) and the new untracked files visible in `git status`.

### Summary

The dirty worktree delivers a **complete web build pipeline** (Vite web config, `build:web` script, `bootstrap-web.ts`, `stoa-server/dist/web/` artifacts present on disk) and **fully refactors 6 renderer files from `window.stoa.*` to a `requireRendererApi()` / dual-path pattern** that can serve both Electron and the web SPA. However, **no browser Playwright project, no `tests/e2e-web/` directory, no web server `webServer` config, no `chromium` browser fixture, and no browser-targeting changes to the generator templates exist yet** — the entire `playwright.config.ts` and every file under `tests/e2e-playwright/` is still 100% Electron-bound. The dirty tree can **build and serve** the web SPA, but it cannot **run any web Playwright test** against it. The gap is purely on the test harness side; the application code is sufficiently ready.

---

### 1. Playwright Config — Unchanged, Still Electron-Only

| File | Status | Content |
|------|--------|---------|
| `playwright.config.ts:1-19` | **Unmodified** | Single unnamed project, `testDir: './tests'`, `testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts']`, `workers: 1`, no `projects:`, no `webServer:`, no `use.baseURL` |
| `playwright.config.ts:14-18` | `use: { trace, screenshot, video }` only | No `baseURL`, no browser `channel`, no `storageState` |

**Verdict:** Zero web Playwright infrastructure has been added. The `test:e2e` script (`package.json:35`) still calls `npm run build && playwright test`, which builds Electron + web via the new `build:web` step, then runs the same Electron-only Playwright suite.

### 2. Package Scripts — `build:web` Added, No Web Test Script

`package.json:12-13` (the only script diff):

```json
"build": "pnpm run build:web && electron-vite build && node scripts/build-stoa-ctl.mjs",
"build:web": "vite build --config vite.web.config.ts",
```

**Added:** `build:web` (Vite build with the new web config).

**Not added:** `test:e2e:web`, `test:web`, `playwright install chromium`, `test:e2e:all`, or any web-project-scoped Playwright command. The `test:e2e` script (`package.json:35`) is unchanged — it still builds everything then runs the unified (Electron-only) Playwright suite.

### 3. Generated Test Pipeline — Unchanged, Still Electron-Targeted

| File | Status | Implication |
|------|--------|-------------|
| `testing/generators/write-generated-playwright.ts:1-37` | **Unmodified** | Still emits 4 Electron-only specs |
| `testing/generators/generate-playwright.ts:9-380` | **Unmodified** | Skeleton generators still emit `import { launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'` and `import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'` |
| `tests/generated/playwright/*.generated.spec.ts` (4 files) | **Unmodified, git-tracked** | All 4 specs (`session-restore`, `session-telemetry-claude-lifecycle`, `stoactl-lifecycle`, `workspace-quick-access`) are still Electron-only |
| `testing/generators/behavior-coverage.ts:1-89` | **Unmodified** | Platform-agnostic — no change needed |

**Verdict:** The generator pipeline is still entirely Electron-bound. The prior research (`research/2026-06-12-electron-e2e-and-generated-journey-tests-migration-inventory.md` lines 49-52) already enumerated this; the dirty tree did not advance this work.

### 4. Hand-Written `tests/e2e-playwright/` — Unchanged, All Electron

All 11 hand-written Playwright test files and 3 fixture/helper files in `tests/e2e-playwright/` are **unmodified**:

- `app-smoke.test.ts:1-68` — calls `launchElectronApp()` (line 2)
- `project-session-journey.test.ts`, `session-event-journey.test.ts`, `terminal-journey.test.ts`, `recovery-journey.test.ts`, `debug-devtools.test.ts`, `sidebar-interaction.test.ts`, `file-explorer.test.ts`, `git-panel.test.ts`, `search-panel.test.ts`, `settings-modal-ui.test.ts` — all `_electron.launch()` via the shared fixture
- `fixtures/electron-app.ts:1-308` — unchanged
- `fixtures/sidebar-test-project.ts`, `helpers/ui-actions.ts`, `helpers/sidebar-actions.ts` — unchanged

**Verdict:** No web Playwright test, no web fixture, no `tests/e2e-web/` directory has been created.

### 5. NEW: Vite Web Build Pipeline

| File | Status | Role |
|------|--------|------|
| `vite.web.config.ts:1-18` | **Untracked, new** | Vite config: `root: src/renderer`, plugins/aliases via `vite.renderer.shared`, `outDir: stoa-server/dist/web`, `input: src/renderer/index.html` |
| `vite.renderer.shared.ts:1-22` | **Untracked, new** | Exports `createRendererAliases()` and `createRendererPlugins()` — Vue + Tailwind + i18n |
| `electron.vite.config.ts` | **Modified** | Now imports `createRendererAliases` / `createRendererPlugins` from `vite.renderer.shared.ts` to deduplicate |
| `tsconfig.node.json:9-10` | **Modified** | Added `vite.web.config.ts` and `vite.renderer.shared.ts` to the node tsconfig include list |
| `stoa-server/dist/web/index.html` | **Present on disk (built)** | Built web entry: CSP relaxed, references `/assets/index-44SETror.js` and `/assets/index-BFRtOsnp.css` |
| `stoa-server/dist/web/assets/*` | **Present on disk (built)** | `FileExplorer`, `SearchPanel`, `SourceControlPanel`, `index-*.js`/`.css`, font files, vscode SVG |

**Verdict:** The web build pipeline is complete and the `dist/web/` artifacts are present on disk. `npm run build:web` will rebuild them; `npm run build` will rebuild them as the first step.

### 6. NEW: Web Bootstrap (`src/renderer/bootstrap-web.ts`)

`src/renderer/bootstrap-web.ts:1-43` — **Untracked, new** (with paired `bootstrap-web.test.ts:1-91`).

Exports `bootstrapWebRenderer(): { client, adapter }`:

- Reads `token` from `window.location.search` (throws `'Missing Stoa web token in URL query parameter "token"'` if absent).
- Calls `initStoaClientForStores(window.location.origin, token)`.
- Wraps `adapter.getBootstrapState` to call `client.flushBuffer()` once on the first snapshot.
- Calls `client.connectWs()` + `setRendererApi(adapter)`.
- Sets `window.stoa = adapter`.

Paired test (`bootstrap-web.test.ts:1-91`) covers: init from origin/token, `flushBuffer` only called once on first `getBootstrapState`, and the missing-token throw.

**Verdict:** This is the web entry point the new `main.ts` calls when `window.stoa` is absent.

### 7. NEW: `main.ts` Web Bootstrap Hookup

`src/renderer/main.ts:1-19` — **Modified**:

```ts
import { bootstrapWebRenderer } from '@renderer/bootstrap-web'
import { stoaClientPlugin } from '@renderer/stores/stoa-store-plugin'
...
if (!window.stoa) {
  bootstrapWebRenderer()
}

const pinia = createPinia()
pinia.use(stoaClientPlugin())
```

The same `index.html` (`src/renderer/index.html:7`) and CSP `connect-src` was relaxed from `http://127.0.0.1:*` to `http: https: ws: wss:` (line 7) so the SPA can talk to any origin and any WS host.

**Verdict:** When the renderer is built with `vite build --config vite.web.config.ts`, `window.stoa` is undefined (no Electron preload), so `bootstrapWebRenderer()` runs and wires the `StoaClient` adapter. The Electron build still has `window.stoa` set by `src/preload/index.ts:57-324`, so the `if (!window.stoa)` guard skips the web bootstrap there.

### 8. NEW: `requireRendererApi()` Bridge Refactor

`src/renderer/stores/stoa-store-plugin.ts:1-90+` — **Modified**. Added:

- `flushStoaClientBuffer(): void` (line 43)
- `getRendererApi(): RendererApi | null` — prefers `StoaClient`-backed adapter when `isStoaClientMode()` and `clientInstance` exist; falls back to `window.stoa` (lines 47-61)
- `setRendererApi(rendererApi: RendererApi | null): void` (line 63)
- `resetStoaClientForStores(): void` (line 65)
- `requireRendererApi(): RendererApi` — throws if neither bridge is available (lines 69-74)

`App.vue:51, 56, 62, 69, 78, 89, 100, 110, 120, 133, 145, 154, 219, 222, 228, 232, 237, 248` — all 18 previously-unconditional `window.stoa.*` call sites now go through `requireRendererApi()`. The `onMounted` block (lines 219-250) takes `const stoa = requireRendererApi()` once and uses it for all subscriptions and `getBootstrapState()`. The test `App.test.ts:332-344` adds a new case asserting that the mount flow works through the web adapter (with `onSessionGraphEvent` returning a noop unsubscribe) without preload-specific assumptions.

**Verdict:** This is the **bridge that makes the same renderer work in both Electron and web**. Prior research (`research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` line 54) called out App.vue's 18 unconditional `window.stoa.*` calls as the blocker — that blocker is now removed.

### 9. NEW: Stores Dual-Pathed to StoaClient

| File | Status | New HTTP path added |
|------|--------|---------------------|
| `src/renderer/composables/useFileOperations.ts:15-58` | Modified | `POST /api/v1/fs/rename`, `POST /api/v1/fs/entry`, `DELETE /api/v1/fs/entry` |
| `src/renderer/composables/useFileTree.ts:49-65` | Modified | `GET /api/v1/fs/dir?projectPath=...&path=...` |
| `src/renderer/stores/git.ts:36-187+` | Modified | `GET /api/v1/git/status`, `/api/v1/git/branches`, `/api/v1/git/log`, `POST /api/v1/git/stage`, `/api/v1/git/unstage` (and others) |
| `src/renderer/stores/search.ts:22-31` | Modified | `POST /api/v1/fs/search` |
| `src/renderer/stores/update.ts:48-94` | Modified | Wraps `requireRendererApi().getUpdateState()` etc. (still goes through bridge, not raw HTTP) |

Each file has a corresponding `.test.ts` (`useFileOperations.test.ts:254-274`, `useFileTree.test.ts:294-314`, `git.test.ts:27-53`, `search.test.ts:25-50`) that mocks `isStoaClientMode → true` and asserts the HTTP path is taken instead of `window.stoa.*`.

**Verdict:** Five more renderer surfaces now have a working web path. The 5 dual-pathed files (from prior research) plus these 5 bring the total to **10 renderer files** with HTTP/WS support, leaving the remaining stores that haven't been touched.

### 10. `stoa-server` Build Wiring — `webClientRoot` Resolver Added

| File | Status | Role |
|------|--------|------|
| `stoa-server/src/shared/web-client-path.ts:1-21` | **Untracked, new** | `resolveWebClientRoot()` / `isWebClientAvailable()` resolve `dist/web/index.html` from `stoa-server/dist/web`, `dist/web`, or `moduleDir/../../dist/web` |
| `stoa-server/src/routes/discovery.ts:1-41` | **Modified** | Removed inline `existsSync`/`resolve`; imports `isWebClientAvailable` from the new module |
| `stoa-server/src/routes/static.ts:1-20` | **Modified** | Uses `resolveWebClientRoot()` for `serveStatic({ root })` |
| `stoa-server/src/index.ts:178-186` | **Modified (string-only)** | Log message updated to `stoa-server/dist/web/` (no functional change) |

**Verdict:** The server now has a single source of truth for "where is the web bundle?" and will serve the built `stoa-server/dist/web/` correctly when `dist/web/index.html` exists (it does).

### 11. WebSocket Upgrade — STILL NOT WIRED

- `stoa-server/src/index.ts:174-177` — still uses plain `serve({ fetch: app.fetch, port })` with no `createNodeWebSocket()`, no `http.Server.upgrade` handler.
- `stoa-server/src/ws/hub.ts:23-93` — fully implemented `WsHub` class with no HTTP upgrade path.
- `StoaClient.connectWs()` (`src/renderer/lib/stoa-client.ts`) — will attempt `new WebSocket(\`${baseUrl}/ws?token=...\`)` but the server has no upgrade handler.

**Verdict:** The web SPA can load, render, and call REST endpoints. It cannot open a WebSocket — every WS subscription will fail. This blocks the same flows it blocks for Electron-runtime-less testing: live session telemetry, presence transitions, terminal data streams, push notifications, runtime-bridge handshakes.

### 12. Runtime Bridge — STILL 503 STUB

- `stoa-server/src/index.ts:84-85` — `const runtimeBridge = createStubRuntimeBridge()` (unchanged)
- `stoa-server/src/routes/runtime-bridge.ts:54-79` — every session lifecycle call returns 503 (unchanged)

**Verdict:** Web-only clients cannot launch, input, resize, kill, or read terminal replay for any session. Same blocker as prior research (`research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` line 130).

### 13. `fs` / `git` / `discover` Routes — STILL MISSING

The dual-pathed renderer composables/stores call these routes:

- `GET /api/v1/fs/dir`
- `POST /api/v1/fs/entry`
- `DELETE /api/v1/fs/entry`
- `POST /api/v1/fs/rename`
- `POST /api/v1/fs/search`
- `GET /api/v1/git/status`
- `GET /api/v1/git/branches`
- `GET /api/v1/git/log`
- `POST /api/v1/git/stage`
- `POST /api/v1/git/unstage`

A glob of `stoa-server/src/routes/` shows **no `fs.ts` or `git.ts`**. The prior research (`research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` line 130) flagged this; the dirty tree has not closed this gap. Until these route groups exist, the new web HTTP paths in `git.ts` and `useFileTree.ts` will 404 in the browser.

### 14. `playwright.config.ts` Project Layout — No Multi-Project Setup

`playwright.config.ts:1-19` is single-project, single-worker, no `projects:` array. Prior research (`research/2026-06-12-playwright-web-ui-parity-context.md` lines 113-118) recommended adding a `web` project with `use.baseURL` + `webServer` config. Not done.

---

### What IS in the dirty tree (positive evidence)

| Capability | Evidence |
|------------|----------|
| Web build runs | `vite.web.config.ts:1-18` + `package.json:13` `build:web` |
| Web bundle is on disk | `stoa-server/dist/web/index.html` + 7 asset files present |
| SPA can bootstrap on the web | `src/renderer/bootstrap-web.ts:1-43` + `bootstrap-web.test.ts:1-91` |
| `main.ts` auto-detects web mode | `src/renderer/main.ts:9-11` `if (!window.stoa) bootstrapWebRenderer()` |
| `App.vue` no longer hard-requires Electron preload | `src/renderer/app/App.vue:51, 56, 62, ... 248` → all 18 sites use `requireRendererApi()` |
| `requireRendererApi()` falls back to `StoaClient` adapter in web mode | `src/renderer/stores/stoa-store-plugin.ts:47-74` |
| 5 more renderer surfaces have HTTP paths | `useFileOperations.ts`, `useFileTree.ts`, `git.ts`, `search.ts`, `update.ts` (each with a unit test) |
| Server can find the web bundle | `stoa-server/src/shared/web-client-path.ts:1-21` + `static.ts:13-19` |
| CSP relaxed for HTTP/WS to any origin | `src/renderer/index.html:7` |
| Server logs mention `stoa-server/dist/web/` | `stoa-server/src/index.ts:181, 183` |

### What IS NOT in the dirty tree (gaps)

| Gap | Implication |
|-----|-------------|
| No `tests/e2e-web/` directory | Zero browser Playwright test files |
| No web Playwright fixture (no `launchWebApp()` equivalent) | Can't open a Chromium page against the running `stoa-server` |
| No `webServer:` config in `playwright.config.ts` | `playwright test` will not auto-spawn the server |
| No `projects:` array — no `chromium` browser project | `playwright test` runs the same Electron suite |
| No `use.baseURL` in `playwright.config.ts` | `page.goto('/...')` calls would 404 |
| No `chromium` / browser install hook in scripts | Need `npx playwright install chromium` manually; not in `test:e2e` |
| No `test:e2e:web` script | Can't run web tests via `npm run` even if added |
| No `fs.ts` / `git.ts` routes in `stoa-server` | The new dual-path renderer code 404s in the browser for fs/git operations |
| No WebSocket upgrade on the server | `StoaClient.connectWs()` will fail; no live push |
| Runtime bridge still a 503 stub | No session lifecycle / terminal in web mode |
| Generator templates still emit `launchElectronApp` | The 4 generated specs stay Electron-bound even after `npm run test:generate` |
| `tests/e2e-playwright/*.test.ts` unchanged | All 11 hand-written tests + 3 fixtures still Electron-only |
| No `package.json` script for `npx playwright install` | First browser run would fail with "browser not found" |

### Is the current state enough to run web UI E2E against stoa-server?

**No — not yet.** The application code is close, but the test harness is missing entirely. Concretely, you cannot do `npx playwright test --project=web` because no `web` project exists. You cannot do `npx playwright test tests/e2e-web/` because the directory does not exist. The fastest path to a green web E2E requires:

1. Add `projects: [{ name: 'electron', ... }, { name: 'web', use: { baseURL }, webServer: { command: 'node stoa-server/dist/index.cjs --port 3270 --web', port: 3270 } }]` to `playwright.config.ts`.
2. Add `chromium` to the projects' `use` (or use `@playwright/test`'s default chromium).
3. Add `npx playwright install chromium` somewhere (CI script or `test:e2e:web` script).
4. Create `tests/e2e-web/fixtures/web-app.ts` (similar shape to `electron-app.ts` but with `page.goto` + token injection from the URL).
5. Add `tests/e2e-web/smoke.test.ts` to assert the SPA loads, the adapter bootstraps, and the connection state reaches `ready`.
6. **Close the missing server routes:** `stoa-server/src/routes/fs.ts` and `git.ts` for the new dual-pathed renderer to be exercised.
7. **Wire the WS upgrade** in `stoa-server/src/index.ts` if any web test wants to assert live push.
8. **Decide what to do about session lifecycle in web mode** — either point web tests at non-PTY flows only (project CRUD, settings, search, file tree reads, git reads) or implement a stub runtime provider for tests.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `playwright.config.ts` unchanged, no `webServer`/`projects`/`baseURL` | `playwright.config.ts` | `playwright.config.ts:1-19` |
| New `build:web` script added | `package.json` | `package.json:12-13` |
| No `test:e2e:web` / `test:web` / `playwright install` scripts | `package.json` | `package.json:10-39` (full file) |
| 4 generated specs unchanged, all Electron | `tests/generated/playwright/*.generated.spec.ts` | 4 files glob-matched |
| 11 hand-written Playwright tests unchanged, all Electron | `tests/e2e-playwright/*.test.ts` | 11 files glob-matched |
| Generator templates still emit `launchElectronApp` | `testing/generators/generate-playwright.ts` | `generate-playwright.ts:19-20, 76-82` |
| New Vite web config | `vite.web.config.ts` | `vite.web.config.ts:1-18` |
| New shared renderer config helpers | `vite.renderer.shared.ts` | `vite.renderer.shared.ts:1-22` |
| Web SPA build present on disk | `stoa-server/dist/web/` | `index.html` + 7 asset files |
| `bootstrap-web.ts` new + test | `src/renderer/bootstrap-web.ts` | `bootstrap-web.ts:1-43` + `.test.ts:1-91` |
| `main.ts` auto-bootstraps web | `src/renderer/main.ts` | `main.ts:9-11` |
| CSP relaxed to http/https/ws/wss | `src/renderer/index.html` | `index.html:7` |
| `requireRendererApi()` bridge refactor | `src/renderer/stores/stoa-store-plugin.ts` | `stoa-store-plugin.ts:43-90` |
| App.vue 18 sites refactored to `requireRendererApi()` | `src/renderer/app/App.vue` | `App.vue:51, 56, 62, 69, 78, 89, 100, 110, 120, 133, 145, 154, 219, 222, 228, 232, 237, 248` |
| New App.vue test for web adapter bootstrap | `src/renderer/app/App.test.ts` | `App.test.ts:332-344` |
| `useFileOperations` dual-pathed | `src/renderer/composables/useFileOperations.ts` | `useFileOperations.ts:15-58` |
| `useFileTree` dual-pathed | `src/renderer/composables/useFileTree.ts` | `useFileTree.ts:49-65` |
| `git` store dual-pathed | `src/renderer/stores/git.ts` | `git.ts:36-187+` |
| `search` store dual-pathed | `src/renderer/stores/search.ts` | `search.ts:22-31` |
| `update` store dual-pathed | `src/renderer/stores/update.ts` | `update.ts:48-94` |
| Unit tests for the new dual paths | `*.test.ts` next to each | `useFileOperations.test.ts:254-274`, `useFileTree.test.ts:294-314`, `git.test.ts:27-53`, `search.test.ts:25-50` |
| Server `webClientRoot` resolver new | `stoa-server/src/shared/web-client-path.ts` | `web-client-path.ts:1-21` |
| `discovery.ts` and `static.ts` use the new resolver | `stoa-server/src/routes/*` | `discovery.ts:7, 47-49`; `static.ts:10, 16, 19` |
| Server entry still no WS upgrade | `stoa-server/src/index.ts` | `index.ts:174-177` (unchanged) |
| Runtime bridge still 503 stub | `stoa-server/src/index.ts` | `index.ts:84-85` (unchanged) |
| No `fs.ts` / `git.ts` route files | `stoa-server/src/routes/` | glob result: no `fs*` / `git*` files |
| `App.vue` no longer has unconditional `window.stoa.*` | `src/renderer/app/App.vue` | grep 0 unconditional `window.stoa` sites (replaced with `requireRendererApi()`) |
| `electron.vite.config.ts` deduplicated via shared helper | `electron.vite.config.ts` | `electron.vite.config.ts:1-50` |
| `tsconfig.node.json` includes new configs | `tsconfig.node.json` | `tsconfig.node.json:9-10` |

### Risks / Unknowns

- [!] **The 4 generated Playwright specs and 11 hand-written tests still call `launchElectronApp()`.** After this worktree is merged, the existing `npm run test:e2e` will still run Electron-only. There is no opt-in flag for "web" — the harness is not multi-project yet.
- [!] **`fs.ts` and `git.ts` are missing from the server.** The dirty worktree added HTTP calls in the renderer for these routes but did not add the server routes. A web E2E that exercises `useFileOperations` or `git` will see 404s. This is a hard prerequisite for any web test that touches files/git.
- [!] **WebSocket upgrade is still not wired.** Any test that asserts live session telemetry, presence transitions, or terminal data over WS will fail because the connection will never upgrade.
- [!] **Runtime bridge is still a 503 stub.** Any test that wants to launch a session, write to a terminal, or restart a session will get 503.
- [?] **The `VITE_USE_STOA_CLIENT` feature flag is still the only `isStoaClientMode()` detection mechanism.** When the web bundle runs, it must set this flag at build time (or runtime) for the dual-pathed stores to route to the HTTP client. The new `main.ts` does not set it. `bootstrap-web.ts` constructs the `StoaClient` and calls `setRendererApi(adapter)`, but it does not set any `VITE_USE_STOA_CLIENT` define. **This means the new `useFileOperations` / `useFileTree` / `git` / `search` HTTP paths will not be taken in the built web bundle as it stands** — they require the flag to be `'1'` at build time (or `isStoaClientMode()` to be re-defined to check `window.location.protocol === 'http:'`).
- [?] **Token auth in the browser.** `bootstrap-web.ts` requires `?token=` in the URL, but `StoaClientPreloadAdapter` passes it as `Authorization: Bearer <token>` on every request. The `?token=` URL parameter is also visible in browser history and to any extension; the prior research (`research/2026-06-12-stoa-server-browser-ui-recommendation.md` lines 86-92) suggested treating it as a capability URL for loopback/LAN only.
- [?] **No SPA router.** `src/renderer/index.html:1-17` + `App.vue` have no `vue-router`. All routing is `window.location.hash` + `App.vue` tab state. The static `serveStatic({ path: 'index.html' })` fallback at `stoa-server/src/routes/static.ts:19` will work for the single-page case, but any deep link (e.g. `?token=...&tab=git`) needs the URL query handling to be in the renderer, not the server.

### Recommended Next Steps (out of scope, flagged for the reader)

1. **Add `fs.ts` and `git.ts` route files in `stoa-server/src/routes/`** to back the new dual-pathed renderer.
2. **Add `projects: [{ name: 'electron' }, { name: 'web' }]` to `playwright.config.ts`** with a `webServer` block that spawns `node stoa-server/dist/index.cjs --port <free> --web`.
3. **Add `npx playwright install chromium` to the `test:e2e:web` script** (or run it in the `webServer` block via `reuseExistingServer`).
4. **Create `tests/e2e-web/fixtures/web-app.ts`** modeled on `tests/e2e-playwright/fixtures/electron-app.ts` (page.goto, token injection, cleanup).
5. **Decide on the runtime bridge for web tests** — either point web tests at non-PTY flows, or implement a test runtime bridge that accepts `runtime:*` commands without spawning PTY.
6. **Decide on the `VITE_USE_STOA_CLIENT` activation path for web** — either bake `__STOA_WEB_MODE__` into `vite.web.config.ts` (as the recommendation report suggested) or override `isStoaClientMode()` at runtime in `bootstrap-web.ts`.
7. **Port one behavior at a time** (start with `app-smoke` / `settings-modal-ui` / `file-explorer` since they don't need terminal, runtime, or push events) before tackling the lifecycle journeys.

---

## Context Handoff: Playwright / Browser Test Migration Progress Audit

Start here: `research/2026-06-13-playwright-browser-test-migration-progress-audit.md`

Context only. Use the saved report as the source of truth.
