# E2E Hang Diagnosis — Bounded Context Report

**Date:** 2026-06-14
**Purpose:** Gather read-only context for diagnosing `npm run test:e2e` hanging after recent stoa-server / Electron architecture changes (commits `b0fd14e`, `4eb8f7c`, `9b8f42c` — "Stoa Server/Client Separation, all 6 phases").
**Scope:** package scripts, Playwright config, setup/teardown hooks, server spawn/lifecycle code, and specs likely to hang or leak Electron/node processes. All claims cite `file:line`.

---

## 1. How `test:e2e` runs

`package.json:36`
```
"test:e2e": "npm run build && npm run build:stoa-server && playwright test"
```
- `npm run build` (`package.json:12`) = `build:web && electron-vite build && node scripts/build-stoa-ctl.mjs`
- `npm run build:stoa-server` (`package.json:14`) = `pnpm --filter stoa-server run build` → `tsup` (`stoa-server/package.json:8`) → emits `stoa-server/dist/index.cjs` + web client
- Then `playwright test` runs **both** projects **sequentially** (`workers:1`, `fullyParallel:false`).

**Implication:** a hang in the `electron` project blocks the `web` project from ever starting, and there is no parallelism to mask a stall.

---

## 2. Playwright config — `playwright.config.ts`

| Setting | Value | Line |
|---|---|---|
| `testDir` | `./tests` | `playwright.config.ts:4` |
| per-test `timeout` | `60_000` ms | `playwright.config.ts:6` |
| `expect.timeout` | `10_000` ms | `playwright.config.ts:8` |
| `retries` | `CI ? 1 : 0` | `playwright.config.ts:10` |
| `fullyParallel` | `false` | `playwright.config.ts:11` |
| `workers` | `1` | `playwright.config.ts:12` |
| `globalSetup` / `globalTeardown` | **none** | — |

Projects (`playwright.config.ts:18-30`):
- `electron` → matches `e2e-playwright/**/*.test.ts` + `generated/playwright/**/*.spec.ts`
- `web` → matches `e2e-web/**/*.test.ts` (chromium)

**Note:** `tests/e2e/*.test.ts` (e.g. `app-bridge-guard`, `main-config-guard`, `backend-lifecycle`) are **vitest**, not Playwright — they are not matched by either project's `testMatch`.

**No `globalSetup`/`globalTeardown`** — each test owns its process lifecycle via fixtures. No shared long-lived server.

### Specs that run (Electron project)
`tests/e2e-playwright/`: `app-smoke`, `debug-devtools`, `file-explorer`, `git-panel`, `project-session-journey`, `recovery-journey`, `search-panel`, `session-event-journey`, `settings-modal-ui`, `sidebar-interaction`, `terminal-journey`, + `fixtures/electron-app.test.ts` (a vitest file that the `**/*.test.ts` glob also drags into Playwright — see Risk R8).
`tests/generated/playwright/`: `session-restore`, `session-telemetry-claude-lifecycle`, `stoactl-lifecycle`, `workspace-quick-access` (4 generated journeys — never hand-edit).

### Specs that run (Web project)
`tests/e2e-web/`: `file-explorer`, `search-panel`, `settings`, `sidebar`, `smoke`.

---

## 3. Process lifecycle — the full map

### 3a. Electron app launch — `tests/e2e-playwright/fixtures/electron-app.ts`

`launchElectronApp` (`electron-app.ts:110-162`):
1. Creates a temp state dir (`electron-app.ts:39-41`, `111`).
2. `ensureElectronMainEntrypoint()` → requires `out/main/index.cjs` (`electron-app.ts:47-56`).
3. `_electron.launch({ args:[entryPath], env })` (`electron-app.ts:126-129`) with `VIBECODING_E2E=1`, `VIBECODING_STATE_DIR=…`, `NODE_ENV=test` (`electron-app.ts:113-119`).
4. `await electronApp.firstWindow()` then waits for `[data-testid=app-viewport]` (15 s) and `[data-testid=command-panel]` (`electron-app.ts:131-133`). **`firstWindow()` has no explicit timeout** — it is bounded only by the 60 s test timeout.

