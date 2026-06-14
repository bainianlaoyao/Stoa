/**
 * WebSocket role router — Phase 5 (Stoa Server browser UI wiring).
 *
 * Pure routing function over a single WebSocket connection's `(searchParams,
 * rawMessage)` input. The HTTP upgrade is handled separately in
 * `index.ts`; once a `ws` connection is established, the role router owns
 * the rest of its lifetime:
 *
 *   - `role=runtime` connections register with `RuntimeBridgeHandler` and
 *     forward every inbound string frame to `handleMessage`. The
 *     `RuntimeBridgeHandler` is the only thing that talks to runtime
 *     providers — it owns command bookkeeping, timeouts, and disconnect
 *     semantics.
 *   - `role=web` connections (or any connection whose `role` is missing or
 *     unrecognised) join the `WsHub` and follow the renderer protocol:
 *     `subscribe` / `unsubscribe` set per-type event filters, and
 *     `session:binary-input` is dispatched to the runtime bridge via the
 *     injected `binaryInputDispatcher`. Unknown message types and
 *     malformed JSON are logged and dropped.
 *
 * The router itself is WS-library-agnostic: it accepts a `Wire` interface
 * matching what we get from `ws` (or any hand-rolled equivalent) plus a
 * callback bundle of `RuntimeBridgeHandler` / `WsHub` / token. This keeps
 * the routing logic unit-testable without binding to a specific transport.
 */
import type { IncomingMessage } from 'node:http'
import type { WsHub, WsLike } from './hub'
import type { WsServerEventType } from './events'
import { WS_SERVER_EVENT_TYPES, WS_CLIENT_MESSAGE_TYPES } from './events'
import type { RuntimeBridgeHandler } from './runtime-bridge-handler'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Roles a single WS connection can declare via the `?role=` query param. */
export type WsRole = 'runtime' | 'web'

/**
 * Outcome of routing a connection. The HTTP upgrade caller uses this to
 * decide whether to keep the socket open or destroy it.
 *
 *   `accepted` — keep the socket open. `dispose` is a teardown callback
 *                that removes the connection from the relevant registry
 *                (runtime handler provider list, or WsHub client list).
 *   `rejected` — destroy the socket. `statusCode` / `reason` are forwarded
 *                as the WS close frame so the client gets a meaningful
 *                diagnostic.
 */
export type RoleRouteResult =
  | { kind: 'accepted'; dispose: () => void }
  | { kind: 'rejected'; statusCode: number; reason: string }

/**
 * Abstraction over a successfully upgraded WebSocket. The role router
 * only ever calls `send` and `close` on it; it does not parse frames
 * itself.
 */
export interface RoleRouterSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

/**
 * Handler bundle for the role router. Tests inject fakes; production code
 * passes real `WsHub` and `RuntimeBridgeHandler` instances.
 */
export interface RoleRouterHandlers {
  hub: WsHub
  runtimeBridge: RuntimeBridgeHandler
  expectedToken: string
  /**
   * Forwards a `session:binary-input` client message to the runtime
   * bridge. The router does not need to know how PTY input is
   * implemented — it just hands off `(sessionId, base64Data)` and lets
   * the bridge handle the rest. May be omitted in tests that never
   * exercise the binary-input path.
   */
  dispatchBinaryInput?: (sessionId: string, base64Data: string) => void
}

/**
 * Minimum interface for the upgraded `http.IncomingMessage` that the role
 * router needs. Subset of `IncomingMessage`; lets the router be used
 * from tests without constructing a real upgrade request.
 */
export interface RoleRouterRequest {
  url?: string | null
  readonly headers: { readonly [name: string]: string | string[] | undefined }
}

// ---------------------------------------------------------------------------
// Role parsing + auth gate
// ---------------------------------------------------------------------------

/**
 * Parse the `?role=` query parameter. Unknown / missing values are
 * coerced to `'web'` so the default path is the safer renderer path.
 * Returning `'web'` for malformed input is the chosen behaviour for
 * Phase 5: the renderer is the only client that should be in this
 * position; a runtime provider that forgets `role=runtime` will be routed
 * to the hub and its messages will be dropped, but it will not
 * inadvertently register as a runtime.
 */
export function resolveRole(rawRole: string | null | undefined): WsRole {
  if (rawRole === 'runtime') return 'runtime'
  return 'web'
}

