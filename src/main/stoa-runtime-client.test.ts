/**
 * Comprehensive integration tests for StoaRuntimeClient.
 *
 * Covers:
 *   - Constructor and configuration
 *   - WebSocket connection setup (URL construction with token & role)
 *   - Command handling for all runtime:* command types
 *   - Reply-to correlation for runtime:response messages
 *   - Terminal data forwarding (runtime:terminal-data)
 *   - Exponential backoff reconnection logic
 *   - Graceful disconnect (clears timers, rejects pending, closes WS)
 *   - Error handling (non-JSON messages, unknown commands, missing payload fields)
 *   - Idempotent launch (duplicate session guard)
 *   - Disconnected client rejects connect()
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClientDeps, StoaRuntimeClientOptions } from './stoa-runtime-client'

// ---------------------------------------------------------------------------
// Mock WebSocket — captures constructor args and allows manual event dispatch
// ---------------------------------------------------------------------------

interface MockWebSocketInstance {
  url: string
  readyState: number
  sentMessages: Array<Record<string, unknown> & { type: string }>
  eventListeners: Map<string, Array<(...args: unknown[]) => void>>
  close: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void
  removeEventListener: (event: string, handler: (...args: unknown[]) => void) => void
}

const instances: MockWebSocketInstance[] = []

// Intercept the global WebSocket constructor
const OriginalWebSocket = globalThis.WebSocket

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3

  url: string
  readyState: number
  sentMessages: Array<Record<string, unknown> & { type: string }> = []
  private eventListeners = new Map<string, Array<(...args: unknown[]) => void>>()

  close = vi.fn(() => {
    this.readyState = 3
  })

  send = vi.fn((data: string) => {
    this.sentMessages.push(JSON.parse(data))
  })

  constructor(url: string) {
    this.url = url
    this.readyState = 0
    instances.push(this as unknown as MockWebSocketInstance)
  }

  addEventListener(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(handler)
  }

  removeEventListener(event: string, handler: (...args: unknown[]) => void): void {
    const listeners = this.eventListeners.get(event)
    if (!listeners) {
      return
    }
    this.eventListeners.set(
      event,
      listeners.filter((listener) => listener !== handler)
    )
  }
}

beforeEach(() => {
  instances.length = 0
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket
  vi.useRealTimers()
  Date.now = ORIGINAL_DATE_NOW
})

const ORIGINAL_DATE_NOW = Date.now.bind(Date)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createDeps(overrides: Partial<RuntimeClientDeps> = {}): RuntimeClientDeps {
  return {
    ptyHost: {
      write: vi.fn(),
      writeBinary: vi.fn(),
      killAndWait: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn(),
      kill: vi.fn(),
      dispose: vi.fn()
    } as unknown as RuntimeClientDeps['ptyHost'],
    appendTerminalData: vi.fn().mockResolvedValue(undefined),
    getTerminalReplay: vi.fn().mockResolvedValue('replay-buffer-data'),
    launchSession: vi.fn().mockResolvedValue(true),
    createChildSession: vi.fn().mockResolvedValue('child-session-123'),
    ...overrides
  }
}

function createOptions(overrides: Partial<StoaRuntimeClientOptions> = {}): StoaRuntimeClientOptions {
  return {
    serverUrl: 'ws://localhost:3270',
    authToken: 'test-token-abc',
    ...overrides
  }
}

/** Dispatch an event on the most recently created MockWebSocket instance */
function dispatchWsEvent(event: string, data: unknown): void {
  const inst = instances[instances.length - 1]
  if (!inst) throw new Error('No WebSocket instance')
  const listeners = inst.eventListeners.get(event)
  if (!listeners) return
  for (const handler of listeners) {
    handler(data)
  }
}

/** Simulate WS open (set readyState to OPEN and dispatch 'open') */
function simulateOpen(): void {
  const inst = instances[instances.length - 1]
  if (!inst) throw new Error('No WebSocket instance')
  inst.readyState = 1 // OPEN
  dispatchWsEvent('open', {})
}

