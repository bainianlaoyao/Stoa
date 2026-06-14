---
date: 2026-06-13
topic: playwright-e2e-surface-audit-and-minimum-browser-web-migration-plan
status: completed
mode: context-gathering
sources: 31
---

## Context Report: Playwright E2E Surface Audit & Minimum Browser-Web Migration Plan for stoa-server

### Why This Was Gathered

To audit the **current Playwright E2E surface** in the repo (what is reusable, what is Electron-only, what is missing) and identify the **minimum browser-web migration plan** for `stoa-server`. Prior research is reused as ground truth and only concrete gaps are filled (exact file touch points, port, browser-availability, current state of routes/transport/CLI/auth). No implementation work; the report ends with a Context Handoff naming the saved path.

### Summary

The repo has **11 hand-written Playwright tests** + **3 generated specs** + **3 fixture/helper files** under `tests/e2e-playwright/` and `tests/generated/playwright/`. **All are Electron-only** (they call `launchElectronApp()` from `tests/e2e-playwright/fixtures/electron-app.ts:110-162`). The dirty worktree (per `research/2026-06-13-playwright-browser-test-migration-progress-audit.md` and `research/2026-06-13-playwright-browser-web-migration-minimum-path.md`) has already built the entire **application-side path** (web bundle, web bootstrap, dual-pathed renderer, server `fs`/`git` routes, custom WS transport, WS role router, WS upgrade wired in `stoa-server/src/index.ts:240-254`). The only remaining gap is the **test harness**: no `tests/e2e-web/`, no `playwright.config.ts` multi-project setup, no `webServer:` config, no `chromium` browser project, no `test:e2e:web` script. The minimum migration adds these harness pieces and ports **17 Tier-1 tests first** (smoke, settings, stoactl) using a `launchWebApp()` fixture that wraps Playwright `page` + token-in-URL against the running `stoa-server` dist.

---

### 1. Current Playwright Surface (verified against disk)

#### 1.1 `playwright.config.ts:1-19`

```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts'],
  testIgnore: ['**/fixtures/**/*.test.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure' },
})
```

- **No `projects:` array.** Single project, single worker, no multi-project split between Electron and browser.
- **No `webServer:`.** Server is not auto-spawned.
- **No `use.baseURL`.** `page.goto('/...')` would 404 in web mode.
- `testMatch` glob covers BOTH `tests/e2e-playwright/**/*.test.ts` and `tests/generated/playwright/**/*.spec.ts` — so once `tests/e2e-web/` is created, the testMatch must be narrowed per-project (otherwise web tests run under the Electron project with no baseURL/webServer).

#### 1.2 `package.json:10-39` (scripts section)

Existing scripts relevant to the migration:

| Script | Body | Implication for migration |
|--------|------|---------------------------|
| `build:12` | `pnpm run build:web && electron-vite build && node scripts/build-stoa-ctl.mjs` | Web bundle is already step 1. Reuse as-is. |
| `build:web:13` | `vite build --config vite.web.config.ts` | Produces `stoa-server/dist/web/index.html` + assets. Reuse. |
| `test:33` | `vitest run` | Tier-1 unit/component tests. Unchanged. |
| `test:generate:34` | `tsx --tsconfig tsconfig.node.json testing/generators/write-generated-playwright.ts` | Re-runs generator. Generator templates are still Electron-only; web-port task requires generator edits (out of scope for minimum path). |
| `test:e2e:35` | `npm run build && playwright test` | Builds everything, then runs Playwright. **Unchanged** — no web project to select yet. |
| `test:all:37` | `npm run test:generate && npm run test && npm run test:e2e && npm run test:behavior-coverage` | Unchanged. |
| `ci:local:39` | `pnpm run test:generate && pnpm run typecheck && pnpm vitest run && pnpm run test:e2e && pnpm run test:behavior-coverage && pnpm run build && pnpm run package && pnpm run verify:packaging && pnpm run verify:release-smoke` | Unchanged. |

**No** `test:e2e:web`, `test:web`, `playwright install`, or `playwright install chromium` script. **No** separate `test:e2e:all` that fans out to both projects.

#### 1.3 `tests/e2e-playwright/` — 11 test files + 3 fixture/helper files (all Electron-bound)

