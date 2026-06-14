---
date: 2026-06-13
topic: playwright-browser-web-migration-minimum-path
status: completed
mode: context-gathering
sources: 42
---

## Context Report: Minimum Practical Browser-Web Migration Path for stoa-server UI Coverage

### Why This Was Gathered

To identify the minimum practical path for migrating Electron UI Playwright tests to browser-web Playwright tests against stoa-server. This report classifies every existing test by migration feasibility, identifies the web fixtures needed, determines server/runtime prerequisites, and recommends a phased migration order.

### Summary

The stoa-server now has all backend routes (`fs.ts`, `git.ts`), a custom WebSocket transport (`transport.ts`), and a WS role router (`role-router.ts`) — closing the gaps identified in the prior audit (`research/2026-06-13-playwright-browser-test-migration-progress-audit.md`). The renderer is fully dual-pathed via `requireRendererApi()` / `isStoaClientMode()`. The `vite.web.config.ts` sets `VITE_USE_STOA_CLIENT=1`. **17 tests can migrate immediately** with only a `launchWebApp()` fixture. **35 more tests** can migrate with a `createProjectViaApi()` + test-project fixture. **9 tests** require WebSocket push and webhook support. **12 tests** are Electron-specific and cannot migrate.

---

### 1. Current Test Inventory

| # | File | Tests | Status | Migration Tier |
|---|------|-------|--------|---------------|
| 1 | `app-smoke.test.ts` | 3 | All passing | **Tier 1** — immediate |
| 2 | `settings-modal-ui.test.ts` | 13 | All passing | **Tier 1** — immediate |
| 3 | `stoactl-lifecycle.generated.spec.ts` | 1 | Passing | **Tier 1** — immediate |
| 4 | `sidebar-interaction.test.ts` | 5 | All passing | **Tier 2** — needs API setup |
| 5 | `file-explorer.test.ts` | 10 (3 skipped) | 7 passing | **Tier 2** — needs API setup |
| 6 | `search-panel.test.ts` | 7 (3 skipped) | 4 passing | **Tier 2** — needs API setup |
| 7 | `git-panel.test.ts` | 13 | All skipped (rg) | **Tier 2** — needs API setup |
| 8 | `project-session-journey.test.ts` | 2 | All passing | **Tier 3** — needs WS + runtime |
| 9 | `session-restore.generated.spec.ts` | 1 | Passing | **Tier 3** — needs WS + runtime |
| 10 | `session-telemetry-claude-lifecycle.generated.spec.ts` | 1 | Passing | **Tier 3** — needs WS + runtime |
| 11 | `session-event-journey.test.ts` | 7 | All passing | **Tier 3** — needs WS + runtime |
| 12 | `terminal-journey.test.ts` | 5 | All passing | **Electron-only** — PTY live terminal |
| 13 | `recovery-journey.test.ts` | 2 | All passing | **Electron-only** — killAndRelaunch |
| 14 | `debug-devtools.test.ts` | 4 | All passing | **Electron-only** — main process state |
| 15 | `workspace-quick-access.generated.spec.ts` | 1 | Passing | **Electron-only** — desktop open-ide/open-file-manager |

**Total: 17 Tier 1 + 35 Tier 2 + 9 Tier 3 + 12 Electron-only = 73 tests**

---

### 2. Migration Tiers Explained

#### Tier 1 — Immediate (17 tests)

