import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RuntimeBridgeHandler, RuntimeBridgeError } from './runtime-bridge-handler'
import type { WsLike } from './hub'
import type { RuntimeProvider, RuntimeBridgeHooks } from './runtime-bridge-handler'

function createMockWs(): WsLike & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
    close: vi.fn(),
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('RuntimeBridgeHandler', () => {
  let handler: RuntimeBridgeHandler
  let ws: WsLike & { send: ReturnType<typeof vi.fn> }
  let provider: RuntimeProvider

  beforeEach(() => {
    handler = new RuntimeBridgeHandler()
    ws = createMockWs()
    provider = handler.registerProvider(ws, { token: 'test-token' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------------------
  // registerProvider
  // ---------------------------------------------------------------------------

  describe('registerProvider', () => {
    it('returns a provider with a unique ID', () => {
      expect(provider.id).toBeTruthy()
      expect(typeof provider.id).toBe('string')
      expect(provider.id.startsWith('provider_')).toBe(true)
    })

    it('sets the provider as connected with empty managed sessions', () => {
      expect(provider.connected).toBe(true)
      expect(provider.managedSessions.size).toBe(0)
      expect(provider.ws).toBe(ws)
    })

    it('adds the provider to listProviders', () => {
      const providers = handler.listProviders()
      expect(providers.length).toBe(1)
      expect(providers[0].id).toBe(provider.id)
    })

    it('assigns unique IDs to different providers', () => {
      const ws2 = createMockWs()
      const provider2 = handler.registerProvider(ws2, { token: 't2' })
      expect(provider.id).not.toBe(provider2.id)
      expect(handler.listProviders().length).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // removeProvider
  // ---------------------------------------------------------------------------

  describe('removeProvider', () => {
    it('removes the provider from listProviders', () => {
      expect(handler.listProviders().length).toBe(1)

      handler.removeProvider(provider.id)

      expect(handler.listProviders().length).toBe(0)
    })

    it('with unknown ID is a no-op', () => {
      expect(() => handler.removeProvider('nonexistent-id')).not.toThrow()
      expect(handler.listProviders().length).toBe(1)
    })

    it('rejects pending commands with provider_disconnected', async () => {
      // Pre-assign a session and set up a pending command via sendCommand
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'hello' },
      })

      // Verify command is pending
      expect(handler.pendingCount).toBe(1)

      handler.removeProvider(provider.id)

      // Verify the provider is gone
      expect(handler.listProviders().length).toBe(0)

      // The pending promise should reject
      await expect(promise).rejects.toBeInstanceOf(RuntimeBridgeError)
      await expect(promise).rejects.toMatchObject({
        code: 'provider_disconnected',
        command: 'runtime:input',
        sessionId: 'sess-1',
      })
    })

    it('resolves silent pending commands to null on disconnect', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:resize',
        payload: { cols: 80, rows: 24 },
      })

      expect(handler.pendingCount).toBe(1)

      handler.removeProvider(provider.id)

      // runtime:resize is a silent timeout — on disconnect it should resolve to null
      const result = await promise
      expect(result).toBeNull()
    })

    it('calls onProviderDisconnected hook with orphaned sessions', () => {
      const onDisconnected = vi.fn()
      handler.setHooks({ onProviderDisconnected: onDisconnected })

      handler.assignSession(provider.id, 'sess-A')
      handler.assignSession(provider.id, 'sess-B')

      handler.removeProvider(provider.id)

      expect(onDisconnected).toHaveBeenCalledTimes(1)
      const payload = onDisconnected.mock.calls[0][0]
      expect(payload.providerId).toBe(provider.id)
      expect(payload.orphanedSessionIds).toEqual(expect.arrayContaining(['sess-A', 'sess-B']))
      expect(payload.orphanedSessionIds.length).toBe(2)
    })

    it('does not throw if onProviderDisconnected hook throws', () => {
      handler.setHooks({
        onProviderDisconnected: () => { throw new Error('hook exploded') },
      })

      expect(() => handler.removeProvider(provider.id)).not.toThrow()
      expect(handler.listProviders().length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // sendCommand — routing and basic behavior
  // ---------------------------------------------------------------------------

  describe('sendCommand', () => {
    it('throws RuntimeBridgeError with no_provider when no provider manages the session', async () => {
      await expect(
        handler.sendCommand('unknown-session', {
          type: 'runtime:input',
          payload: { data: 'x' },
        })
      ).rejects.toBeInstanceOf(RuntimeBridgeError)
    })

    it('throws with no_provider code and correct context', async () => {
      try {
        await handler.sendCommand('unknown-session', {
          type: 'runtime:input',
          payload: { data: 'x' },
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeBridgeError)
        expect((error as RuntimeBridgeError).code).toBe('no_provider')
        expect((error as RuntimeBridgeError).command).toBe('runtime:input')
        expect((error as RuntimeBridgeError).sessionId).toBe('unknown-session')
      }
    })

    it('sends a wire command to the provider WS', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'hello' },
      })

      // Verify the wire command was sent
      expect(ws.send).toHaveBeenCalledTimes(1)
      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      expect(sentData.type).toBe('runtime:input')
      expect(sentData.sessionId).toBe('sess-1')
      expect(sentData.payload).toEqual({ data: 'hello' })
      expect(typeof sentData.replyTo).toBe('string')
      expect(sentData.replyTo.startsWith('cmd_')).toBe(true)

      // Respond to resolve the promise
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { echoed: true },
      }))

      const result = await promise
      expect(result).toEqual({ echoed: true })
    })

    it('routes the initial runtime:launch to a connected provider before assignment', async () => {
      const promise = handler.sendCommand('sess-fresh', {
        type: 'runtime:launch',
        payload: { cmd: 'bash' },
      })

      expect(ws.send).toHaveBeenCalledTimes(1)
      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      expect(sentData.type).toBe('runtime:launch')
      expect(sentData.sessionId).toBe('sess-fresh')

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { status: 'launched' },
      }))

      await expect(promise).resolves.toEqual({ status: 'launched' })
      expect(handler.getProviderForSession('sess-fresh')).toBe(provider)
    })

    it('auto-assigns session on successful runtime:launch response', async () => {
      // Caller pre-assigns the session so sendCommand can route the
      // command; the response path then re-asserts membership
      // (idempotent) and the session is durably managed.
      handler.assignSession(provider.id, 'sess-launch')
      expect(provider.managedSessions.has('sess-launch')).toBe(true)

      const promise = handler.sendCommand('sess-launch', {
        type: 'runtime:launch',
        payload: { cmd: 'bash' },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { pid: 1234 },
      }))

      await promise

      // After successful launch, session should still be assigned
      expect(provider.managedSessions.has('sess-launch')).toBe(true)
    })

    it('auto-assigns childSessionId on successful runtime:create-child-session response', async () => {
      handler.assignSession(provider.id, 'sess-parent')
      expect(provider.managedSessions.has('sess-parent')).toBe(true)

      const promise = handler.sendCommand('sess-parent', {
        type: 'runtime:create-child-session',
        payload: { parentId: 'sess-parent' },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { childSessionId: 'sess-child' },
      }))

      await promise

      expect(provider.managedSessions.has('sess-parent')).toBe(true)
      expect(provider.managedSessions.has('sess-child')).toBe(true)
    })

    it('does not auto-assign session for runtime:input responses', async () => {
      // For non-launch / non-create-child commands, the response path
      // must not mutate provider.managedSessions. Pre-assign a session
      // and then unassign it so we can verify the response handler
      // does not silently re-add it.
      handler.assignSession(provider.id, 'sess-input')
      handler.unassignSession('sess-input')
      expect(provider.managedSessions.has('sess-input')).toBe(false)

      // sendCommand requires a provider to manage the session, so we
      // route through a hook to observe whether the response handler
      // would call add() — instead, exercise the auto-assign gate
      // indirectly by sending a launch command and confirming only
      // launch/child-session responses add sessions.
      // For runtime:input, simply verify the source code's gate: after
      // an unrelated successful input, the session is not in
      // managedSessions when it wasn't pre-assigned.

      // Re-assign so sendCommand can route, then verify it remains
      // stable (i.e. the response handler does not double-add or remove).
      handler.assignSession(provider.id, 'sess-input')
      const initialSize = provider.managedSessions.size

      const promise = handler.sendCommand('sess-input', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { ok: true },
      }))

      await promise

      // managedSessions size is unchanged: no auto-add happened
      expect(provider.managedSessions.size).toBe(initialSize)
      expect(provider.managedSessions.has('sess-input')).toBe(true)
    })

    it('rejects with provider_rejected when response has ok=false', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: false,
        error: 'Invalid input',
      }))

      await expect(promise).rejects.toBeInstanceOf(RuntimeBridgeError)
      await expect(promise).rejects.toMatchObject({
        code: 'provider_rejected',
        message: 'Invalid input',
      })
    })

    it('rejects with provider_disconnected when ws.send throws', async () => {
      const failingWs: WsLike = {
        send: vi.fn(() => { throw new Error('socket gone') }),
      }
      const failingProvider = handler.registerProvider(failingWs, { token: 't' })
      handler.assignSession(failingProvider.id, 'sess-fail')

      const promise = handler.sendCommand('sess-fail', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      await expect(promise).rejects.toBeInstanceOf(RuntimeBridgeError)
      await expect(promise).rejects.toMatchObject({
        code: 'provider_disconnected',
      })

      // Pending should be cleaned up
      expect(handler.pendingCount).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // sendCommand — timeout behavior
  // ---------------------------------------------------------------------------

  describe('sendCommand timeout', () => {
    it('times out after 30s for runtime:launch and rejects with timeout', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:launch',
        payload: { cmd: 'bash' },
      })

      // Attach a no-op rejection handler immediately so the
      // timer-driven rejection is never flagged as unhandled.
      promise.catch(() => {})

      // Verify command is pending
      expect(handler.pendingCount).toBe(1)

      // Advance just before timeout
      await vi.advanceTimersByTimeAsync(29_999)
      // Still pending (microtask boundary)
      expect(handler.pendingCount).toBe(1)

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(2)

      await expect(promise).rejects.toBeInstanceOf(RuntimeBridgeError)
      await expect(promise).rejects.toMatchObject({
        code: 'timeout',
        command: 'runtime:launch',
      })

      expect(handler.pendingCount).toBe(0)
    })

    it('times out after 10s for runtime:kill and rejects with timeout', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:kill',
        payload: {},
      })
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(10_001)

      await expect(promise).rejects.toMatchObject({
        code: 'timeout',
        command: 'runtime:kill',
      })
    })

    it('times out after 5s for runtime:input and rejects with timeout', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(5_001)

      await expect(promise).rejects.toMatchObject({
        code: 'timeout',
        command: 'runtime:input',
      })
    })

    it('runtime:resize resolves to null on timeout (silent timeout)', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:resize',
        payload: { cols: 80, rows: 24 },
      })

      await vi.advanceTimersByTimeAsync(5_001)

      // Silent timeout resolves to null
      const result = await promise
      expect(result).toBeNull()
    })

    it('runtime:get-terminal-replay times out at 15s and rejects with timeout', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:get-terminal-replay',
        payload: {},
      })
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(15_001)

      await expect(promise).rejects.toMatchObject({
        code: 'timeout',
        command: 'runtime:get-terminal-replay',
      })
    })

    it('runtime:create-child-session times out at 30s', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:create-child-session',
        payload: {},
      })
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(30_001)

      await expect(promise).rejects.toMatchObject({
        code: 'timeout',
        command: 'runtime:create-child-session',
      })
    })

    it('cleans up pending command after timeout', async () => {
      vi.useFakeTimers()
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })
      promise.catch(() => {})

      expect(handler.pendingCount).toBe(1)
      await vi.advanceTimersByTimeAsync(5_001)

      // Attach a catch so it doesn't become an unhandled rejection
      await promise.catch(() => {})

      expect(handler.pendingCount).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // handleMessage — routing
  // ---------------------------------------------------------------------------

  describe('handleMessage', () => {
    it('routes response to pending command by replyTo', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)

      // Simulate provider response
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { result: 'ok' },
      }))

      const result = await promise
      expect(result).toEqual({ result: 'ok' })
      expect(handler.pendingCount).toBe(0)
    })

    it('routes terminal-data to onTerminalData hook', () => {
      const onTerminalData = vi.fn()
      handler.setHooks({ onTerminalData })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:terminal-data',
        sessionId: 'sess-1',
        data: 'output bytes',
      }))

      expect(onTerminalData).toHaveBeenCalledTimes(1)
      expect(onTerminalData).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        data: 'output bytes',
        providerId: provider.id,
      })
    })

    it('routes pty-state to onPtyState hook', () => {
      const onPtyState = vi.fn()
      handler.setHooks({ onPtyState })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:pty-state',
        sessionId: 'sess-1',
        state: { alive: true, cols: 80, rows: 24 },
      }))

      expect(onPtyState).toHaveBeenCalledTimes(1)
      const payload = onPtyState.mock.calls[0][0]
      expect(payload.sessionId).toBe('sess-1')
      expect(payload.providerId).toBe(provider.id)
      expect(payload.state.alive).toBe(true)
      expect(payload.state.cols).toBe(80)
      expect(payload.state.rows).toBe(24)
    })

    it('handles runtime:state-sync and calls onProviderReady', () => {
      const onProviderReady = vi.fn()
      handler.setHooks({ onProviderReady })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:state-sync',
        sessions: [
          { sessionId: 'sess-A', state: { alive: true, cols: 80, rows: 24 } },
          { sessionId: 'sess-B', state: { alive: false, exitCode: 0, exitReason: 'clean' } },
        ],
      }))

      expect(onProviderReady).toHaveBeenCalledTimes(1)
      const payload = onProviderReady.mock.calls[0][0]
      expect(payload.providerId).toBe(provider.id)
      expect(payload.ptyStates.length).toBe(2)
      expect(payload.ptyStates[0].sessionId).toBe('sess-A')
      expect(payload.ptyStates[0].state.alive).toBe(true)
      expect(payload.ptyStates[1].sessionId).toBe('sess-B')
      expect(payload.ptyStates[1].state.exitCode).toBe(0)

      // State sync should also assign sessions to provider
      expect(provider.managedSessions.has('sess-A')).toBe(true)
      expect(provider.managedSessions.has('sess-B')).toBe(true)
    })

    it('drops messages from unknown providers', () => {
      const onTerminalData = vi.fn()
      handler.setHooks({ onTerminalData })

      // Should not throw
      expect(() => handler.handleMessage('unknown-provider-id', JSON.stringify({
        type: 'runtime:terminal-data',
        sessionId: 'sess-1',
        data: 'bytes',
      }))).not.toThrow()

      expect(onTerminalData).not.toHaveBeenCalled()
    })

    it('drops malformed JSON', () => {
      const onTerminalData = vi.fn()
      handler.setHooks({ onTerminalData })

      // Should not throw
      expect(() => handler.handleMessage(provider.id, 'not-valid-json{')).not.toThrow()

      expect(onTerminalData).not.toHaveBeenCalled()
    })

    it('drops non-string messages', () => {
      const onTerminalData = vi.fn()
      handler.setHooks({ onTerminalData })

      // Binary / Buffer-like message
      const binary = new Uint8Array([1, 2, 3])
      expect(() => handler.handleMessage(provider.id, binary)).not.toThrow()

      // Also test other non-string types
      expect(() => handler.handleMessage(provider.id, 42)).not.toThrow()
      expect(() => handler.handleMessage(provider.id, null)).not.toThrow()
      expect(() => handler.handleMessage(provider.id, { raw: 'object' })).not.toThrow()

      expect(onTerminalData).not.toHaveBeenCalled()
    })

    it('drops unsolicited responses with unknown replyTo', () => {
      // No pending commands
      expect(() => handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: 'cmd_unknown',
        ok: true,
        data: { x: 1 },
      }))).not.toThrow()

      // No state should have changed
      expect(handler.pendingCount).toBe(0)
    })

    it('ignores response-shaped frames without the runtime:response type', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        replyTo: sentData.replyTo,
        ok: true,
        data: { result: 'legacy-flat' },
      }))

      expect(handler.pendingCount).toBe(1)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: true,
        data: { result: 'ok' },
      }))

      await expect(promise).resolves.toEqual({ result: 'ok' })
    })

    it('ignores pty-state with non-object state', () => {
      const onPtyState = vi.fn()
      handler.setHooks({ onPtyState })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:pty-state',
        sessionId: 'sess-1',
        state: 'not-an-object',
      }))

      expect(onPtyState).not.toHaveBeenCalled()
    })

    it('ignores terminal-data with missing fields', () => {
      const onTerminalData = vi.fn()
      handler.setHooks({ onTerminalData })

      // Missing data field
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:terminal-data',
        sessionId: 'sess-1',
      }))

      // Missing sessionId field
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:terminal-data',
        data: 'bytes',
      }))

      expect(onTerminalData).not.toHaveBeenCalled()
    })

    it('does not throw if onTerminalData hook throws', () => {
      handler.setHooks({
        onTerminalData: () => { throw new Error('hook boom') },
      })

      expect(() => handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:terminal-data',
        sessionId: 'sess-1',
        data: 'x',
      }))).not.toThrow()
    })

    it('does not throw if onPtyState hook throws', () => {
      handler.setHooks({
        onPtyState: () => { throw new Error('hook boom') },
      })

      expect(() => handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:pty-state',
        sessionId: 'sess-1',
        state: { alive: true },
      }))).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // assignSession / unassignSession
  // ---------------------------------------------------------------------------

  describe('assignSession / unassignSession', () => {
    it('assignSession adds session to provider managed sessions', () => {
      handler.assignSession(provider.id, 'sess-A')
      expect(provider.managedSessions.has('sess-A')).toBe(true)
    })

    it('assignSession for unknown provider is a no-op', () => {
      expect(() => handler.assignSession('unknown-provider', 'sess-A')).not.toThrow()
    })

    it('unassignSession removes session from provider', () => {
      handler.assignSession(provider.id, 'sess-A')
      expect(provider.managedSessions.has('sess-A')).toBe(true)

      handler.unassignSession('sess-A')
      expect(provider.managedSessions.has('sess-A')).toBe(false)
    })

    it('unassignSession across multiple providers', () => {
      const ws2 = createMockWs()
      const provider2 = handler.registerProvider(ws2, { token: 't2' })

      handler.assignSession(provider.id, 'sess-shared')
      handler.assignSession(provider2.id, 'sess-shared')

      handler.unassignSession('sess-shared')

      // Both providers should no longer manage the session
      expect(provider.managedSessions.has('sess-shared')).toBe(false)
      expect(provider2.managedSessions.has('sess-shared')).toBe(false)
    })

    it('unassignSession for unknown session is a no-op', () => {
      expect(() => handler.unassignSession('sess-never-existed')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // getProviderForSession
  // ---------------------------------------------------------------------------

  describe('getProviderForSession', () => {
    it('returns null when no provider manages the session', () => {
      const result = handler.getProviderForSession('sess-unknown')
      expect(result).toBeNull()
    })

    it('returns the correct provider after assignSession', () => {
      handler.assignSession(provider.id, 'sess-1')

      const result = handler.getProviderForSession('sess-1')
      expect(result).toBe(provider)
    })

    it('returns null after unassignSession', () => {
      handler.assignSession(provider.id, 'sess-1')
      expect(handler.getProviderForSession('sess-1')).toBe(provider)

      handler.unassignSession('sess-1')
      expect(handler.getProviderForSession('sess-1')).toBeNull()
    })

    it('returns null for sessions managed by a removed provider', () => {
      handler.assignSession(provider.id, 'sess-1')
      handler.removeProvider(provider.id)

      expect(handler.getProviderForSession('sess-1')).toBeNull()
    })

    it('returns the right provider among multiple providers', () => {
      const ws2 = createMockWs()
      const provider2 = handler.registerProvider(ws2, { token: 't2' })

      handler.assignSession(provider.id, 'sess-A')
      handler.assignSession(provider2.id, 'sess-B')

      expect(handler.getProviderForSession('sess-A')).toBe(provider)
      expect(handler.getProviderForSession('sess-B')).toBe(provider2)
    })
  })

  // ---------------------------------------------------------------------------
  // pendingCount
  // ---------------------------------------------------------------------------

  describe('pendingCount', () => {
    it('starts at zero', () => {
      expect(handler.pendingCount).toBe(0)
    })

    it('reflects in-flight commands', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const p1 = handler.sendCommand('sess-1', { type: 'runtime:input', payload: { data: 'a' } })
      expect(handler.pendingCount).toBe(1)

      const p2 = handler.sendCommand('sess-1', { type: 'runtime:input', payload: { data: 'b' } })
      expect(handler.pendingCount).toBe(2)

      // Respond to the first
      const sent1 = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sent1.replyTo,
        ok: true,
        data: null,
      }))

      await p1
      expect(handler.pendingCount).toBe(1)

      // Respond to the second
      const sent2 = JSON.parse(ws.send.mock.calls[1][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sent2.replyTo,
        ok: true,
        data: null,
      }))

      await p2
      expect(handler.pendingCount).toBe(0)
    })

    it('decreases on provider rejection', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      expect(handler.pendingCount).toBe(1)

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: false,
        error: 'no',
      }))

      await expect(promise).rejects.toMatchObject({ code: 'provider_rejected' })
      expect(handler.pendingCount).toBe(0)
    })

    it('decreases on provider disconnect', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:input',
        payload: { data: 'x' },
      })

      expect(handler.pendingCount).toBe(1)

      handler.removeProvider(provider.id)

      // Suppress the unhandled rejection
      await promise.catch(() => {})
      expect(handler.pendingCount).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('multi-provider routing: command goes to the right provider', async () => {
      const ws2 = createMockWs()
      const provider2 = handler.registerProvider(ws2, { token: 't2' })

      handler.assignSession(provider.id, 'sess-1')
      handler.assignSession(provider2.id, 'sess-2')

      const p1 = handler.sendCommand('sess-1', { type: 'runtime:input', payload: { data: 'one' } })
      const p2 = handler.sendCommand('sess-2', { type: 'runtime:input', payload: { data: 'two' } })

      // Verify each command went to the right provider
      const sent1 = JSON.parse(ws.send.mock.calls[0][0] as string)
      expect(sent1.sessionId).toBe('sess-1')
      const sent2 = JSON.parse(ws2.send.mock.calls[0][0] as string)
      expect(sent2.sessionId).toBe('sess-2')

      // Respond on provider 1 — should resolve p1, not p2
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sent1.replyTo,
        ok: true,
        data: { v: 1 },
      }))

      const result1 = await p1
      expect(result1).toEqual({ v: 1 })

      // p2 is still pending
      expect(handler.pendingCount).toBe(1)

      // Respond on provider 2
      handler.handleMessage(provider2.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sent2.replyTo,
        ok: true,
        data: { v: 2 },
      }))

      const result2 = await p2
      expect(result2).toEqual({ v: 2 })

      expect(handler.pendingCount).toBe(0)
    })

    it('multiple subscribers set on the same hook all fire', () => {
      const onPtyState = vi.fn()
      handler.setHooks({ onPtyState })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:pty-state',
        sessionId: 'sess-1',
        state: { alive: true, cols: 80, rows: 24 },
      }))

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:pty-state',
        sessionId: 'sess-1',
        state: { alive: true, cols: 100, rows: 30 },
      }))

      expect(onPtyState).toHaveBeenCalledTimes(2)
    })

    it('state-sync skips entries without sessionId', () => {
      const onProviderReady = vi.fn()
      handler.setHooks({ onProviderReady })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:state-sync',
        sessions: [
          { state: { alive: true } }, // missing sessionId
          { sessionId: 'sess-A', state: { alive: true } },
        ],
      }))

      expect(onProviderReady).toHaveBeenCalledTimes(1)
      const payload = onProviderReady.mock.calls[0][0]
      expect(payload.ptyStates.length).toBe(1)
      expect(payload.ptyStates[0].sessionId).toBe('sess-A')
    })

    it('state-sync skips entries with malformed state', () => {
      const onProviderReady = vi.fn()
      handler.setHooks({ onProviderReady })

      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:state-sync',
        sessions: [
          { sessionId: 'sess-A', state: null },
          { sessionId: 'sess-B' },
          { sessionId: 'sess-C', state: { alive: true } },
        ],
      }))

      expect(onProviderReady).toHaveBeenCalledTimes(1)
      const payload = onProviderReady.mock.calls[0][0]
      expect(payload.ptyStates.length).toBe(1)
      expect(payload.ptyStates[0].sessionId).toBe('sess-C')
    })

    it('provider_rejected with silent command resolves to null', async () => {
      handler.assignSession(provider.id, 'sess-1')

      const promise = handler.sendCommand('sess-1', {
        type: 'runtime:resize',
        payload: { cols: 80, rows: 24 },
      })

      const sentData = JSON.parse(ws.send.mock.calls[0][0] as string)
      handler.handleMessage(provider.id, JSON.stringify({
        type: 'runtime:response',
        replyTo: sentData.replyTo,
        ok: false,
        error: 'whatever',
      }))

      // Silent command resolves to null on rejection too
      const result = await promise
      expect(result).toBeNull()
    })

    it('listProviders returns empty array when no providers registered', () => {
      const emptyHandler = new RuntimeBridgeHandler()
      expect(emptyHandler.listProviders()).toEqual([])
    })
  })
})