| File | Role | Reusable for web? | Migration Tier |
|------|------|-------------------|----------------|
| `app-smoke.test.ts:1-68` | 3 tests: boot shell, empty state, activity icon stability | **Yes — selectors only** (`data-testid="app-viewport"`, `command-panel`, `data-activity-item="..."`, `.terminal-empty-state`) | **Tier 1** |
| `settings-modal-ui.test.ts:1-222` | 13 tests: 5 tabs, search filtering, modal open/close/Escape/aria | **Yes — selectors only** (`[data-settings-tab]`, `[data-settings-search]`, `[data-settings-field]`, `data-testid="modal-*"`, `[aria-label="..."]`) | **Tier 1** |
| `sidebar-interaction.test.ts:1-157` | 5 tests: open/close, tab switching, grid layout, resize, width persist | **Yes** (helpers in `sidebar-actions.ts` are 100% Playwright-`page`/Locator). Needs API setup. | **Tier 2** |
| `file-explorer.test.ts:1-295` | 10 tests (3 `test.skip` for Windows path bugs at lines 102, 145, 174): root entries, expand/collapse, context menu, refresh, toolbar | **Yes** for the 7 non-skipped tests. Needs `createProjectViaApi()` + `createSidebarTestProject()` fixture. | **Tier 2** |
| `search-panel.test.ts` (7 tests, 3 skipped) | Search results, filters, case/whole-word/regex | **Yes**. Same fixture as file-explorer. | **Tier 2** |
| `git-panel.test.ts` (13 tests, all `test.skip` at line 22 — needs `rg` on Windows CI) | Stage/unstage/commit, branch display, section expand/collapse | **Yes** (the 13 are skipped on rg-absence, NOT on the migration). Server `fs.ts:searchContent()` falls back from rg to `git grep` per `research/2026-06-13-playwright-browser-web-migration-minimum-path.md:259` — may actually un-skip them. | **Tier 2** |
| `project-session-journey.test.ts` | 2 tests: shell journey, OpenCode journey | **No** for now — `OpenCode` requires `createSession(type:'opencode')` which is server-side stubbed and needs runtime provider | **Tier 3** |
| `session-event-journey.test.ts` | 7 tests: webhook events → UI, completion, claude raw Stop, PermissionRequest | **Yes** structurally but **needs WS push + webhook ingestion** (server already has `webhooks.ts`, `ws/transport.ts`, `ws/role-router.ts` — and WS upgrade is wired at `stoa-server/src/index.ts:240-254` per the prior audit) | **Tier 3** |
| `terminal-journey.test.ts` | 5 tests: `appendTerminalData(electronApp, ...)` | **Electron-only** — uses `electronApp.evaluate()` to call `__VIBECODING_MAIN_E2E__.appendTerminalData()` (electron-app.ts:191-202). Runtime bridge is now `createLiveRuntimeBridge(runtimeBridgeHandler)` (`index.ts:96`) but requires a WS-`role=runtime` provider connection, which has no Electron fixture equivalent. | **Electron-only** |
| `recovery-journey.test.ts` | 2 tests: `killAndRelaunch()`, `relaunch()` | **Electron-only** — no browser app-lifecycle equivalent. | **Electron-only** |
| `debug-devtools.test.ts` | 4 tests: `getDebugModeActive(electronApp)` | **Electron-only** — reads main-process debug global. | **Electron-only** |
| `terminal-journey.test.ts-snapshots/terminal-viewport-win32.png` | Visual snapshot | Out of scope (not browser-web) | — |

#### 1.4 `tests/e2e-playwright/fixtures/` and `helpers/`

| File | What it does | Web-reuse |
|------|-------------|-----------|
| `fixtures/electron-app.ts:1-308` | `launchElectronApp()` returns `{ electronApp, page, stateDir, close, kill, killAndRelaunch, relaunch }`. `__VIBECODING_MAIN_E2E__` debug API: `getTerminalReplay`, `appendTerminalData`, `queueDialogPickFolder`, `getWorkspaceOpenRequests`, `clearWorkspaceOpenRequests`, `getDebugModeActive`, `getDebugState`. **Plus** `postWebhookEvent()` (line 264-283) and `postClaudeHookEvent()` (line 285-308) — **these already speak HTTP** and target `http://127.0.0.1:${options.port}/events` and `/hooks/claude-code`. Reusable as-is for web tests; just point the port to the stoa-server port. | **Reusable for webhook/hook posts**. Replace `launchElectronApp()` with new `launchWebApp()`. |
| `fixtures/sidebar-test-project.ts:1-73` | Pure Node `mkdir` + `writeFile` + `git init` + `git commit` + staged/modified/untracked files. No Electron, no Playwright. | **Reusable as-is** by web tests. |
| `helpers/ui-actions.ts:1-119` | `createProject()` (line 25-42) uses `queueNextFolderPick(electronApp, path)` to mock the Electron folder dialog. `createSession()` uses `dispatchQuickAddSessionPress(addSessionButton)` (line 80-99) to fire a timed `mousedown`/`mouseup` for the radial-menu button (long-press detection in the renderer). `focusTerminalInput()` (line 101-112) and `runTerminalCommand()` (line 114-118) are Electron-only because they require the xterm helper textarea. | **Cannot reuse `createProject`/`createSession` as-is** — needs `createProjectViaApi(baseUrl, token, { name, path })` and `createSessionViaApi(baseUrl, token, { projectId, type })` that hit `POST /api/v1/projects` and `POST /api/v1/sessions`. Terminal helpers stay Electron-only. |
| `helpers/sidebar-actions.ts:1-257` | Uses only `page` / `Locator` / `data-testid` selectors. No Electron imports. | **Reusable as-is** for web tests. |

