---
date: 2026-06-12
topic: stoa-server-browser-web-hosting-and-ws-role-routing-context
status: completed
mode: context-research (read-only, depth=2/max_depth=2)
scope: stoa-server, src/main/stoa-runtime-client.ts, src/renderer/bootstrap-web.ts, package files, server/ws test patterns
---

## Context Report: Stoa Server Browser Web Client Hosting & `/ws` Role Routing

### Why This Was Gathered
Bounded context for implementing two minimal Stoa-side changes:

1. **Browser web client hosting** — a thin static-SPA wire-up so `stoa-server` can serve a Vue bundle (already buildable by `vite.web.config.ts`) from `stoa-server/dist/web/`. Auth and route mount order are the only server-side concerns; the build target itself is a Vite concern and is out of scope here.
2. **`/ws` role routing** — discriminate inbound WebSocket upgrades by `?role=` (and `?token=`) into the right sink: `role=runtime` → `RuntimeBridgeHandler.registerProvider`, `role=web` (default for `StoaClient`) → `WsHub.addClient`. Pure routing/parsing logic, isolated from `WsHub`/`RuntimeBridgeHandler` internals.

The two are co-located on the same `http.Server.upgrade` event in `stoa-server/src/index.ts:174`, but the responsibility split is clean: static-serving is a route group; role routing is a pure function over `(token, role, message)` plus a `http.Server.upgrade` glue layer.

### Summary
- The static SPA host is **already wired** end-to-end. `staticRoutes` (`stoa-server/src/routes/static.ts:11-19`) and the `webClient` app option (`stoa-server/src/app.ts:74-76`) exist; the only Stoa-side change required is the `--web` discovery-time check, which is already there (`stoa-server/src/routes/discovery.ts:18-41`). No new server code is required for the static-host half — only validation tests.
- The WS upgrade half is **not wired at all** — `stoa-server/src/index.ts:174` calls `serve({ fetch: app.fetch, port })` without passing `createNodeWebSocket` or attaching an `upgrade` listener. `@hono/node-server@^1.14.0` has no built-in WS helper (verified across the local install), and Hono's `upgradeWebSocket` is only exported for `bun`/`deno`/`cloudflare-workers` adapters.
- The role-routing decision is **a pure function** over `(searchParams, rawMessage) → { role, auth }`, with the only I/O surface being the `http.Server.upgrade` event. That makes it ideal for a single tight unit test file in the same style as the existing `ws/hub.test.ts` and `ws/runtime-bridge-handler.test.ts` patterns.

### Key Findings

#### 1. Existing auth middleware (`stoa-server/src/middleware/auth.ts`)

- **Pure Hono middleware factory**: `createAuthMiddleware(token = process.env.STOA_AUTH_TOKEN ?? 'stoa-dev-token'): MiddlewareHandler` (`stoa-server/src/middleware/auth.ts:19-21`).
- **Discovery skip**: returns `next()` for `c.req.path === '/api/v1/discovery' || '/api/v1/discovery/'` (`auth.ts:24-26`).
- **Two modes** (plan §9.2, lines `auth.ts:28-46`):
  - `Authorization: Bearer <token>` matching `token` parameter.
  - `x-stoa-session-id` + `x-stoa-session-token` non-empty pair (Phase 1 placeholder; Phase 2 will validate).
- **Rejection path**: `throw new AppError({ code: 'unauthorized', statusCode: 401, ... })` (`auth.ts:48-52`). Error handler renders the standard `ApiResponse` envelope (`stoa-server/src/middleware/error-handler.ts:11-40`).
- **Reuse opportunity for `/ws`**: the same `(token, sessionId, sessionToken)` triple is what the runtime provider and the browser SPA each pass — the WS upgrade handler can call the **same** token check (a sibling pure function), or it can share the same source token constant. Do **not** try to make the WS upgrade pass through Hono's `app.fetch` — that path does not run for `Upgrade: websocket` requests; the upgrade is intercepted by Node's HTTP server **before** Hono sees the request.

