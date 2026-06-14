---
date: 2026-06-14
topic: SR-mandatory architecture migration — interface consistency audit (read-only context)
status: completed
mode: context-gathering
sources: 24
---

# Context Report: SR-Mandatory Migration Interface Consistency Audit

## Why This Was Gathered

The codebase is migrating from "Stoa Server is optional" to "Stoa Server is mandatory and is the only core." Before finalising that migration, this audit collects the interface-consistency facts an implementation agent needs: do the renderer client, the Electron runtime client, and the SR routes/handler actually agree on paths, wire shapes, and wiring? This report is **read-only context** — it surfaces mismatches and gaps but does not propose fixes or modify code.

Scope: `src/renderer/lib/stoa-client-preload-adapter.ts`, `src/renderer/lib/stoa-client.ts`, `src/main/stoa-runtime-client.ts`, `src/main/index.ts`, `src/preload/index.ts`, `stoa-server/src/{index,app}.ts`, `stoa-server/src/routes/{sessions,projects,webhooks,runtime-bridge}.ts`, `stoa-server/src/ws/{runtime-bridge-handler,role-router,events,hub}.ts`, `stoa-server/src/services/{runtime-bridge-client,session-event-processor}.ts`.

## Summary

The REST surface between the renderer adapter and SR sessions routes is largely consistent, with two concrete shape/param bugs (`terminal-replay`, `context export maxChars`). The **runtime-bridge WebSocket protocol is critically broken in the client→server direction**: the Electron `StoaRuntimeClient` wraps every outbound frame in a `{ type, payload }` envelope, but the SR `RuntimeBridgeHandler.handleMessage` expects flat top-level fields — so every provider response and every terminal-data frame is silently dropped, every command times out, and the first launch of any session cannot even find a provider. Transition flags are mostly already removed from source; only a dead `VITE_USE_STOA_CLIENT` define and a non-existent `/api/v1/electron/shadow-state` call remain.

---

## Key Findings

### F1 — REST paths: renderer adapter ↔ SR sessions routes (mostly consistent)

All headline session endpoints match between `StoaClientPreloadAdapter` and `stoa-server/src/routes/sessions.ts`:

| Adapter method | Adapter call | Route | Match |
|---|---|---|---|
| createSession | `POST /api/v1/sessions` | `routes.post('/sessions')` sessions.ts:112 | ✓ |
| setActiveSession | `PUT /sessions/:id/active` | sessions.ts:163 | ✓ |
| archiveSession | `PUT /sessions/:id/archive` | sessions.ts:171 | ✓ |
| restoreSession | `PUT /sessions/:id/restore` | sessions.ts:179 | ✓ |
| restartSession | `POST /sessions/:id/restart` | sessions.ts:187 | ✓ (path) |
| regenerateSessionTitle | `PUT /sessions/:id/title` | sessions.ts:196 | ✓ |
| listArchivedSessions | `GET /sessions?archive=archived` | sessions.ts:81 | ✓ |
| getTerminalReplay | `GET /sessions/:id/terminal-replay` | sessions.ts:216 | ✓ path, ✗ shape (F2) |
| sendSessionInput | `POST /sessions/:id/input` | sessions.ts:225 | ✓ |
| sendSessionResize | `POST /sessions/:id/resize` | sessions.ts:244 | ✓ |
| listSessionEvidence | `GET /sessions/:id/evidence` | sessions.ts:279 | ✓ |
| contextExportFullText | `GET /sessions/:id/context/full` | sessions.ts:288 | ✓ path, ✗ params (F3) |
| contextExportSlimText | `GET /sessions/:id/context/slim` | sessions.ts:307 | ✓ path, ✗ params (F3) |
| uninstallSidecars | `DELETE /projects/:id/sidecar` | sessions.ts:265 | ✓ (route always 503) |
| getBootstrapState | `GET /api/v1/bootstrap` | projects.ts:81 (mounted /api/v1) | ✓ |

### F2 — `getTerminalReplay` shape mismatch

