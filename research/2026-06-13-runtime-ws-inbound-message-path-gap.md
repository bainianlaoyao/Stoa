---
date: 2026-06-13
topic: runtime websocket inbound message path gap analysis
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Runtime WS Inbound Message Path — Missing Provider Frame Routing

### Why This Was Gathered

Runtime provider frames (terminal-data, pty-state, state-sync, command responses) from Electron must reach `RuntimeBridgeHandler.handleMessage(...)` through the WS transport. This report identifies whether that path is complete and what test seams cover it.

### Summary

**Critical gap found**: `bindRuntimeConnection` in `role-router.ts` registers a provider but never calls `attachMessageHandler`. Inbound frames from runtime providers are silently dropped because `invokeOnMessage` finds no handler in the WeakMap. The `RuntimeBridgeHandler.handleMessage` path is completely unreachable from production WS traffic.

### Key Findings

1. **Production path (`index.ts:200-213`)**: On every accepted WS connection, `conn.on('message', ...)` fires `invokeOnMessage(conn, raw)`. This looks up a WeakMap-stored handler per socket.

2. **Web connections work correctly**: `bindWebConnection` (role-router.ts:206-230) calls `attachMessageHandler(socket, handler)` which stores the handler via `setOnMessage` into the WeakMap. When `invokeOnMessage` fires, the handler is found and routes to `handleWebMessage`.

3. **Runtime connections are missing the handler**: `bindRuntimeConnection` (role-router.ts:174-189) calls `runtimeBridge.registerProvider(...)` and returns a dispose callback, but **never** calls `attachMessageHandler`. When a frame arrives from a runtime provider, `invokeOnMessage` finds nothing in the WeakMap and returns silently — the frame is dropped.

4. **The fix**: Add one `attachMessageHandler` call inside `bindRuntimeConnection`:
   ```typescript
   attachMessageHandler(socket, (raw) => {
     runtimeBridge.handleMessage(provider.id, raw)
   })
   ```

5. **No test covers this gap**: The existing `role-router.test.ts` tests runtime role registration and disposal but never sends a message through `invokeOnMessage` on a runtime-routed socket. The `runtime-bridge-handler.test.ts` tests `handleMessage` directly (not through the role-router transport).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| WS upgrade dispatches `invokeOnMessage` for all accepted connections | `stoa-server/src/index.ts` | `index.ts:203-206` |
| `bindRuntimeConnection` does NOT call `attachMessageHandler` | `stoa-server/src/ws/role-router.ts` | `role-router.ts:174-189` |
| `bindWebConnection` DOES call `attachMessageHandler` | `stoa-server/src/ws/role-router.ts` | `role-router.ts:225-227` |
| `attachMessageHandler` stores handler via `setOnMessage` into WeakMap | `stoa-server/src/ws/role-router.ts` | `role-router.ts:258-263` |
| `invokeOnMessage` looks up WeakMap and calls handler if found | `stoa-server/src/ws/role-router.ts` | `role-router.ts:253-256` |
| `RuntimeBridgeHandler.handleMessage` is the intended entry point for provider frames | `stoa-server/src/ws/runtime-bridge-handler.ts` | `runtime-bridge-handler.ts:318-360` |
| Runtime role-router tests cover registration/disposal but NOT message dispatch | `stoa-server/src/ws/role-router.test.ts` | `role-router.test.ts:190-225` |
| Runtime bridge handler tests call `handleMessage` directly, bypassing transport | `stoa-server/src/ws/runtime-bridge-handler.test.ts` | entire file |

### Smallest Test Seams (No Playwright Needed)

**Seam 1 — `role-router.test.ts` extension**: Add a test in the "routeConnection — runtime role" block:

```
1. routeConnection with role=runtime
2. Set hooks on RuntimeBridgeHandler (e.g. onTerminalData)
3. invokeOnMessage(socket, JSON.stringify({ type: 'runtime:terminal-data', sessionId: 's1', data: 'hello' }))
4. Assert hook was called with { sessionId: 's1', data: 'hello', providerId: <provider.id> }
```

This proves the end-to-end path: transport → WeakMap → handleMessage → hook, without any real WS or Playwright.

**Seam 2 — Response round-trip**: Extend the above to also test command response flow:

```
1. routeConnection with role=runtime
2. assignSession(provider.id, 's1')
3. sendCommand('s1', { type: 'runtime:input', payload: { data: 'x' } })
4. invokeOnMessage(socket, JSON.stringify({ replyTo: <sentReplyTo>, ok: true, data: { echoed: true } }))
5. Assert the sendCommand promise resolves with { echoed: true }
```

This tests the full command → response cycle through the transport layer.

**Seam 3 — Dispose cleanup**: Verify that after `dispose()`, subsequent `invokeOnMessage` calls do NOT reach the handler (the WeakMap entry should be cleaned or the handler should no-op):

```
1. routeConnection with role=runtime
2. result.dispose()
3. invokeOnMessage(socket, JSON.stringify({ type: 'runtime:terminal-data', ... }))
4. Assert hook is NOT called
```

Note: Currently the WeakMap entry is NOT removed on dispose (only the provider is removed from the handler). The handler's early-return on unknown providerId (line 320-323) acts as a safety net, but the WeakMap entry leaks. Consider clearing it.

### Risks / Unknowns

- [!] **Production bug**: Runtime providers cannot communicate back to the server at all until this fix is applied. All `handleMessage` paths (responses, terminal-data, pty-state, state-sync) are dead in production.
- [!] **WeakMap entry leak**: `bindRuntimeConnection` would store a handler that closes over `provider.id`. After `dispose()`, the handler remains in the WeakMap. The `handleMessage` early-return on unknown provider is the safety net, but this is implicit.
- [?] Whether the existing `runtime-bridge-handler.test.ts` tests need updating — they should remain valid since they test the handler in isolation.
- [?] Whether `bindWebConnection` has the same leak pattern (yes it does — `dispose` removes the client from the hub but does not call `setOnMessage(socket, null)` to clear the WeakMap).