#### 2. Existing static routes (`stoa-server/src/routes/static.ts`)

- **Module-level singleton**: `export const staticRoutes = new Hono()` (`static.ts:12`). `webClientRoot` is resolved once at import time via `resolveWebClientRoot()` (`static.ts:13`).
- **Asset path**: `staticRoutes.use('/assets/*', serveStatic({ root: webClientRoot }))` (`static.ts:16`).
- **SPA fallback**: `staticRoutes.get('*', serveStatic({ root: webClientRoot, path: 'index.html' }))` (`static.ts:19`) — the standard `serveStatic` SPA-fallback pattern.
- **Mounted last**: in `createApp`, only when `options.webClient` is true, **after** `/api/v1`, `/ctl`, `/hooks` route groups (`stoa-server/src/app.ts:72-76`). The comment explicitly reserves the slot for "WebSocket upgrades take priority" (`app.ts:73-74`).
- **Resolution rules** (`stoa-server/src/shared/web-client-path.ts:7-17`): looks for `index.html` in three candidate roots in order: `stoa-server/dist/web`, `dist/web`, `<moduleDir>/../../dist/web`. Returns the first that exists, else the first candidate.
- **Implication for tests**: the static route is **module-load-time-bound** to the resolved root. A test for it needs `process.chdir`/monkey-patching of `existsSync`, or it needs to construct the Hono app with a custom `webClient` flag, or it needs to use the same candidates it was built against. The minimal-touch test is to mount `staticRoutes` in a fresh `Hono` and assert that `app.request('/some/spa/route')` returns HTML when the root is present and falls through to a 404 when it is not.

#### 3. Server index / bootstrap (`stoa-server/src/index.ts`)

- **CLI args** (`index.ts:30-47`): `--port <n>`, `--web`, `--lan`; `STOA_LAN_MODE` env var.
- **Web flag coupling** (`index.ts:161-168`):
  ```ts
  const webClientAvailable = isWebClientAvailable()
  const serveWeb = web && webClientAvailable
  const app = createApp(deps, {
    discovery: { webClient: serveWeb, lanMode },
    cors: true,
    webClient: serveWeb,
  })
  ```
  This is the only place the static route is gated. The pattern is clean: pass a flag, do not re-check.
- **HTTP server is bare** (`index.ts:174-177`):
  ```ts
  const server = serve({ fetch: app.fetch, port });
  ```
  No `upgrade` listener. `server` is the `http.Server` returned by `@hono/node-server`'s `serve` — it is the exact hook point for adding `server.on('upgrade', ...)`.
- **Graceful shutdown** (`index.ts:191-203`): `server.close(...)` + 10s force-exit. Does **not** track WS connections. A new role-router that owns WS references must register cleanup on `close`/error to avoid holding the process open past the 10s window.
- **Implication for the WS role router**: the router's lifecycle is owned by the bootstrap layer, not by `app.ts`. The minimal, testable unit is therefore (a) a pure routing function and (b) a thin `attachWebSocketRoleRouter(server, { hub, runtimeBridge, token })` glue function. Both can live next to the WS layer (`stoa-server/src/ws/role-router.ts`) without touching `app.ts` or `index.ts`'s ordering of side effects.

#### 4. WsHub (`stoa-server/src/ws/hub.ts`)

- **Class**: `WsHub` (`hub.ts:23`).
- **Client model** (`hub.ts:10-19`): `WsLike = { send(data: string): void; close?(): void }`; `WsClient = { id, ws, subscriptions: Map<WsServerEventType, WsSubscriptionFilter> }`.
- **Registration** (`hub.ts:31-43`): `addClient(ws: WsLike, token?: string): WsClient`. Token is currently `void`-ed (`hub.ts:40`) — held for "Phase 2b auth validation."
- **Subscription / broadcast / history** (`hub.ts:56-149`): `broadcast(type, payload)`, `handleSubscribe(clientId, types, filter)`, `handleUnsubscribe(clientId, types)`, `getMissedEvents(lastEventId)`, `removeClient(clientId)`, `clientCount`, `historyLength`. All pure-of-side-effects except `client.ws.send`.
- **The role router MUST treat `WsHub` as the authoritative owner** of the web-side client. After `hub.addClient`, the role router hands the returned `WsClient.id` + `ws` off to a per-client message router that:
  - buffers raw frames,
  - parses JSON,
  - routes `subscribe` / `unsubscribe` / `session:binary-input` to the matching `WsHub` method,
  - routes `runtime:response` to `RuntimeBridgeHandler.handleMessage` (when the same socket is also a runtime provider — for now, keep roles exclusive; see "Open design choice" below).