#### 1.5 `tests/generated/playwright/*.generated.spec.ts` (4 files)

All emit `import { launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'`. The generator template (`testing/generators/generate-playwright.ts`) and entry (`testing/generators/write-generated-playwright.ts:1-37`) are still Electron-bound.

| File | Reusable for web? |
|------|-------------------|
| `session-restore.generated.spec.ts` | Needs project+session+archive. **Tier 3** (WS push). |
| `session-telemetry-claude-lifecycle.generated.spec.ts` | Needs fake Claude binary + full WS lifecycle. **Tier 3** (WS push + runtime provider). |
| `stoactl-lifecycle.generated.spec.ts` | Reads `webhookPort` from `getMainE2EDebugState(app.electronApp)` (line 36-37), toggles `settings-stoactl-toggle`, fetches `http://127.0.0.1:${webhookPort}/ctl/health` and asserts 503. In web mode the port is the **stoa-server** port (3270 default per `stoa-server/src/shared/constants.ts:8`) and the ctl router is `app.route('/ctl', healthRoutes)` (`app.ts:67`). The 503 check is structurally the same; only the port source changes. | **Tier 1**, but the `getMainE2EDebugState` call must be replaced — see Touch Point #6. |
| `workspace-quick-access.generated.spec.ts` | Uses `open-ide` / `open-file-manager` which trigger Electron IPC for desktop apps. | **Electron-only**. |

#### 1.6 Test-data temp helper

`testing/test-temp.ts:1-13` — exports `createTestTempDir(prefix)` that writes under `${process.cwd()}/.tmp/tests` (or `VIBECODING_TEST_TMPDIR`). **Reusable as-is** for web tests, including for the stoa-server state directory in `launchWebApp()`.

---

### 2. Server-Side Surface (confirmed: app + routes + WS + build outputs are all ready)

The prior `research/2026-06-13-playwright-browser-web-migration-minimum-path.md` documented that all server-side prerequisites are met. Verified independently against current source:

| Endpoint group | File | Mount path |
|---|---|---|
| Discovery | `stoa-server/src/routes/discovery.ts:18-41` (unauth by design — `auth.ts:23-30`) | `GET /api/v1/discovery` |
| Health | `stoa-server/src/routes/health.ts` | `GET /ctl/health` |
| Projects | `stoa-server/src/routes/projects.ts:77-131` | `GET /api/v1/bootstrap`, `POST /projects`, `DELETE /projects/:id`, `PUT /projects/:id/active` |
| Sessions | `stoa-server/src/routes/sessions.ts:77-324` | `POST /api/v1/sessions`, `PUT /sessions/:id/{active,archive,restore,title}`, `POST /sessions/:id/{restart,input,resize}`, `GET /sessions[?archive=archived]`, `GET /sessions/:id/{terminal-replay,evidence,context/full,context/slim}`, `DELETE /projects/:id/sidecar` |
| Settings | `stoa-server/src/routes/settings.ts` | `GET /api/v1/settings`, `PUT /settings/:key`, etc. |
| Sidebar | `stoa-server/src/routes/sidebar.ts:34` | `GET /api/v1/sidebar`, `PUT /sidebar` |
| Observability | `stoa-server/src/routes/observability.ts:72` | `GET /api/v1/observability/...` |
| Meta-sessions | `stoa-server/src/routes/meta-sessions.ts:104` | `GET /meta-sessions/...`, `POST /meta-sessions/:id/...` |
| **fs** | `stoa-server/src/routes/fs.ts:1-523` | `GET /api/v1/fs/dir`, `POST/DELETE /api/v1/fs/entry`, `POST /api/v1/fs/rename`, `POST /api/v1/fs/search` |
| **git** | `stoa-server/src/routes/git.ts:1-487` | `GET /api/v1/git/status`, `/branches`, `/log`, `POST /api/v1/git/{stage,unstage,commit}` |
| Webhooks | `stoa-server/src/routes/webhooks.ts:312` | `POST /events`, `POST /hooks/{claude-code,codex,opencode}`, `POST /memory-notifications` |
| Static | `stoa-server/src/routes/static.ts:12-35` | `GET /assets/*`, `GET *` (SPA fallback — already excludes `/api/`, `/ctl`, `/events`, `/memory-notifications`, `/hooks/`, `/ws`) |
| Webhook routes (legacy `app.route('/')`) | `stoa-server/src/app.ts:68` | `POST /events`, `POST /hooks/*`, `POST /memory-notifications` |

