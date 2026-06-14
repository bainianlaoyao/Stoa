---
date: 2026-06-13
topic: stoa-server web bootstrap & runtime startup — Playwright fixture launch strategy
status: completed
mode: context-gathering
sources: 26
---

## Context Report: Stoa Server Web Bootstrap & Runtime Startup — Playwright Fixture Launch Strategy

### Why This Was Gathered

Determine the safest way for an **isolated Playwright browser fixture** to launch the stoa-server so the Vue web SPA can be driven end-to-end. The fixture must (a) build correctly, (b) start in a known-clean state, (c) bind a stable port, (d) be reachable through the web bootstrap, and (e) shut down deterministically. This report reuses the three most recent context reports on the same subject and fills the gaps left by them (concrete `HOME`/`USERPROFILE` isolation semantics, exact entry command, the `STOA_DB_PATH` env-var lie, readiness polling, runtime wiring gaps that affect launch behavior, and shutdown semantics).

### Summary

The stoa-server is structurally ready to host a browser Playwright suite. The Vue web build already lands at `stoa-server/dist/web/`, the bootstrap reads `?token=` from the URL, and the auth/token path uses `STOA_AUTH_TOKEN`. **The single non-obvious trap is the `server.db` location**: `stoa-server/src/index.ts:66-67` hardcodes `join(homedir(), '.stoa', 'server.db')` and ignores the `STOA_DB_PATH` env var that `drizzle.config.ts` and `e2e-test.mjs` both assume is honored. The only working isolation mechanism for an isolated Playwright run is to set `USERPROFILE` (Windows) or `HOME` (POSIX) so Node's `os.homedir()` resolves into a fixture-scoped temp dir; the `STOA_AUTH_TOKEN` env var IS honored and can be used for token bootstrap. Three **pre-existing wiring gaps** (no mounted webhook routes, no `SessionEventProcessor`, no `dispatchBinaryInput`) will cause specific browser tests to fail — but they do NOT block the launch itself, only a subset of functional assertions.

### Reuse of Prior Reports (delta only)

Three prior reports cover 80% of this surface — read these first:

| Prior report | What it gives | What it leaves open |
|---|---|---|
| `research/2026-06-13-stoa-server-web-client-build-and-wiring-gaps.md` | Full renderer build pipeline, Vite web config, bootstrap-web wiring, all GAP-1..10 enumeration | Does not give the exact launch command, env var values, or DB isolation mechanism |
| `research/2026-06-13-stoa-server-browser-ui-event-chain-audit.md` | All three wiring gaps (webhook routes, processor, binary input) with line numbers | Does not cover build outputs, port, or shutdown |
| `research/2026-06-13-playwright-browser-web-migration-minimum-path.md` | Tier classification (Tier 1/2/3, Electron-only), recommended `playwright.config.ts` shape | Recommends `STOA_AUTH_TOKEN: 'stoa-dev-token'` but does not call out the `STOA_DB_PATH` lie or the `HOME`-override requirement |

The remainder of this report fills the gap between "fixtures need isolation" and "here are the exact knobs."

### Key Findings

#### 1. Build Outputs — What Must Be on Disk Before Launch

Two artifacts must exist; both are produced by `npm run build`:

| Artifact | Path | Produced by | Verified at |
|---|---|---|---|
| Self-contained CJS server bundle (140 KB) | `stoa-server/dist/index.cjs` | `tsup` (per `tsup.config.ts:1-10`, bundles `stoa-shared` with `noExternal`) | `dist/index.cjs` size = 140 KB, zero references to `'stoa-shared'` (inlined) |
| Vue SPA web bundle | `stoa-server/dist/web/index.html` + `dist/web/assets/*` | `vite build --config vite.web.config.ts` | `index.html` references `/assets/index-44SETror.js` and `/assets/index-BFRtOsnp.css`; CSP `connect-src` includes `http: https: ws: wss:` |

The single command `npm run build` runs both: `pnpm run build:web && electron-vite build && node scripts/build-stoa-ctl.mjs` (`package.json:12`). For a web-only Playwright run, `pnpm run build:web` is sufficient.