- **No code change required to `WsHub` for the role router.** Reuse as-is.

#### 5. RuntimeBridgeHandler + createLiveRuntimeBridge (`stoa-server/src/ws/runtime-bridge-handler.ts`, `stoa-server/src/services/runtime-bridge-client.ts`, `stoa-server/src/routes/runtime-bridge.ts`)

- **Class** (`runtime-bridge-handler.ts:164`): `RuntimeBridgeHandler`. State: `providers: Map<providerId, RuntimeProvider>`, `pendingCommands: Map<replyTo, PendingCommand>`, `hooks: RuntimeBridgeHooks`, `lastKnownPtyState: Map<sessionId, {providerId, state}>`.
- **Provider registration** (`runtime-bridge-handler.ts:180-189`): `registerProvider(ws: WsLike, _auth: { token: string }): RuntimeProvider`. Token is currently discarded (`_auth` prefix) but the **API surface is already there** — the role router can pass `{ token }` from the query string and the handler is already prepared to consume it when validation lands.
- **Wire protocol** (`runtime-bridge-handler.ts:33-46`): SR → provider is a `RuntimeCommand { type, sessionId, payload, replyTo }`; provider → SR is a `RuntimeResponse { replyTo, ok, data?, error? }`. Inbound from provider is a discriminated union: `kind: 'response' | 'terminal-data' | 'pty-state' | 'state-sync`.
- **Routing rules** (`runtime-bridge-handler.ts:318-360`): `handleMessage(providerId, message)`:
  - `replyTo: string` → `handleResponse` (pending-command resolver).
  - `type: 'runtime:terminal-data'` + `sessionId` + `data` → `handleTerminalData` → `hooks.onTerminalData`.
  - `type: 'runtime:pty-state'` + `sessionId` + `state` → `handlePtyState` → `hooks.onPtyState` (normalize state first).
  - `type: 'runtime:state-sync'` + `sessions: Array<...>` → `handleStateSync` → `hooks.onProviderReady`.
  - Malformed JSON, binary, unknown provider, unknown `replyTo`, missing fields: all silently dropped (no throw). This is the design intent — the role router can rely on `handleMessage` not throwing.
- **Factory** (`stoa-server/src/routes/runtime-bridge.ts:91-93`): `createLiveRuntimeBridge(handler)` returns a `RuntimeBridgeClient` (a high-level interface used by supervisors — distinct from the WS-level `RuntimeBridgeHandler`).
- **The role router's contract with the runtime side** is exactly: open WS → `handler.registerProvider(ws, { token })` → for every `ws.on('message', data)` → `handler.handleMessage(providerId, data as string)`. The handler returns the `RuntimeProvider` whose `id` must be remembered for the lifetime of the socket. On `close`/`error`: `handler.removeProvider(providerId)`.
- **No code change required to `RuntimeBridgeHandler` for the role router.** Reuse as-is.

#### 6. Bootstrap-side (web renderer) — `src/renderer/bootstrap-web.ts` and `src/renderer/lib/stoa-client.ts`

- **`bootstrapWebRenderer()`** (`bootstrap-web.ts:22-43`):
  1. Reads `?token=` from `window.location.search` (throws if missing — `bootstrap-web.ts:11-20`).
  2. `initStoaClientForStores(window.location.origin, token)` — `stoa-store-plugin.ts:28-56`.
  3. `new StoaClientPreloadAdapter(client)`.
  4. Wraps `getBootstrapState` to call `client.flushBuffer()` once on the first resolution (`bootstrap-web.ts:28-36`).
  5. `client.connectWs()` and `setRendererApi(adapter)`.
  6. `window.stoa = adapter` (legacy global).