- Adapter declares a `string` return and unwraps `res.data!` as a string: `src/renderer/lib/stoa-client-preload-adapter.ts:107-110`.
- Route returns `envelope({ sessionId, replay })` — an **object**, not a bare string: `stoa-server/src/routes/sessions.ts:216-223`.
- The renderer therefore receives `{ sessionId, replay }` where its type claims a `string`. Latent runtime bug (only reachable once the runtime bridge itself works — see F4/F5).

### F3 — Context-export query-param mismatch

- Adapter sends `maxChars` (and `cursor`, `includeThinking`, `includeToolDetails`) as query params: `stoa-client-preload-adapter.ts:390-391, 404-405`.
- Route reads `c.req.query('maxLength')` (note: different name) and never reads `cursor`/`includeThinking`/`includeToolDetails`: `sessions.ts:292-294, 310-313`.
- Net: adapter's `maxChars` is ignored (route always defaults to 100000), and `nextCursor` (expected by the adapter return type at line 386) is never produced. These are stub routes (return empty text), so impact is limited until real context assembly is wired.

### F4 — CRITICAL: Runtime-bridge WS shape mismatch (client→server direction)

Two different wire protocols are conflated. The WsHub *renderer* protocol uses a `{ type, payload }` envelope (`stoa-server/src/ws/events.ts:38-43` `WsClientMessage`). The *runtime-bridge* protocol uses **flat** shapes (`stoa-server/src/ws/runtime-bridge-handler.ts:33-62` `RuntimeCommand`/`RuntimeResponse`/`ProviderInboundMessage`). The Electron `StoaRuntimeClient` was written against the envelope; the handler expects flat.

**Server → Client (commands): consistent.** `RuntimeBridgeHandler.sendCommand` sends a flat `wireCommand = { type, sessionId, payload, replyTo }` (`runtime-bridge-handler.ts:259-264`); `StoaRuntimeClient.handleMessage` reads `message.type`/`message.replyTo` at top level (`stoa-runtime-client.ts:214`). ✓

**Client → Server (responses + terminal-data): BROKEN.**

- `StoaRuntimeClient.sendResponse` sends `{ type: 'runtime:response', payload: { replyTo, ok, data, error } }` (`stoa-runtime-client.ts:372-377`).
- `StoaRuntimeClient.forwardTerminalData` sends `{ type: 'runtime:terminal-data', payload: { sessionId, data } }` (`stoa-runtime-client.ts:361-366`).
- `RuntimeBridgeHandler.handleMessage` checks `frame.replyTo` (top-level) to route responses (`runtime-bridge-handler.ts:341`), and checks `frame.sessionId`/`frame.data` (top-level) to route terminal data (`runtime-bridge-handler.ts:346`). Both are nested under `payload` by the client, so both checks fail and the frames are **silently dropped**.
- No unwrapping exists on the path: `role-router.bindRuntimeConnection` passes the raw frame straight to `handleMessage` (`role-router.ts:180-181`).

Consequences:
- Every `runtime:*` command issued by SR **times out** (30s for launch, 5s for input/resize) because the provider's `ok` response never resolves the pending command.
- **No terminal output is ever broadcast** to WS subscribers — `session:terminal-data` events never fire because `onTerminalData` hook is never invoked.
- This is not caught by tests: no test wires a real `StoaRuntimeClient` against a real `RuntimeBridgeHandler` (grep of `tests/` for `StoaRuntimeClient` returns nothing); the handler's own tests inject flat frames directly and pre-assign sessions (`runtime-bridge-handler.test.ts:83-105`).

Secondary symptom: `WS_CLIENT_MESSAGE_TYPES` lists `'runtime:response'` (`events.ts:25`), but that list is only consulted by the *web* client path (`role-router.handleWebMessage`, `role-router.ts:306`), which runtime providers never traverse. The entry is vestigial/dead.

### F5 — First launch cannot find a provider (`no_provider`)