The static-route resolver (`stoa-server/src/shared/web-client-path.ts:1-21`) searches three candidate roots for `dist/web/index.html`:
1. `process.cwd()/stoa-server/dist/web`
2. `process.cwd()/dist/web`
3. `moduleDir/../../dist/web` (the bundled CJS path)

**Implication:** The fixture must launch the server with `cwd` set to the repository root (or set up the same path layout). Otherwise `isWebClientAvailable()` returns false, `--web` is silently dropped (`index.ts:204`), and the SPA returns 404 for every route.

#### 2. Entry Command

```bash
node stoa-server/dist/index.cjs --port <PORT> --web
```

- `--port <n>` is parsed by `index.ts:46-48` and overrides `process.env.PORT` and the default `3270` (`shared/constants.ts:8`). Must be a free port; bind to `127.0.0.1` if you want to avoid firewall prompts on Windows.
- `--web` enables the static SPA serving (`index.ts:50, 204`). The `staticRoutes` Hono instance is mounted LAST in `createApp()` (`app.ts:82-84`) so it doesn't shadow `/api/v1`, `/ctl`, `/hooks`, `/events`, or `/ws`.
- `--lan` enables LAN mode (`index.ts:43, 51`). **Not needed for Playwright** — keep off.

`createApp(deps, { cors: true, webClient: true })` is the option bundle that the entry uses when `--web` is set and `isWebClientAvailable()` returns true (`index.ts:204-210`).

**Existing in-tree patterns to mirror:**
- `stoa-server/e2e-test.mjs:45-49` uses `spawn('node', ['dist/index.cjs', '--port', String(port)], { cwd: <repoRoot>, env: { ...process.env, STOA_DB_PATH: DB_PATH } })` — see Finding 4 about why the `STOA_DB_PATH` part doesn't actually do what it says.
- The e2e harness polls `GET /api/v1/discovery` every 300 ms with a 10 s timeout (lines 22-32). **Reuse this for Playwright readiness.**

#### 3. Required Env Vars

| Env var | Read by | Behavior | Required for Playwright? |
|---|---|---|---|
| `STOA_AUTH_TOKEN` | `index.ts:59`, `middleware/auth.ts:20` | Becomes the Bearer token for `Authorization: Bearer <token>`. Default `'stoa-dev-token'`. | **Yes** — set a known fixture token so the test can `?token=…` the URL |
| `STOA_LAN_MODE` | `index.ts:43` | When `true`/`1`, sets `lanMode: true` (passed to discovery route as flag) | No — leave unset |
| `PORT` | `index.ts:41` | Default port if no `--port` arg. Overridden by CLI arg. | Optional — `--port` is clearer |
| `STOA_DB_PATH` | **`drizzle.config.ts:7` only — `index.ts` does NOT read it** | Sets drizzle-kit's DB path, not the runtime DB path | **DO NOT rely on this for runtime isolation** |
| `HOME` (POSIX) | `node:os.homedir()` | When set, overrides the resolved home dir for `process.platform === 'linux'/'darwin'` | **Yes — this is the only working DB isolation mechanism on POSIX** |
| `USERPROFILE` (Windows) | `node:os.homedir()` | When set, overrides the resolved home dir on Windows | **Yes — this is the only working DB isolation mechanism on Windows** |

**The single highest-risk launch detail:** the server's runtime DB is hardcoded to `homedir()/.stoa/server.db` (`index.ts:66-67`). There is no env var, no CLI flag, no config file that overrides it. If you launch two server instances against the same `HOME`/`USERPROFILE`, they will both open the same SQLite file and may corrupt the WAL — SQLite will refuse to open a second writer (returns `SQLITE_BUSY`).

**Conclusion:** the fixture MUST set `USERPROFILE=<tempDir>` (Windows) or `HOME=<tempDir>` (POSIX) before spawning the server. The temp dir must be a fresh `mkdtemp` per fixture instance. The server will then `mkdirSync(<tempHome>/.stoa)` and create `<tempHome>/.stoa/server.db` itself. This is the same trick `tests/e2e/settings-stoactl-toggle.test.ts:21` uses for the stoa-ctl shim tests.

#### 4. The `STOA_DB_PATH` Lie

