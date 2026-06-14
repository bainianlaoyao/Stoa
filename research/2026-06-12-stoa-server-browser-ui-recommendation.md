---
date: 2026-06-12
topic: serving-browser-ui-from-stoa-server-instead-of-electron
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Serving a Browser UI from `stoa-server` instead of Electron

### Why This Was Gathered
To decide the immediate implementation direction for "let `stoa-server` actually serve a web page that substantially replaces the current Electron UI." The repo already contains: (a) a complete Hono HTTP+WS server with 8+ REST route groups, webhook endpoints, and a fully implemented `WsHub`; (b) a complete `StoaClient` HTTP+WS client + `StoaClientPreloadAdapter` that implements the full `RendererApi` interface; (c) a partial feature-flagged dual path (`isStoaClientMode()`, `VITE_USE_STOA_CLIENT`) wired into `workspaces`, `settings`, `sidebar` stores; (d) `App.vue` still calling `window.stoa.*` unconditionally. What is missing is the build target — a Vite web SPA bundle sitting in `stoa-server/dist/web/`, plus a wired WebSocket upgrade on the server.

This report focuses on the **five narrow questions** asked, with citations grounded in the local installed packages (the authoritative version for *this* repo) and the existing audit reports in `research/2026-06-12-*.md`.

### Summary
- **Use SPA static-only serving from Hono on Node** for the UI (no SSR, no hybrid). The Vue renderer is a fully client-side SPA with `electron-vite` and no SSR hooks; the only page is a single document shell.
- **Wire Vite's standard `build` to emit into `stoa-server/dist/web/`** with `base: '/'` and a tiny `vite.web.config.ts` that reuses the existing plugin set (`@vitejs/plugin-vue`, `@tailwindcss/vite`, `@intlify/unplugin-vue-i18n`). No `electron-vite` wrapper.
- **Replace `window.stoa` with `StoaClient` in a `browser` mode** by routing all 18 call sites in `App.vue` through the existing adapter and gating the whole renderer on a single `initStoaClientForStores(baseUrl, token)` bootstrap call.
- **Stream the terminal over the existing WebSocket** using the same `WsHub`, framed as binary frames (the adapter already encodes `sendBinaryInput` as base64 over WS). Pair with a `node-pty` child process on the server side that the server forwards to the socket — no need to swap to a separate terminal proxy.

### Key Findings

#### 1. SPA vs SSR vs Hybrid — Recommendation: **SPA (static-only)**

For a local-first session-management app whose renderer is a hand-built Vue 3 SPA rooted at `App.vue` with no router, no `meta`/`<head>` injection, no per-route data fetch, and no SEO requirement, the SSR vs SSR-hybrid option buys nothing and adds two hard costs (a Node-render pass per request, hydration mismatches against dynamic xterm output).

| Approach | Verdict for this repo | Concrete impact |
|---|---|---|
| SPA (static-only) | **Recommended** | One Vite build → `dist/web/`. `serveStatic({ root: './dist/web', path: 'index.html' })` is already wired (`stoa-server/src/routes/static.ts:14-17`). No new runtime, no hydration risk. |
| SSR (e.g. `vite-ssg`, `vue-router` per route) | Rejected | Renderer has no router today (verified — `vue-router` not in `package.json`); would require a breaking router introduction. SSR is justified for SEO / first-paint, neither of which applies to a localhost dev tool. |
| Hybrid (SPA shell + per-route SSR islands) | Rejected | Same router prerequisite, plus two render modes to maintain. No local app need for it. |

The static-only path is already the design intent. The local `serveStatic` from `@hono/node-server/serve-static` (used at `stoa-server/src/routes/static.ts:9,14,17`) already accepts `root`, `path: 'index.html'`, and `rewriteRequestPath` for SPA fallback rewrites — its shipped TypeScript signature is:

```ts
// @hono/node-server@1.19.14 — node_modules/.pnpm/@hono+node-server@1.19.14_hono@4.12.25/node_modules/@hono/node-server/dist/serve-static.d.ts
type ServeStaticOptions<E extends Env = Env> = {
    root?: string; path?: string; index?: string;
    precompressed?: boolean;
    rewriteRequestPath?: (path: string, c: Context<E>) => string;
    onFound?: ...; onNotFound?: ...;
};
declare const serveStatic: <E extends Env = any>(options?: ServeStaticOptions<E>) => MiddlewareHandler<E>;
```

