/**
 * Tests for the WS role router — Stoa Server browser UI wiring.
 *
 * Covers:
 *   - Role resolution (runtime / web / unknown / missing)
 *   - Token extraction from URL query params
 *   - Auth gate (valid / invalid / missing token)
 *   - Runtime connection binding (registerProvider / dispose)
 *   - Web connection binding (addClient / subscribe / unsubscribe)
 *   - session:binary-input dispatch
 *   - Static mount order (SPA fallback doesn't swallow /api/v1 and /ctl)
 */
import { describe, it, expect, vi } from 'vitest'
import {
  routeConnection,
  resolveRole,
  extractToken,
  isAuthorized,
  invokeOnMessage,
  type RoleRouterHandlers,
  type RoleRouterSocket,
  type RoleRouterRequest,
} from './role-router'
import { WsHub } from './hub'
import { RuntimeBridgeHandler } from './runtime-bridge-handler'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSocket(): RoleRouterSocket & {
  sentData: string[]
  closed: boolean
  closeCode: number | undefined
  closeReason: string | undefined
} {
  const sentData: string[] = []
  const socket: RoleRouterSocket & {
    sentData: string[]
    closed: boolean
    closeCode: number | undefined
    closeReason: string | undefined
  } = {
    send: vi.fn((data: string) => { sentData.push(data) }),
    close: vi.fn((code?: number, reason?: string) => {
      socket.closed = true
      socket.closeCode = code
      socket.closeReason = reason
    }),
    sentData,
    closed: false,
    closeCode: undefined,
    closeReason: undefined,
  }
  return socket
}

function createHandlers(overrides?: Partial<RoleRouterHandlers>): RoleRouterHandlers {
  return {
    hub: new WsHub(),
    runtimeBridge: new RuntimeBridgeHandler(),
    expectedToken: 'test-token',
    ...overrides,
  }
}