`drizzle.config.ts:7` and `e2e-test.mjs:48` both set `STOA_DB_PATH=<custom-path>` expecting the runtime to honor it. They are both **wrong** for the runtime — only `drizzle-kit` migrations read that env var. The runtime at `index.ts:66-67` uses:

```ts
const STOA_DIR = join(homedir(), '.stoa');
const DB_PATH = join(STOA_DIR, 'server.db');
```

This is a pre-existing inconsistency that has not been flagged in the prior reports. For the Playwright fixture:

- **Do not** set `STOA_DB_PATH` and assume it does anything.
- **Do** set `USERPROFILE` (Windows) / `HOME` (POSIX) to a unique temp dir per fixture instance.
- **Do** also `unlinkSync` `<tempHome>/.stoa/server.db{,-shm,-wal}` in cleanup, because SQLite leaves these artifacts even on graceful shutdown.

#### 5. Auth Token Bootstrap

The web bootstrap (`src/renderer/bootstrap-web.ts:11-20`) requires `?token=<value>` in the URL or it throws synchronously. The fixture must:

1. Set `STOA_AUTH_TOKEN=<known-token>` in the server's env (`index.ts:59`).
2. Navigate Playwright to `http://127.0.0.1:<port>/?token=<known-token>`.

Both sides use the same string. The server's `middleware/auth.ts:24-32` skips auth for `/api/v1/discovery`, `/events`, `/memory-notifications`, and `/hooks/*` — so the readiness probe does NOT need a token. All other API endpoints require `Authorization: Bearer <token>` OR the `x-stoa-session-id + x-stoa-session-token` pair (`auth.ts:35-52`). The `StoaClient` HTTP wrapper sends Bearer auth automatically (`stoa-client.ts:96-125`, prior report).

The discovery endpoint does **not** return the auth token (`routes/discovery.ts:21-39`). Tests must hard-code the token in the URL — this is fine for an isolated fixture.

#### 6. Route & Readiness Checks

After the server starts, the fixture should poll readiness before navigating Playwright. Polling targets in priority order:

| Probe | URL | Auth required? | Indicates |
|---|---|---|---|
| HTTP discovery | `GET /api/v1/discovery` | **No** (`auth.ts:24`) | Hono app is mounted, discovery route is live |
| Ctl health | `GET /ctl/health` | **Yes** (Bearer) — returns 401 unauth | Hono + auth + health route wired |
| Bootstrap | `GET /api/v1/bootstrap` | **Yes** | Persistence backend is hydrated |
| SPA root | `GET /` | No | Static mount is serving `index.html` |
| SPA asset | `GET /assets/index-44SETror.js` | No | Vite output present and the hashed asset resolves |

Recommended probe: poll `GET /api/v1/discovery` every 200 ms with a 10 s timeout (`e2e-test.mjs:22-32` already does this at 300 ms / 10 s). Then `GET /?token=<token>` and assert the response is `text/html` with the Stoa `<title>Stoa</title>` and the Vite-injected `<script type="module" crossorigin src="/assets/...">`. Then `GET /assets/index-<hash>.js` to confirm the static mount can resolve hashed assets.

Once those three pass, the SPA bootstrap will succeed and `data-testid="app-viewport"` will be present.

#### 7. Existing Wiring Gaps That Will Affect Browser Tests (Not the Launch)

These three gaps from the prior report (`2026-06-13-stoa-server-bootstrap-wiring-bugs.md`) are still open. They do NOT stop the server from starting, but they will cause specific Tier 3 tests to fail:

| Gap | Location | Impact on Playwright tier |
|---|---|---|
| Webhook routes (`/events`, `/hooks/*`, `/memory-notifications`) are **defined in `webhooks.ts` but never mounted in `app.ts`** | `app.ts:49-84` has no `app.route('/hooks', ...)` | Tier 3 tests that `POST /hooks/claude-code` will get 404. The static-mount-order test passes the validation layer (line 119-141) because that test mounts a manual Hono app; the **real** `index.ts` app.ts does not. |
| `SessionEventProcessor` is **defined but never instantiated in `index.ts`** | `index.ts:1-293` has no import of `session-event-processor` | Even if webhooks were mounted, raw events would not become WS `session:state-patch` broadcasts |
| `dispatchBinaryInput` is **not wired to `roleRouterHandlers`** | `index.ts:225-238` | Browser `StoaClient.sendBinaryInput()` (`stoa-client.ts:258-269`) sends `session:binary-input` over WS; the server silently drops it (`role-router.ts:344-368`) |