- **`StoaClient.connectWs()`** (`src/renderer/lib/stoa-client.ts:145-191`):
  - URL: `${baseUrl.replace(/^http/, 'ws')}/ws?token=<token>[&lastEventId=<id>]`. **No `role=` is set.**
  - Subscribes by sending `{ type: 'subscribe', payload: { eventTypes: [type] } }` (`stoa-client.ts:215-232`).
  - `session:binary-input` is base64 over the same socket (`stoa-client.ts:258-269`).
- **The server-side role router must accept a missing `role` and default to `web`** for browser-renderer compatibility, since `StoaClient` is the existing convention.
- **Electron runtime side** (`src/main/stoa-runtime-client.ts:127-173`):
  - URL: `${serverUrl}/ws?token=<token>&role=runtime` (`stoa-runtime-client.ts:132-134`).
  - Hand-rolled reconnect, `runtime:*` command dispatch.
  - Already passes `role=runtime` — the role router will match on this.

#### 7. Test style & minimal test surfaces

- **Server unit tests use `vitest@^3.2.4`** with `globals: true` (`stoa-server/vitest.config.ts:1-7`) and `app.request()` for HTTP-level testing (`stoa-server/src/routes/routes.test.ts:1-32`).
- **WS unit tests use a hand-rolled `createMockWs(): WsLike`** with `vi.fn()` for `send` and `close` (`stoa-server/src/ws/hub.test.ts:6-11`, `stoa-server/src/ws/runtime-bridge-handler.test.ts:6-11`). Both are test files alongside their target modules (`hub.test.ts` next to `hub.ts`, `runtime-bridge-handler.test.ts` next to `runtime-bridge-handler.ts`).
- **Pattern for the new role-router tests** (`stoa-server/src/ws/role-router.test.ts`):
  - Mock `WsLike` per the existing style — no real `http.Server`, no real `WebSocket` upgrade, no `ws` package needed.
  - Pure-function tests for the role-decision and token-validation steps.
  - Glue-function tests that exercise: a fake `http.Server` with a `Set<upgradeListener>`, simulating the `upgrade` event with a fake `req` (URL with `?role=&token=`) and a fake `socket` (an EventEmitter with a `write`/`destroy`).
  - Tests for: role defaulting, token validation against `STOA_AUTH_TOKEN`, `role=runtime` → registerProvider flow, `role=web` → WsHub flow, unknown role → 4000-class close, missing token → 4001-class close.
- **Auth tests are already in place** (`stoa-server/src/routes/routes.test.ts:108-144`); the new role-router test only needs to assert that the **same** token-validation logic is invoked on the upgrade, not re-test the bearer regex.
- **Static-route test is the one gap** — there is no `static.test.ts` next to `static.ts`. A minimal one would:
  - Mount `staticRoutes` in a fresh `Hono` with `webClient: true` (or assert the route shape directly).
  - Since the root is module-load-time-bound, the test must manipulate `process.cwd()` to point at a temp dir with a fake `index.html`, or stub `existsSync` (the same `vi.mock('node:fs')` style used elsewhere in the repo). Prefer the former for faithfulness.

#### 8. Dependencies already available