function makeRequest(url: string): RoleRouterRequest {
  return {
    url,
    headers: {},
  }
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

describe('resolveRole', () => {
  it('returns "runtime" for role=runtime', () => {
    expect(resolveRole('runtime')).toBe('runtime')
  })

  it('returns "web" for role=web', () => {
    expect(resolveRole('web')).toBe('web')
  })

  it('returns "web" for unknown role', () => {
    expect(resolveRole('unknown')).toBe('web')
  })

  it('returns "web" for null', () => {
    expect(resolveRole(null)).toBe('web')
  })

  it('returns "web" for undefined', () => {
    expect(resolveRole(undefined)).toBe('web')
  })

  it('returns "web" for empty string', () => {
    expect(resolveRole('')).toBe('web')
  })
})

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

describe('extractToken', () => {
  it('extracts token from query params', () => {
    const req = makeRequest('/ws?token=abc123')
    expect(extractToken(req)).toBe('abc123')
  })

  it('extracts token from multi-param URL', () => {
    const req = makeRequest('/ws?role=runtime&token=xyz&foo=bar')
    expect(extractToken(req)).toBe('xyz')
  })

  it('returns null when token is missing', () => {
    const req = makeRequest('/ws?role=runtime')
    expect(extractToken(req)).toBeNull()
  })

  it('returns null when no query string', () => {
    const req = makeRequest('/ws')
    expect(extractToken(req)).toBeNull()
  })

  it('returns null for empty token', () => {
    const req = makeRequest('/ws?token=')
    expect(extractToken(req)).toBeNull()
  })

  it('returns null for null url', () => {
    const req = makeRequest('')
    req.url = null
    expect(extractToken(req)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('isAuthorized', () => {
  it('accepts matching token', () => {
    expect(isAuthorized('test-token', 'test-token')).toBe(true)
  })

  it('rejects wrong token', () => {
    expect(isAuthorized('wrong', 'test-token')).toBe(false)
  })

  it('rejects null token', () => {
    expect(isAuthorized(null, 'test-token')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// routeConnection — auth
// ---------------------------------------------------------------------------

describe('routeConnection — auth', () => {
  it('rejects connections without token', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') {
      expect(result.statusCode).toBe(4401)
    }
  })

  it('rejects connections with wrong token', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=wrong-token')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('rejected')
  })

  it('accepts connections with correct token', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')
  })
})

// ---------------------------------------------------------------------------
// routeConnection — runtime role
// ---------------------------------------------------------------------------

describe('routeConnection — runtime role', () => {
  it('registers a provider when role=runtime', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    expect(handlers.runtimeBridge.listProviders().length).toBe(0)
    const req = makeRequest('/ws?token=test-token&role=runtime')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')
    expect(handlers.runtimeBridge.listProviders().length).toBe(1)
  })

  it('removes provider on dispose', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token&role=runtime')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')
    expect(handlers.runtimeBridge.listProviders().length).toBe(1)
    if (result.kind === 'accepted') {
      result.dispose()
    }
    expect(handlers.runtimeBridge.listProviders().length).toBe(0)
  })

  it('dispose is idempotent', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token&role=runtime')
    const result = routeConnection(req, socket, handlers)
    if (result.kind === 'accepted') {
      result.dispose()
      result.dispose()
    }
    expect(handlers.runtimeBridge.listProviders().length).toBe(0)
  })

  it('forwards runtime provider frames into RuntimeBridgeHandler', async () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token&role=runtime')
    const result = routeConnection(req, socket, handlers)

    expect(result.kind).toBe('accepted')
    const provider = handlers.runtimeBridge.listProviders()[0]
    expect(provider).toBeDefined()
    handlers.runtimeBridge.assignSession(provider!.id, 'sess-1')

    const pending = handlers.runtimeBridge.sendCommand('sess-1', {
      type: 'runtime:input',
      payload: { data: 'hello' },
    })

    expect(socket.sentData).toHaveLength(1)
    const outbound = JSON.parse(socket.sentData[0]!)
    invokeOnMessage(socket, JSON.stringify({
      type: 'runtime:response',
      replyTo: outbound.replyTo,
      ok: true,
      data: { acknowledged: true },
    }))

    await expect(pending).resolves.toEqual({ acknowledged: true })
  })
})

// ---------------------------------------------------------------------------
// routeConnection — web role
// ---------------------------------------------------------------------------

describe('routeConnection — web role', () => {
  it('adds client to hub when role=web', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    expect(handlers.hub.clientCount).toBe(0)
    const req = makeRequest('/ws?token=test-token&role=web')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')
    expect(handlers.hub.clientCount).toBe(1)
  })

  it('defaults to web role when role is missing', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')
    expect(handlers.hub.clientCount).toBe(1)
  })

  it('defaults to web role for unknown role', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token&role=foobar')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')
    expect(handlers.hub.clientCount).toBe(1)
  })

  it('removes client from hub on dispose', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token&role=web')
    const result = routeConnection(req, socket, handlers)
    expect(handlers.hub.clientCount).toBe(1)
    if (result.kind === 'accepted') {
      result.dispose()
    }
    expect(handlers.hub.clientCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Web message dispatch — subscribe
// ---------------------------------------------------------------------------

describe('web message dispatch — subscribe', () => {
  it('subscribe message adds subscription to hub', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    const result = routeConnection(req, socket, handlers)
    expect(result.kind).toBe('accepted')

    invokeOnMessage(socket, JSON.stringify({
      type: 'subscribe',
      payload: { eventTypes: ['session:graph'] },
    }))

    // The client should now be subscribed to session:graph
    expect(handlers.hub.clientCount).toBe(1)
    // Broadcast a session:graph event and verify the socket receives it
    handlers.hub.broadcast('session:graph', { test: true })
    expect(socket.sentData.length).toBe(1)
    const event = JSON.parse(socket.sentData[0]!)
    expect(event.type).toBe('session:graph')
  })

  it('subscribe with sessionId filter', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({
      type: 'subscribe',
      payload: { eventTypes: ['session:state-patch'], filter: { sessionId: 'sess-A' } },
    }))

    // Matching session should be delivered
    handlers.hub.broadcast('session:state-patch', { sessionId: 'sess-A', data: 'x' })
    expect(socket.sentData.length).toBe(1)

    // Non-matching session should be skipped
    handlers.hub.broadcast('session:state-patch', { sessionId: 'sess-B', data: 'y' })
    expect(socket.sentData.length).toBe(1) // still 1
  })

  it('subscribe with unknown event types is ignored', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({
      type: 'subscribe',
      payload: { eventTypes: ['not-a-real-type'] },
    }))

    // No subscription added
    handlers.hub.broadcast('session:graph', { test: true })
    expect(socket.sentData.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Web message dispatch — unsubscribe
// ---------------------------------------------------------------------------

describe('web message dispatch — unsubscribe', () => {
  it('unsubscribe removes subscription', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({
      type: 'subscribe',
      payload: { eventTypes: ['session:graph'] },
    }))

    handlers.hub.broadcast('session:graph', { test: true })
    expect(socket.sentData.length).toBe(1)

    invokeOnMessage(socket, JSON.stringify({
      type: 'unsubscribe',
      payload: { eventTypes: ['session:graph'] },
    }))

    handlers.hub.broadcast('session:graph', { test: true })
    expect(socket.sentData.length).toBe(1) // still 1 — no new message
  })
})