**Tier 1 (smoke + settings) and Tier 2 (sidebar + file explorer + search) tests are unaffected** because they don't depend on webhook ingestion or binary input. They will work as soon as the fixture lands.

For Tier 3 (session events, telemetry lifecycle), the fixture will need the three fixes listed in the prior audit (mount webhook routes in `app.ts`, instantiate `SessionEventProcessor` in `index.ts`, wire `dispatchBinaryInput`). This is a code change to the server, not a fixture concern — call it out before writing the Tier 3 tests.

#### 8. Shutdown Semantics

`index.ts:268-283` registers `SIGINT` and `SIGTERM` handlers that:

1. Call `server.close()` (Hono `@hono/node-server`) and exit 0 when the callback fires.
2. Force-exit with code 1 after a 10 s timeout if graceful shutdown hangs.

The WebSocket upgrade handler (`ws/transport.ts:69-103`) does not detach on `server.close()` — open WS connections may keep the event loop alive briefly. The 10 s force-exit handles this.

**Fixture-side cleanup contract:**

1. Send `SIGTERM` (`proc.kill('SIGTERM')` like `e2e-test.mjs:216`).
2. Wait up to 10 s for exit.
3. Hard-kill with `SIGKILL` if still alive.
4. `rmSync` the temp `USERPROFILE`/`HOME` (recursively) **after** the process exits, to avoid deleting SQLite WAL files while the server is still holding them open.
5. Also `unlinkSync` any `server.db{,-shm,-wal}` directly, defensively, before `rmSync`.

The `webServer` config in Playwright auto-spawns and SIGTERMs the process, but the timeout is configurable (`webServer: { timeout: 15_000 }` per the prior report's recommendation). The temp HOME/USERPROFILE **will not be cleaned up by Playwright** — the fixture must clean it up in `globalTeardown` or in the per-test `afterEach`.

#### 9. CORS

`middleware/cors.ts:1-14` returns `cors({ origin: '*', allowMethods: [...], allowHeaders: ['Authorization', 'Content-Type', 'x-stoa-session-id', 'x-stoa-session-token'], maxAge: 86400 })`. The `StoaClient` is same-origin (it reads `window.location.origin` from `bootstrap-web.ts:24`) so CORS does NOT affect a normal Playwright run, but the wildcard `*` means a test that drives the server from a different origin would also work. No change needed.

#### 10. WebSocket Transport

`stoa-server/src/ws/transport.ts:1-30` is a hand-rolled RFC 6455 minimal transport (text frames only, no binary, no deflate, no fragmentation). The browser `StoaClient` connects to `ws://127.0.0.1:<port>/ws?token=<token>&lastEventId=<n>` and uses `EventSource`/native `WebSocket`. This transport works in unit tests but has not been validated against the real browser `WebSocket` in a full e2e — there is an open risk that frame-edge cases (long frames, ping timing) cause intermittent test failures. The prior audit's `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` flagged this; it's still open.

**For the fixture:** nothing extra to do, but expect occasional WS reconnects in CI. The `StoaClient` has exponential-backoff reconnect (`stoa-client.ts:145-191`, per prior report), so a flaky transport does not break tests — it just slows them.

### Recommended Launch Recipe (concrete)

```ts
// tests/e2e-web/fixtures/web-app.ts (sketch)
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

const AUTH_TOKEN = 'stoa-web-test-token'  // injected into STOA_AUTH_TOKEN
const REPO_ROOT = process.cwd()            // playwright config sets cwd to repo root

export async function launchWebApp() {
  const port = await getFreePort()
  const tempHome = mkdtempSync(join(tmpdir(), 'stoa-web-playwright-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STOA_AUTH_TOKEN: AUTH_TOKEN,
    // CRITICAL: the server reads homedir() — override it so server.db lives here
    ...(process.platform === 'win32'
      ? { USERPROFILE: tempHome }
      : { HOME: tempHome }),
    // STOA_DB_PATH is silently ignored by the runtime — don't set it
  }

  const proc = spawn('node', ['stoa-server/dist/index.cjs', '--port', String(port), '--web'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcess

  // Wait for /api/v1/discovery (no auth required, validates Hono is live)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/discovery`)
      if (res.ok) break
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  if (Date.now() >= deadline) {
    proc.kill('SIGKILL')
    rmSync(tempHome, { recursive: true, force: true })
    throw new Error('Stoa server did not become ready within 15s')
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token: AUTH_TOKEN,
    tempHome,
    proc,
    async close() {
      proc.kill('SIGTERM')
      const killDeadline = Date.now() + 10_000
      while (Date.now() < killDeadline) {
        if (proc.exitCode !== null || proc.killed) break
        await new Promise(r => setTimeout(r, 100))
      }
      if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
      rmSync(tempHome, { recursive: true, force: true })
    },
  }
}
```

Then in `playwright.config.ts`:

```ts
projects: [
  {
    name: 'web',
    testMatch: ['e2e-web/**/*.test.ts'],
    use: { baseURL: 'http://127.0.0.1:0' /* set per-test */ },
    // Do NOT use webServer here — let the fixture own the lifecycle so
    // we can set USERPROFILE per-instance for isolation. The minimum-path
    // report's recommended webServer shape is fine for ONE-SHOT runs but
    // breaks parallel fixture isolation.
  }
]
```

### Build Order for a Web-Only Playwright Run

```bash
# 1. Server bundle (CJS, self-contained)
cd stoa-server && pnpm run build && cd ..