- **`stoa-server/package.json:14-23` (runtime)**: `@hono/node-server@^1.14.0`, `hono@^4.7.0`, `drizzle-orm`, `better-sqlite3`, `stoa-shared`, `zod@^3.24.0`, `nanoid@^5.1.0`. **No `ws` package** — the WS upgrade is currently never wired. If the implementation chooses to use the `ws` package for the `http.Server.upgrade` integration (the standard pairing), it must be **added** to `stoa-server/package.json` dependencies. If the implementation instead uses Node's built-in `WebSocket` (Node ≥21, stable since 22.4), no new dep is needed — but bear in mind the server runs on `@types/node@^24.6.0` (per the root `package.json:65`) which means Node 22+ is the target.
- **`stoa-server/package.json:24-31` (dev)**: `vitest@^3.2.4`, `tsx`, `tsup`, `drizzle-kit`, `typescript@^5.9.3`, `@types/better-sqlite3`. No additional test deps required.
- **No `@hono/node-ws` companion installed** (verified in the research recommendation report). Adding it is a breaking dependency change; prefer the hand-rolled `http.Server.upgrade` path unless a second WS use case appears.
- **No test dep for `ws` / `supertest` / `http` mocking** is needed for pure routing tests; for the `http.Server.upgrade` glue tests, a hand-rolled fake `Server` (a class with a `Set<upgradeListener>` and an `emit('upgrade', ...)`) is sufficient — same pattern as the `WsLike` mock.

#### 9. Open design choices (not decisions, just flags)

- **Default `role`**: the existing `StoaClient` does not send `role` in the query string. The role router must default to `'web'` when `role` is absent or unrecognized; the runtime side explicitly sends `role=runtime`.
- **Token transport on WS**: in web mode the token travels in `?token=` on the WS URL (`StoaClient.connectWs`, `stoa-client.ts:148-152`); this is the only browser-safe way to put a secret in the upgrade handshake without a custom header (browsers forbid setting `Authorization` on `new WebSocket(...)`). The router must read it from `req.url`'s query string, not from request headers.
- **Role exclusivity on a single socket**: a single WS is either `web` or `runtime`, not both. `RuntimeBridgeHandler.handleMessage` and `WsHub.handleSubscribe` operate on disjoint message shapes (`runtime:*` vs `subscribe`/`session:binary-input`); a per-socket role tag is enough to disambiguate.
- **401-equivalent close codes**: the WS spec recommends `1008` (policy violation) for auth failures. The router should close with a documented constant, not `1000`/`1006`/random.
- **`runtime:response` is a `WsClientMessageType`** per `stoa-server/src/ws/events.ts:24` — the constants list has it. The current server has no client-message dispatcher; one would be added (or inline) in the role router. This is part of the "pure role/message routing" logic in scope.
- **Static file mount order**: `app.ts:74-76` mounts `staticRoutes` last. The SPA fallback `'*'` (`static.ts:19`) must not catch `/api/v1/*` or `/ws` — confirmed by the current mount order, but a regression test for that ordering is the single highest-value test in this slice.
- **`discovery.webClient` field**: already plumbed (`stoa-server/src/routes/discovery.ts:18-41`). The bootstrap flow is `GET /api/v1/discovery` (no auth) → renderer reads `data.webClient` and proceeds. No change needed for hosting; only verification that the field is `true` when the bundle is present.

#### 10. Constraints to respect (project rules)

- **No backwards-compatibility code** (project `CLAUDE.md` "不允许写任何兼容性代码"). When wiring `/ws`, the legacy path (e.g. a pre-existing `runtime:*` command that arrived without `role=runtime`) must be rejected, not gracefully accepted. The router is the new boundary; nothing should sneak past it.
- **Design language does not apply** to server-side or test code (`docs/engineering/design-language.md` is a "renderer" constraint; the WS role router and tests are pure logic).
- **Test pipeline must pass** (`CLAUDE.md` "Quality Gate"). New unit tests must run under `npx vitest run` from the repo root and under `cd stoa-server && npm test` (or `npx vitest run` from there, since the stoa-server workspace has its own `vitest.config.ts` at `stoa-server/vitest.config.ts:1-7`).
- **No `as any`, `@ts-ignore`, `@ts-expect-error` in tests** (project `CLAUDE.md`). Use the same `vi.fn()` / typed mock style already in `ws/hub.test.ts:6-11`.

### Implementation Map (where to put what)