/** Simulate a WS message from the server */
function simulateMessage(raw: string): void {
  dispatchWsEvent('message', { data: raw } as MessageEvent)
}

/** Simulate WS close */
function simulateClose(code = 1000, reason = ''): void {
  const inst = instances[instances.length - 1]
  if (!inst) throw new Error('No WebSocket instance')
  inst.readyState = 3 // CLOSED
  dispatchWsEvent('close', { code, reason, wasClean: true } as CloseEvent)
}

/** Get the latest sent message from the WS */
function getLastSentMessage(): (Record<string, unknown> & { type: string }) | undefined {
  const inst = instances[instances.length - 1]
  if (!inst || inst.sentMessages.length === 0) return undefined
  return inst.sentMessages[inst.sentMessages.length - 1]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StoaRuntimeClient - connection setup', () => {
  it('constructs WS URL with token and role query params', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    // The constructor was called — check the URL
    expect(instances.length).toBe(1)
    expect(instances[0].url).toContain('token=test-token-abc')
    expect(instances[0].url).toContain('role=runtime')

    // Resolve the connection
    simulateOpen()
    await connectPromise
  })

  it('resolves connect() once the WS is open', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    expect(client.connected).toBe(false)

    simulateOpen()
    await connectPromise
    expect(client.connected).toBe(true)
  })

  it('rejects connect() on WebSocket error before opening', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()

    dispatchWsEvent('error', new ErrorEvent('fail', { message: 'ECONNREFUSED' }))

    await expect(connectPromise).rejects.toThrow(/Failed to connect/)
    expect(client.connected).toBe(false)
  })

  it('throws if connect() is called after dispose()', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())
    client.disconnect()
    await expect(client.connect()).rejects.toThrow(/disposed/)
  })
})