Returned `close()` (`electron-app.ts:139-142`) → `closeElectronAppWithTimeout(electronApp, processHandle)`:
- `electronApp.close()` raced against a **5 s** timeout; on timeout → `processHandle.kill('SIGKILL')` (`electron-app.ts:75-99`).
- Then `waitForProcessExit(processHandle)` — polls `exitCode/killed` for up to **40 × 125 ms ≈ 5 s** + 500 ms tail (`electron-app.ts:58-73`).

`kill()` / `killAndRelaunch()` (`electron-app.ts:143-155`) → **SIGKILL immediately**, then `waitForProcessExit` + `disposeElectronAppConnection`.

`cleanupStateDir` (`electron-app.ts:164-177`) retries `rm -rf` up to 20 × (`250 * attempt`) ms on `EBUSY` → up to ~52 s if a handle (orphaned PTY/SR holding the dir) persists.

### 3b. Web app launch — `tests/e2e-web/fixtures/web-app.ts`

`launchWebApp` (`web-app.ts:175-241`):
1. Reserves a free loopback port via an ephemeral `net.createServer` (`web-app.ts:64-85`).
2. `ensureStoaServerEntrypoint()` → `stoa-server/dist/index.cjs` (`web-app.ts:42-51`); `ensureWebClientBuild()` → `stoa-server/dist/web/index.html` (`web-app.ts:53-62`).
3. `spawn(process.execPath, [entryPath, '--port', port, '--web'], { stdio:['ignore','pipe','pipe'] })` (`web-app.ts:199-203`). **`process.execPath` is the Playwright/Node binary, not Electron.**
4. `waitForServerReady` (`web-app.ts:120-161`): polls `GET /api/v1/discovery` then `GET /` for `<title>Stoa</title>`, **15 s** timeout (`WEB_SERVER_READY_TIMEOUT_MS`, `web-app.ts:10`). Throws if the child exits first (`web-app.ts:131-134`).
5. `page.goto(\`${baseUrl}/#token=…\`)`, waits for `app-viewport` + `command-panel` (`web-app.ts:222-224`).

`close()` (`web-app.ts:237-239`) → `closeServerProcess` (`web-app.ts:163-173`): SIGTERM → `waitForProcessExit` (**80 × 125 ms = 10 s**, `web-app.ts:101-118`) → SIGKILL fallback.

### 3c. Electron main process bootstrap — `src/main/index.ts`

Inside `app.whenReady().then(async () => {...})` (`index.ts:493-1912`), **SR is spawned BEFORE the window is created**:
- `srSpawner = new StoaServerSpawner(srConfig, srDeps)` (`index.ts:1480`); config `portRange:[3270,3280]`, `stoaDir:~/.stoa` (`index.ts:1417-1422`).
- `const srPort = await srSpawner.spawn()` (`index.ts:1481`)
- `await srSpawner.waitForHealth()` (`index.ts:1483`) ← **up to 30 s** (`HEALTH_TIMEOUT_MS`, `stoa-server-spawner.ts:151`)
- `await srSpawner.connectRuntime()` (`index.ts:1484`) ← opens a WebSocket to SR as the runtime provider.
- … IPC handlers registered …
- `mainWindow = createMainWindow()` (`index.ts:1879`) — **only after SR is healthy**.

Catch-all (`index.ts:1907-1912`): if `whenReady` chain throws, logs and `app.exit(1)`. **No window is ever created in that path**, so Playwright's `firstWindow()` waits until the 60 s test timeout.

### 3d. Electron teardown — `before-quit` handler `src/main/index.ts:1914-1931`