| Concern | File | Notes |
|---|---|---|
| Pure role-decision function | `stoa-server/src/ws/role-router.ts` (new) | `(searchParams, authToken) => { role, clientToken, ok, closeCode? }` — pure, no I/O. |
| Per-socket message dispatcher | `stoa-server/src/ws/role-router.ts` (same file) | Wires parsed frames to `WsHub.handleSubscribe` / `handleUnsubscribe` / `RuntimeBridgeHandler.handleMessage`. |
| `http.Server.upgrade` glue | `stoa-server/src/ws/role-router.ts` (same file) | `attachWebSocketRoleRouter(server, deps)`; `deps = { hub, runtimeBridge, token }`. |
| Bootstrap wiring | `stoa-server/src/index.ts:174` | One new line: `attachWebSocketRoleRouter(server, { hub, runtimeBridge: createLiveRuntimeBridge(runtimeHandler), token })` — requires a `RuntimeBridgeHandler` instance to be created in `index.ts` (currently not instantiated there; the stub bridge is used, `index.ts:84-85`). |
| Static-route mount-order test | `stoa-server/src/routes/static.test.ts` (new) | Asserts that `/api/v1/*` and `/ctl/*` are not swallowed by the SPA fallback. |
| Role-router tests | `stoa-server/src/ws/role-router.test.ts` (new) | Pure-function + fake-server-upgrade + per-role message-routing cases. |
| Auth-on-upgrade test | (within `role-router.test.ts`) | Asserts the same token regex used by `auth.ts:31` is enforced; reject on missing/invalid token with `1008` close. |
| Package dep (if `ws` is added) | `stoa-server/package.json:15-23` | New `"ws": "^8.x"` (or whichever is current at implementation time). |
| `ws` package types | `stoa-server/package.json:24-31` (dev) | New `"@types/ws": "^8.x"`. |

### Evidence Chain (file:line citations)

