---
date: 2026-06-12
topic: stoa-server-web-client-migration-audit-v2
status: completed
mode: context-gathering
sources: 33
---

## Context Report: Stoa Server Web UI Migration — Code Reuse & Stale-Claim Audit

### Why This Was Gathered
Re-audit the existing migration traces in the repo at HEAD (`b0fd14e`) to (1) verify which prior reports are still accurate against current code, (2) enumerate existing browser/web app artifacts and adapters, (3) detect worktree/package changes that suggest an in-progress migration, and (4) call out concrete reuse opportunities vs. stale assumptions to discard for the goal "让 stoa server 真正 serve 一个网页, 基本迁移当前 electron UI".

### Summary
The repo already contains three prior reports on the same topic (dated 2026-06-12) plus a brand-new audit dropped into `research/` minutes ago (`research/2026-06-12-stoa-server-web-client-migration-audit.md`). All four prior reports and the current code agree on the headline: **the Stoa Server is a fully wired Hono HTTP+WS API, but the web SPA itself does not exist** — no `dist/web/`, no `vite.web.config.ts`, no `web-index.html`, no `out/web/`. The repo's package layout, build scripts, and store wiring show clear in-progress migration signals: a `--web` CLI flag, a `stoaServerEnabled` settings toggle, an `AdvancedSettings.vue` UI to flip it, an `AboutSettings.vue` "Web Client" info card backed by `getServerInfo()`, a `StoaClient`+`StoaClientPreloadAdapter` pair that already implements the full `RendererApi`, a Pinia `stoa-store-plugin` with `VITE_USE_STOA_CLIENT` feature flag, and a partial `isStoaClientMode()` dual-path wired into `workspaces.ts`, `settings.ts`, `sidebar.ts` — but **not yet into `App.vue`**, which still calls `window.stoa.*` unconditionally. The biggest reusable asset is the plan doc `docs/superpowers/plans/2026-06-12-stoa-server-client-separation.md` (Phase 6 = Web Client, weeks 14–16). The most important stale claims to discard: any assumption that WS upgrade is wired to the HTTP server, that the renderer has been adapted for `http://` routing, or that `fs` / `git` route groups exist on the server.

### Key Findings

#### 1. Prior Reports — Cross-Checked Against Current Code

| Report | Path | Status Today (HEAD b0fd14e) |
|---|---|---|
| Stoa Server Web UI routes/testids/E2E coverage | `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` | **Accurate.** Re-verified: 8+ REST route groups, 12 WS event types, `dist/web/` empty, all Playwright tests Electron-only. |
| Playwright config & deterministic generation | `research/2026-06-12-playwright-web-ui-parity-context.md` | **Accurate.** `playwright.config.ts:1-19` is still Electron-only single-project, `workers: 1`, no `webServer`. |
| Electron E2E & generated journey tests migration inventory | `research/2026-06-12-electron-e2e-and-generated-journey-tests-migration-inventory.md` | **Accurate.** 11 hand-written tests in `tests/e2e-playwright/`, 4 generated specs, 19 behaviors, 9 topology surfaces — all Electron-bound via `launchElectronApp()`. |
| Stoa Server Web Client Migration Audit | `research/2026-06-12-stoa-server-web-client-migration-audit.md` | **Accurate & most useful as a gap list.** The "Critical Gaps" section (no Vite web build, no WS upgrade wiring, no fs/git routes, runtime bridge is a 503 stub) all still hold. |
| Prior Electron embedded server research | `research/2025-06-12-electron-embedded-server-architecture.md` | **Mostly stale.** Recommended Fastify/Hono over Express, SQLite, mDNS. Repo chose Hono + SQLite (matches), but Express is still in the root `package.json:53` (legacy main-process HTTP server, not the new SR). mDNS/QR-code discovery not implemented. Useful for justifying tech choices, not for reuse. |

#### 2. Existing Browser/Web App Artifacts, Adapters, Tests