```ts
app.on('before-quit', async (event) => {
  if (isQuittingAfterBridgeStop) { unsubscribeStoaCtlGate(); return }
  event.preventDefault()
  try {
    await deleteCtlPortFile()
    await prepareForQuitAndInstall()   // flush + pty dispose + bridge.stop + lease.stop
    if (srSpawner) { await srSpawner.shutdown() }
  } finally {
    unsubscribeStoaCtlGate()
    app.quit()
  }
})
```
- `event.preventDefault()` defers quit until the async chain finishes.
- `prepareForQuitAndInstall()` (`index.ts:353-371`): `await projectSessionManager.flush()` → `await ptyHost.disposeAndWait()` → `sessionInputRouter.dispose()` → `await stopSessionEventBridge()` → `await hookLeaseManager.stop()`. Guarded by `isQuittingAfterBridgeStop` (`index.ts:354-358`).
- `app.on('window-all-closed')` → `app.quit()` on non-darwin (`index.ts:1933-1937`).
- SIGINT/SIGTERM (`index.ts:378-379`) → `app.quit()`. **On Windows these are not delivered to GUI Electron processes normally**, so teardown is driven by Playwright's `close()` (which closes all windows → `window-all-closed` → `app.quit()` → `before-quit`).

### 3e. Stoa Server spawn/shutdown — `src/main/stoa-server-spawner.ts`

`StoaServerSpawner.spawn()` (`spawner.ts:179-210`):
- `findAvailablePortInRange([3270,3280])` (`spawner.ts:100-111`) — 11 ports.
- `fork(entryPoint, ['--port', port, '--web'], { stdio:'pipe', env:{...process.env} })` (`spawner.ts:189-192`). Dev entry = `stoa-server/dist/index.cjs` (`spawner.ts:307-314`). **`fork()` runs SR under Electron's Node ABI.**
- Registers `process.on('exit')` (`spawner.ts:201-207`): nulls `this.process`; if `!disposed && code!==0` → `handleCrash()`.

`handleCrash()` (`spawner.ts:316-335`): one-shot restart after `CRASH_RESTART_DELAY_MS=2_000`; gives up on second crash.

`restart()` (`spawner.ts:337-373`): re-spawns on a **new** port, `await this.waitForHealth()` (another 30 s), `await this.connectRuntime()`.

`shutdown()` (`spawner.ts:255-301`):
1. `this.disposed = true`; `runtimeClient.disconnect()` first (`spawner.ts:259-260`).
2. `proc.kill('SIGTERM')` → `Promise.race([once('exit'), 10 s timeout])` → `proc.kill('SIGKILL')` if not exited (`SHUTDOWN_SIGTERM_WAIT_MS=10_000`, `spawner.ts:154, 275-298`).
3. **On Windows, `kill('SIGTERM')` = `TerminateProcess` (hard kill); SR's `gracefulShutdown` handler does NOT run.** So the 10 s race resolves immediately.

### 3f. SR entry point — `stoa-server/src/index.ts`

- `parseArgs` → `{port, web, lanMode}` (`index.ts:40-57`); `authToken = STOA_AUTH_TOKEN ?? 'stoa-dev-token'` (`index.ts:60`).
- `start()` (`index.ts:66-285`): tries SQLite, falls back to JSON for *persistence* (`index.ts:76-84`), **BUT meta-session services require SQLite** — if `!db || !metaSessionManager || !proposalStore` → `console.error(...); process.exit(1)` (`index.ts:146-149`). ← **hard early-exit if `better-sqlite3` fails to load.**
- `serve({ fetch: app.fetch, port })` from `@hono/node-server` (`index.ts:217-220`).
- `attachWebSocketServer` + role router for `/ws?token=…&role=runtime|web` (`index.ts:226-255`).
- `gracefulShutdown(signal)` (`index.ts:269-281`): `server.close(cb → process.exit(0))` + **10 s force `process.exit(1)` timeout**.
- SIGINT/SIGTERM registered (`index.ts:283-284`). **Only effective on POSIX; ignored/hard-killed on Windows.**
- Top-level `start().catch(→ process.exit(1))` (`index.ts:291-294`).

