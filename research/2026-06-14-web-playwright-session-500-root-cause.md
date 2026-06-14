---
date: 2026-06-14
topic: Web Playwright createSessionViaApi generic 500 root cause
status: completed
mode: context-gathering
sources: 11
---

## Context Report: Web Playwright `createSessionViaApi` generic 500

### Why This Was Gathered
Web Playwright tests (`tests/e2e-web/*.test.ts`) fail because the helper
`createSessionViaApi` (`tests/e2e-web/helpers/web-ui-actions.ts`) receives a
**generic HTTP 500** from `POST /api/v1/sessions`. The implementer needs the
exact root cause, the intended Web SR architecture, and the files that must
change so the e2e-web journeys (sidebar, file-explorer, search-panel) can create
sessions and pass.

### Summary
The session route (`stoa-server/src/routes/sessions.ts`) unconditionally calls
`runtimeBridge.launch(...)` on session creation. In the web Playwright fixture the
SR is spawned with `--web` but **no runtime provider is ever connected**, so the
live runtime bridge throws `RuntimeBridgeError('no_provider')`. That class
extends `Error`, not `AppError`, and the global error handler
(`stoa-server/src/middleware/error-handler.ts`) maps **every non-`AppError` to a
generic `500 internal_error`** — that is the "generic 500" the helper observes.
The intended contract (per the unit test and the SR/Client-separation plan) is a
**503** when the bridge is unavailable; the unit test only passes because it
mocks `launch` to throw an `AppError(503)`, masking the real throw path. Fixing
the 500→503 mapping is the root-cause fix; making the e2e-web tests actually
green additionally requires a runtime provider (in-process auto-ACK provider in
`--web` mode, or a fake WS provider in the fixture).

### Key Findings

1. **The helper's failure surface.** `createSessionViaApi` POSTs
   `{projectId, type, title}` to `/api/v1/sessions` and throws when
   `!response.ok || !payload?.ok` (`web-ui-actions.ts:33`). On a generic 500 the
   envelope's `error.message` is `"An unexpected error occurred"` (see finding 5),
   so the helper raises `Error("An unexpected error occurred")`. (`web-ui-actions.ts:53-66`, `:32-36`)

2. **Session creation always launches a runtime.** `POST /sessions` calls
   `manager.createSession(request)` (createSession errors → `409`, an `AppError`,
   so not the source), then in a second try-block calls
   `runtimeBridge.launch(...)` → `markRuntimeStarting` → `markRuntimeAlive`, and
   **re-throws** any error from that block after deleting the session record.
   (`sessions.ts:144-210`, specifically `:196-209`; re-throw at `:208`)

3. **No provider is connected in web mode.** The SR entry always wires
   `createLiveRuntimeBridge(runtimeBridgeHandler)` — there is no stub in `--web`
   mode. Runtime providers only exist via a WebSocket connection with
   `role=runtime` (`role-router.ts:164-167`, `:174-192`). The Playwright fixture
   spawns the SR with `--web` and never connects a provider, so
   `RuntimeBridgeHandler.providers` is empty. (`index.ts:96-97`; `web-app.ts:200-204`, `:217-222`)

4. **`launch` throws `RuntimeBridgeError`, not `AppError`.** With no provider,
   `sendCommand` → `getProviderForCommand` returns `null` even for
   `runtime:launch` (because `providers.values().next().value` is `undefined`),
   so it throws `new RuntimeBridgeError('no_provider', ...)`. `RuntimeBridgeError`
   `extends Error`, **not** `AppError`. (`runtime-bridge-handler.ts:92` class def; `:246-257` throw; `:376-381` null-provider logic; `runtime-bridge-client.ts:34-46,98`)

5. **Global error handler downgrades non-`AppError` to generic 500.** The handler
   returns the real status only when `err instanceof AppError`; everything else
   becomes `{ code: 'internal_error', message: 'An unexpected error occurred' }`
   with HTTP 500. So `RuntimeBridgeError` silently becomes a generic 500.
   (`error-handler.ts:16`, `:30-39`)

