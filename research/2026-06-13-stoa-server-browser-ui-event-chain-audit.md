---
date: 2026-06-13
topic: stoa-server browser UI server-side event chain audit
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Stoa Server Browser UI Server-Side Event Chain

### Why This Was Gathered
Determine exactly what is missing or broken in the stoa-server event pipeline before browser Playwright UI tests can work end-to-end.

### Summary
The stoa-server has a well-structured event chain architecture (webhook routes → SessionEventProcessor → WsHub broadcast → browser WS client), but **three critical wiring gaps** break the pipeline: (1) webhook routes are never mounted in `app.ts`, (2) `SessionEventProcessor` is never instantiated in `index.ts`, and (3) `dispatchBinaryInput` is not wired to the runtime bridge. Additionally, the web client build artifacts must exist for static serving to work.

### Key Findings

#### ❌ Critical Gap 1: Webhook routes NOT mounted in `app.ts`

`stoa-server/src/routes/webhooks.ts` defines `createWebhookRoutes()` with full provider adapter endpoints (`/events`, `/hooks/claude-code`, `/hooks/codex`, `/hooks/opencode`, `/memory-notifications`), but `app.ts` never imports or mounts them.

The `createApp()` function mounts these route groups:
- `/api/v1/discovery` (line 64)
- `/ctl` health (line 65)
- `/api/v1` projects (line 68)
- `/api/v1` sessions (line 69)
- `/api/v1` settings (line 70)
- `/api/v1` observability (line 71)
- `/api/v1` meta-sessions (line 72)
- `/api/v1` sidebar (line 73)
- `/api/v1` fs (line 74)
- `/api/v1` git (line 75)
- `/` static (line 80, conditional)

**Missing**: `app.route('/hooks', createWebhookRoutes(deps.webhooks))` — no webhook routes, no webhook deps in `AppDeps`.

**Impact**: Provider adapters (Claude Code, Codex, OpenCode) cannot deliver session events to the server. Without this, the browser UI receives zero session state updates.

#### ❌ Critical Gap 2: `SessionEventProcessor` NEVER instantiated in `index.ts`

`stoa-server/src/services/session-event-processor.ts` defines the full event processing pipeline:
- Accept `CanonicalSessionEvent` (from webhook routes)
- Build `SessionStatePatchEvent` and apply via `ProjectSessionManager`
- Persist raw event to `session_events` SQLite table
- Broadcast WS `session:state-patch` event
- Broadcast WS `observability:presence` event
- Trigger title generation on turn completion

But `index.ts` never creates a `SessionEventProcessor` instance. The constructor takes `SessionEventProcessorDeps` (manager, db, wsHub, runtimeBridge) — all of which are available in `index.ts` but never wired together.

**Impact**: Even if webhook routes were mounted and received events, nothing would process them into WS broadcasts. The browser client would never see session:state-patch, observability:presence, or session:terminal-data events.

#### ❌ Critical Gap 3: `dispatchBinaryInput` NOT wired in `index.ts`

`stoa-server/src/ws/role-router.ts` accepts an optional `dispatchBinaryInput` callback in `RoleRouterHandlers` (line 79). When a web client sends `session:binary-input`, `handleBinaryInput()` checks `handlers.dispatchBinaryInput` (line 354) — if absent, the input is silently dropped.

In `index.ts` lines 194–198:
```ts
const roleRouterHandlers: RoleRouterHandlers = {
  hub: wsHub,
  runtimeBridge: runtimeBridgeHandler,
  expectedToken: authToken,
  // dispatchBinaryInput is NOT set
};
```

The browser `StoaClient.sendBinaryInput()` (line 258) sends `session:binary-input` over WS, but the server silently drops it.

**Impact**: Terminal input from the browser UI (typing commands) goes nowhere. Users cannot interact with sessions.

#### ⚠️ Significant Gap 4: No WS initial state snapshot on connect

The `WsInitialState` and `WsMissedEvents` interfaces exist in `events.ts` (lines 57–73), and `WsHub.getMissedEvents()` is implemented (hub.ts:127). However:
- No code sends an initial state snapshot when a web client connects
- No code sends `ws:missed-events` on reconnection with `lastEventId`
- The browser client works around this via HTTP bootstrap (`getBootstrapState`) followed by `flushBuffer()`

This is a known design where the initial state comes from HTTP, not WS. The `StoaClient` expects this pattern (bootstrap-web.ts:28–36). It's functional but fragile.

#### ⚠️ Significant Gap 5: Web client build artifacts must exist

`resolveWebClientRoot()` in `shared/web-client-path.ts` checks for `dist/web/index.html`. The `--web` CLI flag enables static serving, but:
- `vite.web.config.ts` exists in the repo root for building the web client
- There's no indication `pnpm build:web` (or equivalent) has been run
- Without the build, `isWebClientAvailable()` returns false and static serving is skipped

#### ⚠️ Significant Gap 6: Webhook deps not in AppDeps

The `AppDeps` interface (app.ts:31–39) has no `webhooks` field. To wire webhook routes, `AppDeps` needs:
```ts
webhooks: WebhookRouteDeps;
```
Where `WebhookRouteDeps` provides `onEvent`, `onMemoryNotification`, `getSessionSecret`, `authorizeHookRequest`.

