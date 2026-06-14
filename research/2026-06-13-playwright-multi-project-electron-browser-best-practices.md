---
date: 2026-06-13
topic: Playwright multi-project setups mixing Electron and browser tests — isolation, fixtures, shared webServer
status: completed
mode: context-gathering
sources: 15
---

# Context Report: Playwright Multi-Project Electron + Browser Best Practices

## Why This Was Gathered

The repo at `D:\Data\DEV\ultra_simple_panel` has Playwright Electron journeys and is migrating to also run browser/web journeys against the Stoa server. We need to decide whether to share a `webServer` block, fan out per-project servers, or use fixtures — and understand isolation, state, and port conflicts.

## Summary

Playwright's `projects` array is the standard vehicle for mixing Electron and browser targets. A **top-level `webServer` is shared across all projects by default** — this causes two failure modes when mixing Electron + browser: (1) the web server starts even when only Electron tests run, wasting time; (2) port conflicts arise in parallel workers. Per-project `webServer` was implemented in May 2026 (PR #40869) but **reverted in June 2026** (PR #41167) due to UI-mode and baseURL wiring issues, so it is not available yet in v1.57. The recommended pattern for this repo is: **`projects` array + project dependencies for setup**, **fixture-driven server launch for browser tests**, and **explicit isolation via env vars and per-worker ports**. The Electron `_electron.launch()` API is entirely independent of `webServer` config — they do not interfere.

## Current Repo State

| Finding | Source | Location |
|---------|--------|----------|
| Config has no `webServer`, no `projects`, no `globalSetup` | `playwright.config.ts` | `D:\Data\DEV\ultra_simple_panel\playwright.config.ts:1-19` |
| `testMatch` covers both Electron and generated spec files | `playwright.config.ts:5` | `D:\Data\DEV\ultra_simple_panel\playwright.config.ts:5` |
| `workers: 1`, `fullyParallel: false` (serial Electron) | `playwright.config.ts:12-13` | `D:\Data\DEV\ultra_simple_panel\playwright.config.ts:12-13` |
| `launchElectronApp()` fixture sets `VIBECODING_STATE_DIR` per invocation | `electron-app.ts:111-119` | `D:\Data\DEV\ultra_simple_panel\tests\e2e-playwright\fixtures\electron-app.ts` |
| Generated specs use `launchElectronApp()` from same fixture | `session-restore.generated.spec.ts:20` | `D:\Data\DEV\ultra_simple_panel\tests\generated\playwright\session-restore.generated.spec.ts` |
| `stoactl-lifecycle.generated.spec.ts` calls `fetch()` to `127.0.0.1:${webhookPort}` | `stoactl-lifecycle.generated.spec.ts:47` | `D:\Data\DEV\ultra_simple_panel\tests\generated\playwright\stoactl-lifecycle.generated.spec.ts` |
| Stoa server port is read from `debugState.webhookPort` (runtime-injected) | `stoactl-lifecycle.generated.spec.ts:37` | `D:\Data\DEV\ultra_simple_panel\tests\generated\playwright\stoactl-lifecycle.generated.spec.ts` |

**Current architecture:**

- Single `playwright.config.ts` with no `webServer` field — the Stoa HTTP server is **embedded inside the Electron app** (the Electron main process starts it), not launched separately via Playwright config.
- `workers: 1` and `fullyParallel: false` sidestep port/state conflicts entirely for now.
- Browser/web journeys are not yet written — the migration question is precisely whether to add a browser project that points at the Stoa server.
- `VIBECODING_STATE_DIR` is the per-test isolation mechanism already in use (`electron-app.ts:117`).

## Vendor Recommendation

### `projects` array