`RuntimeBridgeHandler.sendCommand` resolves the target provider via `getProviderForSession(sessionId)`, which scans each provider's `managedSessions` set (`runtime-bridge-handler.ts:245-256, 366-373`). A brand-new session is in **no** provider's `managedSessions`. The only assignment paths are:

1. `handleResponse` after a *successful* `runtime:launch`/`runtime:create-child-session` (`runtime-bridge-handler.ts:444-449, 485`) — chicken-and-egg for the first launch.
2. `handleStateSync` triggered by an inbound `runtime:state-sync` frame (`runtime-bridge-handler.ts:477-494`).

`StoaRuntimeClient` **never sends a `runtime:state-sync` frame on connect** — grep of `stoa-runtime-client.ts` for `state-sync`/`pty-state` returns nothing. `connect()` only opens the socket (`stoa-runtime-client.ts:127-173`). There is no "route to any available provider" fallback in `sendCommand`, and no production code calls the public `assignSession` directly (only tests do).

Therefore the first `runtime:launch` for any session throws `RuntimeBridgeError('no_provider')`. This affects the restart route (`sessions.ts:187-194` → `runtimeBridge.launch`) and any future create→launch path.

Additionally, session **creation** (`POST /sessions` → `manager.createSession`, `sessions.ts:112-161`) creates only a record — it does **not** trigger a PTY launch. The **only** launch trigger currently wired in SR is `POST /sessions/:id/restart`. The normal "create session → terminal appears" flow is not wired through the runtime bridge at all.

### F6 — `stoa-server/src/index.ts` wiring (mostly complete)

Wiring present and correct:
- `RuntimeBridgeHandler` + `createLiveRuntimeBridge` (`index.ts:96-97`); passed into `SessionEventProcessor` whose constructor calls `setHooks` to wire terminal-data/provider-disconnect hooks (`session-event-processor.ts:172-175, 201-233`).
- Webhook `onEvent` → `sessionEventProcessor.processEvent` (`index.ts:188-191`).
- Discovery routes mounted with `webClient`/`lanMode` options (`app.ts:66`, `index.ts:207-211`).
- Static web client mounted last when `serveWeb` (`app.ts:82-84`).
- WS role router wires `hub` + `runtimeBridgeHandler` + `dispatchBinaryInput` (binary input decodes base64→latin1 then calls `runtimeBridge.input`) (`index.ts:226-255`).

Wiring gaps/weaknesses:
- `getSessionSecret` returns the single hardcoded `authToken` for **any** existing session (`index.ts:196-200, 60`). Session-level secrets are not enforced — all sessions share the server token.
- Observability getters are stubs: `getSessionPresence`/`getProjectObservability` return `null`, `getAppObservability` returns zeroes, `listSessionEvents` returns empty (`index.ts:109-131`). The `session_events` table is populated by `SessionEventProcessor.persistEvent` (`session-event-processor.ts:347-369`) but is never read back through any route.
- SR is now spawned **unconditionally** (`srSpawner.spawn()` → `waitForHealth()` → `connectRuntime()`), no longer gated by a flag (`src/main/index.ts:1505-1510`). `createRuntimeClient` is fully implemented and returns a real `StoaRuntimeClient` wired to `ptyHost`/`runtimeController` (`src/main/index.ts:1452-1502`). The old "returns null" state referenced in stale session notes is gone.

### F7 — Residual transition flags

- `STOA_USE_SERVER` — **removed from source**. Grep of `src/`, `stoa-server/src/`, vite configs returns nothing; only present in built bundle (`stoa-server/dist/web/...`) and a stale `.stoa/sessions.json` note. ✓
- `stoaServerEnabled` — **removed from source** `.ts`/`.vue`. The settings store no longer references it; only the stale built bundle and the `.stoa/sessions.json` note still contain it. ✓
- `VITE_USE_STOA_CLIENT` — **still present and dead**: defined in `vite.web.config.ts:12` as `'import.meta.env.VITE_USE_STOA_CLIENT': '"1"'`, but **no source file reads `import.meta.env.VITE_USE_STOA_CLIENT`**. Pure dead define.