**Server-side (Hono HTTP+WS) — complete, not browser-targeted**
- App factory: `stoa-server/src/app.ts:46-79` — Hono, auth, CORS, mounted routes
- Static route: `stoa-server/src/routes/static.ts:11-17` — `serveStatic({ root: './dist/web' })` + SPA fallback
- Discovery: `stoa-server/src/routes/discovery.ts:47-49` — `isWebClientAvailable()` checks `dist/web/index.html`
- Entry: `stoa-server/src/index.ts:174-186` — `serve({ fetch: app.fetch, port })`; logs Web-client status but **does not wire WS upgrade**
- WebSocket hub: `stoa-server/src/ws/hub.ts:23-93` — fully implemented (broadcast, subscribe, reconnection replay) but no HTTP upgrade path
- Public fallback HTML: `stoa-server/public/index.html:1-39` — "Web client not available" placeholder
- Server unit tests: `stoa-server/src/routes/*.test.ts` (5 files) — use Hono in-process `app.request()`, no real HTTP listener, no browser
- Server E2E: `stoa-server/e2e-test.mjs:1-228` — standalone Node script, 16 HTTP-based checks (not Playwright)

**Renderer-side HTTP+WS client — complete, named "StoaClient"**
- `src/renderer/lib/stoa-client.ts:61-286` — `StoaClient` class: `get/post/put/delete`, WS subscribe/unsubscribe with exponential backoff, `sendBinaryInput` (base64 over WS), event buffering + flush, `dispose`
- `src/renderer/lib/stoa-client-preload-adapter.ts:64-650` — `StoaClientPreloadAdapter implements RendererApi` — every IPC call mapped to a REST/WS endpoint, including desktop-only stubs
- `src/renderer/lib/stoa-client.test.ts`, `src/renderer/lib/stoa-client-preload-adapter.test.ts` — adapter tests with mocked fetch/WS
- `src/renderer/stores/stoa-store-plugin.ts:28-56` — Pinia plugin: `initStoaClientForStores(baseUrl, token)`, `getStoaClient()`, `isStoaClientMode()` (gated by `VITE_USE_STOA_CLIENT === '1'`)

**Feature-flagged dual-path wiring (partial)**
- `src/renderer/stores/workspaces.ts:241-340` — `hydrateFromStoaClient`, `subscribeToSessionGraphViaStoaClient`, `subscribeToObservabilityViaStoaClient` paths
- `src/renderer/stores/settings.ts:37, 48, 59, 70, 81` — StoaClient branches for settings reads/writes
- `src/renderer/stores/sidebar.ts:101, 116` — StoaClient branches for sidebar state
- `src/renderer/stores/stoa-store-plugin.ts:43-47` — `isStoaClientMode()` detection

**Migration surface for `window.stoa` calls in `App.vue`** — **NOT yet dual-pathed**:
- `src/renderer/app/App.vue:51, 56, 62, 69, 78, 89, 100, 110, 120, 133, 145, 154, 219, 222, 228, 232, 237, 248` — all 18 call sites use `window.stoa.*` directly. App.vue has no `isStoaClientMode()` check.

**Settings UI for the toggle — present**
- `src/renderer/components/settings/AdvancedSettings.vue:117-153` — `data-testid="settings-stoaServer-toggle"`, calls `store.updateSetting('stoaServerEnabled', next)`
- `src/renderer/components/settings/AboutSettings.vue:90-107` — `Web Client` info card showing `serverInfo.value` (url, token, available) via `window.stoa.getServerInfo()`
- i18n keys: `settings.stoaServerToggle` (`en.ts:27`, `zh-CN.ts:27`); `about.webClient` (`en.ts:232`, `zh-CN.ts:232`)

**Main-process glue (Phase 5)**
- `src/main/stoa-server-spawner.ts:1-376` — `StoaServerSpawner` (port-range scan 3270-3280, health check, SIGTERM/SIGKILL, crash restart, runtime bridge connection)
- `src/main/stoa-runtime-client.ts:1-447` — `StoaRuntimeClient` (Electron-as-runtime WS provider; reflects "electron→SR runtime bridge" §6.3 of plan)
- `src/main/index.ts:1382-1416` — spawner wired behind `STOA_USE_SERVER === 'true'` OR `stoaServerEnabled === true` setting
- `src/main/index.ts:1779-1803` — `IPC_CHANNELS.serverGetInfo` handler with fallback: SR spawner → webhook port → unavailable
- Tests: `src/main/stoa-server-spawner.test.ts` (12 describe blocks), `src/main/stoa-runtime-client.test.ts`

