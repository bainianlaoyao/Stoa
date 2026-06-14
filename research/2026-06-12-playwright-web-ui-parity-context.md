---
date: 2026-06-12
topic: Playwright Config, Deterministic Generation & Web UI Parity Testing
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Playwright Configuration, Deterministic Generation & Web UI Parity Tests

### Why This Was Gathered
To understand how Playwright is currently configured for Electron-only E2E testing, how deterministic test generation works from behavior/topology/journey assets, and what infrastructure changes would be needed to add browser-based web UI parity tests against the Stoa Server.

### Summary
Playwright is configured exclusively for Electron via `_electron.launch()`. All E2E tests run through `tests/e2e-playwright/` using a shared fixture that launches the real Electron binary with a test state directory. Deterministic generation uses a `testing/` layer (behaviors → topologies → journeys) that feeds a generator (`testing/generators/generate-playwright.ts`) to emit spec files into `tests/generated/playwright/`. The Stoa Server (`stoa-server/`) already exists as a workspace package with Hono REST+WS routes, a `StoaClient`+`StoaClientPreloadAdapter` pair in the renderer, and a `--web` flag for static file serving — but there are **no browser-targeted Playwright tests yet**. Adding web UI parity tests would require a new Playwright project config (browser-based, pointing at the SR HTTP server), a `webServer` config or manual server startup, and new fixtures that replace Electron-specific APIs with standard Playwright browser page operations.

---

### Key Findings

#### 1. Current Playwright Config — Electron Only

- **Config file**: `playwright.config.ts:1-19` — single unnamed project, no browser projects.
- **Test match**: `e2e-playwright/**/*.test.ts` + `generated/playwright/**/*.spec.ts`.
- **Workers**: forced to 1 (`fullyParallel: false`), appropriate for stateful Electron tests.
- **No `webServer` config** — Electron launches directly via `_electron.launch()`.
- **No browser projects** — all tests go through the Electron fixture.

**Electron fixture** (`tests/e2e-playwright/fixtures/electron-app.ts:110-162`):
- Launches `out/main/index.cjs` with `VIBECODING_E2E=1` and a temp state dir.
- Uses `electron.firstWindow()` + waits for `app-viewport` and `command-panel` test IDs.
- Provides `close()`, `kill()`, `killAndRelaunch()`, `relaunch()`.
- Exposes `getMainE2EDebugState()`, `readTerminalBuffer()`, `postWebhookEvent()`, `postClaudeHookEvent()` via `electronApp.evaluate()` — these call into `__VIBECODING_MAIN_E2E__` debug API on the main process.
- Single-worker, process-kill fallback with SIGKILL for cleanup.

#### 2. Deterministic Test Generation Pipeline

The generation pipeline is: **Behavior specs** → **Topology specs** → **Journey specs** → **Generator** → **Written spec files**.

- **Behaviors** (`testing/behavior/*.ts`): Define coverage budgets, observation layers, interruptions. Example: `session.behavior.ts`.
- **Topologies** (`testing/topology/*.ts`): Define stable `data-testid` keys. Example: `archive.topology.ts` has `root`, `restoreButton`, `sessionRow`.
- **Journeys** (`testing/journeys/*.ts`): Map behaviors to executable paths. Example: `session-restore.journey.ts`.
- **Generator** (`testing/generators/generate-playwright.ts`): Has 4 skeleton generators:
  - `generatePlaywrightSkeleton()` — generic session restore journey.
  - `generateClaudeLifecyclePlaywrightSkeleton()` — full Claude telemetry lifecycle (ready→running→blocked→complete→failure).
  - `generateStoactlLifecyclePlaywrightSkeleton()` — stoa-ctl toggle + health check.
  - `generateWorkspaceQuickAccessPlaywrightSkeleton()` — workspace quick actions + IPC verification.
- **Writer** (`testing/generators/write-generated-playwright.ts`): Reads behavior/topology/journey imports, calls generators, writes to `tests/generated/playwright/*.generated.spec.ts`. Run via `npm run test:generate` (`tsx testing/generators/write-generated-playwright.ts`).
- **Behavior coverage** (`testing/generators/behavior-coverage.ts`): Classifies each behavior as Declared → Reachable → Verified → Hardened based on journey coverage, observation layers, and interruption coverage. Run via `npm run test:behavior-coverage`.

All generated specs import from `../../e2e-playwright/fixtures/electron-app` and `../../e2e-playwright/helpers/ui-actions` — they are **Electron-only** by design.