# 2. Web SPA (Vite output to stoa-server/dist/web/)
pnpm run build:web

# 3. Install Playwright chromium (one-time, NOT in test fixture)
npx playwright install chromium

# 4. Run web project
pnpm exec playwright test --project=web
```

Skipping step 1 will leave `stoa-server/dist/index.cjs` stale or missing; the fixture will fail with `spawn ENOENT`.

### Risks / Unknowns

- [!] **DB isolation depends on `homedir()` override.** If a future refactor introduces `STOA_STATE_DIR` or `STOA_DB_PATH` reading in `index.ts:66-67`, the fixture must be updated in lockstep. Recommend adding a `STOA_STATE_DIR` env var read in `index.ts` as part of the same change.
- [!] **Three pre-existing wiring gaps** (no webhook routes, no `SessionEventProcessor`, no `dispatchBinaryInput`) — will block Tier 3 tests, not Tier 1/2.
- [?] The hand-rolled WS transport (`ws/transport.ts`) has not been exercised end-to-end against the browser `WebSocket` API in a real E2E run. The existing tests use the `Wire` interface. Intermittent CI flakiness is plausible.
- [?] The `--web` flag requires the static resolver to find `dist/web/index.html`. If the fixture spawns from a different `cwd`, the SPA returns 404 silently — the API still works. Recommend asserting `GET /` returns `text/html` with `<title>Stoa</title>` after readiness, not just discovery.
- [?] The `static-mount-order.test.ts` passes a custom Hono app with `webhooks: {}` injected; the **real** `app.ts` `createApp` is never called with a `webhooks` field. This means no real-instance test currently exercises the path that the real `index.ts` takes. If a future change adds webhook mounting to `app.ts`, that test will need to be updated.
- [?] `better-sqlite3` requires native binding compilation; on Windows it may need `pnpm rebuild better-sqlite3` after install. If the build environment changes (CI image), this can fail silently at server startup with `Cannot find module '../build/Release/better_sqlite3.node'`.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| `dist/index.cjs` is self-contained 140 KB CJS, `stoa-shared` inlined | filesystem | `stoa-server/dist/index.cjs` |
| Server bundle built with `tsup`, `noExternal: ['stoa-shared']` | `stoa-server/tsup.config.ts` | lines 1-10 |
| Vue SPA built to `stoa-server/dist/web/` | `vite.web.config.ts` | lines 5-20 |
| `index.html` CSP allows `ws: wss:` and HTTP(S) | `stoa-server/dist/web/index.html` | line 6 |
| Static SPA resolver looks for `dist/web/index.html` in 3 candidates | `stoa-server/src/shared/web-client-path.ts` | lines 5-21 |
| `isWebClientAvailable()` is called in `index.ts:203` and gates `--web` | `stoa-server/src/index.ts` | lines 203-204, 257-263 |
| Default port `3270` | `stoa-server/src/shared/constants.ts` | line 8 |
| `--port`, `--web`, `--lan` CLI args | `stoa-server/src/index.ts` | lines 39-56 |
| `STOA_AUTH_TOKEN` env var read at startup | `stoa-server/src/index.ts` | line 59 |
| Auth default `'stoa-dev-token'` | `stoa-server/src/middleware/auth.ts` | line 20 |
| **DB path hardcoded to `homedir()/.stoa/server.db` — NO env override** | `stoa-server/src/index.ts` | lines 66-67 |
| `STOA_DB_PATH` only read by `drizzle.config.ts` and `e2e-test.mjs` (not runtime) | `stoa-server/drizzle.config.ts` | line 7 |
| `e2e-test.mjs` is wrong about `STOA_DB_PATH` for runtime | `stoa-server/e2e-test.mjs` | line 48 |
| `mkdirSync(STOA_DIR)` — server creates `~/.stoa` on startup | `stoa-server/src/index.ts` | line 70 |
| SQLite migration is auto-applied via inline `INLINE_SCHEMA_SQL` | `stoa-server/src/db/connection.ts` | lines 18-22, 45-199 |
| CORS wildcard + Authorization header allowed | `stoa-server/src/middleware/cors.ts` | lines 7-13 |
| Auth skip list: discovery, events, memory-notifications, hooks | `stoa-server/src/middleware/auth.ts` | lines 24-32 |
| Discovery endpoint returns `{ webClient, lanMode }` — no token | `stoa-server/src/routes/discovery.ts` | lines 21-39 |
| Ctl health requires Bearer | `stoa-server/src/routes/health.ts` | line 11 (route mounted before auth in `app.ts:67`) — auth runs first, so 401 unauth (verified in `static-mount-order.test.ts:89-93`) |
| Static mount order: API > ctl > hooks > SPA fallback | `stoa-server/src/routes/static.ts` | lines 12-35 |
| Web bootstrap reads `?token` from URL, throws if missing | `src/renderer/bootstrap-web.ts` | lines 11-20 |
| Server entry wires WS upgrade + role router | `stoa-server/src/index.ts` | lines 240-254 |
| Graceful shutdown on SIGINT/SIGTERM, 10 s force-exit | `stoa-server/src/index.ts` | lines 268-283 |
| Webhook routes exist but NOT mounted in `createApp()` | `stoa-server/src/app.ts` | lines 49-84 (no `/hooks` route) |
| `SessionEventProcessor` defined, never imported in `index.ts` | `stoa-server/src/index.ts` | full file grep returns no reference |
| `dispatchBinaryInput` absent from `roleRouterHandlers` | `stoa-server/src/index.ts` | lines 225-238 |
| `createTestTempDir` available via `testing/test-temp.ts` | `testing/test-temp.ts` | lines 1-13 |
| e2e harness pattern (spawn + poll /api/v1/discovery) | `stoa-server/e2e-test.mjs` | lines 22-49 |
| Existing HOME-override pattern for isolation | `tests/e2e/settings-stoactl-toggle.test.ts` | lines 21-23 |

## Context Handoff: Stoa Server Web Bootstrap & Playwright Launch Strategy

Start here: `research/2026-06-13-stoa-server-web-bootstrap-and-playwright-launch-strategy.md`

Context only. Use the saved report as the source of truth.

The single most important takeaway: **the runtime DB is hardcoded to `homedir()/.stoa/server.db` and the `STOA_DB_PATH` env var is a no-op at runtime.** Isolate Playwright fixtures by setting `USERPROFILE` (Windows) or `HOME` (POSIX) to a per-fixture `mkdtemp` directory. Set `STOA_AUTH_TOKEN` to a known fixture value and pass it via `?token=` in the URL. The three pre-existing wiring gaps (webhook routes, `SessionEventProcessor`, `dispatchBinaryInput`) block Tier 3 tests but not the launch itself.