### 3g. Runtime client (Electron → SR WS) — `src/main/stoa-runtime-client.ts`

- `connect()` (`runtime-client.ts:132-178`): opens `ws://…/ws?token=…&role=runtime`; resolves on `open`.
- `disconnect()` (`runtime-client.ts:184-192`): sets `disposed`, clears reconnect timer, closes WS.
- `close` event → `scheduleReconnect()` (`runtime-client.ts:156-163, 393-416`) with exponential backoff (1 s → 30 s, `runtime-client.ts:104-106`), **only suppressed when `disposed`**. If `disconnect()` is not called before SR dies, this timer keeps firing forever inside the (soon-to-be-killed) Electron process.

### 3h. Webhook (session-event-bridge) server — `src/core/webhook-server.ts` + `src/main/session-event-bridge.ts`

`SessionEventBridge.stop()` (`session-event-bridge.ts:751-764`) → `this.server?.stop()` (the local webhook Express server) + clears maps + `manager.setTerminalWebhookPort(null)`.

`createLocalWebhookServer().stop()` (`webhook-server.ts:486-503`):
```ts
await new Promise((resolve, reject) => { active.close((error) => { ... }) })
```
**This `http.Server.close()` has NO timeout.** `close()` waits for all in-flight/keep-alive connections to drain. A stuck request handler (e.g. an `onEvent` awaiting an unresponsive `mirrorCanonicalEventToStoaServer` fetch, `index.ts:1008-1026`) or a lingering keep-alive socket will make `stop()` hang **indefinitely** — see Risk R1.

### 3i. PTY host — `src/core/pty-host.ts`

`disposeAndWait(timeoutMs=2_000)` (`pty-host.ts:203-206`): `Promise.all(killAndWait(...))`. `killAndWait` (`pty-host.ts:173-196`): `terminal.kill()` → `waitForExit(2 s)` → `forceKillProcessTree` (`taskkill /PID /T /F` on Windows, `pty-host.ts:67-82`) → `waitForExit(1 s)`. **Bounded at ~3 s per PTY — not a hang source.**

---

## 4. Setup/teardown hooks in specs

- **No `globalSetup`/`globalTeardown`** in `playwright.config.ts`.
- **No `test.beforeAll`/`test.afterAll`** in any Playwright spec (confirmed by grep over `tests/e2e-playwright`, `tests/e2e-web`, `tests/generated`).
- `test.beforeEach`/`test.afterEach` exist in: `e2e-playwright/{file-explorer,git-panel,search-panel,sidebar-interaction}.test.ts` and `e2e-web/{file-explorer,search-panel,sidebar}.test.ts` — these set up a fixture app per test (same `launchElectronApp`/`launchWebApp` + `close()` pattern as smoke).
- Journey specs (`recovery-journey`, `session-event-journey`, `project-session-journey`, `terminal-journey`) use `try { … } finally { await app.close() }`.
- **Process management lives only in the fixtures** — specs never call `process.kill`/`SIGKILL` directly (grep confirms the only matches are in `electron-app.ts`).

---

## 5. Hang / leak risk register (ranked)

### R1 — Webhook server `stop()` is unbounded ★★★ (top suspect)
`webhook-server.ts:486-503`. `http.Server.close()` callback waits for all connections to drain with no timeout. Called from `session-event-bridge.ts:752` → `index.ts:368` (`prepareForQuitAndInstall`) → `before-quit` (`index.ts:1923`). If any in-flight `/events` or `/hooks/*` request is stuck (e.g. `mirrorCanonicalEventToStoaServer` doing a fetch to SR that never responds — `index.ts:1008-1026`, no `AbortSignal`), `before-quit`'s async chain never completes, `app.quit()` in the `finally` never runs, and Playwright's `electronApp.close()` hits its **5 s** timeout (`electron-app.ts:83-90`) → SIGKILL. **→ R5 (orphaned SR).**