**Preload bridge (Electron side)**
- `src/preload/index.ts:57-324` — exposes `window.stoa` via `contextBridge.exposeInMainWorld('stoa', api)`. Includes `getServerInfo()`.
- `src/shared/project-session.ts:708` — `getServerInfo: () => Promise<{ available, port, url, token }>` declared in `RendererApi`
- `src/shared/test-fixtures.ts:208` — mock for tests
- `src/renderer/lib/stoa-client-preload-adapter.ts:638-643` — adapter implementation (calls `GET /api/v1/discovery`)

#### 3. Worktree / Package / Settings Changes Suggesting In-Progress Migration

**Untracked research files (in working tree, today)**:
- `research/2026-06-12-electron-e2e-and-generated-journey-tests-migration-inventory.md`
- `research/2026-06-12-playwright-web-ui-parity-context.md`
- `research/2026-06-12-stoa-server-web-client-migration-audit.md`
- `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md`

**Recent commit chain (HEAD..HEAD~4)**:
- `b0fd14e feat(server): wire up real services in entry point + E2E test` — boots real `serve()` with all services, replaces stub factories
- `4eb8f7c fix(settings): show server URL from webhook port when SR not spawned` — `getServerInfo` fallback to webhook port
- `9b8f42c feat(server): extract Stoa Server/Client separation — all 6 phases` — the big-bang refactor
- The three prior reports were generated **between** `9b8f42c` and the current HEAD, meaning the SR scaffold was already complete when the reports were written.

**Active worktree branches** (verified via `git branch -a`):
- `main` (current)
- `feature/session-id-reconciliation` — 3 commits ahead, **unrelated** to web UI migration
- `entire/...` (10 branches) — `entire` checkpoint branches, unrelated
- `feature/entire-evolver-memory-bridge` — unrelated (Evolver integration)
- `wip/root-dirty-before-main-merge-20260511` — pre-merge wip, unrelated
- `chore/disable-memory-main` — unrelated

**No in-progress implementation work on the web client itself**:
- No branch in active worktrees contains web-client build files
- `out/web/` does not exist anywhere
- `vite.web.config.ts` does not exist (only vendored in `research/upstreams/orca/vite.web.config.ts:1-31`)
- `web-index.html` does not exist (only vendored in `research/upstreams/orca/src/renderer/src/web/main.tsx`)
- `dist/web/` does not exist
- No `build:web` / `test:e2e:web` script in `package.json:10-39`

**Build pipeline signals**:
- Root `package.json:8` — `"workspaces": ["stoa-shared", "stoa-server"]` (pnpm workspace)
- `pnpm-workspace.yaml:1-3` — confirms workspace members
- `electron.vite.config.ts:40-63` — renderer config still single-purpose (Electron-only)
- Root `package.json:53` — `express` is still a root dep (legacy main-process HTTP server, not the new Hono SR)

#### 4. Reuse Opportunities

