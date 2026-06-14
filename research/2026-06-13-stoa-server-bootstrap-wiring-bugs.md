---
date: 2026-06-13
topic: stoa-server bootstrap wiring bugs — SessionEventProcessor, webhook routes, notification:memory, dispatchBinaryInput
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Stoa Server Bootstrap Wiring Bugs

### Why This Was Gathered

The server entry point (`stoa-server/src/index.ts`) wires up services but has several critical gaps: the `SessionEventProcessor` is never instantiated, webhook routes are not mounted, memory notification broadcasts are never triggered, and the binary-input dispatch is silently dropped.

### Summary

The server bootstraps persistence, WsHub, ProjectSessionManager, RuntimeBridgeHandler, and meta-session services correctly, but **four major wiring gaps** exist: (1) `SessionEventProcessor` exists but is never imported or instantiated in `index.ts`; (2) webhook routes (`/events`, `/hooks/*`, `/memory-notifications`) are defined but never mounted in `createApp()`; (3) `notification:memory` WS events have a broadcast helper but no codepath ever invokes it; (4) `dispatchBinaryInput` is omitted from `roleRouterHandlers`, so all `session:binary-input` client messages are silently dropped.

### Key Findings

#### Bug 1: `SessionEventProcessor` Never Instantiated

`stoa-server/src/services/session-event-processor.ts` (370 lines) is a fully implemented service that:
- Accepts canonical session events from webhook routes
- Applies session state patches via `ProjectSessionManager`
- Persists events to `session_events` SQLite table
- Broadcasts WS `session:state-patch` and `observability:presence` events
- Triggers title generation on turn completion
- Wires `RuntimeBridgeHandler` hooks for terminal data forwarding

**However**, `index.ts` never imports or instantiates it. No `SessionEventProcessor` instance exists in the server runtime. This means:
- Webhook events have no processor to handle them
- No session state patches are ever applied from webhook payloads
- No WS broadcasts for state changes occur
- No event persistence to `session_events` table
- No title generation triggers

**Impact**: The entire event processing pipeline is dead code at runtime.

#### Bug 2: Webhook Routes Not Mounted

`stoa-server/src/routes/webhooks.ts` exports `createWebhookRoutes(deps)` which creates routes for:
- `POST /events` — canonical session events
- `POST /hooks/claude-code` — Claude Code provider adapter
- `POST /hooks/codex` — Codex provider adapter
- `POST /hooks/opencode` — OpenCode provider adapter
- `POST /memory-notifications` — memory runtime notifications

`stoa-server/src/app.ts` (`createApp()`) mounts these route groups:
- `/api/v1/discovery`, `/ctl`, `/api/v1` (projects, sessions, settings, observability, meta-sessions, sidebar, fs, git), and optionally `/` (static)

**Webhook routes are never mounted.** The `app.ts` comment at line 78 even references `/hooks` in a comment ("API routes (/api/v1, /ctl, /hooks) and WebSocket upgrades take priority"), but no `app.route('/hooks', ...)` call exists. The tests in `webhook-routes.test.ts` mount them manually in test Hono instances.

**Impact**: All webhook endpoints return 404. No provider (Claude Code, Codex, OpenCode) can submit events. Memory notification submissions fail.

#### Bug 3: `notification:memory` Broadcast Never Triggered

`stoa-server/src/ws/broadcast.ts:55` exports `broadcastMemoryNotification()` which creates a `notification:memory` WS event. The event type is registered in `WS_SERVER_EVENT_TYPES` (`events.ts:13`).

The only place `onMemoryNotification` is called is `webhooks.ts:438`:
```typescript
const result = await deps.onMemoryNotification?.({ ... })
```

Since webhook routes are not mounted (Bug 2) and even if they were, no `onMemoryNotification` handler is wired in `index.ts` (the `WebhookRouteDeps` would need to be constructed with a callback that calls `wsHub.broadcast('notification:memory', ...)`), **no `notification:memory` event is ever broadcast to WS clients**.

**Impact**: Memory notifications (recall, solidify, distill events) are received by the server but never forwarded to connected web clients.

#### Bug 4: `dispatchBinaryInput` Missing from `roleRouterHandlers`

`stoa-server/src/ws/role-router.ts:68-80` defines `RoleRouterHandlers` with an optional `dispatchBinaryInput?: (sessionId: string, base64Data: string) => void` property.