Renderer is already SR-mandatory: `window.stoa` is no longer exposed by the preload (`src/preload/index.ts` only `exposeInMainWorld('stoaElectron', …)`); instead the renderer bootstraps `window.stoa = new StoaClientPreloadAdapter(client)` itself in both `bootstrap-electron.ts` and `bootstrap-web.ts` (desktop mixin `Object.assign(adapter, nativeBridge)` for window/dialog/update/shell). The store plugin's `getRendererApi()` falls back to that injected adapter (`stoa-store-plugin.ts:28-34`).

### F8 — Non-existent route call: `/api/v1/electron/shadow-state`

- `src/main/index.ts:1009-1031` (`syncShadowStateToStoaServer`) issues `PUT ${baseUrl}/api/v1/electron/shadow-state`.
- **No such route exists in stoa-server.** Grep of `stoa-server/src/` for `shadow-state`/`shadowState`/`electron/` (excluding tests) returns nothing. The `/api/v1` group in `app.ts:71-78` mounts projects/sessions/settings/observability/meta-sessions/sidebar/fs/git — there is no `electron` subgroup, and `app.ts` has no catch-all that would synthesise it (static fallback only fires for `--web`, `app.ts:82-84`).
- The call would therefore 404 (or be shadowed by the static web client if `--web`). Either the endpoint was never implemented server-side or the call is dead code left over from an earlier migration design where Electron pushed its in-memory state into SR.
- For contrast, the sibling `mirrorCanonicalEventToStoaServer` posts to `/events` (`src/main/index.ts:1038`), and that route **does** exist (`stoa-server/src/routes/webhooks.ts:316`). So only the shadow-state call is orphaned.

---

## Evidence Chain

| Finding | Source | Location |
|---|---|---|
| F1 sessions REST paths consistent | sessions.ts | `stoa-server/src/routes/sessions.ts:81-323` |
| F1 adapter REST mappings | adapter | `src/renderer/lib/stoa-client-preload-adapter.ts:98-146, 376-411` |
| F1 bootstrap route exists | projects.ts | `stoa-server/src/routes/projects.ts:81` (mounted /api/v1, app.ts:71) |
| F2 terminal-replay shape mismatch | adapter + route | `stoa-client-preload-adapter.ts:107-110`; `sessions.ts:216-223` |
| F3 maxChars vs maxLength | adapter + route | `stoa-client-preload-adapter.ts:390-391,404-405`; `sessions.ts:292-294,310-313` |
| F4 client wraps response in payload | runtime client | `src/main/stoa-runtime-client.ts:372-377` |
| F4 client wraps terminal-data in payload | runtime client | `src/main/stoa-runtime-client.ts:361-366` |
| F4 server reads replyTo/sessionId at top level | handler | `stoa-server/src/ws/runtime-bridge-handler.ts:341,346` |
| F4 role-router passes raw frame, no unwrap | role-router | `stoa-server/src/ws/role-router.ts:180-181` |
| F4 flat command wire (server→client OK) | handler + client | `runtime-bridge-handler.ts:259-264`; `stoa-runtime-client.ts:214` |
| F4 vestigial runtime:response in WS_CLIENT_MESSAGE_TYPES | events | `stoa-server/src/ws/events.ts:25` |
| F4 no integration test wires real client↔handler | tests | grep `StoaRuntimeClient` in `tests/` → none |
| F5 sendCommand needs pre-assigned provider | handler | `stoa-server/src/ws/runtime-bridge-handler.ts:245-256,366-373` |
| F5 only assignment paths are response + state-sync | handler | `runtime-bridge-handler.ts:444-449,477-494` |
| F5 client never sends state-sync | runtime client | grep `state-sync`/`pty-state` in `stoa-runtime-client.ts` → none |
| F5 createSession does not launch PTY | sessions route | `sessions.ts:112-161` (manager.createSession only) |
| F6 SR spawned unconditionally | main | `src/main/index.ts:1505-1510` |
| F6 createRuntimeClient fully implemented | main | `src/main/index.ts:1452-1502` |
| F6 sessionEventProcessor wires bridge hooks | processor | `stoa-server/src/services/session-event-processor.ts:151-175,201-233` |
| F6 getSessionSecret uses shared authToken | index.ts | `stoa-server/src/index.ts:60,196-200` |
| F6 observability stubs | index.ts | `stoa-server/src/index.ts:109-131` |
| F7 STOA_USE_SERVER removed from source | grep | src/ + stoa-server/src/ + vite configs → none |
| F7 stoaServerEnabled removed from source | grep | src/ + stoa-server/src/ (.ts/.vue) → none |
| F7 VITE_USE_STOA_CLIENT dead define | vite.web.config.ts | `vite.web.config.ts:12`; no reader in src/ |
| F7 window.stoa set by renderer bootstrap | bootstrap | `src/renderer/bootstrap-electron.ts`; `src/renderer/bootstrap-web.ts`; preload only exposes stoaElectron `src/preload/index.ts:87` |
| F8 shadow-state call | main | `src/main/index.ts:1019` |
| F8 shadow-state route absent | grep | stoa-server/src/ (excl tests) → none; app.ts:71-78 no electron group |
| F8 /events route exists (sibling OK) | webhooks | `stoa-server/src/routes/webhooks.ts:316` |