| Claim | Source | Location |
|---|---|---|
| Static SPA route already wired with mount order | `stoa-server/src/routes/static.ts:11-19`, `stoa-server/src/app.ts:72-76` | `staticRoutes` + `app.route('/', staticRoutes)` last |
| Web client path resolution | `stoa-server/src/shared/web-client-path.ts:7-21` | `resolveWebClientRoot`, `isWebClientAvailable` |
| `createApp` accepts `webClient` flag | `stoa-server/src/app.ts:38-44`, `74-76` | `CreateAppOptions.webClient` + `if (options.webClient)` |
| Discovery exposes `webClient` and `lanMode` | `stoa-server/src/routes/discovery.ts:18-41` | `createDiscoveryRoutes` returns `webClient`, `lanMode` flags |
| `--web` flag handling in entry | `stoa-server/src/index.ts:30-49`, `161-186` | CLI parse + `serveWeb` gate + console summary |
| HTTP server started without `upgrade` | `stoa-server/src/index.ts:174-177` | `serve({ fetch: app.fetch, port })` |
| `WsHub.addClient(ws, token?)` | `stoa-server/src/ws/hub.ts:31-43` | `addClient` accepts optional token (held for Phase 2b) |
| `RuntimeBridgeHandler.registerProvider(ws, { token })` | `stoa-server/src/ws/runtime-bridge-handler.ts:180-189` | Token passed in but `_auth` is discarded — room for future validation |
| `RuntimeBridgeHandler.handleMessage` is non-throwing | `stoa-server/src/ws/runtime-bridge-handler.ts:318-360` | All branches `return` early on malformed input; `try/catch` on JSON parse |
| Auth middleware shape (token, session headers) | `stoa-server/src/middleware/auth.ts:19-54` | `createAuthMiddleware(token?)` returns `MiddlewareHandler` |
| Auth skips discovery only | `stoa-server/src/middleware/auth.ts:24-26` | `c.req.path === '/api/v1/discovery'` |
| Error handler renders `ApiResponse` envelope | `stoa-server/src/middleware/error-handler.ts:11-40` | AppError → structured JSON; unknown → 500 |
| Existing `ws/hub.test.ts` mock pattern | `stoa-server/src/ws/hub.test.ts:6-11` | `createMockWs(): WsLike = { send: vi.fn(), close: vi.fn() }` |
| Existing `ws/runtime-bridge-handler.test.ts` mock pattern | `stoa-server/src/ws/runtime-bridge-handler.test.ts:6-15` | Same shape + `flushMicrotasks()` helper |
| `WsClientMessageType` constants | `stoa-server/src/ws/events.ts:21-28` | `subscribe`, `unsubscribe`, `session:binary-input`, `runtime:response` |
| `WsServerEventType` constants (12) | `stoa-server/src/ws/events.ts:3-18` | Same as broadcast helpers in `ws/broadcast.ts` |
| `WsServerEvent` envelope | `stoa-server/src/ws/events.ts:31-36` | `{ id, type, payload, timestamp }` |
| `createLiveRuntimeBridge(handler)` factory | `stoa-server/src/routes/runtime-bridge.ts:91-93` | Thin pass-through to `createLiveRuntimeBridgeClient` |
| `LiveRuntimeBridgeClient` adapter | `stoa-server/src/services/runtime-bridge-client.ts:28-107` | `LiveRuntimeBridgeClient` translates semantic calls to `runtime:*` commands |
| `StoaClient` connects to `/ws?token=` (no `role`) | `src/renderer/lib/stoa-client.ts:148-152` | `${baseUrl.../ws?token=...&lastEventId=...}` |
| `StoaRuntimeClient` connects to `/ws?role=runtime&token=` | `src/main/stoa-runtime-client.ts:127-134` | `url.searchParams.set('role', 'runtime')` |
| `bootstrapWebRenderer` reads `?token=` from URL | `src/renderer/bootstrap-web.ts:11-43` | Throws if missing; calls `client.connectWs()` |
| Stoa-server dep list (no `ws` package) | `stoa-server/package.json:15-23` | `@hono/node-server`, `hono`, `drizzle-orm`, `better-sqlite3`, `stoa-shared`, `zod`, `nanoid` |
| Stoa-server dev-dep list (vitest present) | `stoa-server/package.json:24-31` | `vitest@^3.2.4`, `tsx`, `tsup`, `drizzle-kit`, `typescript`, `@types/better-sqlite3` |
| Vitest config for stoa-server | `stoa-server/vitest.config.ts:1-7` | `globals: true`, `include: ['src/**/*.test.ts']` |
| `tsconfig` path alias to shared types | `stoa-server/tsconfig.json:14-20` | `stoa-shared` → `../stoa-shared/types` |
| Static-route mount order preserved in `app.ts` | `stoa-server/src/app.ts:65-76` | `/api/v1`, `/ctl`, then static last |
| `serveStatic` signature (Hono 4.x) | verified in prior research | `node_modules/.pnpm/@hono+node-server@1.19.14_*/.../serve-static.d.ts:1-17` |
| `@hono/node-server` does not export `createNodeWebSocket` | verified in prior research | only `serve`, `getRequestListener`, `createAdaptorServer` exported |
| Hono core has no Node-side `upgradeWebSocket` | verified in prior research | only `hono/bun`, `hono/deno`, `hono/cloudflare-workers` adapter modules export it |

### Risks / Unknowns

