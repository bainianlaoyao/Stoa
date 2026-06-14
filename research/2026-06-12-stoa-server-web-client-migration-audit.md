---
date: 2026-06-12
topic: stoa-server-web-client-migration-audit
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Stoa Server Web Client Migration Audit

### Why This Was Gathered
To understand the exact current wiring of `stoa-server` and the renderer, and enumerate concrete gaps blocking the goal "让 stoa server 真正的 serve 一个网页, 基本迁移当前 electron UI".

### Summary
The stoa-server is a Hono-based HTTP server with 8+ REST route groups, WebSocket hub, and SQLite persistence — already an API-complete backend. The renderer is a Vue 3 + Pinia SPA built by `electron-vite`, communicating via `window.stoa` IPC. A full `StoaClient` HTTP+WS client and `StoaClientPreloadAdapter` already implement the `RendererApi` interface over REST/WS. The missing pieces are: (1) a standard Vite build of the renderer that outputs to `dist/web/`, (2) WebSocket upgrade wiring on the server, (3) missing server-side routes (fs, git), and (4) graceful degradation for desktop-only features (title bar, native dialogs, PTY terminal).

### Key Findings

#### 1. Workspace & Package Wiring

| Package | Role | Build Tool |
|---------|------|------------|
| `stoa` (root) | Electron app — main, preload, renderer | `electron-vite` |
| `stoa-server` | Hono HTTP server — workspace member | `tsup` (CJS output) |
| `stoa-shared` | Shared types — re-exports from `src/shared/` | N/A (path alias) |

- Root `package.json:8` declares `"workspaces": ["stoa-shared", "stoa-server"]`
- `stoa-server/package.json:9` — dev script: `tsx watch src/index.ts`; build: `tsup`
- `stoa-server/tsup.config.ts:3` — builds `src/index.ts` → CJS, bundles `stoa-shared` inline
- Server entry: `stoa-server/src/index.ts:55-216` — parses CLI args (`--port`, `--web`, `--lan`), bootstraps SQLite, WsHub, ProjectSessionManager, MetaSessionManager, starts Hono via `serve()`

#### 2. HTTP Server Stack (Already Complete)

**Framework**: Hono on `@hono/node-server`

**App factory**: `stoa-server/src/app.ts:46` — `createApp(deps, options)`:
1. Global error handler
2. CORS middleware (conditional)
3. Auth middleware (Bearer token or session headers; skips `/api/v1/discovery`)
4. Route groups mounted under `/api/v1`, `/ctl`, `/hooks`
5. Static file serving (conditional, mounted last)

**Route map** (from existing report `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md`):

| Route Group | Mount | Source | Key Endpoints |
|-------------|-------|--------|---------------|
| Discovery | `/api/v1/discovery` | `routes/discovery.ts:19` | `GET /` (unauthenticated) |
| Health | `/ctl` | `routes/health.ts` | `GET /health` |
| Projects | `/api/v1` | `routes/projects.ts:77` | `GET /bootstrap`, `POST /projects`, `DELETE /projects/:id`, `PUT /projects/:id/active` |
| Sessions | `/api/v1` | `routes/sessions.ts:77` | 15 endpoints (CRUD, archive, restore, restart, terminal replay, input, resize, evidence, context export) |
| Settings | `/api/v1` | `routes/settings.ts` | `GET /settings`, `PUT /settings/:key`, `POST /settings/detect/shell`, `POST /settings/detect/provider`, `GET /settings/title-generation/models` |
| Sidebar | `/api/v1` | `routes/sidebar.ts:34` | `GET /sidebar`, `PUT /sidebar` |
| Observability | `/api/v1` | `routes/observability.ts:72` | `GET /observability/sessions/:id/presence`, `GET /observability/projects/:id`, `GET /observability/app`, `GET /observability/sessions/:id/events` |
| Meta-Sessions | `/api/v1` | `routes/meta-sessions.ts:104` | 10+ endpoints (bootstrap, CRUD, proposals, approve/reject/dispatch, inspector) |
| Control | `/ctl` | `routes/control.ts:157` | 18 endpoints for stoa-ctl |
| Webhooks | `/hooks` | `routes/webhooks.ts:312` | `POST /events`, `POST /hooks/claude-code`, `/codex`, `/opencode`, `/memory-notifications` |
| Static | `/` | `routes/static.ts:11` | `GET /assets/*`, `GET *` (SPA fallback to `dist/web/index.html`) |

#### 3. Static Asset & Web Client Status

- **Static route exists**: `stoa-server/src/routes/static.ts:14-17` — serves `dist/web/` with SPA fallback
- **`--web` flag wired**: `stoa-server/src/index.ts:41` — `if (args[i] === '--web') web = true`
- **Web client detection**: `stoa-server/src/routes/discovery.ts:48` — `isWebClientAvailable()` checks `existsSync('dist/web/index.html')`
- **Placeholder HTML**: `stoa-server/public/index.html` — "Web client not available"
- **`dist/web/` does NOT exist** — the Vue SPA has never been built for web