**WebSocket transport** (verified in `stoa-server/src/index.ts:240-254`): `attachWebSocketServer(server, ...)` + `routeConnection(req, conn, roleRouterHandlers)` + `invokeOnMessage(conn, raw)`. The role router (`stoa-server/src/ws/role-router.ts:1-394`) handles `role=web` and `role=runtime` separately. Browser will connect to `ws://localhost:3270/ws?token=stoa-dev-token&role=web`.

**Auth**: `stoa-server/src/middleware/auth.ts:34-42` accepts `Authorization: Bearer <token>`. Default token is `stoa-dev-token` (from `index.ts:59`).

**CLI flags** (from `index.ts:39-56`): `--port <n>` (default 3270 per `shared/constants.ts:8`), `--web` (serves SPA), `--lan` (LAN mode). The server can be spawned as `node stoa-server/dist/index.cjs --port 3271 --web` for a separate test port.

**Built web bundle** (verified on disk): `stoa-server/dist/web/index.html` (628 bytes, 2026-06-12 21:30) + 9 assets in `assets/`: `CascadiaMono-95CNhH_0.woff2`, `FileExplorer-D-NkC-Ac.js`, `FileExplorer-DrUJhoHv.css`, `JetBrainsMono_wght_-CVbsCYZG.woff2`, `SearchPanel-64UshPXU.js`, `SourceControlPanel-ObeVhp-u.js`, `index-44SETror.js` (1 MB main bundle), `index-BFRtOsnp.css`, `vscode-C_7wk1WI.svg`.