| Opportunity | Source | Reuse Pattern |
|---|---|---|
| Hono app factory + middleware order | `stoa-server/src/app.ts:46-79` | **Reuse as-is** for the web build — no changes needed. Static route is already mounted last (line 74-76) with SPA fallback. |
| `StoaClient` HTTP+WS client | `src/renderer/lib/stoa-client.ts:61` | **Reuse as-is** — already implements reconnect, buffering, base64 binary input. 286 lines, fully tested. |
| `StoaClientPreloadAdapter` | `src/renderer/lib/stoa-client-preload-adapter.ts:64` | **Reuse as-is** — implements every `RendererApi` method over REST/WS. Web build can either set `window.stoa = new StoaClientPreloadAdapter(client)` during bootstrap, OR make all stores use the StoaClient path exclusively. |
| Pinia `stoa-store-plugin` | `src/renderer/stores/stoa-store-plugin.ts:28-56` | **Reuse as-is** — already gates by `VITE_USE_STOA_CLIENT`. Needs a parallel env detection (`import.meta.env.MODE === 'web' \|\| hostname !== 'electron'`) to flip on automatically for the web build. |
| `isStoaClientMode()` flag | `src/renderer/stores/stoa-store-plugin.ts:43-47` | **Extend** — add a `isWebMode()` (or replace) that detects web context (e.g. `window.location.protocol === 'http:'`), so the dual-path stores activate unconditionally in the web bundle. |
| Existing dual-path stores | `workspaces.ts:241-340`, `settings.ts:37-81`, `sidebar.ts:101-116` | **Reference pattern** — these three stores show the canonical IPC→StoaClient conversion. Use as the template for the other 5 stores and for `App.vue` itself. |
| `getServerInfo()` data flow | `src/main/index.ts:1779-1803` + `AboutSettings.vue:90-107` + `preload/index.ts:321-323` | **Reuse pattern** — web client can read `discovery` (unauthenticated) for the same info, plus pull the token from URL query string or localStorage. |
| `stoaServerEnabled` settings toggle | `src/shared/project-session.ts:214, 259`, `AdvancedSettings.vue:117-153`, `src/main/index.ts:1386-1408` | **Reuse for the Electron→Web glue** — already gates server spawning. For the web build, the same setting determines whether to advertise the URL in the About card. |
| Plan doc Phase 6 (Web Client) | `docs/superpowers/plans/2026-06-12-stoa-server-client-separation.md:1394-1404` | **Reuse as the implementation outline** — already enumerates: 1) static serving ✓, 2) Vue router `http://` adaptation, 3) desktop-only fallback, 4) responsive layout, 5) browser testing. The plan said weeks 14-16. |
| `stoa-server/e2e-test.mjs` | `stoa-server/e2e-test.mjs:1-228` | **Reference pattern** — 16 HTTP-based checks against a real server. Use as the seed for browser Playwright tests; replace HTTP with browser interactions and screenshot baselines. |
| Orca upstream `vite.web.config.ts` | `research/upstreams/orca/vite.web.config.ts:1-31` | **Reuse the pattern, not the config** — `root: 'src/renderer'`, `base: './'`, `outDir: 'out/web'`, input `web-index.html`. The codebase is Vue not React, so copy the structure, not the plugins. |
| Orca upstream `web/main.tsx` | `research/upstreams/orca/src/renderer/src/web/main.tsx:1-51` | **Reference pattern** — lazy-loads `App` after a `WebConnect` pairing screen. Stoa can do the same with token-entry instead of pairing. |

#### 5. Stale Assumptions to Discard