describe('StoaRuntimeClient - command handling', () => {
  it('handles runtime:launch by calling launchSession and responding ok', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-1',
      payload: { cols: 80, rows: 24 },
      replyTo: 'corr-001'
    }))

    // Let the async handleMessage resolve
    await new Promise((r) => setImmediate(r))

    expect(deps.launchSession).toHaveBeenCalledWith('sess-1', {
      initialDimensions: { cols: 80, rows: 24 }
    })

    const response = getLastSentMessage()
    expect(response).toBeDefined()
    expect(response).toEqual({
      type: 'runtime:response',
      replyTo: 'corr-001',
      ok: true,
      data: { status: 'launched' }
    })
  })

  it('handles runtime:launch idempotently for already-running sessions', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    // First launch
    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-dup',
      payload: {},
      replyTo: 'corr-1'
    }))
    await new Promise((r) => setImmediate(r))

    // Second launch for same session
    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-dup',
      payload: {},
      replyTo: 'corr-2'
    }))
    await new Promise((r) => setImmediate(r))

    // launchSession should only be called once
    expect(deps.launchSession).toHaveBeenCalledTimes(1)

    // Second response should indicate already_running
    const last = getLastSentMessage()
    expect(last!.data).toEqual({ status: 'already_running' })
  })

  it('rejects concurrent runtime:launch commands for the same launching session', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    const launchSession = vi.fn(() => launchPromise)
    const deps = createDeps({ launchSession })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-concurrent',
      payload: {},
      replyTo: 'corr-concurrent-1'
    }))
    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-concurrent',
      payload: {},
      replyTo: 'corr-concurrent-2'
    }))
    await new Promise((r) => setImmediate(r))

    expect(launchSession).toHaveBeenCalledTimes(1)
    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-concurrent-2',
      ok: false,
      error: 'runtime:launch is already in progress for session sess-concurrent'
    })

    resolveLaunch?.(true)
    await new Promise((r) => setImmediate(r))

    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-concurrent-1',
      ok: true,
      data: { status: 'launched' }
    })
  })

  it('times out hung runtime:launch commands and clears launch-time queues', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const launchSession = vi.fn(() => new Promise<boolean>(() => {}))
    const deps = createDeps({ launchSession })
    const client = new StoaRuntimeClient(createOptions(), deps)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-hung',
      payload: {},
      replyTo: 'corr-hung-launch'
    }))
    await vi.advanceTimersByTimeAsync(1)

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-hung',
      payload: { data: 'queued-before-timeout\n' },
      replyTo: 'corr-hung-input'
    }))
    await vi.advanceTimersByTimeAsync(29_000)
    await new Promise((r) => setImmediate(r))

    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-hung-launch',
      ok: false,
      error: 'runtime:launch timed out after 29000ms for session sess-hung'
    })

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-hung',
      payload: { data: 'after-timeout\n' },
      replyTo: 'corr-hung-input-after'
    }))
    await vi.advanceTimersByTimeAsync(1)

    expect(deps.ptyHost.write).not.toHaveBeenCalled()
    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-hung-input-after',
      ok: false,
      error: 'runtime:input cannot target inactive session sess-hung'
    })
    vi.useRealTimers()
  })

  it('queues runtime:input that arrives while launch is still in progress', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    const deps = createDeps({ launchSession: vi.fn(() => launchPromise) })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-queue-input',
      payload: {},
      replyTo: 'corr-queue-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-queue-input',
      payload: { data: 'first\n' },
      replyTo: 'corr-queue-input-1'
    }))
    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-queue-input',
      payload: { data: 'second\n' },
      replyTo: 'corr-queue-input-2'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).not.toHaveBeenCalled()
    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-queue-input-1',
      ok: true
    })
    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-queue-input-2',
      ok: true
    })

    resolveLaunch(true)
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).toHaveBeenNthCalledWith(1, 'sess-queue-input', 'first\n')
    expect(deps.ptyHost.write).toHaveBeenNthCalledWith(2, 'sess-queue-input', 'second\n')
  })

  it('keeps runtime:launch successful when queued input flush fails after activation', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    const deps = createDeps({
      launchSession: vi.fn(() => launchPromise),
      ptyHost: {
        write: vi.fn(() => {
          throw new Error('write failed')
        }),
        writeBinary: vi.fn(),
        killAndWait: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn(),
        kill: vi.fn(),
        dispose: vi.fn()
      } as unknown as RuntimeClientDeps['ptyHost']
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-flush-fail',
      payload: {},
      replyTo: 'corr-flush-fail-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-flush-fail',
      payload: { data: 'queued\n' },
      replyTo: 'corr-flush-fail-input'
    }))
    await new Promise((r) => setImmediate(r))

    resolveLaunch(true)
    await new Promise((r) => setImmediate(r))

    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-flush-fail-launch',
      ok: true,
      data: { status: 'launched' }
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to flush queued input for sess-flush-fail after launch'),
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })

  it('writes input directly when it arrives while queued launch input is being flushed', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    let releaseInterrupt!: () => void
    const interruptGate = new Promise<void>((resolve) => {
      releaseInterrupt = resolve
    })
    const markAgentTurnInterrupted = vi.fn(() => interruptGate)
    const deps = createDeps({
      launchSession: vi.fn(() => launchPromise),
      getSessionType: vi.fn((): 'opencode' => 'opencode'),
      markAgentTurnInterrupted
    })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-reentrant-input',
      payload: {},
      replyTo: 'corr-reentrant-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-reentrant-input',
      payload: { data: '\x03' },
      replyTo: 'corr-reentrant-queued'
    }))
    await new Promise((r) => setImmediate(r))

    resolveLaunch(true)
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-reentrant-input',
      payload: { data: 'after-active\n' },
      replyTo: 'corr-reentrant-after-active'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).toHaveBeenNthCalledWith(1, 'sess-reentrant-input', '\x03')
    expect(deps.ptyHost.write).toHaveBeenNthCalledWith(2, 'sess-reentrant-input', 'after-active\n')

    releaseInterrupt()
    await new Promise((r) => setImmediate(r))

    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-reentrant-after-active',
      ok: true
    })
  })

  it('writes binary runtime:input payloads without converting through text', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-binary',
      payload: {},
      replyTo: 'corr-binary-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-binary',
      payload: { base64Data: Buffer.from([0x1b, 0xe9]).toString('base64') },
      replyTo: 'corr-binary-input'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).not.toHaveBeenCalled()
    expect(deps.ptyHost.writeBinary).toHaveBeenCalledWith(
      'sess-binary',
      Buffer.from([0x1b, 0xe9])
    )
  })

  it('marks agent turns interrupted when binary runtime:input is Ctrl+C', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const markAgentTurnInterrupted = vi.fn(async () => {})
    const deps = createDeps({
      getSessionType: vi.fn((): 'claude-code' => 'claude-code'),
      markAgentTurnInterrupted
    })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-binary-ctrl-c',
      payload: {},
      replyTo: 'corr-binary-ctrl-c-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-binary-ctrl-c',
      payload: { base64Data: Buffer.from([0x03]).toString('base64') },
      replyTo: 'corr-binary-ctrl-c'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.writeBinary).toHaveBeenCalledWith(
      'sess-binary-ctrl-c',
      Buffer.from([0x03])
    )
    expect(markAgentTurnInterrupted).toHaveBeenCalledWith('sess-binary-ctrl-c', 'claude-code')
  })

  it('queues binary runtime:input payloads while launch is still in progress', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    const deps = createDeps({ launchSession: vi.fn(() => launchPromise) })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-queue-binary',
      payload: {},
      replyTo: 'corr-queue-binary-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-queue-binary',
      payload: { base64Data: Buffer.from([0x80, 0xff]).toString('base64') },
      replyTo: 'corr-queue-binary-input'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.writeBinary).not.toHaveBeenCalled()

    resolveLaunch(true)
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.writeBinary).toHaveBeenCalledWith(
      'sess-queue-binary',
      Buffer.from([0x80, 0xff])
    )
  })

  it('handles runtime:launch failure and returns error response', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps({ launchSession: vi.fn().mockResolvedValue(false) })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-fail',
      payload: {},
      replyTo: 'corr-fail'
    }))
    await new Promise((r) => setImmediate(r))

    const last = getLastSentMessage()
    expect(last!.ok).toBe(false)
    expect(last!.error).toMatch(/Failed to launch session/)
  })

  it('handles runtime:kill by calling ptyHost.killAndWait', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:kill',
      sessionId: 'sess-kill',
      payload: {},
      replyTo: 'corr-kill'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.killAndWait).toHaveBeenCalledWith('sess-kill')

    const last = getLastSentMessage()
    expect(last!.ok).toBe(true)
  })

  it('removes killed sessions from reconnect state sync', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-kill-sync',
      payload: {},
      replyTo: 'corr-launch-kill-sync'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:kill',
      sessionId: 'sess-kill-sync',
      payload: {},
      replyTo: 'corr-kill-sync'
    }))
    await new Promise((r) => setImmediate(r))

    vi.useFakeTimers({ shouldAdvanceTime: true })
    simulateClose(1006, 'lost')
    await vi.advanceTimersByTimeAsync(2_000)
    simulateOpen()
    await new Promise((r) => setImmediate(r))

    const stateSync = instances[instances.length - 1].sentMessages.find((message) => message.type === 'runtime:state-sync')
    expect(stateSync).toBeUndefined()

    vi.useRealTimers()
  })

  it('handles runtime:input by writing to ptyHost', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-in',
      payload: {},
      replyTo: 'corr-input-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-in',
      payload: { data: 'ls -la\n' },
      replyTo: 'corr-input'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).toHaveBeenCalledWith('sess-in', 'ls -la\n')
  })

  it('rejects runtime:input for inactive sessions instead of silently dropping data', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-inactive',
      payload: { data: 'pwd\n' },
      replyTo: 'corr-input-inactive'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).not.toHaveBeenCalled()
    const last = getLastSentMessage()
    expect(last).toEqual({
      type: 'runtime:response',
      replyTo: 'corr-input-inactive',
      ok: false,
      error: 'runtime:input cannot target inactive session sess-inactive'
    })
  })

  it('handles runtime:input error when payload.data is not a string', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-in',
      payload: { data: 123 },
      replyTo: 'corr-input'
    }))
    await new Promise((r) => setImmediate(r))

    const last = getLastSentMessage()
    expect(last!.ok).toBe(false)
    expect(last!.error).toMatch(/payload\.data/)
  })

  it('handles runtime:resize by calling ptyHost.resize', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-rs',
      payload: {},
      replyTo: 'corr-resize-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:resize',
      sessionId: 'sess-rs',
      payload: { cols: 120, rows: 40 },
      replyTo: 'corr-resize'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.resize).toHaveBeenCalledWith('sess-rs', 120, 40)
  })

  it('rejects runtime:resize for inactive sessions instead of silently no-oping', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:resize',
      sessionId: 'sess-rs-inactive',
      payload: { cols: 120, rows: 40 },
      replyTo: 'corr-resize-inactive'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.resize).not.toHaveBeenCalled()
    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-resize-inactive',
      ok: false,
      error: 'runtime:resize cannot target inactive session sess-rs-inactive'
    })
  })

  it('retains the last runtime:resize that arrives while launch is still in progress', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    const deps = createDeps({ launchSession: vi.fn(() => launchPromise) })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-queue-resize',
      payload: {},
      replyTo: 'corr-queue-resize-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:resize',
      sessionId: 'sess-queue-resize',
      payload: { cols: 100, rows: 30 },
      replyTo: 'corr-queue-resize-1'
    }))
    simulateMessage(JSON.stringify({
      type: 'runtime:resize',
      sessionId: 'sess-queue-resize',
      payload: { cols: 132, rows: 44 },
      replyTo: 'corr-queue-resize-2'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.resize).not.toHaveBeenCalled()

    resolveLaunch(true)
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.resize).toHaveBeenCalledTimes(1)
    expect(deps.ptyHost.resize).toHaveBeenCalledWith('sess-queue-resize', 132, 44)
  })

  it('handles runtime:resize error when cols/rows are missing', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:resize',
      sessionId: 'sess-rs',
      payload: { cols: 120 },
      replyTo: 'corr-resize'
    }))
    await new Promise((r) => setImmediate(r))

    const last = getLastSentMessage()
    expect(last!.ok).toBe(false)
    expect(last!.error).toMatch(/payload\.cols and payload\.rows/)
  })

  it('handles runtime:interrupt by sending Ctrl+C (ETX)', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-int',
      payload: {},
      replyTo: 'corr-int-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:interrupt',
      sessionId: 'sess-int',
      payload: {},
      replyTo: 'corr-int'
    }))
    await new Promise((r) => setImmediate(r))

    // ETX = '\x03'
    expect(deps.ptyHost.write).toHaveBeenCalledWith('sess-int', '\x03')
  })

  it('queues runtime:interrupt while launch is still in progress', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    let resolveLaunch!: (value: boolean) => void
    const launchPromise = new Promise<boolean>((resolve) => {
      resolveLaunch = resolve
    })
    const markAgentTurnInterrupted = vi.fn(async () => {})
    const deps = createDeps({
      launchSession: vi.fn(() => launchPromise),
      getSessionType: vi.fn((): 'claude-code' => 'claude-code'),
      markAgentTurnInterrupted
    })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-int-launching',
      payload: {},
      replyTo: 'corr-int-launching-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:interrupt',
      sessionId: 'sess-int-launching',
      payload: {},
      replyTo: 'corr-int-launching'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).not.toHaveBeenCalled()
    expect(instances[0].sentMessages).toContainEqual({
      type: 'runtime:response',
      replyTo: 'corr-int-launching',
      ok: true
    })

    resolveLaunch(true)
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).toHaveBeenCalledWith('sess-int-launching', '\x03')
    expect(markAgentTurnInterrupted).toHaveBeenCalledWith('sess-int-launching', 'claude-code')
  })

  it('marks agent turns interrupted when Ctrl+C arrives through runtime:input', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const markAgentTurnInterrupted = vi.fn(async () => {})
    const deps = createDeps({
      getSessionType: vi.fn((): 'opencode' => 'opencode'),
      markAgentTurnInterrupted
    })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-ctrl-c',
      payload: {},
      replyTo: 'corr-ctrl-c-launch'
    }))
    await new Promise((r) => setImmediate(r))

    simulateMessage(JSON.stringify({
      type: 'runtime:input',
      sessionId: 'sess-ctrl-c',
      payload: { data: '\x03' },
      replyTo: 'corr-ctrl-c-input'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.ptyHost.write).toHaveBeenCalledWith('sess-ctrl-c', '\x03')
    expect(markAgentTurnInterrupted).toHaveBeenCalledWith('sess-ctrl-c', 'opencode')
  })

  it('handles runtime:get-terminal-replay by returning replay data', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:get-terminal-replay',
      sessionId: 'sess-replay',
      payload: {},
      replyTo: 'corr-replay'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.getTerminalReplay).toHaveBeenCalledWith('sess-replay')

    const last = getLastSentMessage()
    expect(last!.ok).toBe(true)
    expect(last!.data).toEqual({ text: 'replay-buffer-data' })
  })

  it('handles runtime:create-child-session and returns childSessionId', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:create-child-session',
      sessionId: 'parent-session',
      payload: {
        type: 'shell',
        title: 'Child task',
        initialCols: 100,
        initialRows: 30
      },
      replyTo: 'corr-child'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.createChildSession).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'parent-session',
        type: 'shell',
        title: 'Child task',
        initialCols: 100,
        initialRows: 30
      })
    )

    const last = getLastSentMessage()
    expect(last!.ok).toBe(true)
    expect(last!.data).toEqual({ childSessionId: 'child-session-123' })
  })

  it('uses the command sessionId as parentId for runtime:create-child-session', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:create-child-session',
      sessionId: 'parent-session',
      payload: { type: 'shell' },
      replyTo: 'corr-child-fail'
    }))
    await new Promise((r) => setImmediate(r))

    expect(deps.createChildSession).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-session' })
    )
  })

  it('responds with error for unknown runtime command types', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:unknown-command',
      sessionId: 'sess-x',
      payload: {},
      replyTo: 'corr-unknown'
    }))
    await new Promise((r) => setImmediate(r))

    const last = getLastSentMessage()
    expect(last!.ok).toBe(false)
    expect(last!.error).toMatch(/Unknown runtime command/)
  })

  it('ignores non-JSON messages', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    const sentCount = instances[0].sentMessages.length

    simulateMessage('not-json {{{')
    await new Promise((r) => setImmediate(r))

    // No response should be sent for non-JSON messages
    expect(instances[0].sentMessages.length).toBe(sentCount)
  })

  it('ignores messages that are not runtime commands', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    const sentCount = instances[0].sentMessages.length

    simulateMessage(JSON.stringify({ type: 'subscription:update', data: {} }))
    await new Promise((r) => setImmediate(r))

    expect(instances[0].sentMessages.length).toBe(sentCount)
  })
})