In `index.ts:194-198`:
```typescript
const roleRouterHandlers: RoleRouterHandlers = {
  hub: wsHub,
  runtimeBridge: runtimeBridgeHandler,
  expectedToken: authToken,
};
```

**`dispatchBinaryInput` is not provided.** The role router's `handleBinaryInput` function (`role-router.ts:344-368`) checks `if (!handlers.dispatchBinaryInput)` and returns silently when absent. All `session:binary-input` messages from web clients are dropped.

The correct wiring would be:
```typescript
dispatchBinaryInput: (sessionId, base64Data) => {
  runtimeBridgeHandler.sendCommand(sessionId, {
    type: 'runtime:input',
    payload: { data: base64Data }
  }).catch((err) => {
    console.warn('[index] binary-input dispatch failed:', err)
  })
}
```

**Impact**: Web clients cannot send terminal input to running sessions. PTY interaction from the browser is broken.

#### Additional Observation: `listSessionEvents` Stub

`index.ts:120-127` defines `listSessionEvents` as a stub that always returns empty:
```typescript
const listSessionEvents = (...) => ({
  events: [] as Array<{ payload: Record<string, unknown> }>,
  nextCursor: null as string | null,
  hasMore: false,
});
```

Even if `SessionEventProcessor` were wired (which persists events to `session_events` table), this stub doesn't query the DB. A real implementation would need to read from the SQLite `session_events` table.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionEventProcessor` not imported | `stoa-server/src/index.ts` |全文无 `session-event-processor` 引用 |
| `SessionEventProcessor` class exists | `stoa-server/src/services/session-event-processor.ts` | :145-370 |
| Webhook routes not mounted | `stoa-server/src/app.ts` | :49-84 — no `/hooks` route |
| Webhook routes defined | `stoa-server/src/routes/webhooks.ts` | :312-457 |
| `notification:memory` broadcast helper exists | `stoa-server/src/ws/broadcast.ts` | :55-57 |
| `notification:memory` in event types | `stoa-server/src/ws/events.ts` | :13 |
| `onMemoryNotification` callback definition | `stoa-server/src/routes/webhooks.ts` | :53-60 |
| `onMemoryNotification` invocation | `stoa-server/src/routes/webhooks.ts` | :438 |
| `dispatchBinaryInput` optional in interface | `stoa-server/src/ws/role-router.ts` | :79 |
| `dispatchBinaryInput` absent from handlers | `stoa-server/src/index.ts` | :194-198 |
| `handleBinaryInput` silent return | `stoa-server/src/ws/role-router.ts` | :354 |
| `listSessionEvents` empty stub | `stoa-server/src/index.ts` | :120-127 |
| Comment references `/hooks` as expected route | `stoa-server/src/app.ts` | :78 |
| RuntimeBridgeHandler.sendCommand available | `stoa-server/src/ws/runtime-bridge-handler.ts` | :245-311 |

### Risks / Unknowns

- [!] **Bug 1+2 combined**: Without SessionEventProcessor AND without webhook routes mounted, the server has no working event ingestion pipeline. This is a fundamental functionality gap.
- [!] **Bug 4**: Binary input dispatch missing means browser-based terminal interaction is completely broken.
- [?] The `WebhookRouteDeps` interface expects `onEvent` and `onMemoryNotification` callbacks. The correct wiring would construct `createWebhookRoutes({ onEvent: processor.processEvent.bind(processor), onMemoryNotification: ..., ... })` and mount it. The full deps contract for `WebhookRouteDeps.getSessionSecret` and `authorizeHookRequest` needs to be connected to `ProjectSessionManager` session secret lookup.
- [?] Whether the `RuntimeBridgeHandler.setHooks()` call in `SessionEventProcessor` constructor (line 172-174) creates a circular dependency concern — it calls `runtimeBridge.setHooks()` in the constructor, which stores hooks that reference `this.wsHub`. This is fine as long as `wsHub` is the same instance.
- [?] Whether `runtime:input` command expects `base64Data` directly or needs further encoding — the `RuntimeBridgeHandler.sendCommand` sends the payload as-is over WS.

## Context Handoff: Stoa Server Bootstrap Wiring Bugs

Start here: `research/2026-06-13-stoa-server-bootstrap-wiring-bugs.md`

Context only. Use the saved report as the source of truth.