/**
 * Pull the expected token out of the upgrade request. The router only
 * accepts the `?token=` query parameter for WS auth — the HTTP
 * `Authorization: Bearer` header is not present on a WS upgrade in every
 * browser, and the `x-stoa-session-*` pair is renderer-side state that
 * arrives later over the WS itself. Keeping this narrow avoids
 * accidentally accepting "Authorization" headers that some proxies add.
 */
export function extractToken(req: RoleRouterRequest): string | null {
  const url = req.url ?? ''
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return null
  const params = new URLSearchParams(url.slice(queryIndex + 1))
  const token = params.get('token')
  return token && token.length > 0 ? token : null
}

/**
 * Pure auth check. Exposed for testing; the role router itself
 * short-circuits to `rejected` on mismatch.
 */
export function isAuthorized(token: string | null, expected: string): boolean {
  return token !== null && token === expected
}

// ---------------------------------------------------------------------------
// Router entry point
// ---------------------------------------------------------------------------

/**
 * Route a freshly-upgraded WebSocket to its handler. Returns the
 * per-socket dispose callback on success so the caller can wire it to
 * the transport's `close` event.
 */
export function routeConnection(
  req: RoleRouterRequest,
  socket: RoleRouterSocket,
  handlers: RoleRouterHandlers,
): RoleRouteResult {
  const token = extractToken(req)
  if (!isAuthorized(token, handlers.expectedToken)) {
    return {
      kind: 'rejected',
      statusCode: 4401,
      reason: 'unauthorized',
    }
  }

  const url = req.url ?? ''
  const queryIndex = url.indexOf('?')
  const params =
    queryIndex >= 0 ? new URLSearchParams(url.slice(queryIndex + 1)) : new URLSearchParams()
  const role = resolveRole(params.get('role'))

  if (role === 'runtime') {
    return bindRuntimeConnection(socket, handlers.runtimeBridge, token!)
  }
  return bindWebConnection(socket, handlers)
}

// ---------------------------------------------------------------------------
// Runtime connections (Electron-side PTY providers)
// ---------------------------------------------------------------------------

function bindRuntimeConnection(
  socket: RoleRouterSocket,
  runtimeBridge: RuntimeBridgeHandler,
  token: string,
): RoleRouteResult {
  const provider = runtimeBridge.registerProvider(asWsLike(socket), { token })
  attachMessageHandler(socket, (raw) => {
    runtimeBridge.handleMessage(provider.id, raw)
  })
  let disposed = false
  return {
    kind: 'accepted',
    dispose: () => {
      if (disposed) return
      disposed = true
      runtimeBridge.removeProvider(provider.id)
    },
  }
}

// ---------------------------------------------------------------------------
// Web connections (renderer clients)
// ---------------------------------------------------------------------------

/**
 * Build a WsLike adapter around a `RoleRouterSocket`. The `WsHub`
 * interface requires a `close?` method, so we forward when present.
 */
function asWsLike(socket: RoleRouterSocket): WsLike {
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(1000, 'normal'),
  }
}

function bindWebConnection(
  socket: RoleRouterSocket,
  handlers: RoleRouterHandlers,
): RoleRouteResult {
  const client = handlers.hub.addClient(asWsLike(socket))

  const dispose = (): void => {
    handlers.hub.removeClient(client.id)
    try {
      socket.close(1000, 'normal')
    } catch {
      // Socket may already be closed by the transport.
    }
  }

  // Expose the message handler to the transport by attaching it to the
  // socket. We use a WeakMap to keep the closure out of the socket
  // shape itself, since `RoleRouterSocket` is just the abstraction used
  // by the router; the actual `ws` library does the message dispatch.
  attachMessageHandler(socket, (raw) =>
    handleWebMessage(client.id, raw, socket, handlers, dispose),
  )

  return { kind: 'accepted', dispose }
}

// ---------------------------------------------------------------------------
// Web message dispatch
// ---------------------------------------------------------------------------

/**
 * Per-socket `onmessage` storage. The transport layer (production `ws`
 * or hand-rolled) calls `setOnMessage(socket, fn)` when a frame arrives.
 * The router stores the handler in a WeakMap so it can be GC'd when the
 * socket is.
 */
const messageHandlers = new WeakMap<RoleRouterSocket, (raw: string) => void>()

/** Transport hook: store the per-socket message handler. */
export function setOnMessage(
  socket: RoleRouterSocket,
  handler: (raw: string) => void,
): void {
  messageHandlers.set(socket, handler)
}