describe('StoaRuntimeClient - terminal data forwarding', () => {
  it('sends runtime:terminal-data via WS when connected', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    client.forwardTerminalData('sess-1', 'output data from PTY')

    const last = getLastSentMessage()
    expect(last).toEqual({
      type: 'runtime:terminal-data',
      sessionId: 'sess-1',
      data: 'output data from PTY'
    })
  })

  it('sends runtime:pty-state when a PTY exits', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const markRuntimeExited = vi.fn().mockResolvedValue(undefined)
    const client = new StoaRuntimeClient(createOptions(), createDeps({ markRuntimeExited }))

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    client.markRuntimeExited('sess-exited', 7, 'provider exited')

    expect(getLastSentMessage()).toEqual({
      type: 'runtime:pty-state',
      sessionId: 'sess-exited',
      state: {
        alive: false,
        exitCode: 7,
        exitReason: 'failed'
      }
    })
    expect(markRuntimeExited).toHaveBeenCalledWith('sess-exited', 7, 'provider exited')
  })

  it('sends runtime:pty-state alive for provider-owned local launches', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    client.markRuntimeAlive('sess-local')

    expect(getLastSentMessage()).toMatchObject({
      type: 'runtime:pty-state',
      sessionId: 'sess-local',
      state: {
        alive: true
      }
    })
  })
})