So the current static route at `stoa-server/src/routes/static.ts:14,17` (using `root: './dist/web'` and `path: 'index.html'`) is the textbook SPA-fallback pattern; no new infra is needed.

#### 2. Serving Vite-Built Assets from Hono on Node

**Authoritative pattern (the one already in the repo, with one known gap):**

```ts
// stoa-server/src/routes/static.ts:11-17
export const staticRoutes = new Hono();
staticRoutes.use('/assets/*', serveStatic({ root: './dist/web' }));        // hashed assets
staticRoutes.get('*', serveStatic({ root: './dist/web', path: 'index.html' })); // SPA fallback
```

Mount order matters: the static route is mounted last in `app.ts` so `/api/v1`, `/ctl`, `/hooks`, and the WS upgrade take priority. The audit (`research/2026-06-12-stoa-server-web-client-migration-audit.md`, lines 122-128) already flagged that 404s for unknown API paths will be silently swallowed by the SPA fallback `*` route if the mount order ever regresses. Concretely: API 404s must be returned as JSON, not the SPA HTML.

**Vite build that emits into `stoa-server/dist/web/`:**

The renderer is currently built by `electron-vite` to `out/renderer/`. For web, a sibling `vite.web.config.ts` is the cleanest path (mirrors what `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` already concluded at line 23 and the prior report's open question at line 168). The web config must:

1. Set `root: 'src/renderer'` and `base: '/'`.
2. Reuse the existing plugins (`@vitejs/plugin-vue`, `@tailwindcss/vite`, `@intlify/unplugin-vue-i18n`).
3. Set `build.outDir: path.resolve(__dirname, 'stoa-server/dist/web')` (relative to repo root) and `build.emptyOutDir: true`.
4. Mark `electron`, `electron-vite`, `node-pty` as `optimizeDeps.exclude` and `build.rollupOptions.external` so the web bundle does not try to bundle them.
5. Add `define: { __STOA_WEB_MODE__: 'true' }` so the renderer can feature-gate `TitleBar`, `UpdatePrompt`, `NewProjectModal` (folder picker), and `node-pty`-backed terminal at build time without a runtime `typeof window !== 'undefined' !== 'electron'` check.

Vite's `base` is the only SPA-serve knob: with `base: '/'`, hashed assets end up under `/assets/` and the static `use('/assets/*', ...)` route serves them. The `index.html` entry's `<script type="module" src="/assets/index-[hash].js">` resolves against the same origin, so auth cookies and the `?token=` query both work.

**Gap to fill now:** the `dist/web/` directory does not exist (`research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` line 56, line 110). The static route already handles the *serving* side; the missing piece is the *build* side.

#### 3. Replacing Electron Preload/IPC with Browser-Safe HTTP + WebSocket

The repo already has the replacement built. The plan is to **stop using `window.stoa` and route everything through `StoaClient` + `StoaClientPreloadAdapter`**, with the existing feature flag (`VITE_USE_STOA_CLIENT=1`) promoted from "optional in stores" to "the only path in web mode."

**Concrete steps, citing the exact files:**

1. **Drop the `window.stoa` branch from `App.vue`.** All 18 call sites are unconditional `window.stoa.*` (audit v2, line 54; renderer audit line 38). Replace with:
   - `initStoaClientForStores(window.location.origin, new URLSearchParams(location.search).get('token') ?? '')` — already exists at `src/renderer/stores/stoa-store-plugin.ts:28-56`, lines 28, 32, 37.
   - `await workspaceStore.hydrateFromStoaClient()` — already exists at `src/renderer/stores/workspaces.ts:243-251`.
   - `workspaceStore.subscribeToSessionGraphViaStoaClient()` and `subscribeToObservabilityViaStoaClient()` — already at `workspaces.ts:253-283`.
   - `settingsStore.loadSettings()` (already dual-pathed at `settings.ts:37,48,59,70,81`).
   - `sidebarStore.fetchSidebarState/persistSidebarState` (already dual-pathed at `sidebar.ts:101,116`).
   - The 5 stores that have *no* StoaClient path today (`update`, `git`, `search`, plus `useFileTree`, `useFileOperations` composables) need new adapter methods — the prior report (`migration-audit.md` lines 130-133) enumerated the missing server routes (`/api/v1/fs/*`, `/api/v1/git/*`); those routes are not on the server yet and are the biggest remaining gap.

2. **Auth boundary.** The server's bearer-token middleware (`stoa-server/src/middleware/auth.ts:21`, cited in `migration-audit.md` line 160) already accepts `Authorization: Bearer <token>`. The browser does not have a way to store a secret token, so the threat model shifts: in **web mode the token is treated as a capability URL** — the server generates it on server start, prints it to stdout, and the user opens `http://127.0.0.1:PORT/?token=...`. The token is sent only over the loopback/LAN path and is never persisted in browser storage. The `StoaClient` already passes it as `Authorization: Bearer <token>` on every request (`src/renderer/lib/stoa-client.ts:61-286`). The discovery endpoint (`stoa-server/src/routes/discovery.ts:19, 47-49`) does not require auth and is the safe bootstrap.

3. **WebSocket auth.** `WsHub.addClient(ws, token?)` (`stoa-server/src/ws/hub.ts:23-33`) already accepts an optional token for future auth. In web mode the client passes the token either in the `?token=` query string of the WS URL or in `Sec-WebSocket-Protocol: bearer, <token>` — the latter is the only browser-safe place to send a secret, because the WS handshake lets the server see the protocol header before upgrade. Once upgraded, the `StoaClient` reuses the existing reconnect-with-replay behavior (1s → 30s exponential backoff, `getMissedEvents()` on reconnect — audit v2 line 42).

4. **Wire the WS upgrade on the server.** This is the one piece the audit (`migration-audit.md` lines 99, 128) explicitly flagged as missing. With `@hono/node-server@1.19.14` and `hono@4.12.25` installed locally, there is **no `createNodeWebSocket` helper** in either package's `.d.ts` exports (verified: only `serve`, `getRequestListener`, `createAdaptorServer` are exported from `@hono/node-server/dist/index.d.ts`; the only `upgradeWebSocket` re-exports are in `hono/bun`, `hono/deno`, `hono/cloudflare-workers` adapter modules). The shipped patterns for Hono on Node are therefore either:

   - **Recommended:** drop down to the underlying `http.Server` returned by `serve()` and attach the `upgrade` event directly, then call `WsHub.addClient({ send, close })` for each new `WebSocket` (the `ws` npm package is the most common pairing). This is what `honojs/node-server` examples show and matches the existing `WsLike` interface in `stoa-server/src/ws/hub.ts:9-12`.
   - **Alternative:** use the third-party `@hono/node-ws` companion, which is the upstream community package but is not currently a dependency of this repo. Adding it would be a breaking dependency change; the manual `http.Server.upgrade` path is one-time code (~30 lines) and uses the same `ws` library the renderer will use on the browser side.

   Either way, the `WsHub` itself does not change; only the integration point does.

5. **CSP and origin.** The renderer's current CSP (`src/renderer/index.html:7`, cited in `migration-audit.md` line 150) is `default-src 'self'; connect-src 'self' http://127.0.0.1:*`. In web mode `connect-src` must include the server's own origin and `ws://` / `wss://` for the same host. The server origin and the WS origin are identical in the local-first deployment, so the existing `'self'` already covers it; only LAN mode (`--lan`) requires widening the CSP allow-list, and that can be done at the static `index.html` build time (the server controls the artifact, so this is not a per-user concern).

#### 4. Browser Terminal / Session Streaming

The renderer already uses xterm.js (`@xterm/xterm@6.1.0-beta.216` per `package.json:43`). The streaming concern is the **server side**, not the browser: how the local `node-pty` process is connected to the browser's xterm WebSocket.

**Current state:** the terminal currently runs in two places depending on the deployment:
- In Electron, `node-pty` is spawned in the main process and its I/O is forwarded to the renderer via IPC (`research/2026-05-05-vscode-terminal-stack.md` and the project's `terminal-integration-architecture-review.md`).
- In `stoa-server`, the runtime bridge is a **stub returning 503** (`stoa-server/src/index.ts:84-85`, `createStubRuntimeBridge()`; confirmed by `migration-audit.md` lines 84, 135). There is no real `node-pty` process attached to the WS hub.

**Best practice for the web path** (matching the rest of this codebase's WS framing, no new transport):

1. Server-side: spawn `node-pty` for the requested session when a WebSocket attaches with a session subscription filter. Pipe `pty.onData(data)` → `ws.send(JSON.stringify({ type: 'session:terminal-data', sessionId, payload: { data: base64(data) } }))`. Pipe `ws.on('message', ...)` (binary) → `pty.write(Buffer.from(payload.data, 'base64'))`. This matches the existing `StoaClient.sendBinaryInput` shape (base64 over WS, audit v2 line 42) and the `session:terminal-data` event type in `stoa-server/src/ws/events.ts:3-16`.
2. Resize: the existing `POST /api/v1/sessions/:id/resize` endpoint and its WS counterpart — keep them. xterm.js's `@xterm/addon-fit` measures pixel dimensions client-side and posts them through the same channel.
3. Replay: `WsHub` already keeps `MAX_EVENT_HISTORY = 1000` (`hub.ts:24`) and exposes `getMissedEvents()` for reconnection replay. Replay is sufficient for short-lived reconnects; for long disconnects, a `GET /api/v1/sessions/:id/terminal-replay?cursor=...` route (already in the route map at `stoa-server/src/routes/sessions.ts:77`) is the backfill source.
4. xterm.js itself is browser-native and does not need any adapter — the renderer component `TerminalViewport.vue` is reusable as-is once the I/O source is `StoaClient` instead of `window.stoa`.

**Backpressure and flow control** (community-known gotcha): xterm.js's `term.write()` is fast for ANSI rendering but does not pace against the server. The codebase already addressed this in `research/2026-05-05-xtermjs-write-batching-coalescing.md` — apply the same coalescer on the server side before `ws.send`. Do not introduce a per-frame `setTimeout` or a worker thread; the existing pattern is in scope.

#### 5. Recommendation for this Repo

**Use a static-only Vue SPA built by a sibling `vite.web.config.ts`, served by the existing `staticRoutes` in `stoa-server`, with the `StoaClient` library as the only renderer ↔ server boundary.** Reuse every existing adapter, store, and component. The work that actually needs to happen is:

1. **Build the SPA:** add `vite.web.config.ts` (root `src/renderer`, base `/`, plugins from the existing renderer config, externalize `electron` + `node-pty`, output to `stoa-server/dist/web/`). Add a `build:web` script and a `webServer` block in `playwright.config.ts` (the existing playwright config is Electron-only — `research/2026-06-12-playwright-web-ui-parity-context.md` flagged this).
2. **Promote the dual path to a single path in web mode:** set `VITE_USE_STOA_CLIENT=1` for the web build, and rewrite the 18 unconditional `window.stoa.*` call sites in `App.vue` to go through `initStoaClientForStores` + the StoaClient-aware store methods. The desktop Electron build keeps the IPC path and the web build is the only one that sets the flag (vite's `define` handles this without a runtime check).
3. **Wire WebSocket upgrade on the server:** attach the `upgrade` event to the `http.Server` returned by `serve()` in `stoa-server/src/index.ts:174`, hand each new socket to `WsHub.addClient`. The `WsHub` itself does not change.
4. **Fill the missing server routes:** add `/api/v1/fs/*` and `/api/v1/git/*` route groups (enumerated in `migration-audit.md` lines 130-133), because the renderer's `git` and `search` stores plus `useFileTree` and `useFileOperations` composables call them through the adapter and will throw at runtime otherwise.
5. **Wire PTY in `stoa-server`:** replace `createStubRuntimeBridge()` with a real bridge that owns a `node-pty` process per active session and pipes its I/O to the WebSocket hub. This is the largest single piece of work and the one with the most local-platform risk (Windows ConPTY vs. Unix `forkpty`); keep it gated behind a feature flag and a per-platform test, per the project's existing rules.
6. **Degrade desktop-only UI:** hide `TitleBar`, `UpdatePrompt`, the folder picker in `NewProjectModal` behind `__STOA_WEB_MODE__`. The renderer audit (`research/2026-06-12-renderer-ui-and-state-boundary-audit.md` line 38) already names every one of these as needing a web-mode branch.

Do not do this in a backwards-compatible way. Per the project rule "we are in prototype stage, all improvements are breaking changes", retire the IPC bridge and the `--web` flag's "placeholder HTML" path as soon as the SPA exists.

### Tradeoff Table

| Choice | Pro | Con | Verdict |
|---|---|---|---|
| SPA static-only (vs SSR) | Zero new runtime, hydration-free, matches the no-router renderer as-is. `serveStatic` already wired. | No first-paint SEO (irrelevant for localhost). | **Pick.** |
| SPA static-only (vs SSR-hybrid) | One render path, no islands API to learn. | Pays for SSR infrastructure without local-app benefit. | **Reject.** |
| `vite.web.config.ts` sibling (vs grafting onto `electron.vite.config.ts`) | Clean separation; web build can `define: __STOA_WEB_MODE__` without polluting Electron's main/preload config. | One extra config file to maintain. | **Pick.** |
| Reuse `StoaClient` + `StoaClientPreloadAdapter` as the only web path (vs a fresh web-specific client) | Adapter is fully implemented and tested (audit v2 lines 42-43); zero new client code. | Need to delete the legacy `window.stoa` branches, which is breaking. | **Pick.** Breaking is the project norm. |
| `?token=` capability URL (vs session cookie / OIDC) | Single hop, no cookie origin issues, no third-party auth dep, token never leaves the loopback unless `--lan`. | Token is visible in browser history and stdout; acceptable for a localhost tool. | **Pick.** |
| WS via `http.Server.upgrade` (vs `@hono/node-ws` companion) | No new dependency, ~30 lines, uses the `ws` package the browser side already targets. | Hand-rolled upgrade handler; not a Hono-supplied helper. | **Pick** for now. Migrate to `@hono/node-ws` later if it stabilizes. |
| Reuse `WsHub` + `session:terminal-data` event framing (vs a separate terminal stream) | One transport, one auth boundary, one reconnection model, replay already works. | xterm binary data goes through base64; ~33% bandwidth overhead. | **Pick.** Localhost bandwidth is not the constraint. |
| Server-owned `node-pty` per session (vs browser-WS to a sidecar Electron runtime) | Removes Electron from the browser path entirely. | Two terminal runtimes to maintain in the codebase (server's PTY, Electron's PTY) until Electron is retired. | **Pick for web**, keep the Electron path for desktop until the server's PTY is hardened. |

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Hono version installed | `stoa-server/package.json:17` | `"hono": "^4.7.0"` (resolved to 4.12.25) |
| `@hono/node-server` version installed | `stoa-server/package.json:16` | `"@hono/node-server": "^1.14.0"` (resolved to 1.19.14) |
| `serveStatic` accepts `root` + `path: 'index.html'` | local type defs | `node_modules/.pnpm/@hono+node-server@1.19.14_hono@4.12.25/node_modules/@hono/node-server/dist/serve-static.d.ts:1-17` |
| `serveStatic` supports `rewriteRequestPath` for SPA rewrites | local type defs | same `.d.ts:11` |
| `@hono/node-server` does not export `createNodeWebSocket` | local `.d.ts` | `node_modules/.pnpm/@hono+node-server@1.19.14_hono@4.12.25/node_modules/@hono/node-server/dist/index.d.ts:1-9` |
| Hono core has no Node-side `upgradeWebSocket` | grep over local `.d.ts` | only `hono/bun`, `hono/deno`, `hono/cloudflare-workers` adapter modules export it |
| Static route already wired | `stoa-server/src/routes/static.ts:14-17` | `serveStatic({ root: './dist/web' })` + SPA fallback |
| WS hub exists, upgrade not wired | `stoa-server/src/ws/hub.ts:23-93`, `stoa-server/src/index.ts:174` | `WsHub` complete; `serve({ fetch, port })` without `upgrade` |
| `StoaClient` + `StoaClientPreloadAdapter` already implement full `RendererApi` | `src/renderer/lib/stoa-client.ts:61`, `src/renderer/lib/stoa-client-preload-adapter.ts:64` | Full REST + WS + binary terminal input |
| Pinia plugin already exposes `initStoaClientForStores` | `src/renderer/stores/stoa-store-plugin.ts:28-56` | `initStoaClientForStores(baseUrl, token)` |
| `App.vue` has 18 unconditional `window.stoa.*` sites | audit v2 | `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md:54` |
| Missing server routes for web (fs, git) | audit | `research/2026-06-12-stoa-server-web-client-migration-audit.md:130-133` |
| Runtime bridge is a 503 stub | `stoa-server/src/index.ts:84-85` | `createStubRuntimeBridge()` |
| Playwright config is Electron-only | audit | `research/2026-06-12-playwright-web-ui-parity-context.md` |
| Renderer has no `vue-router` | audit | `research/2026-06-12-renderer-ui-and-state-boundary-audit.md:41` |
| Terminal backpressure pattern documented in repo | prior research | `research/2026-05-05-xtermjs-write-batching-coalescing.md` |
| Project's "no backwards compatibility" rule | CLAUDE.md | "不允许写任何兼容性代码" |

### Risks / Unknowns

- [!] **`node-pty` on the server side is the highest-risk piece.** Windows ConPTY behavior, signal handling, and resize semantics differ from the Electron main-process path. The audit migration plan should not retire Electron's terminal path until the server-side PTY has been validated on the same host.
- [?] Whether to add `@hono/node-ws` as a dependency (cleaner upgrade handler) or hand-roll the `http.Server.upgrade` glue. The hand-rolled path is ~30 lines; `@hono/node-ws` adds a dep but is the more standard Hono-Node WS pattern. **Recommendation:** start with the hand-rolled path (one less dep), revisit when a real second WS use case appears.
- [?] Whether the token in the `?token=` query string survives a Vite dev-server HMR reload (the user-facing dev workflow). If the URL gets normalized, the token can be lifted into a `stoa_token` `localStorage` entry — but that widens the threat model, so default to keeping it in the URL.
- [!] The CSP in `src/renderer/index.html:7` needs the same-origin `ws:` added for the WebSocket to connect. Since `'self'` covers the same-origin WS, no actual change is needed for loopback. For LAN mode, the connect-src directive will need to widen, and that is build-time controlled by the Vite plugin (not a runtime concern).
- [?] How the server's PTY should be cleaned up when a WS disconnects. The current `WsHub.removeClient` does not know about PTY lifecycles; this is a new responsibility that does not exist in the stub bridge.
- [?] Whether the existing `e2e-test.mjs` (audit v2 line 39, 16 HTTP-based checks) should be promoted into the Playwright suite as the "web smoke" journey, or kept as a separate Node-only smoke. Recommendation: keep both, but the Playwright one is the one that gets maintained.

### Reused Prior Research

- `research/2026-06-12-stoa-server-web-ui-routes-testids-e2e-coverage.md` — full route map and the empty `dist/web/` fact.
- `research/2026-06-12-stoa-server-web-client-migration-audit.md` — gap list (no Vite web build, no WS upgrade, missing fs/git routes, 503 runtime bridge) — every item is reused as the "what to build" list in section 5 above.
- `research/2026-06-12-stoa-server-web-client-migration-audit-v2.md` — confirmation that prior reports are still accurate against `b0fd14e`, the 18 unconditional `window.stoa.*` sites in `App.vue`, and the fact that the `StoaClient` library is the reusable asset.
- `research/2026-06-12-renderer-ui-and-state-boundary-audit.md` — the per-component / per-store / per-composable breakdown of which files need a rewrite vs. lift-as-is, used to scope step 6 of section 5.
- `research/2026-05-05-xtermjs-write-batching-coalescing.md` — terminal backpressure pattern that must be applied to the server-side PTY→WS pipeline.

No new community search was needed; the local installed packages and the prior audit reports are the authoritative sources for this repo's versions. The community evidence budget was spent only on the SPA-vs-SSR verdict, where the prior reports do not commit to a choice.