6. **The intended contract is 503, but it is only enforced by a mock.** The route
   unit test expects status `503` when launch fails, and its helper
   `createBridgeUnavailableError` produces an `AppError({code:'internal_error',
   statusCode:503})`. The real live bridge never throws that shape, so the
   contract holds only in the unit test, never at runtime. (`api-routes.test.ts:81-87`, `:315-329`)

7. **Why the smoke test passes but the others don't.** `smoke.test.ts` never
   creates a session, so it never hits the launch path. `sidebar.test.ts`,
   `file-explorer.test.ts`, and `search-panel.test.ts` all call
   `createSessionViaApi` inside `beforeNavigate` and therefore hit the
   no-provider → 500 path. (`tests/e2e-web/smoke.test.ts`; `sidebar.test.ts:31`, `file-explorer.test.ts:31`, `search-panel.test.ts:29`)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Helper POSTs and throws on non-ok | `tests/e2e-web/helpers/web-ui-actions.ts` | `web-ui-actions.ts:53-66`, `:32-36` |
| Route creates session then calls launch, re-throws on failure | `stoa-server/src/routes/sessions.ts` | `sessions.ts:144-210`, re-throw at `:208` |
| `manager.createSession` errors mapped to 409 (not the 500) | `stoa-server/src/routes/sessions.ts` | `sessions.ts:185-194` |
| Live runtime bridge wired unconditionally; no stub in `--web` | `stoa-server/src/index.ts` | `index.ts:96-97` |
| Provider registers only via WS `role=runtime` | `stoa-server/src/ws/role-router.ts` | `role-router.ts:164-167`, `:174-192` |
| Fixture spawns `--web`, never connects a provider | `tests/e2e-web/fixtures/web-app.ts` | `web-app.ts:200-204`, `:217-222` |
| Live client delegates launch to handler.sendCommand | `stoa-server/src/services/runtime-bridge-client.ts` | `runtime-bridge-client.ts:34-46`, `:98` |
| `RuntimeBridgeError` extends `Error`, thrown on no_provider | `stoa-server/src/ws/runtime-bridge-handler.ts` | `runtime-bridge-handler.ts:92`, `:246-257`, `:376-381` |
| Global handler returns generic 500 for non-`AppError` | `stoa-server/src/middleware/error-handler.ts` | `error-handler.ts:16`, `:30-39` |
| Intended contract is 503, enforced only by mock | `stoa-server/src/routes/api-routes.test.ts` | `api-routes.test.ts:81-87`, `:315-329` |
| markRuntimeStarting/markRuntimeAlive only patch state (not the source) | `stoa-server/src/services/project-session-manager.ts` | `project-session-manager.ts:567-573` |

### Expected Web SR Architecture (from `docs/superpowers/plans/2026-06-12-stoa-server-client-separation.md`)