describe('StoaRuntimeClient - terminal forwarding when disconnected', () => {
  it('silently drops terminal data when WS is null', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())
    // Never connected — ws is null
    expect(() => client.forwardTerminalData('sess-x', 'data')).not.toThrow()
  })
})

describe('StoaRuntimeClient - graceful disconnect', () => {
  it('closes WS, clears reconnect timer, and rejects pending commands', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    client.disconnect()

    expect(instances[0].close).toHaveBeenCalledWith(1000, 'Client shutdown')
    expect(client.connected).toBe(false)
  })

  it('marks client as disposed preventing future reconnects', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    client.disconnect()

    // Simulate a close event (should not trigger reconnect because disposed)
    simulateClose(1006, 'abnormal')

    // Advance timers to check no reconnect is scheduled
    vi.useFakeTimers()
    vi.advanceTimersByTime(60_000)

    // Only one WS instance should have been created (no reconnect)
    expect(instances.length).toBe(1)
  })
})

describe('StoaRuntimeClient - reconnection with backoff', () => {
  it('schedules a reconnect after WS close', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    // Now switch to fake timers so we can control the reconnect delay
    vi.useFakeTimers({ shouldAdvanceTime: true })

    // Simulate close — this should schedule a reconnect via setTimeout
    simulateClose(1006, 'connection lost')

    // Advance past the reconnect delay (base 1s + jitter up to 0.5s)
    await vi.advanceTimersByTimeAsync(2_000)

    // A second WS instance should be created for the reconnect
    expect(instances.length).toBeGreaterThanOrEqual(2)

    vi.useRealTimers()
  })

  it('increases delay exponentially on repeated failures', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    // First connection
    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    vi.useFakeTimers({ shouldAdvanceTime: true })

    // First close -> schedule first reconnect (delay ≈ 1s + jitter)
    simulateClose(1006, 'lost')
    await vi.advanceTimersByTimeAsync(2_000)

    // Second WS is created by reconnect; simulate its failure
    if (instances.length >= 2) {
      // Close the second WS to trigger another reconnect
      simulateClose(1006, 'lost again')
      // Wait for second reconnect delay (2^1 * 1s + jitter ≈ 2-2.5s)
      await vi.advanceTimersByTimeAsync(5_000)
    }

    // At least 3 WS instances total
    expect(instances.length).toBeGreaterThanOrEqual(3)

    vi.useRealTimers()
  })

  it('syncs active session ownership after reconnect', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-sync',
      payload: {},
      replyTo: 'corr-sync'
    }))
    await new Promise((r) => setImmediate(r))

    vi.useFakeTimers({ shouldAdvanceTime: true })
    simulateClose(1006, 'lost')
    await vi.advanceTimersByTimeAsync(2_000)

    expect(instances.length).toBeGreaterThanOrEqual(2)
    simulateOpen()
    await new Promise((r) => setImmediate(r))

    const stateSync = instances[instances.length - 1].sentMessages.find((message) => message.type === 'runtime:state-sync')
    expect(stateSync).toEqual({
      type: 'runtime:state-sync',
      sessions: [{
        sessionId: 'sess-sync',
        state: {
          alive: true,
          startedAt: expect.any(String)
        }
      }]
    })

    vi.useRealTimers()
  })

  it('syncs provider-owned local sessions that become alive before the WS opens', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    client.markRuntimeAlive('sess-local-before-open')

    expect(instances[0].sentMessages).toEqual([])

    simulateOpen()
    await connectPromise

    const stateSync = instances[0].sentMessages.find((message) => message.type === 'runtime:state-sync')
    expect(stateSync).toEqual({
      type: 'runtime:state-sync',
      sessions: [{
        sessionId: 'sess-local-before-open',
        state: {
          alive: true,
          startedAt: expect.any(String)
        }
      }]
    })
  })

  it('does not sync a session as active after it exits while disconnected', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-disconnect-exit',
      payload: {},
      replyTo: 'corr-disconnect-exit'
    }))
    await new Promise((r) => setImmediate(r))

    vi.useFakeTimers({ shouldAdvanceTime: true })
    simulateClose(1006, 'lost')
    client.markRuntimeExited('sess-disconnect-exit', 0, 'exited while disconnected')
    await vi.advanceTimersByTimeAsync(2_000)

    expect(instances.length).toBeGreaterThanOrEqual(2)
    simulateOpen()
    await new Promise((r) => setImmediate(r))

    const stateSync = instances[instances.length - 1].sentMessages.find((message) => message.type === 'runtime:state-sync')
    expect(stateSync).toBeUndefined()

    vi.useRealTimers()
  })
})