**Browsers already installed** (verified at `C:\Users\30280\AppData\Local\ms-playwright\`): `chromium-1208`, `chromium-1217`, `chromium-1223`, plus matching `chromium_headless_shell-*`. Playwright 1.59.1 (`npx --no-install playwright --version`). The Chromium binaries match the 1.59 Playwright build, so no `npx playwright install` step is required for the new web project.

**Vite web config** (`vite.web.config.ts:1-21`): `root: src/renderer`, `outDir: stoa-server/dist/web`, `define: { 'import.meta.env.VITE_USE_STOA_CLIENT': '"1"' }` (line 11-13) — bakes the StoaClient flag at build time. Shared renderer aliases/plugins are in `vite.renderer.shared.ts:1-22` (refactored from `electron.vite.config.ts`).

**Web bootstrap** (`src/renderer/bootstrap-web.ts:1-43`): reads `?token=` from `window.location.search`, calls `initStoaClientForStores(window.location.origin, token)`, constructs `StoaClientPreloadAdapter`, wraps `adapter.getBootstrapState` to call `client.flushBuffer()` once on first snapshot, calls `client.connectWs()` + `setRendererApi(adapter)`, assigns `window.stoa = adapter`. Throws `'Missing Stoa web token in URL query parameter "token"'` if absent. `main.ts:9-11` auto-invokes `bootstrapWebRenderer()` when `window.stoa` is undefined. Paired test: `src/renderer/bootstrap-web.test.ts:1-91`.

---

### 3. Exact File Touch Points for the Minimum Migration

The following files must be **added** or **modified** to enable the Tier-1 web tests. All paths are relative to `D:\Data\DEV\ultra_simple_panel\`.

#### 3.1 `playwright.config.ts` (MODIFY — multi-project layout)

Convert the current single-project config into a two-project config (Electron + web). The Electron project keeps the current testMatch. The web project adds `webServer:`, `use.baseURL`, and a narrowed `testMatch: ['e2e-web/**/*.test.ts']`. **Critical**: the current top-level `testMatch` (`e2e-playwright/**/*.test.ts`, `generated/playwright/**/*.spec.ts`) MUST be moved to the `electron` project, not left at root, otherwise the new `e2e-web/` tests get pulled into the Electron project (which has no `baseURL` and no `webServer`).

Touch points:
- `playwright.config.ts:1-19` — replace with multi-project layout.
- `tests/e2e-web/**/*.test.ts` — added by the new tests; will be picked up by the `web` project's `testMatch`.
- `tests/e2e-web/fixtures/web-app.ts` — new file (the `launchWebApp()` fixture).
- `tests/e2e-web/helpers/web-ui-actions.ts` — new file (`createProjectViaApi`/`createSessionViaApi`).

Recommended `webServer` block:
```ts
webServer: {
  command: 'node stoa-server/dist/index.cjs --port 3271 --web',
  port: 3271,
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
  env: { STOA_AUTH_TOKEN: 'stoa-dev-token', PORT: '3271' },
}
```
- The server must be **built first** (`stoa-server/dist/index.cjs` exists per `stoa-server/dist/index.cjs` 141 KB, built 2026-06-12 20:18). `npm run test:e2e:web` (new script) runs `npm run build` (which produces the cjs) then `playwright test --project=web`.
- Port 3271 chosen as a deterministic non-default port to avoid colliding with a developer's local stoa-server.
- `reuseExistingServer: !process.env.CI` lets local devs avoid restarting the server across `playwright test` invocations.

#### 3.2 `package.json` (MODIFY — add web test scripts)

Add scripts. Touch points: `package.json:10-39` (scripts block).

Recommended additions:
- `"build:web:test"`: `"vite build --config vite.web.config.ts"` (alias to `build:web` — actually NOT needed; just reference `build:web` directly)
- `"test:e2e:web"`: `"npm run build && playwright test --project=web"`
- `"test:e2e:electron"`: `"npm run build && playwright test --project=electron"` (explicit, for symmetry)
- `"test:e2e:all"`: `"npm run build && playwright test"` (no `--project` flag runs both — preserves current `test:e2e:35` behavior and adds web)
- `"playwright:install"`: `"playwright install chromium"` (idempotent; the browsers are already installed on this machine, so this is a no-op in dev but required in CI)

#### 3.3 `tests/e2e-web/fixtures/web-app.ts` (NEW)

Mirrors `tests/e2e-playwright/fixtures/electron-app.ts:110-162` but spawns the stoa-server as a child process (or relies on `webServer:` auto-spawn from the config) and returns a Playwright `page` opened at `http://localhost:3271/?token=stoa-dev-token`. Required exports:
- `launchWebApp(options?: { port?: number; token?: string }): Promise<{ page: Page; baseUrl: string; token: string; stateDir: string; close(): Promise<void> }>`
- Inside: poll `GET /api/v1/discovery` (unauth) until 200; then `page.goto(baseUrl + '?token=' + token)`; then `await expect(page.getByTestId('app-viewport')).toBeVisible({ timeout: 15_000 })` (matches the Electron fixture's expectation pattern at line 132).
- `cleanupStateDir(stateDir)` — copy from `tests/e2e-playwright/fixtures/electron-app.ts:164-177` verbatim; both `cleanupStateDir` are pure Node.

#### 3.4 `tests/e2e-web/helpers/web-ui-actions.ts` (NEW)

Replaces `tests/e2e-playwright/helpers/ui-actions.ts:25-99` (`createProject`/`createSession`) with HTTP-based equivalents:
- `createProjectViaApi(baseUrl, token, { name, path }): Promise<{ id: string; name: string }>` — `POST /api/v1/projects` with `{ name, path, defaultSessionType }` using `Authorization: Bearer <token>`. Returns the created `ProjectSummary` (response shape: `{ ok: true, data: ProjectSummary, meta: ... }` per `projects.ts:102`).
- `createSessionViaApi(baseUrl, token, { projectId, type }): Promise<{ id: string; title: string }>` — `POST /api/v1/sessions` with `{ projectId, type }`. Returns `{ ok: true, data: SessionSummary, ... }` per `sessions.ts:151`. Caveat: for `type: 'shell'` the server will create the session row, but `runtimeBridge` calls will 503 until a runtime provider connects. For Tier-2 sidebar tests that don't touch terminal, `type: 'shell'` is fine.
- `createSidebarTestProject()` — **re-import from `tests/e2e-playwright/fixtures/sidebar-test-project.ts:34-73`** as-is. No copy-paste; just `import { createSidebarTestProject } from '../../e2e-playwright/fixtures/sidebar-test-project'`.

#### 3.5 Initial tests to migrate (Tier 1, 17 tests)

| New web test file | Source Electron test | Tests | Migration deltas |
|-------------------|----------------------|-------|------------------|
| `tests/e2e-web/smoke.test.ts` | `tests/e2e-playwright/app-smoke.test.ts:1-68` | 3 | Replace `launchElectronApp` → `launchWebApp`. **Drop** `await expect(app.page.locator('.terminal-empty-state')).toContainText('No session to display')` (the terminal surface is empty in web mode because no session exists — but the message wording may differ; verify against the live renderer before porting, or assert on a softer condition like `data-testid="command-panel"` visibility). |
| `tests/e2e-web/settings.test.ts` | `tests/e2e-playwright/settings-modal-ui.test.ts:1-222` | 13 | Straight port — only `data-settings-*` / `data-testid="modal-*"` selectors. The `openCommandSurfaceNewProject` helper at `settings-modal-ui.test.ts:4-8` clicks `command-panel` then `workspace.new-project` — verify the new-project button is reachable in web mode (no Electron dialog). |
| `tests/e2e-web/stoactl.test.ts` | `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts:1-57` | 1 | **Cannot directly port** because it calls `getMainE2EDebugState(app.electronApp)` (line 36-37) to read the webhook port. In web mode, the **stoa-server** port (3270/3271) **is** the ctl health port. Replace `debugState?.webhookPort` with `options.port` (the stoa-server port). The `POST /api/v1/projects` + `POST /api/v1/sessions` can be done via the new `createProjectViaApi`/`createSessionViaApi` helpers. The final `fetch('http://127.0.0.1:${port}/ctl/health')` returns 503 when stoa-ctl is disabled. **Also**: this generated spec should be regenerated by `npm run test:generate` once the generator template is updated to emit web-shaped code; until then, the hand-written web port can live in `tests/e2e-web/stoactl.test.ts` and the generator template update is **out of scope for the minimum path** (the prior audit flagged this and it remains true). |

After Tier 1 lands, follow-up Tiers add more web tests but the harness (config, scripts, fixtures) is reusable as-is. Tier 2 (`sidebar`, `file-explorer`, `search`, `git`) adds `createSessionViaApi()` (already in `web-ui-actions.ts` for Tier 1 stoactl) and reuses `createSidebarTestProject` + `sidebar-actions.ts`. Tier 3 (`session-events`, `session-restore`, `telemetry`) reuses `postWebhookEvent()`/`postClaudeHookEvent()` from `tests/e2e-playwright/fixtures/electron-app.ts:264-308` (they already use `fetch` against `http://127.0.0.1:port`, just point at the stoa-server port).

---

### 4. Key Risks and Unknowns (consolidated from existing research + new findings)

- [!] **Generator template** (`testing/generators/generate-playwright.ts:1-381`) still emits Electron-only code (imports `launchElectronApp`, calls `electronApp.evaluate`, uses `createProject` with `queueNextFolderPick`). Regenerating via `npm run test:generate` will **re-overwrite any hand-edited generated specs** with Electron code. Mitigation: keep Tier 1 web tests under `tests/e2e-web/` (new path) and do NOT regenerate until the generator is web-aware. The generator update is **out of scope** for the minimum path.
- [!] **The `webServer:` `port: 3271` is a fixed port** — concurrent Playwright workers on the same machine will conflict. The current `workers: 1` (line 13) prevents this; do not raise workers without first enabling per-worker port allocation.
- [!] **`createProject()` in the Electron UI** opens a native folder-picker dialog (mocked by `queueNextFolderPick`). The web UI uses `POST /api/v1/projects` directly. **The web test for "new project button" should NOT use the dialog flow** — it should test the new-project modal fields and submit, OR skip the dialog flow and assert the `POST /api/v1/projects` API contract instead. (TBD: confirm with the renderer whether the web app shows a "Browse" button that calls a browser file picker; if so, Playwright's `setInputFiles` will be needed.)
- [!] **Runtime bridge**: `stoa-server/src/index.ts:96` uses `createLiveRuntimeBridge(runtimeBridgeHandler)`, but `runtime-bridge.ts:54-80` still exports the stub. Sessions of `type: 'shell'` will succeed in `POST /api/v1/sessions` (row created) but `restart`/`input`/`resize`/`terminal-replay` will 503. For Tier 1 this is a non-issue. For Tier 2 the sidebar tests that don't need terminal are fine. For Tier 3 a real runtime provider must connect via WS.
- [!] **`main.ts:9-11`** auto-invokes `bootstrapWebRenderer()` if `window.stoa` is undefined. The web fixture MUST navigate with `?token=...` in the URL, or the bootstrap throws (`bootstrap-web.ts:15-20`).
- [!] **`STOA_AUTH_TOKEN` env var**: the server reads it from env (`index.ts:59`). The `webServer:` `env:` block in Playwright must set it (recommended value: `'stoa-dev-token'`). The `launchWebApp` fixture must pass the same token to the browser via the URL.
- [?] **`isStoaClientMode()` detection**: the `vite.web.config.ts:12` `define` block sets `import.meta.env.VITE_USE_STOA_CLIENT` to `'1'` at build time. The renderer's dual-pathed stores (`useFileOperations.ts:15-58`, `useFileTree.ts:49-65`, `stores/git.ts`, `stores/search.ts`, `stores/update.ts`) all use this flag to switch to the HTTP path. The flag is bake-in, not runtime. **As long as the web bundle is built with the flag, the dual paths work.** This was a risk in the prior audit; it has been **resolved** by the `define` block.
- [?] **Token in URL** (`bootstrap-web.ts:12-20`): the token is visible in browser history and to any extension. Acceptable for LAN/loopback testing; the prior research (`research/2026-06-12-stoa-server-browser-ui-recommendation.md:86-92`) treats it as a capability URL. No action required for the minimum path.
- [?] **No SPA router** (`src/renderer/index.html:1-17`): deep links rely on query handling in the renderer. The static fallback at `stoa-server/src/routes/static.ts:20-35` returns `index.html` for any non-API/ctl/hooks/ws path. Verified.
- [?] **Playwright `webServer` command** expects a single executable that stays running. `node stoa-server/dist/index.cjs --port 3271 --web` matches this. The server's `start()` function in `index.ts:65-284` is async and resolves after the listener binds, so the server prints "Stoa Server listening on port 3271" before Playwright polls. Good.

---

### 5. Migration Order (Minimum Path)

#### Phase 1 — Smoke + Settings + stoactl (17 tests)

1. Create `tests/e2e-web/fixtures/web-app.ts` with `launchWebApp()`.
2. Create `tests/e2e-web/helpers/web-ui-actions.ts` with `createProjectViaApi()` + `createSessionViaApi()`.
3. Create `tests/e2e-web/smoke.test.ts` (3 tests ported from `app-smoke.test.ts`).
4. Create `tests/e2e-web/settings.test.ts` (13 tests ported from `settings-modal-ui.test.ts`).
5. Create `tests/e2e-web/stoactl.test.ts` (1 test ported from generated spec, but with port source replaced).
6. Modify `playwright.config.ts:1-19` to multi-project (`electron` + `web`).
7. Modify `package.json:10-39` to add `test:e2e:web`, `test:e2e:electron`, `test:e2e:all`, `playwright:install`.
8. Run `npx playwright test --project=web` and verify all 17 pass.

#### Phase 2 — Sidebar + File Explorer + Search + Git (35 tests)

9. Reuse `createSidebarTestProject()` + `sidebar-actions.ts` as-is.
10. Add `tests/e2e-web/sidebar.test.ts`, `file-explorer.test.ts`, `search.test.ts`, `git.test.ts`.

#### Phase 3 — Session Events (9 tests)

11. Reuse `postWebhookEvent` + `postClaudeHookEvent` from `electron-app.ts:264-308`, point port at stoa-server.
12. Add `tests/e2e-web/session-events.test.ts`, `session-restore.test.ts`, `telemetry.test.ts`.

#### Out of Scope (Electron-only)

- `terminal-journey.test.ts` (5) — needs runtime provider
- `recovery-journey.test.ts` (2) — needs Electron app lifecycle
- `debug-devtools.test.ts` (4) — needs main-process debug global
- `workspace-quick-access.generated.spec.ts` (1) — needs desktop IPC
- Generator template rewrite — separate workstream

---

### 6. Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Playwright config has no `projects:` / `webServer:` / `baseURL` | `playwright.config.ts` | `playwright.config.ts:1-19` |
| `test:e2e` builds and runs Playwright; no web project | `package.json:35` | `package.json:35` |
| No `test:e2e:web` / `playwright:install` scripts | `package.json:10-39` | scripts block |
| 11 hand-written Playwright tests, all Electron | `tests/e2e-playwright/*.test.ts` | 11 files glob-matched |
| 4 generated Playwright specs, all Electron | `tests/generated/playwright/*.generated.spec.ts` | 4 files |
| 3 fixture/helper files | `tests/e2e-playwright/fixtures/`, `tests/e2e-playwright/helpers/` | 3 files |
| `createProject()` uses `queueNextFolderPick` (Electron dialog mock) | `tests/e2e-playwright/helpers/ui-actions.ts:25-42` | `ui-actions.ts:25-42` |
| `createSession()` uses radial-menu long-press | `tests/e2e-playwright/helpers/ui-actions.ts:80-99` | `ui-actions.ts:80-99` |
| `sidebar-actions.ts` has no Electron imports | `tests/e2e-playwright/helpers/sidebar-actions.ts:1-257` | full file |
| `sidebar-test-project.ts` is pure Node.js + git | `tests/e2e-playwright/fixtures/sidebar-test-project.ts:1-73` | full file |
| `postWebhookEvent` / `postClaudeHookEvent` are HTTP-based | `tests/e2e-playwright/fixtures/electron-app.ts:264-308` | `electron-app.ts:264-308` |
| `__VIBECODING_MAIN_E2E__` debug API is Electron-only | `tests/e2e-playwright/fixtures/electron-app.ts:30-37, 179-262` | `electron-app.ts:30-37, 179-262` |
| 3 file-explorer tests skipped for Windows path bugs | `tests/e2e-playwright/file-explorer.test.ts:102, 145, 174` | `file-explorer.test.ts:102, 145, 174` |
| All 13 git-panel tests skipped for missing ripgrep | `tests/e2e-playwright/git-panel.test.ts:22` | `git-panel.test.ts:22` |
| `bootstrap-web.ts` reads `?token=` and bootstraps StoaClient | `src/renderer/bootstrap-web.ts:11-43` | `bootstrap-web.ts:11-43` |
| `main.ts` auto-invokes `bootstrapWebRenderer()` if `!window.stoa` | `src/renderer/main.ts:9-11` | `main.ts:9-11` |
| `vite.web.config.ts` sets `VITE_USE_STOA_CLIENT='1'` | `vite.web.config.ts:11-13` | `vite.web.config.ts:11-13` |
| `vite.renderer.shared.ts` deduplicates renderer config | `vite.renderer.shared.ts:1-22` | full file |
| `electron.vite.config.ts` uses shared helpers | `electron.vite.config.ts:1-50` | full file |
| Server `fs` routes complete | `stoa-server/src/routes/fs.ts:1-523` | full file |
| Server `git` routes complete | `stoa-server/src/routes/git.ts:1-487` | full file |
| Server static route mounted LAST (priority for API/ctl/hooks/ws) | `stoa-server/src/app.ts:80-84` | `app.ts:80-84` |
| Server WS transport implements RFC 6455 | `stoa-server/src/ws/transport.ts:1-100+` | full file |
| Server WS role router handles `role=web` | `stoa-server/src/ws/role-router.ts:1-394` | full file |
| Server entry wires WS upgrade + role routing | `stoa-server/src/index.ts:240-254` | `index.ts:240-254` |
| Server CLI: `--port` (default 3270), `--web`, `--lan` | `stoa-server/src/index.ts:39-56` | `index.ts:39-56` |
| Auth: `Authorization: Bearer <token>`; default `stoa-dev-token` | `stoa-server/src/middleware/auth.ts:19-59`; `index.ts:59` | `auth.ts:19-59`; `index.ts:59` |
| Web SPA bundle is on disk | `stoa-server/dist/web/index.html` + 9 assets | `index.html` 628 bytes, 9 files |
| Built web bundle: 1MB main + 5 component chunks + 2 fonts + 1 css + 1 svg | `stoa-server/dist/web/assets/` | `assets/` listing |
| `stoa-server/dist/index.cjs` is built (141 KB) | `stoa-server/dist/index.cjs` | 141 KB, 2026-06-12 |
| `test-temp.ts` is reusable (no Electron, no Playwright deps) | `testing/test-temp.ts:1-13` | `test-temp.ts:1-13` |
| `vite.web.config.ts` outputs to `stoa-server/dist/web/` | `vite.web.config.ts:14-19` | `vite.web.config.ts:14-19` |
| `webClientRoot` resolver finds `dist/web/index.html` | `stoa-server/src/shared/web-client-path.ts:1-21` | full file |
| `webServer` example: `node stoa-server/dist/index.cjs --port 3271 --web` | `stoa-server/src/index.ts:39-56` | `index.ts:39-56` |
| Generator entry writes 4 Electron-only specs | `testing/generators/write-generated-playwright.ts:1-37` | `write-generated-playwright.ts:1-37` |
| Playwright 1.59.1 installed | `npx --no-install playwright --version` | output: `Version 1.59.1` |
| Chromium 1208/1217/1223 + headless_shell installed | `C:\Users\30280\AppData\Local\ms-playwright\` | directory listing |
| `stoactl-lifecycle.generated.spec.ts` reads `webhookPort` via Electron debug | `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts:36-38` | `stoactl-lifecycle.generated.spec.ts:36-38` |

---

### 7. Recommended Next Steps (out of scope for this report)

1. Implement `tests/e2e-web/fixtures/web-app.ts` and `tests/e2e-web/helpers/web-ui-actions.ts`.
2. Update `playwright.config.ts` to multi-project.
3. Add `test:e2e:web` / `test:e2e:all` / `playwright:install` scripts to `package.json`.
4. Port the 17 Tier-1 tests.
5. Run `npx playwright test --project=web` and verify.
6. (Phase 2) Reuse `createSidebarTestProject` + `sidebar-actions.ts` for 35 more tests.
7. (Phase 3) Reuse `postWebhookEvent`/`postClaudeHookEvent` for 9 more tests.
8. (Separate workstream) Update the generator template to emit web-shaped specs.

---

## Context Handoff: Playwright E2E Surface Audit & Minimum Browser-Web Migration Plan for stoa-server

Start here: `research/2026-06-13-playwright-e2e-surface-audit-and-minimum-browser-web-migration-plan.md`

Context only. Use the saved report as the source of truth.