#### 4. Shared Types & Integration Points

- `stoa-shared/types/index.ts` — re-exports 11 modules from `../../src/shared/` (project-session, meta-session, observability, sidebar-types, memory-runtime, session-state-reducer, provider-descriptors, terminal-settings, update-state, evolver-project-paths, observability-projection)
- `stoa-server/tsconfig.json:16` — path alias `stoa-shared` → `../stoa-shared/types`
- Server imports from `stoa-shared` in every route file

#### 5. StoaClient (HTTP+WS Client Library)

- `src/renderer/lib/stoa-client.ts:61` — Full REST + WebSocket client
- Methods: `get/post/put/delete` (HTTP), `subscribe/unsubscribe` (WS), `sendBinaryInput`, `connectWs`, `flushBuffer`, `dispose`
- WS reconnect with exponential backoff (1s → 30s max)
- Used via Pinia plugin `stoa-store-plugin.ts:52` — injects `$stoaClient` into all stores

#### 6. StoaClientPreloadAdapter (Drop-in IPC Replacement)

- `src/renderer/lib/stoa-client-preload-adapter.ts:64` — implements full `RendererApi` interface
- Maps all IPC calls to REST/WS endpoints
- Desktop-only methods (window management, native dialogs, auto-update, shell) return stubs with `console.warn`

#### 7. Current Renderer (Vue SPA)

- Entry: `src/renderer/index.html` → `src/renderer/main.ts` → `src/renderer/app/App.vue`
- Framework: Vue 3 + Pinia + vue-i18n + Tailwind CSS
- Build: `electron-vite` renderer config (`electron.vite.config.ts:40-63`) — builds to `out/renderer/`
- **All communication via `window.stoa.*`** — IPC calls like `window.stoa.getBootstrapState()`, `window.stoa.createProject()`, etc.
- Stores have dual path: `isStoaClientMode()` checks `VITE_USE_STOA_CLIENT` env flag; when true, uses `StoaClient` instead of IPC

#### 8. WebSocket Hub (Server-Side)

- `stoa-server/src/ws/hub.ts:23` — `WsHub` class
- Event types: `WsServerEventType` from `stoa-server/src/ws/events.ts:3-16` — 12 types (session:graph, session:terminal-data, observability:*, notification:*, etc.)
- Features: client registration, subscription filters, broadcast, reconnection replay
- **BUT: WebSocket upgrade is NOT wired to the HTTP server** — `index.ts:174` uses plain `serve()` without WS upgrade handler

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Root workspace includes stoa-server | `package.json:8` | `"workspaces": ["stoa-shared", "stoa-server"]` |
| Server uses Hono | `stoa-server/package.json:17` | `"hono": "^4.7.0"` |
| Static route serves dist/web/ | `stoa-server/src/routes/static.ts:14` | `serveStatic({ root: './dist/web' })` |
| --web flag is CLI-parsed | `stoa-server/src/index.ts:41` | `if (args[i] === '--web') web = true` |
| Web client availability check | `stoa-server/src/routes/discovery.ts:48` | `existsSync(resolve(..., 'dist/web/index.html'))` |
| dist/web/ does not exist | Glob search | No files under `stoa-server/dist/web/` |
| StoaClient HTTP+WS client | `src/renderer/lib/stoa-client.ts:61` | Full implementation |
| PreloadAdapter implements RendererApi | `src/renderer/lib/stoa-client-preload-adapter.ts:64` | 650 lines mapping IPC→REST |
| Renderer uses window.stoa IPC | `src/renderer/app/App.vue:51-57` | `window.stoa.setActiveProject()`, `window.stoa.createSession()`, etc. |
| Electron preload exposes window.stoa | `src/preload/index.ts:57-324` | Full IPC bridge |
| Pinia plugin injects StoaClient | `src/renderer/stores/stoa-store-plugin.ts:52` | `stoaClientPlugin()` |
| Feature flag VITE_USE_STOA_CLIENT | `src/renderer/stores/stoa-store-plugin.ts:44` | `import.meta.env.VITE_USE_STOA_CLIENT` |
| Stores have dual IPC/StoaClient paths | `src/renderer/stores/workspaces.ts:286-340` | `if (isStoaClientMode()) { ... } else { legacy IPC }` |
| WS hub exists but not wired | `stoa-server/src/index.ts:174` | `serve({ fetch: app.fetch, port })` — no WS upgrade |
| Server build outputs CJS via tsup | `stoa-server/tsup.config.ts:3-9` | `format: ['cjs']`, `noExternal: ['stoa-shared']` |
| Server builds into stoa-server/dist/ | `stoa-server/tsconfig.json:11` | `"outDir": "./dist"` |