These tests only need:
- The web SPA to load in a browser tab
- HTTP API responses from stoa-server
- `data-testid` selectors that work identically in web mode
- **No project/session creation** (settings/smoke don't require it) or **project creation via simple HTTP call** (stoactl)

**Tests:**
- `app-smoke.test.ts` — 3 tests: boot shell spec, empty state spec, activity icons while switching surfaces. All verify `data-testid="app-viewport"`, `data-testid="command-panel"`, `data-activity-item` selectors. No Electron-specific APIs.
- `settings-modal-ui.test.ts` — 13 tests: 5 tabs rendered, default panel, tab switching, Claude permissions switch, search focusing, modal dialog behavior. All use `data-settings-tab`, `data-settings-field`, `data-testid="modal-*"` selectors. No Electron APIs.
- `stoactl-lifecycle.generated.spec.ts` — 1 test: toggles stoactl in settings, verifies `/ctl/health` returns 503. Uses `data-testid="settings-stoactl-toggle"` + HTTP fetch. Only needs project created via API (which this test already does by calling `createProject`).

**Migration steps for Tier 1:**
1. Create `tests/e2e-web/fixtures/web-app.ts` with `launchWebApp()`
2. Create `tests/e2e-web/smoke.test.ts` (port of `app-smoke.test.ts`)
3. Create `tests/e2e-web/settings.test.ts` (port of `settings-modal-ui.test.ts`)
4. Create `tests/e2e-web/stoactl.test.ts` (port of generated spec)
5. Add `projects: [{ name: 'web', use: { baseURL }, webServer: {...} }]` to `playwright.config.ts`

#### Tier 2 — Needs API Setup (35 tests)

These tests need a project and session created via HTTP API, plus the sidebar test project fixture on disk.

**Tests:**
- `sidebar-interaction.test.ts` — 5 tests: toggle open/close, tab switching, grid layout, resize handle, width persistence. Needs `createProjectViaApi()` + `createSessionViaApi()` equivalents.
- `file-explorer.test.ts` — 10 tests (3 skipped for Windows path bugs): root entries, expand/collapse folders, nested expansion, collapse all, context menu creation/rename/delete, toolbar buttons. Needs project with files on disk. The `createSidebarTestProject()` fixture already creates the right file layout — just needs project registration via HTTP.
- `search-panel.test.ts` — 7 tests (3 skipped for rg): search results, empty query, case-sensitive, whole-word, regex, expand/collapse groups, error handling. Same setup as file-explorer.
- `git-panel.test.ts` — 13 tests (all currently skipped for rg): git status sections, staged/modified/untracked files, stage/unstage, commit, branch name, section collapse/expand. Same setup as file-explorer. **The server git routes (`stoa-server/src/routes/git.ts`) now exist**, so these could potentially run.

**Migration steps for Tier 2:**
1. Create `tests/e2e-web/helpers/web-ui-actions.ts` — web equivalents of `ui-actions.ts`:
   - `createProjectViaApi(baseUrl, token, { name, path })` → `POST /api/v1/projects`
   - `createSessionViaApi(baseUrl, token, { projectId, type })` → `POST /api/v1/sessions`
2. Reuse `createSidebarTestProject()` fixture as-is (it only writes to disk + git init)
3. Create `tests/e2e-web/sidebar.test.ts`, `file-explorer.test.ts`, `search.test.ts`, `git.test.ts`

**Key insight:** The `createProject()` helper in `ui-actions.ts:25-42` uses `queueNextFolderPick(electronApp, path)` to simulate Electron's folder dialog — this is the Electron-specific part. The web equivalent simply calls `POST /api/v1/projects` with the same project path.

#### Tier 3 — Needs WS + Webhook (9 tests)

These tests require WebSocket push events and webhook ingestion working end-to-end.

**Tests:**
- `session-event-journey.test.ts` — 7 tests: session event projection, webhook-driven UI update, completion projection, claude raw Stop hook, claude activity hook, PermissionRequest hook, invalid secret rejection. Requires: webhook endpoint (`POST /events`, `POST /hooks/claude-code`), WS push to renderer, session status dots reflecting pushed state.
- `session-restore.generated.spec.ts` — 1 test: archive + restore a session. Requires: project/session creation, archive API, WS state sync.
- `session-telemetry-claude-lifecycle.generated.spec.ts` — 1 test: full lifecycle ready→running→blocked→running→complete→ready→failure. Requires: fake Claude binary, webhook events, WS push, session status UI.

**Server readiness:**
- The WS transport (`stoa-server/src/ws/transport.ts`) is fully implemented (RFC 6455 handshake + text frames)
- The WS role router (`stoa-server/src/ws/role-router.ts`) handles `role=web` connections
- The server entry (`stoa-server/src/index.ts:200-213`) wires `attachWebSocketServer` + `routeConnection`
- Webhook routes (`stoa-server/src/routes/webhooks.ts`) exist
- **This tier can migrate once the WS→renderer push is confirmed working in browser mode**

#### Electron-Only — Cannot Migrate (12 tests)

- `terminal-journey.test.ts` — 5 tests: live terminal output via `appendTerminalData(electronApp, ...)`, codex hooks with fake binary, session isolation (terminal buffer read). Requires `electronApp.evaluate()` to access `__VIBECODING_MAIN_E2E__` debug API.
- `recovery-journey.test.ts` — 2 tests: `killAndRelaunch()` and `relaunch()` to verify state persistence across app restarts. Electron app lifecycle — no browser equivalent.
- `debug-devtools.test.ts` — 4 tests: key sequence `114514` toggles debug mode, verified via `getDebugModeActive(electronApp)`. Uses `electronApp.evaluate()` to read main-process state.
- `workspace-quick-access.generated.spec.ts` — 1 test: `workspace.open-ide` and `workspace.open-file-manager` trigger Electron IPC to open desktop apps. No browser equivalent.

---

### 3. Web Fixture Architecture

#### 3.1 `launchWebApp()` — Core Web Fixture

```
tests/e2e-web/fixtures/web-app.ts
```

Must provide:
- Start stoa-server as a child process: `node stoa-server/dist/index.cjs --port <free> --web`
- Wait for server readiness (poll `GET /ctl/health` or `GET /api/v1/discovery`)
- Open browser page at `http://localhost:<port>?token=<test-token>`
- Wait for SPA bootstrap (poll for `data-testid="app-viewport"`)
- Return `{ page, baseUrl, token, cleanup }`

The auth token is controlled by `STOA_AUTH_TOKEN` env var (defaults to `stoa-dev-token` in `stoa-server/src/index.ts:192`).

State directory: Use `createTestTempDir('stoa-web-playwright-')` for isolation.

#### 3.2 `createProjectViaApi()` — Replace `createProject()`

The Electron `createProject()` (`ui-actions.ts:25-42`) does:
1. `mkdir` the project directory
2. `queueNextFolderPick(electronApp, path)` — Electron folder dialog mock
3. Click "New project" button
4. Fill dialog form
5. Submit

The web equivalent:
1. `mkdir` the project directory (same)
2. `POST /api/v1/projects` with `{ name, path }` (HTTP API call)
3. Verify project appears in the UI via `data-testid="project-row"`

#### 3.3 `createSessionViaApi()` — Replace `createSession()`

The Electron `createSession()` (`ui-actions.ts:44-74`) does:
1. Click add-session button
2. Select provider type from radial menu
3. Wait for session row

The web equivalent:
1. `POST /api/v1/sessions` with `{ projectId, type }` (HTTP API call)
2. Verify session appears in the UI

**Caveat:** For `type: 'shell'`, the server needs a runtime provider to accept the session. In test mode, either:
- Use `type: 'opencode'` or `type: 'claude-code'` (these don't immediately need a PTY)
- Register a mock runtime provider via WS (`role=runtime`) that accepts commands
- Or implement a stub runtime bridge that auto-creates session state without PTY

For Tier 2 tests (file-explorer, search, git), the session type doesn't matter much — they just need the sidebar open and the project path registered. A shell session that shows as "starting" is sufficient.

#### 3.4 Sidebar Actions — Mostly Reusable As-Is

`sidebar-actions.ts` uses only `data-testid` selectors and standard Playwright `page` / `Locator` APIs. No Electron-specific calls. **Can be shared directly** between `tests/e2e-playwright/helpers/` and `tests/e2e-web/helpers/`.

#### 3.5 Sidebar Test Project — Reusable As-Is

`sidebar-test-project.ts` creates files on disk and runs `git init + git commit`. Pure Node.js, no Electron dependency. **Reuse directly** from web tests.

---

### 4. Playwright Config Changes

Current `playwright.config.ts`:
```ts
export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts'],
  testIgnore: ['**/fixtures/**/*.test.ts'],
  workers: 1,
  // No projects, no webServer, no baseURL
})
```

Recommended multi-project layout:
```ts
export default defineConfig({
  testDir: './tests',
  workers: 1,
  projects: [
    {
      name: 'electron',
      testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts'],
      testIgnore: ['**/fixtures/**/*.test.ts'],
      use: { trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure' },
    },
    {
      name: 'web',
      testMatch: ['e2e-web/**/*.test.ts'],
      use: {
        baseURL: 'http://localhost:3271',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
      },
      webServer: {
        command: 'node stoa-server/dist/index.cjs --port 3271 --web',
        port: 3271,
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
        env: { STOA_AUTH_TOKEN: 'stoa-dev-token' },
      },
    },
  ],
})
```

New scripts needed in `package.json`:
```json
"test:e2e:web": "npm run build && playwright test --project=web",
"test:e2e:all": "npm run build && playwright test"
```

---

### 5. Server/Runtime Prerequisites — Current State

| Prerequisite | Status | Location |
|-------------|--------|----------|
| `fs` routes (dir, file, entry, rename, search) | **Done** | `stoa-server/src/routes/fs.ts` |
| `git` routes (status, stage, unstage, commit, branches, log, diff, etc.) | **Done** | `stoa-server/src/routes/git.ts` |
| `sidebar` routes (GET/PUT sidebar state) | **Done** | `stoa-server/src/routes/sidebar.ts` |
| `settings` routes | **Done** | `stoa-server/src/routes/settings.ts` |
| `projects` routes | **Done** | `stoa-server/src/routes/projects.ts` |
| `sessions` routes | **Done** | `stoa-server/src/routes/sessions.ts` |
| WebSocket upgrade handler | **Done** | `stoa-server/src/ws/transport.ts` |
| WS role router (web/runtime separation) | **Done** | `stoa-server/src/ws/role-router.ts` |
| WS hub (broadcast, subscribe/unsubscribe) | **Done** | `stoa-server/src/ws/hub.ts` |
| Static file serving for web SPA | **Done** | `stoa-server/src/routes/static.ts` |
| Web client path resolver | **Done** | `stoa-server/src/shared/web-client-path.ts` |
| Discovery route with webClient flag | **Done** | `stoa-server/src/routes/discovery.ts` |
| CORS middleware | **Done** | `stoa-server/src/middleware/cors.ts` |
| Webhook event routes | **Done** | `stoa-server/src/routes/webhooks.ts` |
| Runtime bridge handler | **Done** | `stoa-server/src/ws/runtime-bridge-handler.ts` |
| `VITE_USE_STOA_CLIENT=1` in web build | **Done** | `vite.web.config.ts:12` |
| Web bootstrap (`bootstrapWebRenderer`) | **Done** | `src/renderer/bootstrap-web.ts` |
| Dual-pathed stores (git, search, file ops, file tree) | **Done** | 5 renderer files |
| `requireRendererApi()` bridge | **Done** | `src/renderer/stores/stoa-store-plugin.ts` |
| CSP relaxed for ws:// | **Done** | `src/renderer/index.html:7` |
| `--web` CLI flag in server | **Done** | `stoa-server/src/index.ts:48` |

**All server-side prerequisites are now met.** The prior audit's gaps (missing `fs.ts`, `git.ts`, no WS upgrade) have been closed.

---

### 6. Risks / Unknowns

- [!] **Session creation may need a runtime provider.** The server's `POST /api/v1/sessions` likely requires a runtime provider connection to fully initialize. For web tests that just need a project row in the UI without a live terminal, we may need a "headless" session creation path or a mock runtime provider fixture.
- [!] **Windows path separator bugs in file explorer.** Three file-explorer tests are already skipped (`test.skip`) due to `startCreateFile`/`startRename` using `lastIndexOf('/')` instead of handling `\`. These bugs affect both Electron and web; they should be fixed before or during migration.
- [!] **Git panel tests are all skipped.** All 13 git-panel tests are `test.skip()` due to missing ripgrep on Windows CI. The server's `fs.ts:searchContent()` already falls back from rg to `git grep`, so the web versions might actually work. Worth trying.
- [!] **The `webServer` config in Playwright may conflict with parallel runs.** The server uses a fixed port; if two Playwright workers try to start it simultaneously, one will fail. The recommended config uses `reuseExistingServer` and a single worker.
- [?] **Token in URL query parameter.** `bootstrap-web.ts:15-20` reads `?token=` from `window.location.search`. This is visible in browser history and logs. Acceptable for LAN/loopback testing but not for production.
- [?] **No SPA router.** Deep links (e.g., `?token=...&tab=git`) depend on query handling in the renderer, not the server. The static `serveStatic({ path: 'index.html' })` fallback works for the single-page case but has not been tested with complex query params.

---

### 7. Recommended Migration Order

#### Phase 1 — Smoke + Settings (17 tests, 0 new fixtures beyond `launchWebApp()`)

| Test File | Tests | Effort |
|-----------|-------|--------|
| `app-smoke.test.ts` → `smoke.test.ts` | 3 | Low — direct port, replace `launchElectronApp()` with `launchWebApp()` |
| `settings-modal-ui.test.ts` → `settings.test.ts` | 13 | Low — same, all data-testid selectors |
| `stoactl-lifecycle.generated.spec.ts` → `stoactl.test.ts` | 1 | Medium — needs `createProjectViaApi()` |

**Deliverables:**
- `tests/e2e-web/fixtures/web-app.ts` (launchWebApp + cleanup)
- `tests/e2e-web/helpers/web-ui-actions.ts` (createProjectViaApi)
- `tests/e2e-web/smoke.test.ts`
- `tests/e2e-web/settings.test.ts`
- `tests/e2e-web/stoactl.test.ts`
- `playwright.config.ts` multi-project update
- `package.json` `test:e2e:web` script

#### Phase 2 — Sidebar + File Explorer (35 tests, needs project/session API fixtures)

| Test File | Tests | Effort |
|-----------|-------|--------|
| `sidebar-interaction.test.ts` → `sidebar.test.ts` | 5 | Medium — needs project+session setup |
| `file-explorer.test.ts` → `file-explorer.test.ts` | 10 | Medium — needs test project fixture |
| `search-panel.test.ts` → `search.test.ts` | 7 | Medium — same fixture |
| `git-panel.test.ts` → `git.test.ts` | 13 | Medium — same fixture, may un-skip |

**Deliverables:**
- `createSessionViaApi()` in web-ui-actions.ts
- 4 test files

#### Phase 3 — Session Events (9 tests, needs WS + webhook end-to-end)

| Test File | Tests | Effort |
|-----------|-------|--------|
| `session-event-journey.test.ts` → `session-events.test.ts` | 7 | High — webhook + WS push |
| `session-restore.generated.spec.ts` → `session-restore.test.ts` | 1 | High |
| `session-telemetry-claude-lifecycle.generated.spec.ts` → `telemetry.test.ts` | 1 | High — fake binary + full lifecycle |

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `app-smoke.test.ts` uses only `data-testid` selectors, no Electron evaluate | `tests/e2e-playwright/app-smoke.test.ts` | Lines 1-68 |
| `settings-modal-ui.test.ts` uses only `data-settings-*` selectors | `tests/e2e-playwright/settings-modal-ui.test.ts` | Lines 1-222 |
| `stoactl-lifecycle.generated.spec.ts` uses settings toggle + HTTP fetch | `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | Lines 1-57 |
| `createProject()` depends on `queueNextFolderPick` (Electron dialog mock) | `tests/e2e-playwright/helpers/ui-actions.ts:25-42` | Lines 25-42 |
| `sidebar-actions.ts` has no Electron dependencies | `tests/e2e-playwright/helpers/sidebar-actions.ts` | Lines 1-257 |
| `sidebar-test-project.ts` is pure Node.js + git | `tests/e2e-playwright/fixtures/sidebar-test-project.ts` | Lines 1-73 |
| `terminal-journey.test.ts` uses `appendTerminalData(electronApp, ...)` | `tests/e2e-playwright/terminal-journey.test.ts` | Lines 146, 259-260 |
| `recovery-journey.test.ts` uses `killAndRelaunch()` and `relaunch()` | `tests/e2e-playwright/recovery-journey.test.ts` | Lines 55, 102 |
| `debug-devtools.test.ts` uses `getDebugModeActive(electronApp)` | `tests/e2e-playwright/debug-devtools.test.ts` | Lines 9, 13 |
| `workspace-quick-access.generated.spec.ts` uses `open-ide` + `open-file-manager` | `tests/generated/playwright/workspace-quick-access.generated.spec.ts` | Lines 44-48 |
| Server `fs` routes exist with full CRUD | `stoa-server/src/routes/fs.ts` | Lines 1-523 |
| Server `git` routes exist with full operations | `stoa-server/src/routes/git.ts` | Lines 1-487 |
| Server WS transport implements RFC 6455 | `stoa-server/src/ws/transport.ts` | Lines 1-408 |
| Server WS role router handles `role=web` connections | `stoa-server/src/ws/role-router.ts` | Lines 1-394 |
| Server entry wires WS upgrade + role routing | `stoa-server/src/index.ts` | Lines 200-213 |
| `vite.web.config.ts` sets `VITE_USE_STOA_CLIENT=1` | `vite.web.config.ts` | Line 12 |
| `bootstrap-web.ts` reads `?token=` from URL query | `src/renderer/bootstrap-web.ts` | Lines 12-20 |
| `isStoaClientMode()` checks VITE_USE_STOA_CLIENT flag | `src/renderer/stores/stoa-store-plugin.ts` | Lines 91-95 |
| Auth token defaults to `stoa-dev-token` | `stoa-server/src/index.ts` | Line 192 |
| Playwright config has no `projects:` or `webServer:` | `playwright.config.ts` | Lines 1-19 |
| No `test:e2e:web` script in package.json | `package.json` | Lines 10-39 |
| 3 file-explorer tests skipped for Windows path bugs | `tests/e2e-playwright/file-explorer.test.ts` | Lines 102, 145, 174 |
| All 13 git-panel tests skipped for missing ripgrep | `tests/e2e-playwright/git-panel.test.ts` | Line 22 |
| `session-event-journey.test.ts` uses webhook endpoints | `tests/e2e-playwright/session-event-journey.test.ts` | Lines 102-116, 161-176 |
| `session-telemetry-claude-lifecycle` installs fake Claude binary | `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts` | Lines 45-62 |

### Risks / Unknowns (consolidated)

- [!] Session creation via `POST /api/v1/sessions` may require a connected runtime provider for full initialization. Tests that just need a project row (without live terminal) may need a lighter-weight session creation path.
- [!] The custom WS transport (`transport.ts`) is a hand-rolled RFC 6455 implementation, not the `ws` npm package. It handles text frames, ping/pong, and close frames but does not support binary frames, per-frame deflate, or continuation frames. This is sufficient for JSON-based Stoa protocol but hasn't been tested against browser WebSocket API in real E2E.
- [!] Playwright's `webServer` config auto-manages the server lifecycle, but the server's graceful shutdown has a 10-second timeout. If Playwright kills the process hard, state directories may not be cleaned up.
- [?] The `createProjectViaApi` needs to know the server's auth token. This must be passed through the fixture (env var or hardcoded test token).

---

## Context Handoff: Playwright Browser-Web Migration Minimum Path

Start here: `research/2026-06-13-playwright-browser-web-migration-minimum-path.md`

Context only. Use the saved report as the source of truth.