| Stale Assumption | Why It's Wrong | Source of Correction |
|---|---|---|
| "WebSocket upgrade is wired to the server" | `stoa-server/src/index.ts:174` uses plain `serve({ fetch, port })` — no `createNodeWebSocket()`, no `upgrade` handler. `WsHub` is a class library, not a route. | `stoa-server/src/index.ts:174-186` + plan §6.3 says "RPC bridge" but `index.ts` doesn't wire it |
| "`fs` and `git` route groups exist on the server" | No `stoa-server/src/routes/fs.ts` or `git.ts`. `StoaClientPreloadAdapter` calls `/api/v1/fs/*` and `/api/v1/git/*` which 404 today. | Glob result: only `bootstrap.ts` style files; `StoaClientPreloadAdapter.ts:638+` |
| "Runtime bridge is operational for the web client" | `createStubRuntimeBridge()` at `stoa-server/src/index.ts:85` returns a 503 for every session lifecycle call. Web-only clients have no PTY. | `stoa-server/src/routes/runtime-bridge.ts:54-79` + `stoa-server/src/index.ts:84-85` |
| "The renderer has been adapted for `http://` routing" | `src/renderer/index.html:7` has CSP `connect-src 'self' http://127.0.0.1:*`. The renderer has no Vue Router (grep `vue-router` = 0 hits in `src/renderer/`). Routing is `window.location.hash` plus `App.vue` tab state. | `src/renderer/index.html:1-17`, Grep `createWebHashHistory` = 0 |
| "`App.vue` can be reused as the web entry unchanged" | `App.vue` has 18 unconditional `window.stoa.*` calls (lines 51-248). In a web build, `window.stoa` is undefined unless the bootstrap explicitly sets it. | `src/renderer/app/App.vue:51-248` |
| "Discovery route exposes a web client" | `isWebClientAvailable()` checks `dist/web/index.html`. That file doesn't exist. `webClient: false` in every discovery response today. | `stoa-server/src/routes/discovery.ts:47-49` + Glob `dist/web/**` = empty |
| "All stores support StoaClient mode" | Only `workspaces.ts`, `settings.ts`, `sidebar.ts` have the dual path. Other stores (`memory-notifications`, `update`, `meta-session`, `provider`, `stoa-store-plugin`) have NOT been migrated. | Grep `isStoaClientMode` = 3 store files |
| "`node-pty` works in the browser bundle" | `node-pty` is a native addon — it will fail to import in any browser build. The web bundle must externalize or exclude it. | `package.json:54` — `node-pty: ^1.1.0` |
| "Express is gone" | Root `package.json:53` still depends on `express` for the legacy main-process HTTP server (not the new SR). Don't remove it during the web migration. | `package.json:53` |
| "The Electron app's `webPreferences.sandbox: false` constraint is the same for the web build" | That's Electron-only. Web build needs CSP, no `nodeIntegration`, no `contextIsolation`, CORS allowed for self. | `src/renderer/index.html:7` CSP, `src/main/index.ts` BrowserWindow config |

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| 4 prior reports exist in research/ | Glob `research/2026-06-12-*.md` | 4 untracked files |
| Plan doc Phase 6 = Web Client, weeks 14-16 | `docs/superpowers/plans/2026-06-12-stoa-server-client-separation.md` | `2026-06-12-stoa-server-client-separation.md:1394-1404` |
| Hono app factory mounts static last | `stoa-server/src/app.ts` | `stoa-server/src/app.ts:74-76` |
| Static route serves dist/web/ + SPA fallback | `stoa-server/src/routes/static.ts` | `stoa-server/src/routes/static.ts:11-17` |
| `isWebClientAvailable()` checks dist/web/index.html | `stoa-server/src/routes/discovery.ts` | `stoa-server/src/routes/discovery.ts:47-49` |
| dist/web/ does not exist | Glob `stoa-server/dist/**` | empty result |
| No vite.web.config.ts in repo | Glob `**/vite.web.config.ts` | only vendored Orca one |
| No web-index.html in repo | Glob `**/web-index.html` | only vendored Orca one |
| No out/web/ in repo | Glob `out/web/**/*` | empty result |
| WebSocket hub exists but no upgrade | `stoa-server/src/ws/hub.ts:23-93` + `stoa-server/src/index.ts:174` | `index.ts:174` plain `serve()` |
| 12 WS event types defined | `stoa-server/src/ws/events.ts:3-16` | line 3-16 |
| StoaClient REST+WS class | `src/renderer/lib/stoa-client.ts:61-286` | line 61 |
| StoaClientPreloadAdapter implements RendererApi | `src/renderer/lib/stoa-client-preload-adapter.ts:64-650` | line 64 |
| Dual-path: workspaces.ts | `src/renderer/stores/workspaces.ts:241-340` | line 241, 286 |
| Dual-path: settings.ts | `src/renderer/stores/settings.ts:37-81` | lines 37, 48, 59, 70, 81 |
| Dual-path: sidebar.ts | `src/renderer/stores/sidebar.ts:101, 116` | lines 101, 116 |
| App.vue has 18 unconditional window.stoa calls | `src/renderer/app/App.vue:51-248` | grep count 18 |
| isStoaClientMode feature flag | `src/renderer/stores/stoa-store-plugin.ts:43-47` | line 43-47 |
| stoaServerEnabled setting | `src/shared/project-session.ts:214, 259` | lines 214, 259 |
| stoaServerEnabled UI toggle | `src/renderer/components/settings/AdvancedSettings.vue:117-153` | line 117-153 |
| getServerInfo IPC handler | `src/main/index.ts:1779-1803` | line 1779-1803 |
| StoaServerSpawner (Phase 5) | `src/main/stoa-server-spawner.ts:1-376` | line 1-376 |
| StoaRuntimeClient (Phase 5) | `src/main/stoa-runtime-client.ts:1-447` | line 1-447 |
| Preload exposes window.stoa | `src/preload/index.ts:57-326` | line 57-326 |
| About Web Client card | `src/renderer/components/settings/AboutSettings.vue:90-107, 153-167, 279-333` | multiple |
| Renderer CSP | `src/renderer/index.html:7` | line 7 |
| electron-vite renderer config | `electron.vite.config.ts:40-63` | line 40-63 |
| Root workspaces declaration | `package.json:8` | line 8 |
| pnpm-workspace.yaml | `pnpm-workspace.yaml:1-3` | lines 1-3 |
| No fs.ts / git.ts in stoa-server | Glob `stoa-server/src/**/fs*.ts` + `git*.ts` | empty result |
| Stub runtime bridge 503 | `stoa-server/src/routes/runtime-bridge.ts:54-79` | line 54-79 |
| Stub created in index.ts | `stoa-server/src/index.ts:84-85` | line 84-85 |
| Server E2E (HTTP-only, not Playwright) | `stoa-server/e2e-test.mjs:1-228` | line 1-228 |
| Server unit tests in-process | `stoa-server/src/routes/api-routes.test.ts:137` | line 137 |
| Playwright config Electron-only | `playwright.config.ts:1-19` | line 1-19 |
| 11 hand-written Playwright tests | `tests/e2e-playwright/*.test.ts` | glob 11 files |
| 4 generated Playwright specs | `tests/generated/playwright/*.generated.spec.ts` | glob 4 files |
| Upstream Orca vite.web.config.ts pattern | `research/upstreams/orca/vite.web.config.ts:1-31` | line 1-31 |
| Upstream Orca web/main.tsx WebConnect pattern | `research/upstreams/orca/src/renderer/src/web/main.tsx:1-51` | line 1-51 |
| HEAD commit | `b0fd14e feat(server): wire up real services in entry point + E2E test` | `git log -1` |
| No in-progress web work in any worktree | `git branch -a` | all branches reviewed |