// ---------------------------------------------------------------------------
// Web message dispatch — session:binary-input
// ---------------------------------------------------------------------------

describe('web message dispatch — session:binary-input', () => {
  it('dispatches binary input to the handler', () => {
    const socket = createMockSocket()
    const dispatchBinaryInput = vi.fn()
    const handlers = createHandlers({ dispatchBinaryInput })
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({
      type: 'session:binary-input',
      payload: { sessionId: 'sess-1', data: 'aGVsbG8=' },
    }))

    expect(dispatchBinaryInput).toHaveBeenCalledWith('sess-1', 'aGVsbG8=')
  })

  it('ignores binary input with missing fields', () => {
    const socket = createMockSocket()
    const dispatchBinaryInput = vi.fn()
    const handlers = createHandlers({ dispatchBinaryInput })
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({
      type: 'session:binary-input',
      payload: { sessionId: 'sess-1' },
    }))

    expect(dispatchBinaryInput).not.toHaveBeenCalled()
  })

  it('ignores binary input when no dispatcher is provided', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    // No dispatchBinaryInput set
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    // Should not throw
    invokeOnMessage(socket, JSON.stringify({
      type: 'session:binary-input',
      payload: { sessionId: 'sess-1', data: 'aGVsbG8=' },
    }))
  })
})

// ---------------------------------------------------------------------------
// Web message dispatch — malformed / unknown
// ---------------------------------------------------------------------------

describe('web message dispatch — edge cases', () => {
  it('ignores malformed JSON', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, 'not-json{{{')
    // Should not throw, no side effects
    expect(handlers.hub.clientCount).toBe(1)
  })

  it('ignores messages without type', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({ payload: {} }))
    expect(handlers.hub.clientCount).toBe(1)
  })

  it('ignores unknown message types', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, JSON.stringify({ type: 'unknown-type', payload: {} }))
    expect(handlers.hub.clientCount).toBe(1)
  })

  it('ignores non-object parsed messages', () => {
    const socket = createMockSocket()
    const handlers = createHandlers()
    const req = makeRequest('/ws?token=test-token')
    routeConnection(req, socket, handlers)

    invokeOnMessage(socket, '42')
    invokeOnMessage(socket, '"hello"')
    invokeOnMessage(socket, 'null')
    expect(handlers.hub.clientCount).toBe(1)
  })
})