---

## Risks / Unknowns

- [!] **F4 is a show-stopper for the runtime bridge.** Until the client→server frame shape is reconciled (flat vs envelope), the real Electron provider cannot complete a single command or stream any terminal data. This is the highest-priority item.
- [!] **F5 compounds F4.** Even after the shape is fixed, the first launch of a new session will fail with `no_provider` unless either (a) `StoaRuntimeClient` sends a connect-time `runtime:state-sync` of its live PTYs and/or SR assigns new sessions to a provider before launch, or (b) `sendCommand` gains a "any provider" fallback for `runtime:launch`. The intended design was not determinable from code alone.
- [!] **F8** — confirm whether `/api/v1/electron/shadow-state` is meant to exist (and the call is live) or whether `syncShadowStateToStoaServer` should be deleted. Its caller at `src/main/index.ts:581` (`void syncShadowStateToStoaServer()`) runs unconditionally; a 404 there would be swallowed only if `void` discards the rejection (it does **not** — an unhandled rejection would surface). Behaviour of that path needs runtime confirmation.
- [?] `uninstallSidecars` route always returns 503 by design ("Sidecar management is Electron-only", `sessions.ts:265-276`), while the adapter still calls it (`stoa-client-preload-adapter.ts:370-372`). Intentional desktop/server split, but worth confirming the renderer handles the 503 gracefully.
- [?] The create→launch gap (F5) may be intentional for the current prototype stage (sessions are launched from the Electron side via a different path not yet routed through SR). Not verifiable from these files alone — needs the session-launch wiring in `src/main/index.ts` (`launchSessionRuntimeWithGuard`, referenced at `index.ts:1469`) cross-checked against SR's expectation.
- [?] Built bundles under `stoa-server/dist/web/` and `out/renderer/` still reference `stoaServerEnabled`/`STOA_USE_SERVER`; these are stale build artefacts, not source, but they will resurface if the web client is rebuilt without the source removal being complete (it is complete in source).

---

## Context Handoff

Start here: `research/2026-06-14-sr-mandatory-interface-consistency-audit.md`

Context only. Use the saved report as the source of truth. Highest-priority items for the implementation/review loop: **F4** (WS shape mismatch — runtime bridge dead in client→server direction) and **F5** (first launch `no_provider` + no create→launch wiring). Secondary: **F2** (terminal-replay shape), **F3** (context export params), **F8** (orphaned shadow-state call), **F7** (dead `VITE_USE_STOA_CLIENT` define).