/** Transport hook: invoke the per-socket message handler if any. */
export function invokeOnMessage(socket: RoleRouterSocket, raw: string): void {
  const handler = messageHandlers.get(socket)
  if (handler) handler(raw)
}

function attachMessageHandler(
  socket: RoleRouterSocket,
  handler: (raw: string) => void,
): void {
  setOnMessage(socket, handler)
}

interface SubscribeMessagePayload {
  eventTypes: string[]
  filter?: { sessionId?: string }
}

function handleWebMessage(
  clientId: string,
  raw: string,
  socket: RoleRouterSocket,
  handlers: RoleRouterHandlers,
  dispose: () => void,
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return
  const frame = parsed as Record<string, unknown>
  const type = frame.type
  if (typeof type !== 'string') return

  if (type === 'subscribe') {
    handleSubscribe(clientId, frame.payload, handlers)
    return
  }

  if (type === 'unsubscribe') {
    handleUnsubscribe(clientId, frame.payload, handlers)
    return
  }

  if (type === 'session:binary-input') {
    handleBinaryInput(frame.payload, socket, handlers, dispose)
    return
  }

  if (!WS_CLIENT_MESSAGE_TYPES.includes(type as never)) {
    // Unknown client message type — drop silently. Runtime providers
    // do not use this branch; they go through `handleMessage` on the
    // runtime bridge.
    return
  }
}

function handleSubscribe(
  clientId: string,
  rawPayload: unknown,
  handlers: RoleRouterHandlers,
): void {
  const payload = parseSubscribePayload(rawPayload)
  if (!payload) return
  const eventTypes = payload.eventTypes.filter(
    (value): value is WsServerEventType =>
      typeof value === 'string' &&
      (WS_SERVER_EVENT_TYPES as readonly string[]).includes(value),
  )
  if (eventTypes.length === 0) return
  handlers.hub.handleSubscribe(clientId, eventTypes, payload.filter)
}

function handleUnsubscribe(
  clientId: string,
  rawPayload: unknown,
  handlers: RoleRouterHandlers,
): void {
  if (!rawPayload || typeof rawPayload !== 'object') return
  const eventTypes = (rawPayload as { eventTypes?: unknown }).eventTypes
  if (!Array.isArray(eventTypes)) return
  const filtered = eventTypes.filter(
    (value): value is WsServerEventType =>
      typeof value === 'string' &&
      (WS_SERVER_EVENT_TYPES as readonly string[]).includes(value),
  )
  if (filtered.length === 0) return
  handlers.hub.handleUnsubscribe(clientId, filtered)
}

function handleBinaryInput(
  rawPayload: unknown,
  socket: RoleRouterSocket,
  handlers: RoleRouterHandlers,
  dispose: () => void,
): void {
  if (!rawPayload || typeof rawPayload !== 'object') return
  const payload = rawPayload as { sessionId?: unknown; data?: unknown }
  if (typeof payload.sessionId !== 'string') return
  if (typeof payload.data !== 'string') return
  if (!handlers.dispatchBinaryInput) {
    return
  }
  try {
    handlers.dispatchBinaryInput(payload.sessionId, payload.data)
  } catch (error) {
    // Surface as a normal close — the runtime bridge rejected the
    // input (e.g. unknown session). Disposing the socket is heavier
    // than necessary; we just log and let the client reconnect if it
    // wants.
    console.warn('[ws/role-router] binary-input dispatch failed:', error)
    void dispose
    void socket
  }
}

function parseSubscribePayload(
  rawPayload: unknown,
): SubscribeMessagePayload | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null
  const payload = rawPayload as { eventTypes?: unknown; filter?: unknown }
  if (!Array.isArray(payload.eventTypes)) return null
  const eventTypes = payload.eventTypes.filter(
    (value): value is string => typeof value === 'string',
  )
  if (eventTypes.length === 0) return null

  let filter: { sessionId?: string } | undefined
  if (payload.filter && typeof payload.filter === 'object') {
    const f = payload.filter as { sessionId?: unknown }
    if (typeof f.sessionId === 'string' && f.sessionId.length > 0) {
      filter = { sessionId: f.sessionId }
    }
  }
  return { eventTypes, filter }
}

// Re-export for tests that want to construct an IncomingMessage-shaped object
// without spinning up a real HTTP server.
export type { IncomingMessage }