### R2 — SR startup hard-exit on `better-sqlite3` ABI mismatch ★★★
`stoa-server/src/index.ts:146-149` → `process.exit(1)` when SQLite/meta-session init fails. `stoa-server/src/db/connection.ts:7-23` loads `better-sqlite3` directly. SR runs under **two different Node ABIs** across the two projects:
- Electron project: SR is `fork()`-ed by Electron (`stoa-server-spawner.ts:189`) → needs `better-sqlite3` built for **Electron's ABI** (`npm run rebuild:native`, `package.json:27`).
- Web project: SR is `spawn()`-ed by Playwright's Node (`web-app.ts:199`) → needs `better-sqlite3` built for **plain Node ABI** (`pnpm.onlyBuiltDependencies`, `package.json:86-92`).

These are **mutually exclusive** native rebuilds. Whichever ABI is current, the other project's SR `process.exit(1)`s on boot. Symptom differs:
- Electron path: spawner exit handler → `handleCrash` → 2 s restart → exit again → give up; meanwhile original `waitForHealth` polls a dead port for **30 s** → throws → `app.exit(1)` (`index.ts:1907-1912`). Playwright `firstWindow()` then sees the process exit. **~30 s stall per test, but resolves.**
- Web path: `waitForServerReady` sees `exitCode !== null` and throws immediately (`web-app.ts:131-134`). Fast failure.

### R3 — `before-quit` async re-entrancy ★★
`index.ts:1914-1931`. `event.preventDefault()` + a long `await` chain. `isQuittingAfterBridgeStop` is only set inside `prepareForQuitAndInstall` (`index.ts:358`), which is awaited partway through. If `before-quit` fires twice before that line (e.g. Playwright `close()` + `window-all-closed` + an in-flight `app.quit()` from somewhere), two async chains run concurrently → double `srSpawner.shutdown()`, double `bridge.stop()`. The second `shutdown()` finds `this.process` possibly already null and returns early (`spawner.ts:262-265`) — low damage, but the double `bridge.stop()` / `webhook close()` on an already-nulled server is a latent race.

### R4 — SR crash-restart loop burns the port range ★★
`stoa-server-spawner.ts:316-373`. Each crash → 2 s delay → `findAvailablePortInRange` → new port. Combined with R2 (SR exit(1)) or any startup crash, this consumes ports 3270–3280. After ~11 leaked/crashed SRs, `findAvailablePortInRange` throws "No available port" (`spawner.ts:108-110`) → `spawn()` rejects → `app.exit(1)`.

### R5 — Orphaned SR child on Electron SIGKILL ★★★ (Windows-specific leak)
`stoa-server-spawner.ts:189` uses `fork()` with no `detached`, no Windows Job Object. When the Electron parent is SIGKILLed (Playwright `closeElectronAppWithTimeout` fallback at `electron-app.ts:92`; or `killAndRelaunch` at `electron-app.ts:143-155`), **Windows does not kill the child**. The orphaned SR keeps listening on its port and runs until manually killed. Across many sequential Electron tests (workers:1), ports 3270–3280 fill → R4. `recovery-journey.test.ts:55` does exactly one `killAndRelaunch` per test.

### R6 — Runtime client reconnect timer never cancelled if SR dies first ★
`stoa-runtime-client.ts:393-416`. If the WS closes and `disconnect()` was not called (e.g. Electron killed mid-teardown before `srSpawner.shutdown` reached `runtimeClient.disconnect()`), `scheduleReconnect` keeps firing 1 s→30 s timers, each attempting `connect()` to a dead SR. These are node timers on a process about to be SIGKILLed — self-limiting, but they add log noise and can mask the real shutdown path.

### R7 — `firstWindow()` has no explicit timeout ★
`electron-app.ts:131`. If SR health never passes (R2/R4) the main process calls `app.exit(1)` without creating a window; Playwright's `firstWindow()` then rejects (process gone) — but the failure surface depends on Playwright detecting the exit. If the process lingers (e.g. stuck in `before-quit` per R1), `firstWindow()` waits the full 60 s test timeout.