### Concrete Gaps vs. Real Server-Hosted Web UI

#### Critical (Must-Have)

1. **No Vite Web Build for the Renderer** — The renderer is built by `electron-vite` which outputs Electron-specific bundles (CJS preload, renderer with `electron` module stubs). Need a **standard Vite config** that builds the same `src/renderer/` codebase as a web SPA to `stoa-server/dist/web/`. This is the single biggest gap.

2. **WebSocket Upgrade Not Wired** — `stoa-server/src/index.ts:174` uses `serve()` from `@hono/node-server` without WS upgrade. The `WsHub` class exists and is fully implemented but no client can actually connect. Need to use `@hono/node-server`'s `createNodeWebSocket()` or inject the `upgrade` handler.

3. **Missing Server Routes for fs and git** — The `StoaClientPreloadAdapter` references these routes that don't exist in `stoa-server/src/routes/`:
   - `/api/v1/fs/dir`, `/api/v1/fs/file`, `/api/v1/fs/entry`, `/api/v1/fs/rename`, `/api/v1/fs/search`
   - `/api/v1/git/status`, `/api/v1/git/stage`, `/api/v1/git/unstage`, `/api/v1/git/discard`, `/api/v1/git/commit`, `/api/v1/git/push`, `/api/v1/git/pull`, `/api/v1/git/fetch`, `/api/v1/git/rebase`, `/api/v1/git/merge`, `/api/v1/git/branches`, `/api/v1/git/log`, `/api/v1/git/diff`, `/api/v1/git/checkout`
   - `/api/v1/settings/detect/vscode`

4. **Runtime Bridge is Stub (503)** — All session runtime operations (terminal replay, input, resize, restart) return 503 via `createStubRuntimeBridge()`. Real PTY sessions require a WebSocket-based PTY proxy or a connected runtime provider.

#### Important (Needed for Functional Web UI)

5. **Renderer `window.stoa` References Must Be Redirected** — `App.vue` and stores call `window.stoa.*` directly. The dual-path pattern (`isStoaClientMode()`) exists in some stores but not all. For a web build, `window.stoa` won't exist at all. Options:
   - Make the web build set `window.stoa = new StoaClientPreloadAdapter(client)` during bootstrap
   - OR make all stores use the StoaClient path exclusively

6. **Desktop-Only UI Components Need Degradation**:
   - `TitleBar.vue` — custom Electron title bar (minimize/maximize/close) → hide in web
   - `UpdatePrompt.vue` — auto-update via electron-updater → hide in web
   - `NewProjectModal.vue` — uses `window.stoa.pickFolder()` → replace with text input
   - xterm.js terminal — requires `node-pty` on backend → needs WebSocket terminal proxy
   - `shellShowItemInFolder` — desktop-only → disable in web

7. **Content Security Policy** — `src/renderer/index.html:7` has strict CSP: `default-src 'self'; connect-src 'self' http://127.0.0.1:*`. For web client, `connect-src` must allow the server's own origin and WebSocket URL.

8. **i18n Plugin Path** — `electron.vite.config.ts:58` uses `@intlify/unplugin-vue-i18n` with hardcoded path to `src/renderer/i18n/`. The web Vite config needs the same plugin.

#### Nice-to-Have

9. **No Discovery-Based Bootstrap in App.vue** — Currently `App.vue:248` calls `window.stoa.getBootstrapState()`. For web, the app needs to discover the server (same origin or via discovery endpoint) and bootstrap from there.

10. **Auth Token Flow** — The server auth middleware requires a Bearer token (`stoa-server/src/middleware/auth.ts:21`). For web client, need a login/token-entry UI or session-based auth.

11. **LAN Mode CORS + Auth** — In LAN mode, CORS is enabled but auth still required. Browser clients need a way to provide the token.

### Risks / Unknowns

- [!] The renderer has ~50 Vue components and 8 stores. The web build must compile all of them without Electron-specific imports crashing.
- [!] `node-pty` and `electron` are listed as root dependencies. The web Vite build must externalize or exclude them.
- [?] Whether `@hono/node-server`'s `serve()` supports WS upgrade natively or if a separate HTTP server is needed.
- [?] The `electron-vite` renderer build uses `@vitejs/plugin-vue`, `@tailwindcss/vite`, and `@intlify/unplugin-vue-i18n` — these must all work in a standard Vite build without electron-vite wrapper.
- [?] Whether a single Vite config can serve both Electron and web builds, or if a separate `vite.web.config.ts` is needed.

### Reused Prior Research

The existing report `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` covers server architecture, route map, WebSocket hub, StoaClient, test coverage gaps, and test-id topology in detail. This report focuses on the migration gaps not covered there (renderer build, IPC replacement, missing routes, UI degradation).