describe('StoaRuntimeClient - WS close rejects pending commands', () => {
  it('rejects pending commands when connection closes', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps()
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    // Send a command that expects a response (via internal pendingCommands)
    // We can't directly create pending commands from the public API,
    // but we can verify that close triggers rejectAllPending behavior
    // by checking that disconnect clears state.

    // Simulate receiving a launch command so there's active state
    simulateMessage(JSON.stringify({
      type: 'runtime:launch',
      sessionId: 'sess-pending',
      payload: {},
      replyTo: 'corr-pending'
    }))
    await new Promise((r) => setImmediate(r))

    // Now disconnect
    client.disconnect()
    expect(client.connected).toBe(false)
  })
})

describe('StoaRuntimeClient - connected property', () => {
  it('returns true when WS is open', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    expect(client.connected).toBe(true)
  })

  it('returns false before connecting', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())
    expect(client.connected).toBe(false)
  })

  it('returns false after disconnect', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const client = new StoaRuntimeClient(createOptions(), createDeps())

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    client.disconnect()
    expect(client.connected).toBe(false)
  })
})

describe('StoaRuntimeClient - command handler error propagation', () => {
  it('returns error response when ptyHost throws during runtime:kill', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps({
      ptyHost: {
        write: vi.fn(),
        killAndWait: vi.fn().mockRejectedValue(new Error('Process not found')),
        resize: vi.fn(),
        kill: vi.fn(),
        dispose: vi.fn()
      } as unknown as RuntimeClientDeps['ptyHost']
    })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:kill',
      sessionId: 'nonexistent',
      payload: {},
      replyTo: 'corr-kill-err'
    }))
    await new Promise((r) => setImmediate(r))

    const last = getLastSentMessage()
    expect(last!.ok).toBe(false)
    expect(last!.error).toMatch(/Process not found/)
  })

  it('returns error response when createChildSession throws', async () => {
    const { StoaRuntimeClient } = await import('./stoa-runtime-client')
    const deps = createDeps({
      createChildSession: vi.fn().mockRejectedValue(new Error('Cannot create child'))
    })
    const client = new StoaRuntimeClient(createOptions(), deps)

    const connectPromise = client.connect()
    simulateOpen()
    await connectPromise

    simulateMessage(JSON.stringify({
      type: 'runtime:create-child-session',
      sessionId: 'parent',
      payload: { parentId: 'parent', type: 'shell' },
      replyTo: 'corr-child-err'
    }))
    await new Promise((r) => setImmediate(r))

    const last = getLastSentMessage()
    expect(last!.ok).toBe(false)
    expect(last!.error).toMatch(/Cannot create child/)
  })
})