- SR is the **data/state center**; the Electron shell is a **runtime-capable
  client** that owns PTY processes (`plan §1, §6`; line 87: "Electron shell is
  NOT a thin client. It is a runtime-capable client that holds PTY processes").
- PTY ownership **stays in Electron** (`plan §6`, line 962). SR proxies runtime
  commands over the WS Runtime Bridge Protocol.
- Per the command table (`plan §6`, line 945): `runtime:launch` is issued by
  `POST /api/v1/sessions` **and** `POST /ctl/session/create` — i.e. session
  creation is contractually paired with a runtime launch.
- Per-command timeouts exist; when a provider is absent/unresponsive, SR "returns
  an error to the caller" (`plan §6`, line 969). The route's own unit test pins
  that error to **503** (finding 6). So the contract is: bridge unavailable ⇒
  503, never 500.
- There is **no** in-process / node-pty runtime provider on the SR side, and no
  such provider is wired for `--web` mode. The web client is a pure renderer that
  connects as `role=web` (`role-router.ts:167`). Confirmed by grep: `node-pty`
  appears only under `src/core/pty-host.ts` (Electron side) and bundled web
  assets — never in `stoa-server/src`.

### Likely Files To Edit

The fix splits into two layers. **(A)** The root-cause fix for the *generic 500*;
**(B)** the change needed for the e2e-web tests to actually create a session.

**A. Root-cause fix (500 → correct error):** pick one, prefer (A1).

- **A1 — `stoa-server/src/middleware/error-handler.ts`**: add a branch mapping
  `RuntimeBridgeError` to an `AppError(503, 'runtime_unavailable')` before the
  generic-500 fallback. Centralised; fixes every route that calls the bridge
  (`sessions` archive/restore/restart/input/resize/terminal-replay, plus the
  `meta-session` and `ctl` paths). Needs `RuntimeBridgeError` importable from
  `../ws/runtime-bridge-handler`. (`error-handler.ts:16,30-39`)
- **A2 — `stoa-server/src/routes/sessions.ts`** (and sibling routes): wrap each
  `runtimeBridge.*` call so `RuntimeBridgeError` is re-thrown as `AppError(503)`.
  Localised but repetitive across routes; misses `ctl`/`meta-session` paths.
- A3 — make `LiveRuntimeBridgeClient` itself throw `AppError(503)` instead of
  `RuntimeBridgeError`. Touches the bridge protocol layer and its tests; least
  recommended because it loses the structured `code` (`no_provider` /
  `timeout` / `provider_disconnected`).

**B. Make `createSessionViaApi` succeed (return 201) without an Electron
provider:** pick one.

- **B1 — `stoa-server/src/index.ts`** (+ new module): when `web` is true, register
  an **in-process auto-ACK runtime provider** so `runtime:launch` resolves and
  sessions reach `runtime.alive`. Keeps the contract intact; the web client sees
  real `SessionSummary` data with `runtime_state='alive'`. Aligns with how the
  sidebar/explorer/search tests assert only UI state (no terminal bytes).
- **B2 — `tests/e2e-web/fixtures/web-app.ts`**: connect a fake WS client with
  `role=runtime&token=<token>` that auto-ACKs `runtime:launch` before
  `beforeNavigate` runs. Keeps the server clean; pushes test infrastructure into
  the fixture and requires the WebSocket URL+auth to be derivable from the
  launched process.
- B3 — teach `POST /sessions` to treat `no_provider` as non-fatal (create the
  record, skip launch, leave `runtime_state='created'`). **Breaks the §6
  contract** ("session create ⇒ launch") and the unit test that asserts launch is
  called; avoid unless the team explicitly redefines the contract. Note:
  project policy forbids compatibility code, so if the contract changes it must
  be a clean break, not a tolerated fallback.

Recommended combination: **A1 + B1**. A1 alone removes the "generic" quality of
the 500 (turns it into a real 503) but the e2e-web session-create tests still
fail; B1 makes them actually create a session.

### Risks / Unknowns

- [!] **Unit test masks the bug.** `api-routes.test.ts:81-87` mocks the bridge
  with an `AppError(503)`. Any fix must also update that mock (or assert against
  a real `RuntimeBridgeError`) so the test reflects runtime behaviour instead of
  continuing to hide the gap.
- [!] **Multiple routes are affected**, not just `POST /sessions`: archive, restore,
  restart, input, resize, terminal-replay in `sessions.ts` all call the bridge and
  re-throw. A handler-level fix (A1) covers them; a route-level fix (A2) must be
  repeated.
- [?] **Provider lifecycle in `--web` mode is undefined.** The plan assumes an
  Electron provider. If B1 is chosen, the auto-ACK provider's behaviour for
  `kill`/`input`/`resize`/`terminal-replay`/`create-child-session` must be
  decided (no-op vs. stub) — the current tests only exercise `launch` indirectly
  via session creation.
- [?] **`stoa-server/dist/index.cjs` must be built** before Playwright
  (`web-app.ts:38-51`). Out of scope for the 500 root cause, but the implementer
  must rebuild after editing server source. `npm run test:e2e:web` (per
  `web-app.ts:46`) runs the build step.
- [?] Not verified at runtime in this pass (read-only research). The chain is
  inferred from code; confirm by spawning the SR in `--web`, POSTing a session,
  and reading the server stderr — `runtime-bridge-handler.ts` does not log
  `no_provider`, so the only signal is the HTTP 500 body.