- [!] **`http.Server.upgrade` shape**: a hand-rolled upgrade listener must call `socket.write(...)` and `socket.destroy()` to reject (not just `return`), and must use the `WebSocket` class from the chosen package (`ws`, Node 22 built-in, or `@hono/node-ws`). A test that does not exercise a real socket will be lossy here.
- [?] **Node built-in `WebSocket` vs `ws` package**: the `ws` package is the de-facto standard and the same package the browser-side `StoaClient` library would target for server-side testing. If the implementation goes with `ws`, add it as a runtime dep of `stoa-server`. If it goes with the built-in, save a dep but pin the Node engine.
- [?] **Where the `RuntimeBridgeHandler` instance lives**: it is currently **not instantiated** in `index.ts:55-207` — only the stub `createStubRuntimeBridge()` is used. The role router needs a real `RuntimeBridgeHandler` for `role=runtime` to do anything useful. The minimal change is to create one in `start()` and pass it to both `createLiveRuntimeBridge` and `attachWebSocketRoleRouter`.
- [?] **Per-socket `close` cleanup on Hono `serve()`**: `serve()` in `@hono/node-server@^1.14.0` does not track open WS sockets in the `http.Server` reference it returns. The role router's `ws.on('close', ...)` handler must call `hub.removeClient` / `runtimeBridge.removeProvider` to keep counts honest. A test for this is part of the role-router test file.
- [?] **Static-route mount-order regression**: the `'*'` SPA fallback will swallow `/api/v1/*` and `/ws` 404s if the mount order ever regresses. A test that mounts the routes in the wrong order and asserts the 404 returns JSON is cheap insurance.
- [?] **Auth on `/api/v1/discovery` skip does not apply to WS**: the WS router must NOT skip auth when the path is `/api/v1/discovery` — it has no path. The skip is HTTP-only.
- [?] **Token in `?token=` is logged by default**: Node's `http.Server` access log (if enabled) would record the token. There is no access log enabled in `index.ts:174-207`, so this is not an active risk, but a future debug log should redact it.

### Reused Prior Research

- `research/2026-06-12-stoa-server-browser-ui-recommendation.md` — SPA vs SSR verdict, Vite web build target, the `http.Server.upgrade` recommendation, the missing `dist/web/` fact, the `?token=` capability URL pattern, the `@hono/node-server` no-built-in-WS fact.
- `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` — full route map, the "all tests use `app.request()`" fact, the empty `dist/web/` directory, the no-browser-E2E status.
- `research/2026-06-12-stoa-server-web-client-migration-audit.md` — gap list (no Vite web build, no WS upgrade, missing fs/git routes, 503 runtime bridge).
- `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` — confirmation that the prior reports are still accurate against `b0fd14e`, the 18 unconditional `window.stoa.*` sites in `App.vue`, the `StoaClient` library as the reusable asset.

No new community search was needed; the local installed packages and the prior audit reports are the authoritative sources for this repo's versions. The community evidence budget was spent only on confirming the `@hono/node-server` WS-export absence, which the prior recommendation report had already verified.

---

## Context Handoff

**Saved report path:** `D:\Data\DEV\ultra_simple_panel\research\2026-06-12-stoa-server-browser-web-hosting-and-ws-role-routing-context.md`

The report contains:

1. **Why-this-was-gathered** framing for the two narrowly-scoped changes (static SPA host wiring + `/ws` role router), with the responsibility split between them explicit.
2. **10 key findings** covering: auth middleware, static routes, server bootstrap, `WsHub`, `RuntimeBridgeHandler`/`createLiveRuntimeBridge`, the web-renderer bootstrap side, existing test style, available dependencies, open design choices, and project rules.
3. **An implementation map** with file paths and whether each entry is new or existing.
4. **A 28-row evidence chain** with `file:line` citations for every claim, including the existing `ws/hub.test.ts` / `ws/runtime-bridge-handler.test.ts` mock patterns, the missing `ws` package, the absence of a `createNodeWebSocket` export, the Hono middleware factory shape, the WS constants in `ws/events.ts`, and the bootstrap-side `StoaClient`/`StoaRuntimeClient` WS URL conventions.
5. **7 risks/unknowns** including the `http.Server.upgrade` shape, the Node built-in `WebSocket` vs `ws` package decision, the fact that `RuntimeBridgeHandler` is **not yet instantiated** in `index.ts` (only the stub bridge is used), the static-route mount-order regression risk, and the auth-skip-doesn't-apply-to-WS note.
6. **Reused prior research** — every prior report from `research/2026-06-12-*.md` is cited; no new community search was performed (all required versions and facts were already verified in the prior research).

The report is sized for direct consumption by a planning subagent: it cites the exact files, lines, and existing test patterns that an implementation will need. No code is written. No implementation files are modified.