The `onEvent` callback should be wired to `SessionEventProcessor.processEvent()`.

### What IS Working

The following components are fully implemented and tested:

1. **WS role-router** (`role-router.ts` + test): Auth gate, role dispatch, subscribe/unsubscribe, binary-input routing — all tested ✓
2. **WS transport** (`transport.ts`): Hand-rolled RFC 6455 server — frame encode/decode, handshake, ping/pong ✓
3. **RuntimeBridgeHandler** (`runtime-bridge-handler.ts` + test): Provider registration, command dispatch, timeout, crash recovery — all tested ✓
4. **RuntimeBridgeClient** (`runtime-bridge-client.ts` + `runtime-bridge.ts`): Live + stub clients — tested via handler tests ✓
5. **WsHub** (`hub.ts` + test): Client management, broadcast, subscription filters — all tested ✓
6. **Webhook route validation** (`webhooks.ts` + test): Full validation, provider adapters — tested ✓
7. **Static route mount order** (`static-mount-order.test.ts`): Confirms API routes take priority over SPA fallback ✓
8. **Auth middleware** (`auth.ts`): Bearer token + session-scoped access ✓
9. **SessionEventProcessor** (`session-event-processor.ts`): Complete event processing logic — but untested in integration (never instantiated) ⚠️
10. **Browser StoaClient** (`stoa-client.ts`): HTTP + WS client with subscribe, reconnect, buffering ✓
11. **Browser bootstrap** (`bootstrap-web.ts`): Token from URL, StoaClient init, WS connect ✓

### Event Chain (As Designed vs. Current State)

```
As Designed:
  Provider Hook → POST /hooks/claude-code → webhookRoutes → onEvent →
    SessionEventProcessor.processEvent() → manager.applySessionStatePatch() +
    WsHub.broadcast('session:state-patch') → WS → Browser Client

Current:
  Provider Hook → POST /hooks/claude-code → ❌ 404 (routes not mounted)
  Even if routes worked → onEvent is undefined → ❌ no processing
  SessionEventProcessor → ❌ never instantiated → ❌ no WS broadcasts
  Browser binary input → WS → role-router → ❌ silently dropped (dispatchBinaryInput unset)
```

### Required Fixes for Playwright UI Tests

| # | Fix | File(s) | Effort |
|---|-----|---------|--------|
| 1 | Add `webhooks` to `AppDeps`, mount webhook routes in `createApp()` | `app.ts`, `webhooks.ts` | ~20 lines |
| 2 | Instantiate `SessionEventProcessor` in `index.ts`, wire its `onEvent` to webhook deps | `index.ts` | ~15 lines |
| 3 | Wire `dispatchBinaryInput` in `roleRouterHandlers` to `runtimeBridgeHandler` | `index.ts` | ~5 lines |
| 4 | Build web client (`vite.web.config.ts` → `dist/web/`) | Build step | Config |
| 5 | Add `lastEventId` reconnection to WS transport or role-router | `role-router.ts` or `transport.ts` | Optional |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Webhook routes not mounted | `app.ts` has no `createWebhookRoutes` import | `app.ts:1-96` |
| SessionEventProcessor never instantiated | `index.ts` has no `SessionEventProcessor` import | `index.ts:1-253` |
| dispatchBinaryInput not wired | `roleRouterHandlers` missing field | `index.ts:194-198` |
| Webhook route factory exists | `createWebhookRoutes()` fully implemented | `webhooks.ts:312-457` |
| SessionEventProcessor fully implemented | Class with full pipeline | `session-event-processor.ts:145-370` |
| WsHub broadcast works | Tested, subscribe/unsubscribe/filter | `hub.ts:23-150` |
| Role-router dispatches correctly | Tested with subscribe, binary-input | `role-router.ts:144-393` |
| Auth middleware allows discovery | Skip for /api/v1/discovery | `auth.ts:24-26` |
| WS transport implements RFC 6455 | Handshake, frame encode/decode | `transport.ts:1-408` |
| Browser StoaClient connects via WS | HTTP + WS, subscribe, reconnect | `stoa-client.ts:61-286` |
| Browser bootstrap reads token from URL | `readRequiredToken()` from query | `bootstrap-web.ts:11-19` |
| Static mount order verified | API routes beat SPA fallback | `static-mount-order.test.ts:76-118` |

### Risks / Unknowns

- [!] The hand-rolled WS transport (`transport.ts`) implements a minimal RFC 6455 subset. Browser WebSocket implementations may send edge-case frames (fragmented, binary) that aren't handled. This could cause intermittent Playwright failures.
- [!] The `SessionEventProcessor` depends on `StoaDb` for persisting events to `session_events` table. If the DB schema migration for this table hasn't run, `persistEvent()` will silently catch and log errors, but events will be lost.
- [?] The `StoaClient.connectWs()` connects to `/ws?token=...&lastEventId=...` but the server's `extractToken()` only reads `token` — `lastEventId` is parsed but never used for reconnection replay.
- [?] No integration test exists that wires the full chain: HTTP server + WS upgrade + role-router + WsHub + broadcast to a connected client. The existing tests are all unit-level with mocks.