### R8 — `fixtures/electron-app.test.ts` is a vitest file caught by Playwright glob ★
`playwright.config.ts:21` matches `e2e-playwright/**/*.test.ts`. `tests/e2e-playwright/fixtures/electron-app.test.ts` imports from `vitest` (`fixtures/electron-app.test.ts:4`) and will be loaded by Playwright too. If its vitest-only imports or `afterEach` cause a worker-level error, the Playwright worker can fail to tear down. (Worth confirming whether this is intentionally excluded elsewhere; no `testIgnore` covers it — `playwright.config.ts:5` only excludes `**/fixtures/**/*.test.ts`… which **does** exclude this path. Confirmed safe — `testIgnore` at line 5 covers it.)

### R9 — `stoa-server/e2e-test.mjs` is NOT part of `test:e2e`
Modified in the working tree but invoked manually, not by `playwright test`. Out of scope for the Playwright hang, but if it is run by hand it spawns its own SR — note for context.

---

## 6. Recently changed files (working tree, uncommitted) — `git diff --stat HEAD`

```
electron.vite.config.ts          |  18 +----
package.json                     |  10 ++-
playwright.config.ts             |  14 +++-
src/main/index.ts                | 155 +++++++++++++++++++++++++--------------   ← before-quit + SR wiring
src/main/session-event-bridge.ts |   4 +
src/main/stoa-runtime-client.ts  |  34 ++++-----
src/main/stoa-server-spawner.ts  |  10 +--
stoa-server/src/app.ts           |   8 ++
stoa-server/src/index.ts         |  94 +++++++++++++++++++++++              ← gracefulShutdown + meta-session gate
```
The bulk of the change is in `src/main/index.ts` (+155/-~) — exactly where the `before-quit` teardown chain and SR bootstrap ordering live (`index.ts:1414-1485`, `1914-1931`). **This is the highest-likelihood regression surface for the hang.** `stoa-server/src/index.ts` (+94) introduced the `process.exit(1)` meta-session gate (`index.ts:146-149`) and the `gracefulShutdown` path (`index.ts:269-284`).

---

## 7. Suggested instrumentation to localize the hang (for the diagnosis agent, not this report)

1. **Webhook `stop()` timeout** — wrap `active.close(...)` in `webhook-server.ts:493-502` with a `Promise.race` against a 3–5 s timeout; log on timeout. Confirms/denies R1.
2. **`before-quit` tracing** — add `console.log` at each `await` in `index.ts:1914-1931` and `prepareForQuitAndInstall` steps (`index.ts:353-371`) to see which `await` never resolves.
3. **SR boot log capture** — the spawner already pipes `[sr:stdout]`/`[sr:stderr]` (`stoa-server-spawner.ts:194-199`); grep Playwright output for `Cannot start: meta-session services require SQLite` to detect R2.
4. **Orphan check** — after a hung run, `netstat -ano | grep 327` / `tasklist | findstr node` to spot leaked SR processes (R5).
5. **ABI check** — `node -e "require('better-sqlite3')"` under plain Node vs `electron -e …` to confirm R2 mismatch.
6. **Isolate project** — run `npm run test:e2e:web` and `npm run test:e2e:electron` separately (`package.json:38-39`) to see which project hangs.

---

## Context Handoff

- **Saved report path:** `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-e2e-hang-diagnosis-context.md`
- **Top suspects to investigate first:** R1 (webhook `stop()` unbounded, `webhook-server.ts:486-503`), R5 (orphaned SR on Windows SIGKILL, `stoa-server-spawner.ts:189`), R2 (SQLite ABI mismatch → SR `process.exit(1)`, `stoa-server/src/index.ts:146-149`).
- **Highest-regression file:** `src/main/index.ts` (+155 lines in working tree) — teardown chain `index.ts:1914-1931` + SR bootstrap ordering `index.ts:1480-1485, 1879`.
- **Depth note:** gathered at depth=2/max_depth=2; no further headless dispatched.