### Risks / Unknowns

- [!] The three prior reports on this topic were written **minutes before** this audit, with overlapping content but inconsistent naming (`web-client-migration-audit` vs `web-ui-routes-testids-e2e-coverage`). The four reports should be consolidated into one canonical migration brief to avoid re-reading 4× redundant scans.
- [!] `App.vue` has 18 hard-coded `window.stoa.*` calls. For the web build to load at all, the bootstrap must set `window.stoa = new StoaClientPreloadAdapter(client)` before `App.vue` runs, OR the entire `App.vue` must be refactored to a `useStoaApi()` composable.
- [!] `runtime-bridge.ts` is a 503 stub. Without a connected runtime provider (Electron side), the web client cannot launch, input, resize, or read terminal replay for any session. This is a fundamental capability gap for the web UI.
- [?] Whether `node-pty` and `electron` deps can be excluded from the web bundle (vite `rollupOptions.external`) without breaking the existing `App.vue` import graph.
- [?] Whether the server's `serve()` from `@hono/node-server` natively supports WS upgrade via `injectWebSocket()` or whether a separate HTTP server with `ws` package is needed.
- [?] What the `webClient: true` semantics are in the discovery response — the flag is set when `--web` is passed AND `dist/web/index.html` exists. The web client must trust this flag to decide whether to render the SPA or show the "not available" fallback.
- [?] The `stoa-server/e2e-test.mjs` is not wired into any `npm test:*` script — it's a one-off script. Whether to convert it into a Vitest integration suite or replace it with Playwright browser tests is undecided.

### Recommended Next Steps (not in scope, but flagged for the reader)

1. **Consolidate the four prior reports** into one canonical migration brief (or pick one and update).
2. **Add a `vite.web.config.ts`** that compiles `src/renderer/` to `stoa-server/dist/web/` and a matching `build:web` npm script. Reuse the Orca pattern.
3. **Wire WS upgrade** in `stoa-server/src/index.ts` via `injectWebSocket()` from `@hono/node-server`.
4. **Implement `fs.ts` + `git.ts` route groups** to back the `StoaClientPreloadAdapter` calls, OR add a runtime-fallback in the adapter.
5. **Either set `window.stoa` at bootstrap OR refactor `App.vue`** to use a `useStoaApi()` composable.
6. **Add a `WebConnect` token-entry screen** modeled on Orca's `src/renderer/src/web/main.tsx:1-51`, persisted to localStorage.
7. **Add an E2E Web Playwright project** to `playwright.config.ts` (separate project, `webServer` config) plus a web `StoaClient` test seed (modeled on `stoa-server/e2e-test.mjs`).
8. **Add a CSP relaxation** in `src/renderer/index.html:7` for the web bundle: `connect-src` must include the SR's own origin and `ws://`.

## Context Handoff: Stoa Server Web UI Migration — Code Reuse & Stale-Claim Audit

Start here: `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md`

Context only. Use the saved report as the source of truth.