#### 3. Stoa Server — Current State

- **Package**: `stoa-server/` is a pnpm workspace package (declared in `pnpm-workspace.yaml`).
- **Stack**: Hono v4 + Drizzle ORM + better-sqlite3 + Zod + WebSocket hub.
- **Entry**: `stoa-server/src/index.ts` — boots with `--port`, `--web`, `--lan` flags.
- **Static serving**: `stoa-server/src/routes/static.ts` serves `dist/web/` for the Vue SPA when `--web` flag is used.
- **Full REST API**: `/api/v1/bootstrap`, `/api/v1/projects`, `/api/v1/sessions`, `/api/v1/settings`, `/api/v1/observability/*`, `/api/v1/meta-sessions/*`, `/api/v1/sidebar`, `/api/v1/fs/*`, `/api/v1/git/*`, `/ctl/*` (control routes), `/hooks/*` (webhook routes).
- **WebSocket**: `/ws?token=xxx` with subscription-based event delivery.
- **Runtime bridge**: `/ws?token=xxx&role=runtime` for Electron to connect as PTY provider.
- **E2E test**: `stoa-server/e2e-test.mjs` — a standalone Node script that spawns the server and runs 16 HTTP-based checks against the REST API. Not Playwright-based.
- **Auth**: Bearer token (`Authorization: Bearer <token>`) on all endpoints except `/api/v1/discovery`.

#### 4. StoaClient — Renderer HTTP+WS Client

- **StoaClient** (`src/renderer/lib/stoa-client.ts`): Generic HTTP+WS client with `get/post/put/delete/subscribe`.
- **StoaClientPreloadAdapter** (`src/renderer/lib/stoa-client-preload-adapter.ts`): Implements the full `RendererApi` interface using `StoaClient`. Desktop-only methods (window management, dialogs, updates) return stubs/warnings.
- **Already tested**: `src/renderer/lib/stoa-client.test.ts` (mocked fetch/WebSocket), `src/renderer/lib/stoa-client-preload-adapter.test.ts`.
- This adapter is the bridge that makes the renderer work identically via HTTP/WS instead of Electron IPC.

#### 5. Vitest Exclusion

`vitest.config.ts:34` explicitly excludes `**/stoa-server/**` from the root Vitest run. `stoa-server` has its own `vitest run` via its own `package.json` script.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Playwright config is Electron-only, workers=1, no browser projects | `playwright.config.ts` | `playwright.config.ts:1-19` |
| Electron fixture launches `out/main/index.cjs` with test env | `electron-app.ts` | `tests/e2e-playwright/fixtures/electron-app.ts:110-162` |
| Main E2E debug API accessed via `electronApp.evaluate()` | `electron-app.ts` | `tests/e2e-playwright/fixtures/electron-app.ts:214-221` |
| 4 Playwright skeleton generators for different journeys | `generate-playwright.ts` | `testing/generators/generate-playwright.ts:9-380` |
| Writer script produces 4 generated spec files | `write-generated-playwright.ts` | `testing/generators/write-generated-playwright.ts:1-37` |
| Behavior coverage maturity: Declared→Reachable→Verified→Hardened | `behavior-coverage.ts` | `testing/generators/behavior-coverage.ts:32-51` |
| npm scripts: test:generate, test:e2e, test:behavior-coverage | `package.json` | `package.json:33-36` |
| Stoa Server entry point with --web, --port, --lan flags | `index.ts` | `stoa-server/src/index.ts:30-47` |
| Static file serving for Vue SPA from dist/web/ | `static.ts` | `stoa-server/src/routes/static.ts:1-17` |
| StoaClientPreloadAdapter implements full RendererApi via HTTP | `stoa-client-preload-adapter.ts` | `src/renderer/lib/stoa-client-preload-adapter.ts:64-650` |
| StoaClient HTTP+WS client with subscribe/unsubscribe | `stoa-client.ts` | `src/renderer/lib/stoa-client.ts:59-61` |
| Stoa Server e2e-test.mjs: 16 HTTP-based checks | `e2e-test.mjs` | `stoa-server/e2e-test.mjs:67-228` |
| StoaServerSpawner manages SR lifecycle from Electron | `stoa-server-spawner.ts` | `src/main/stoa-server-spawner.ts:157-376` |
| StoaRuntimeClient connects Electron as PTY provider via WS | `stoa-runtime-client.ts` | `src/main/stoa-runtime-client.ts:103-447` |
| Server/Client separation plan with 6 phases | plan doc | `docs/superpowers/plans/2026-06-12-stoa-server-client-separation.md` |
| Vitest excludes stoa-server/ from root run | `vitest.config.ts` | `vitest.config.ts:34` |
| pnpm-workspace includes stoa-server + stoa-shared | workspace | `pnpm-workspace.yaml:1-3` |
| Existing Playwright Electron research from April 2026 | prior research | `research/2026-04-21-playwright-electron-testing.md` |

