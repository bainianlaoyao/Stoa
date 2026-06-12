/**
 * Tests for StoaClient — HTTP + WebSocket client.
 *
 * Uses vi.stubGlobal('fetch') to intercept global fetch calls and
 * exercise the full request/response parsing pipeline, including the
 * ApiResponse envelope, error mapping, and StoaClientError construction.
 *
 * WebSocket behavior is verified by stubbing the global WebSocket
 * constructor and simulating lifecycle events (open/message/close).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoaClient, StoaClientError } from './stoa-client'

// ── Test constants ─────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3270'
const TOKEN = 'test-token'

// ── Mock response builder ──────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function okEnvelope<T>(data: T, meta?: { requestId?: string; pagination?: { cursor: string | null; hasMore: boolean; totalCount?: number } }) {
  return {
    ok: true,
    data,
    meta: {
      requestId: meta?.requestId ?? 'r-1',
      timestamp: '2026-01-01T00:00:00Z',
      ...(meta?.pagination ? { pagination: meta.pagination } : {}),
    },
  }
}

function errorEnvelope(code: string, message: string, opts?: { details?: Record<string, unknown>; nextSteps?: string[] | null }) {
  return {
    ok: false,
    error: { code, message, ...(opts?.details ? { details: opts.details } : {}), ...(opts?.nextSteps !== undefined ? { nextSteps: opts.nextSteps } : {}) },
    meta: { requestId: 'r-err', timestamp: '2026-01-01T00:00:00Z' },
  }
}

// ── Mock fetch type ────────────────────────────────────────────────────

interface CapturedCall {
  url: string
  init: RequestInit
}

let originalFetch: typeof globalThis.fetch
let mockFetch: ReturnType<typeof vi.fn>
let captured: CapturedCall[]

beforeEach(() => {
  captured = []
  originalFetch = globalThis.fetch

  mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    captured.push({ url, init: init ?? {} })

    // Route by path — simple in-memory mock handler
    const path = url.replace(BASE_URL, '')

    if (path === '/api/v1/test') {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(okEnvelope({ method: 'POST' }), 201))
      }
      if (init?.method === 'PUT') {
        return Promise.resolve(jsonResponse(okEnvelope({ method: 'PUT' })))
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse(okEnvelope({ method: 'DELETE' })))
      }
      return Promise.resolve(jsonResponse(okEnvelope({ method: 'GET' })))
    }

    if (path === '/api/v1/test/abc') {
      return Promise.resolve(jsonResponse(okEnvelope({ method: 'DELETE', id: 'abc' })))
    }

    if (path === '/api/v1/test-body' && init?.method === 'DELETE') {
      return Promise.resolve(jsonResponse(okEnvelope({ method: 'DELETE-BODY' })))
    }

    if (path === '/api/v1/error-4xx') {
      return Promise.resolve(
        jsonResponse(
          errorEnvelope('not_found', 'Resource not found', {
            details: { resourceId: 'res-123' },
            nextSteps: ['Try a different ID'],
          }),
          404,
        ),
      )
    }

    if (path === '/api/v1/error-5xx') {
      return Promise.resolve(
        jsonResponse(
          errorEnvelope('internal_error', 'Something went wrong', { details: { stack: '...' } }),
          500,
        ),
      )
    }

    if (path === '/api/v1/error-minimal') {
      return Promise.resolve(jsonResponse(errorEnvelope('bad_request', 'Bad request'), 400))
    }

    if (path === '/api/v1/paginated') {
      return Promise.resolve(
        jsonResponse(
          okEnvelope({ items: ['a', 'b'] }, {
            pagination: { cursor: 'next-cursor', hasMore: true, totalCount: 42 },
          }),
        ),
      )
    }

    if (path === '/api/v1/empty-data') {
      return Promise.resolve(jsonResponse({ ok: true, data: null, meta: { requestId: 'r', timestamp: 't' } }))
    }

    // Default: 200 with empty
    return Promise.resolve(jsonResponse(okEnvelope({})))
  })

  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.fetch = originalFetch
})

// ── Constructor tests ──────────────────────────────────────────────────

describe('StoaClient constructor', () => {
  it('strips trailing slashes from baseUrl', () => {
    const client = new StoaClient('http://localhost:3000///', TOKEN)
    client.get('/api/v1/test').catch(() => {})
    expect(captured[0].url).toBe('http://localhost:3000/api/v1/test')
  })

  it('uses exact baseUrl when no trailing slashes', () => {
    const client = new StoaClient('http://localhost:3000', TOKEN)
    client.get('/api/v1/test').catch(() => {})
    expect(captured[0].url).toBe('http://localhost:3000/api/v1/test')
  })

  it('preserves baseUrl path prefix', () => {
    const client = new StoaClient('http://localhost:3000/api/', TOKEN)
    client.get('/v1/test').catch(() => {})
    expect(captured[0].url).toBe('http://localhost:3000/api/v1/test')
  })
})

// ── HTTP method tests ──────────────────────────────────────────────────

describe('HTTP methods', () => {
  let client: StoaClient

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
  })

  it('GET sends correct method, headers, and parses response', async () => {
    const res = await client.get<{ method: string }>('/api/v1/test')
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ method: 'GET' })

    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-token')
    expect(headers['Content-Type']).toBe('application/json')
    expect(captured[0].init.method).toBe('GET')
    expect(captured[0].init.body).toBeUndefined()
  })

  it('POST sends method, body, and auth header', async () => {
    const res = await client.post<{ method: string }>('/api/v1/test', { name: 'foo', value: 42 })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ method: 'POST' })

    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-token')
    expect(captured[0].init.method).toBe('POST')
    expect(captured[0].init.body).toBe(JSON.stringify({ name: 'foo', value: 42 }))
  })

  it('POST without body omits body from request', async () => {
    await client.post('/api/v1/test')
    expect(captured[0].init.body).toBeUndefined()
  })

  it('PUT sends method, body, and auth header', async () => {
    const res = await client.put<{ method: string }>('/api/v1/test', { updated: true })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ method: 'PUT' })

    expect(captured[0].init.method).toBe('PUT')
    expect(captured[0].init.body).toBe(JSON.stringify({ updated: true }))
  })

  it('DELETE sends correct method and auth header', async () => {
    const res = await client.delete<{ method: string; id: string }>('/api/v1/test/abc')
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ method: 'DELETE', id: 'abc' })

    expect(captured[0].init.method).toBe('DELETE')
    expect(captured[0].init.body).toBeUndefined()
  })

  it('DELETE with body sends body', async () => {
    const res = await client.delete<{ method: string }>('/api/v1/test-body', { key: 'val' })
    expect(res.ok).toBe(true)
    expect(captured[0].init.body).toBe(JSON.stringify({ key: 'val' }))
  })

  it('all methods set Content-Type to application/json', async () => {
    await client.post('/api/v1/test', { x: 1 })
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('request() body is JSON-serialized with correct types', async () => {
    await client.post('/api/v1/test', { arr: [1, 2, 3], nested: { a: 1 } })
    expect(captured[0].init.body).toBe('{"arr":[1,2,3],"nested":{"a":1}}')
  })
})

// ── ApiResponse envelope parsing ───────────────────────────────────────

describe('ApiResponse envelope', () => {
  let client: StoaClient

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
  })

  it('parses meta.requestId and meta.timestamp', async () => {
    const res = await client.get('/api/v1/test')
    expect(res.meta.requestId).toBe('r-1')
    expect(res.meta.timestamp).toBe('2026-01-01T00:00:00Z')
  })

  it('parses pagination metadata correctly', async () => {
    const res = await client.get<{ items: string[] }>('/api/v1/paginated')
    expect(res.ok).toBe(true)
    expect(res.data?.items).toEqual(['a', 'b'])
    expect(res.meta.pagination).toEqual({
      cursor: 'next-cursor',
      hasMore: true,
      totalCount: 42,
    })
  })

  it('handles null data field gracefully', async () => {
    const res = await client.get<unknown>('/api/v1/empty-data')
    expect(res.ok).toBe(true)
    expect(res.data).toBeNull()
  })
})

// ── Error handling ─────────────────────────────────────────────────────

describe('Error handling', () => {
  let client: StoaClient

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
  })

  it('throws StoaClientError on 4xx response', async () => {
    await expect(client.get('/api/v1/error-4xx')).rejects.toThrow(StoaClientError)
  })

  it('4xx error carries correct code, message, name', async () => {
    try {
      await client.get('/api/v1/error-4xx')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StoaClientError)
      const e = err as StoaClientError
      expect(e.code).toBe('not_found')
      expect(e.message).toBe('Resource not found')
      expect(e.name).toBe('StoaClientError')
    }
  })

  it('4xx error preserves details and nextSteps', async () => {
    try {
      await client.get('/api/v1/error-4xx')
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as StoaClientError
      expect(e.details).toEqual({ resourceId: 'res-123' })
      expect(e.nextSteps).toEqual(['Try a different ID'])
    }
  })

  it('throws StoaClientError on 5xx response', async () => {
    try {
      await client.get('/api/v1/error-5xx')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StoaClientError)
      const e = err as StoaClientError
      expect(e.code).toBe('internal_error')
      expect(e.message).toBe('Something went wrong')
      expect(e.details).toEqual({ stack: '...' })
    }
  })

  it('error with missing details/nextSteps is still valid StoaClientError', async () => {
    try {
      await client.get('/api/v1/error-minimal')
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as StoaClientError
      expect(e.code).toBe('bad_request')
      expect(e.message).toBe('Bad request')
      expect(e.details).toBeUndefined()
      expect(e.nextSteps).toBeUndefined()
    }
  })

  it('StoaClientError is instanceof Error', async () => {
    try {
      await client.get('/api/v1/error-4xx')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(StoaClientError)
    }
  })

  it('throws when response has ok:false but no error field', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: false, meta: { requestId: 'r', timestamp: 't' } }, 200),
    )
    await expect(client.get('/api/v1/test')).rejects.toThrow(StoaClientError)
  })

  it('uses "unknown_error" code when response has no error envelope', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: false, meta: { requestId: 'r', timestamp: 't' } }, 500),
    )
    try {
      await client.get('/api/v1/test')
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as StoaClientError
      expect(e.code).toBe('unknown_error')
    }
  })
})

// ── WebSocket ──────────────────────────────────────────────────────────

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  onopen: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  readyState: number
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    readyState: 1, // OPEN
  }
}

function stubWebSocketFactory(ws: MockWebSocket) {
  const constructor = vi.fn(() => ws)
  // StoaClient.sendWsMessage checks `this.ws.readyState === WebSocket.OPEN`
  // so we must provide the WebSocket constants on the constructor.
  ;(constructor as unknown as { OPEN: number }).OPEN = 1 // WebSocket.OPEN
  ;(constructor as unknown as { CONNECTING: number }).CONNECTING = 0
  ;(constructor as unknown as { CLOSING: number }).CLOSING = 2
  ;(constructor as unknown as { CLOSED: number }).CLOSED = 3
  vi.stubGlobal('WebSocket', constructor)
}

describe('WebSocket connection', () => {
  let client: StoaClient
  let mockWs: MockWebSocket

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
    mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
  })

  it('connectWs creates WebSocket with correct URL and token', () => {
    client.connectWs()
    expect(WebSocket).toHaveBeenCalledWith(
      'ws://localhost:3270/ws?token=test-token',
    )
  })

  it('connectWs uses wss:// when baseUrl is https://', () => {
    const httpsClient = new StoaClient('https://example.com', TOKEN)
    httpsClient.connectWs()
    expect(WebSocket).toHaveBeenCalledWith(
      'wss://example.com/ws?token=test-token',
    )
  })

  it('connectWs does not create new WS if already connected', () => {
    client.connectWs()
    vi.mocked(WebSocket).mockClear()
    client.connectWs()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('connectWs does not create new WS after dispose', () => {
    client.dispose()
    client.connectWs()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('connectWs includes lastEventId in URL when set by prior message', () => {
    client.connectWs()
    // Simulate receiving a message — this updates lastEventId internally
    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'evt-42', type: 'x', payload: 'y', timestamp: 't' }),
        }),
      )
    }
    // Force a re-connect: clear the ws reference by triggering close
    if (mockWs.onclose) mockWs.onclose()
    // Now manually call connectWs again (it will create a new WebSocket
    // because the old ws was cleared on close)
    client.connectWs()
    expect(WebSocket).toHaveBeenCalledTimes(2)
    const secondUrl = vi.mocked(WebSocket).mock.calls[1][0]
    expect(secondUrl).toContain('lastEventId=evt-42')
  })
})

describe('WebSocket subscription', () => {
  let client: StoaClient
  let mockWs: MockWebSocket

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
    mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
  })

  it('subscribe sends subscribe message when WS is open', () => {
    client.connectWs()
    client.subscribe('test-event', () => {})
    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', payload: { eventTypes: ['test-event'] } }),
    )
  })

  it('unsubscribe removes handlers and sends unsubscribe message', () => {
    client.connectWs()
    client.subscribe('test-event', () => {})

    client.unsubscribe('test-event')

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'unsubscribe', payload: { eventTypes: ['test-event'] } }),
    )
  })

  it('subscribe returns unsubscribe function that removes handler', () => {
    const handler = vi.fn()
    const unsubscribe = client.subscribe('test-event', handler)
    client.connectWs()
    client.flushBuffer()

    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'e1', type: 'test-event', payload: 'hello', timestamp: 't' }),
        }),
      )
    }
    expect(handler).toHaveBeenCalledWith('hello')

    unsubscribe()

    handler.mockClear()
    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'e2', type: 'test-event', payload: 'world', timestamp: 't' }),
        }),
      )
    }
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('WebSocket buffering and dispatch', () => {
  let client: StoaClient
  let mockWs: MockWebSocket

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
    mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
  })

  it('buffers events before flushBuffer is called', () => {
    const handler = vi.fn()
    client.subscribe('my-event', handler)
    client.connectWs()

    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'b1', type: 'my-event', payload: 'buf1', timestamp: 't' }),
        }),
      )
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'b2', type: 'my-event', payload: 'buf2', timestamp: 't' }),
        }),
      )
    }

    // Before flush, handler should not be called
    expect(handler).not.toHaveBeenCalled()

    // Flush — both should be replayed
    client.flushBuffer()
    expect(handler).toHaveBeenCalledWith('buf1')
    expect(handler).toHaveBeenCalledWith('buf2')
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('after flushBuffer, new events dispatch immediately', () => {
    const handler = vi.fn()
    client.subscribe('live-event', handler)
    client.connectWs()
    client.flushBuffer()

    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'l1', type: 'live-event', payload: 'live', timestamp: 't' }),
        }),
      )
    }
    expect(handler).toHaveBeenCalledWith('live')
  })

  it('malformed JSON messages are silently ignored', () => {
    const handler = vi.fn()
    client.subscribe('test', handler)
    client.connectWs()
    client.flushBuffer()

    if (mockWs.onmessage) {
      mockWs.onmessage(new MessageEvent('message', { data: 'not-json{{{' }))
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('handler errors do not break other handlers on same event', () => {
    const badHandler = vi.fn(() => {
      throw new Error('oops')
    })
    const goodHandler = vi.fn()

    client.subscribe('multi', badHandler)
    client.subscribe('multi', goodHandler)
    client.connectWs()
    client.flushBuffer()

    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'e1', type: 'multi', payload: 'x', timestamp: 't' }),
        }),
      )
    }

    expect(badHandler).toHaveBeenCalled()
    expect(goodHandler).toHaveBeenCalled()
  })

  it('handlers for different events are isolated', () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()
    client.subscribe('a', handlerA)
    client.subscribe('b', handlerB)
    client.connectWs()
    client.flushBuffer()

    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'e1', type: 'a', payload: 1, timestamp: 't' }),
        }),
      )
    }
    expect(handlerA).toHaveBeenCalledWith(1)
    expect(handlerB).not.toHaveBeenCalled()
  })

  it('events with no subscribers are silently dropped', () => {
    client.connectWs()
    client.flushBuffer()

    if (mockWs.onmessage) {
      mockWs.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify({ id: 'e1', type: 'unknown-event', payload: 1, timestamp: 't' }),
        }),
      )
    }
    // No throw — just no dispatch
  })
})

describe('Binary input', () => {
  let client: StoaClient
  let mockWs: MockWebSocket

  beforeEach(() => {
    client = new StoaClient(BASE_URL, TOKEN)
    mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
  })

  it('sendBinaryInput encodes as base64 via WS message', () => {
    client.connectWs()
    const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    client.sendBinaryInput('s1', data)

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'session:binary-input',
        payload: { sessionId: 's1', data: 'SGVsbG8=' },
      }),
    )
  })

  it('sendBinaryInput does not send when WS is not open', () => {
    client.connectWs()
    mockWs.readyState = 0 // CONNECTING
    client.sendBinaryInput('s1', new Uint8Array([1]))
    expect(mockWs.send).not.toHaveBeenCalled()
  })

  it('sendBinaryInput handles empty input', () => {
    client.connectWs()
    client.sendBinaryInput('s1', new Uint8Array([]))

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'session:binary-input',
        payload: { sessionId: 's1', data: '' },
      }),
    )
  })
})

// ── Reconnect ──────────────────────────────────────────────────────────

describe('WebSocket reconnect', () => {
  let client: StoaClient
  let mockWs: MockWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    client = new StoaClient(BASE_URL, TOKEN)
    mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules reconnect on WS close with initial delay', () => {
    client.connectWs()
    expect(WebSocket).toHaveBeenCalledOnce()
    vi.mocked(WebSocket).mockClear()

    if (mockWs.onclose) mockWs.onclose()

    // Should not reconnect immediately
    expect(WebSocket).not.toHaveBeenCalled()

    // Advance by initial delay (1000ms)
    vi.advanceTimersByTime(1000)
    expect(WebSocket).toHaveBeenCalledOnce()
  })

  it('does not reconnect after dispose', () => {
    client.connectWs()
    client.dispose()
    vi.mocked(WebSocket).mockClear()

    if (mockWs.onclose) mockWs.onclose()

    vi.advanceTimersByTime(5000)
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('does not double-schedule when close fires twice', () => {
    client.connectWs()
    vi.mocked(WebSocket).mockClear()

    if (mockWs.onclose) mockWs.onclose()
    if (mockWs.onclose) mockWs.onclose()

    vi.advanceTimersByTime(1000)
    // Should only reconnect once
    expect(WebSocket).toHaveBeenCalledOnce()
  })
})

// ── Dispose ────────────────────────────────────────────────────────────

describe('dispose', () => {
  it('closes WebSocket if open', () => {
    const client = new StoaClient(BASE_URL, TOKEN)
    const mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
    client.connectWs()
    client.dispose()
    expect(mockWs.close).toHaveBeenCalled()
  })

  it('prevents further connectWs calls', () => {
    const client = new StoaClient(BASE_URL, TOKEN)
    client.subscribe('evt', () => {})
    client.dispose()

    const wsSpy = vi.fn()
    ;(wsSpy as unknown as { OPEN: number }).OPEN = 1
    vi.stubGlobal('WebSocket', wsSpy)
    client.connectWs()
    expect(wsSpy).not.toHaveBeenCalled()
  })

  it('prevents reconnect via timer after dispose', () => {
    vi.useFakeTimers()
    const client = new StoaClient(BASE_URL, TOKEN)
    const mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
    client.connectWs()
    client.dispose()

    if (mockWs.onclose) mockWs.onclose()
    vi.advanceTimersByTime(60000)

    expect(WebSocket).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('clears pending reconnect timer', () => {
    vi.useFakeTimers()
    const client = new StoaClient(BASE_URL, TOKEN)
    const mockWs = createMockWs()
    stubWebSocketFactory(mockWs)
    client.connectWs()

    if (mockWs.onclose) mockWs.onclose()
    // Timer should be pending
    client.dispose()

    vi.mocked(WebSocket).mockClear()
    vi.advanceTimersByTime(60000)
    expect(WebSocket).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// ── StoaClientError class ──────────────────────────────────────────────

describe('StoaClientError class', () => {
  it('is an Error subclass', () => {
    const e = new StoaClientError('test', 'test message')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(StoaClientError)
  })

  it('exposes code, message, details, nextSteps as readonly properties', () => {
    const details = { x: 1 }
    const nextSteps = ['step 1']
    const e = new StoaClientError('c', 'm', details, nextSteps)
    expect(e.code).toBe('c')
    expect(e.message).toBe('m')
    expect(e.details).toBe(details)
    expect(e.nextSteps).toBe(nextSteps)
  })

  it('name is "StoaClientError"', () => {
    const e = new StoaClientError('c', 'm')
    expect(e.name).toBe('StoaClientError')
  })

  it('handles undefined details and nextSteps', () => {
    const e = new StoaClientError('c', 'm')
    expect(e.details).toBeUndefined()
    expect(e.nextSteps).toBeUndefined()
  })
})