Source: [Playwright docs — Projects](https://playwright.dev/docs/test-projects)

> A project is a logical group of tests running with the same configuration. We use projects so we can run tests on different browsers and devices.

Projects can parametrize by environment (`baseURL`), timeout, retries, and test filter. A project for Electron and a separate project for browser is the standard structure.

### `webServer` top-level and array form

Source: [Playwright docs — Web server](https://playwright.dev/docs/test-webserver)

> Use the `webServer` property in your Playwright config to launch a development web server during the tests.

`webServer` accepts a single object or an **array of objects** for multiple servers. All top-level `webServer` entries launch before any project runs. **There is no per-project `webServer` in the stable release as of v1.57.**

### Per-project `webServer`: shipped then reverted

Source: [PR #40869 (May 2026)](https://github.com/microsoft/playwright/pull/40869) + [PR #41167 (Jun 2026)](https://github.com/microsoft/playwright/pull/41167)

A per-project `webServer` was added in May 2026 (merged), enabling each project to declare its own server launched only when that project is selected. Maintainer @Skn0tt reverted it in June 2026 citing:

1. In **UI mode and VS Code extension**, the project filter is not applied to server setup, so all per-project servers start anyway — defeating the purpose.
2. **baseURL is silently undefined** for port-only per-project servers (no error, just broken `page.goto()`).
3. **Sharding starts and tears down every selected project's server on every shard**, even shards with no tests for that project.
4. **globalSetup cannot see a project's webServer** — it lives only on the internal config.

**Implication for this repo**: Do not plan around per-project `webServer`. Use fixtures instead.

### `globalSetup` vs project dependencies

Source: [Playwright docs — Global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown)

| Feature | Project Dependencies (recommended) | `globalSetup` (config option) |
|---------|--------------------------------------|-------------------------------|
| Runs before all tests | Yes | Yes |
| HTML report visibility | Yes (separate project) | No |
| Trace recording | Yes | No |
| Playwright fixtures | Yes | No |
| Browser management | Via browser fixture | Manual via `browserType.launch()` |
| Config options (headless, testIdAttribute) | Auto-applied | Ignored |

**Recommendation from Playwright**: use project dependencies (`testMatch` + `dependencies` + `teardown`) over `globalSetup` for setup that needs traces, fixtures, or visibility in reports.

## Community Patterns

### Pattern 1: Issue #21701 — Electron + browser with different baseUrls

Source: [GitHub Issue #21701](https://github.com/microsoft/playwright/issues/21701)

A developer asked how to run the same test suite against both an Electron app (with embedded server) and a browser pointing at a dev server (Angular via `ng serve`). The recommended answer:

- Use `projects` with different `baseURL` values.
- Use **project dependencies** to run a setup project first.
- Override the **`page` fixture** — leave it as-is for browser tests, swap to `electronApp.firstWindow()` for Electron tests.

### Pattern 2: Simon Willison — Electron-only Playwright setup

Source: [Simon Willison TIL](https://til.simonwillison.net/electron/testing-electron-playwright)

Electron-only tests use `_electron.launch()` directly in test files with no `webServer` config at all. The Electron app is the server; no separate HTTP process is needed. This maps exactly to what the repo currently does.

### Pattern 3: Project dependencies for shared auth state

Source: [DEV Community — A better global setup in Playwright](https://dev.to/playwright/a-better-global-setup-in-playwright-reusing-login-with-project-dependencies-14)

Pattern:

```ts
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] }, dependencies: ['setup'] },
  ],
});
```

The `setup` project runs first; browser projects depend on it. No shared `webServer` — each browser project uses `baseURL` from `use`.

### Pattern 4: Issue #22496 — smoke vs full suite with different servers

Source: [GitHub Issue #22496](https://github.com/microsoft/playwright/issues/22496)

Original request for per-project `webServer` (later implemented and reverted). The user's ideal config had:

- `functional-chromium` project: local dev server + mock server on ports 3000 + 3001.
- `smoke-chromium` project: no server, points at `https://production.app.com`.

This is exactly the scenario this repo faces: Electron tests (embedded Stoa) vs browser tests (external Stoa dev server).

## Decision Guidance

### When NOT to use a shared `webServer`

1. **Electron tests vs browser tests pointing at different servers** — If Electron launches an embedded Stoa server and browser tests need an external Stoa dev server, a shared top-level `webServer` block will launch the external server even when only Electron tests run. Wasteful, and if they share the same port, a conflict occurs.

2. **Parallel workers with the same hard-coded port** — `workers: > 1` with `webServer: { port: 3000 }` causes port conflicts. Each worker needs its own port. The fix is either `workers: 1` (current repo approach) or dynamic port allocation via env vars.

3. **Environment mismatch** — If one project needs `baseURL: http://localhost:3000` (local dev) and another needs `baseURL: http://staging.example.com`, a shared `webServer` cannot serve both. Use separate projects with their own `use.baseURL`.

4. **CI vs local reuse tension** — `reuseExistingServer: !process.env.CI` works for one server. With multiple servers (Stoa + mock), managing reuse per-server gets complex.

### How to isolate state per worker/project

| Dimension | Mechanism | Example |
|-----------|-----------|---------|
| **State files / user data dirs** | Per-test temp dir via env var | `VIBECODING_STATE_DIR` (already in use, `electron-app.ts:117`) |
| **HTTP server port** | Dynamic port via env var | `process.env.STOA_PORT ?? (43127 + workerIndex)` or `TEST_WORKER_INDEX` |
| **Env vars** | Merge into `electron.launch({ env })` or `webServer.env` | `electron-app.ts:113-124` already does this |
| **Database** | Per-worker DB name or path | `process.env.TEST_DB = \`test-${workerIndex}.db\`` |
| **Playwright browser context** | Default isolation (each test gets fresh context) | No extra config needed |

Dynamic port example for `webServer`:

```ts
const port = 3000 + (process.env.TEST_WORKER_INDEX ? parseInt(process.env.TEST_WORKER_INDEX) : 0);
webServer: {
  command: `npm run start -- --port ${port}`,
  url: `http://localhost:${port}`,
}
```

### When fixtures are better than `webServer`

**Use fixtures when:**

- The server is **started inside the test process** (Electron main process starts Stoa, as is currently the case).
- You need **test-scoped setup/teardown** (start server per test, not per run).
- You need **dynamic port allocation** based on test parameters or worker index.
- You want **fixtures to share state** (e.g., one fixture starts the server, another consumes the URL).
- You need **custom logic** (conditional server launch, health check with custom headers, etc.).

**Use `webServer` when:**

- The server is a simple static process (`npm run start`).
- The same server is needed for all tests in the run.
- You want Playwright to auto-retry the server if it crashes.

### How Electron `_electron` launches interact with `webServer` blocks

**They are completely independent.** `_electron.launch()` starts the Electron binary as a child process. `webServer` launches a separate HTTP server process. They do not share ports unless explicitly configured to. Key implications:

- A top-level `webServer` block will start **even when only Electron tests are selected** (via `--project`), unless the server's `url` already responds (via `reuseExistingServer: true`).
- Electron tests that embed their own HTTP server (like Stoa in this repo) should **not** use `webServer` config at all — the server is already running inside the Electron process.
- Browser tests pointing at the same embedded Stoa server can get the port dynamically from the Electron app's debug API (as seen in `stoactl-lifecycle.generated.spec.ts:37`).

**Proposed structure for this repo:**

```ts
// Option A: Browser project via fixture-based server launch
export default defineConfig({
  projects: [
    {
      name: 'electron',
      testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts'],
      // No webServer — Electron starts Stoa internally
    },
    {
      name: 'browser',
      testMatch: ['e2e-browser/**/*.spec.ts'],
      use: {
        baseURL: `http://127.0.0.1:${process.env.STOA_PORT ?? 43127}`,
      },
      // Server started via fixture, not webServer config
    },
  ],
});
```

Or with `workers: > 1` and dynamic ports:

```ts
// Option B: Multi-worker with fixture-based dynamic server
const workerPort = (index: number) => 43127 + index * 10;
```

## Risks / Unknowns

- **[!] Per-project `webServer` is reverted** (June 2026). Do not rely on it in Playwright v1.57 (current repo version `@playwright/test: ^1.57.0`). Monitor Playwright v1.61+ for a re-implementation with the baseURL and UI-mode fixes.

- **[!] Workers > 1 + shared `webServer` = port conflict**. Current repo uses `workers: 1` to avoid this. If parallel workers are needed for browser tests, each worker must get a unique port. `TEST_WORKER_INDEX` is available in `webServer.env` for dynamic port construction.

- **[?] How Stoa server port is allocated**: The generated specs read `debugState.webhookPort` at runtime from the Electron app's debug API. Browser tests need to know this port before they can navigate. Options: (a) start Stoa first via fixture, write port to a temp file, have browser tests read it; (b) use a fixed well-known port for the test server (requires `workers: 1` or per-worker port offset); (c) have the browser project depend on an Electron setup project that exports the port.

- **[?] Whether Stoa server is truly embedded in Electron or started as a separate subprocess**: Current evidence suggests embedded (port is read from `getDebugState()` in `stoactl-lifecycle.generated.spec.ts`). Confirm by reading the Electron main entry startup code.

- **[?] Whether browser tests will share fixtures with Electron tests**: The fixture file (`electron-app.ts`) is Electron-specific. Browser tests will likely need a separate fixture file or a conditional fixture that works in both contexts.

- **[?] VS Code extension behavior with mixed projects**: If developers use the Playwright VS Code extension, project selection in the UI may not correctly filter which servers start, based on the revert reasoning for PR #41167.

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `playwright.config.ts` has no `webServer`, `projects`, `globalSetup` | Local file | `D:\Data\DEV\ultra_simple_panel\playwright.config.ts:1-19` |
| `testMatch` covers both Electron and generated spec files | Local file | `D:\Data\DEV\ultra_simple_panel\playwright.config.ts:5` |
| `workers: 1`, `fullyParallel: false` | Local file | `D:\Data\DEV\ultra_simple_panel\playwright.config.ts:12-13` |
| `launchElectronApp()` sets `VIBECODING_STATE_DIR` per test | Local file | `D:\Data\DEV\ultra_simple_panel\tests\e2e-playwright\fixtures\electron-app.ts:111-119` |
| Generated specs call `fetch()` to runtime-resolved `webhookPort` | Local file | `D:\Data\DEV\ultra_simple_panel\tests\generated\playwright\stoactl-lifecycle.generated.spec.ts:47` |
| Per-project `webServer` was implemented then reverted | GitHub PRs | [PR #40869](https://github.com/microsoft/playwright/pull/40869), [PR #41167](https://github.com/microsoft/playwright/pull/41167) |
| Project dependencies are recommended over `globalSetup` | Playwright docs | [Global setup](https://playwright.dev/docs/test-global-setup-teardown) |
| `projects` array supports multiple browsers/environments | Playwright docs | [Projects](https://playwright.dev/docs/test-projects) |
| `webServer` accepts array for multiple servers | Playwright docs | [Web server](https://playwright.dev/docs/test-webserver) |
| Issue #21701: Electron+browser mixing via `page` fixture override | GitHub issue | [Issue #21701](https://github.com/microsoft/playwright/issues/21701) |
| Issue #22496: smoke vs full suite with different servers | GitHub issue | [Issue #22496](https://github.com/microsoft/playwright/issues/22496) |
| `TEST_WORKER_INDEX` available for dynamic port allocation | GitHub issue | [Issue #37920](https://github.com/microsoft/playwright/issues/37920) |
| Electron `_electron` is independent of `webServer` config | Playwright docs | [Electron](https://playwright.dev/docs/api/class-electron) |
| Pattern 3: project dependencies for shared setup | DEV Community | [A better global setup](https://dev.to/playwright/a-better-global-setup-in-playwright-reusing-login-with-project-dependencies-14) |
| Pattern 2: Electron-only setup with no `webServer` | Simon Willison TIL | [Testing Electron with Playwright](https://til.simonwillison.net/electron/testing-electron-playwright) |