---

### Risks / Unknowns

- [!] **No browser Playwright project exists yet** — Adding one requires new config, fixtures, and potentially new test IDs that work in both Electron and browser contexts.
- [!] **Terminal testing gap in browser** — In Electron, terminal buffer is read via `electronApp.evaluate()` calling the main process debug API. In browser, the renderer must expose terminal data differently (WS subscription or page.evaluate accessing xterm.js buffer).
- [!] **Auth token required for all API access** — Browser tests need to know the server auth token. Either hardcode a test token, inject it via env, or have the fixture read it from the server's token file.
- [!] **Runtime bridge dependency** — PTY operations (launch, input, resize, kill) require an Electron runtime provider connected to SR. Web-only tests cannot exercise PTY features without a mock runtime or a real Electron backend connected.
- [!] **Generated specs are Electron-specific** — All 4 generators import `launchElectronApp` from `../../e2e-playwright/fixtures/electron-app`. Browser parity tests would need a parallel set of generators or a parameterized generator.
- [?] **Web build status** — `dist/web/` may not exist yet. The `--web` flag checks `isWebClientAvailable()` but the web build step (building the Vue SPA for browser hosting) may not be integrated into the build pipeline.
- [?] **SPA routing** — `static.ts` has an SPA fallback, but the Vue router currently assumes `file://` protocol in Electron. Adaptation for `http://` routing may be incomplete.
- [!] **Screenshot baselines** — Existing terminal screenshot test (`terminal-journey.test.ts-snapshots/terminal-viewport-win32.png`) is platform-specific. Browser screenshots will differ from Electron screenshots even on the same OS due to different Chromium versions and rendering contexts.

---

### What Would Need to Change for Web UI Parity Tests

1. **New Playwright project** in `playwright.config.ts`:
   ```ts
   projects: [
     { name: 'electron', testDir: './tests', testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts'] },
     { name: 'web', testDir: './tests', testMatch: ['e2e-web/**/*.test.ts'] }
   ]
   ```
   The web project would use `use: { baseURL: 'http://localhost:PORT' }` and a `webServer` config.

2. **Web fixture** (`tests/e2e-web/fixtures/web-app.ts`):
   - Starts `stoa-server` as a child process (or uses Playwright `webServer` config).
   - Opens browser to `http://localhost:PORT`.
   - Auth token injected via URL query, cookie, or test fixture.
   - Uses standard Playwright `page` instead of `electronApp`.
   - No access to `electronApp.evaluate()` — must use HTTP API or WS for state inspection.

3. **Web server startup** in test harness:
   - Either `webServer: { command: 'node stoa-server/dist/index.cjs --port 3270 --web', port: 3270 }` in Playwright config.
   - Or manual spawn in fixture `beforeAll()`.

4. **Terminal data observation** in browser:
   - Subscribe to `session:terminal-data` WS events from the test page.
   - Or use `page.evaluate()` to read xterm.js buffer if the terminal component is rendered.
   - Cannot use the Electron main-process debug API.

5. **Behavior/topology parity**:
   - Existing topologies (`data-testid` values) should work in browser if the same Vue components are rendered.
   - New behavior specs for "web-only" or "web-parity" scenarios.
   - Generator would need a browser skeleton variant (replacing `launchElectronApp` with `page.goto()`).

6. **npm scripts**:
   ```json
   "test:e2e:web": "stoa-server/build && playwright test --project=web",
   "test:e2e:all": "npm run test:e2e && npm run test:e2e:web"
   ```

7. **Runtime bridge mock** (for PTY-less tests):
   - A stub runtime provider that accepts `runtime:*` commands via WS but doesn't actually spawn PTY processes.
   - Or restrict web tests to data-management flows (project/session CRUD, settings, observability) that don't require PTY.

---

## Context Handoff: Playwright Config, Deterministic Generation & Web UI Parity

Start here: `research/2026-06-12-playwright-web-ui-parity-context.md`

Context only. Use the saved report as the source of truth.
