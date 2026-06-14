import { describe, expect, it, vi } from 'vitest'
import { LiveRuntimeBridgeClient } from './runtime-bridge-client'
import { RuntimeBridgeError, RuntimeBridgeHandler } from '../ws/runtime-bridge-handler'
import type { WsLike } from '../ws/hub'

function createMockWs(): WsLike & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
    close: vi.fn(),
  }
}

function resolveLatestCommand(ws: { send: ReturnType<typeof vi.fn> }, handler: RuntimeBridgeHandler, providerId: string, data: unknown): void {
  const sent = JSON.parse(ws.send.mock.calls.at(-1)?.[0] as string)
  handler.handleMessage(providerId, JSON.stringify({
    type: 'runtime:response',
    replyTo: sent.replyTo,
    ok: true,
    data,
  }))
}

describe('LiveRuntimeBridgeClient', () => {
  it('launch routes to a connected provider before the session is assigned', async () => {
    const handler = new RuntimeBridgeHandler()
    const ws = createMockWs()
    const provider = handler.registerProvider(ws, { token: 'test-token' })
    const client = new LiveRuntimeBridgeClient(handler)

    const launch = client.launch('sess-fresh', {
      command: 'bash',
      cwd: '/workspace',
      cols: 100,
      rows: 30,
      env: { TERM: 'xterm-256color' },
    })

    expect(ws.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent).toMatchObject({
      type: 'runtime:launch',
      sessionId: 'sess-fresh',
      payload: {
        command: 'bash',
        cwd: '/workspace',
        cols: 100,
        rows: 30,
        env: { TERM: 'xterm-256color' },
      },
    })

    resolveLatestCommand(ws, handler, provider.id, { status: 'launched' })

    await expect(launch).resolves.toBeUndefined()
    expect(handler.getProviderForSession('sess-fresh')).toBe(provider)
  })

  it('getTerminalReplay reads the canonical text field', async () => {
    const handler = new RuntimeBridgeHandler()
    const ws = createMockWs()
    const provider = handler.registerProvider(ws, { token: 'test-token' })
    handler.assignSession(provider.id, 'sess-replay')
    const client = new LiveRuntimeBridgeClient(handler)

    const replay = client.getTerminalReplay('sess-replay')

    expect(ws.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent).toMatchObject({
      type: 'runtime:get-terminal-replay',
      sessionId: 'sess-replay',
      payload: {},
    })

    resolveLatestCommand(ws, handler, provider.id, { text: 'terminal buffer' })

    await expect(replay).resolves.toBe('terminal buffer')
  })

  it('createChildSession uses top-level sessionId as parent and reads childSessionId', async () => {
    const handler = new RuntimeBridgeHandler()
    const ws = createMockWs()
    const provider = handler.registerProvider(ws, { token: 'test-token' })
    handler.assignSession(provider.id, 'sess-parent')
    const client = new LiveRuntimeBridgeClient(handler)

    const child = client.createChildSession('sess-parent', {
      type: 'shell',
      command: 'npm test',
      cwd: '/workspace',
    })

    expect(ws.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent).toMatchObject({
      type: 'runtime:create-child-session',
      sessionId: 'sess-parent',
      payload: {
        type: 'shell',
        command: 'npm test',
        cwd: '/workspace',
      },
    })

    resolveLatestCommand(ws, handler, provider.id, { childSessionId: 'sess-child' })

    await expect(child).resolves.toBe('sess-child')
    expect(handler.getProviderForSession('sess-child')).toBe(provider)
  })

  it('createChildSession rejects malformed child responses', async () => {
    const handler = new RuntimeBridgeHandler()
    const ws = createMockWs()
    const provider = handler.registerProvider(ws, { token: 'test-token' })
    handler.assignSession(provider.id, 'sess-parent')
    const client = new LiveRuntimeBridgeClient(handler)

    const child = client.createChildSession('sess-parent', { type: 'shell' })
    resolveLatestCommand(ws, handler, provider.id, { sessionId: 'legacy-child' })

    await expect(child).rejects.toBeInstanceOf(RuntimeBridgeError)
    await expect(child).rejects.toMatchObject({
      code: 'malformed_response',
      command: 'runtime:create-child-session',
      sessionId: 'sess-parent',
    })
  })
})
