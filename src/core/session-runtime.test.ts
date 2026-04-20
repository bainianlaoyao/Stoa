import { describe, expect, test, vi } from 'vitest'
import type { ProviderDefinition } from '@extensions/providers'
import { startSessionRuntime } from './session-runtime'

function createProvider(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    providerId: 'opencode',
    supportsResume: () => true,
    supportsStructuredEvents: () => true,
    async buildStartCommand(session, context) {
      return {
        command: 'opencode',
        args: ['--port', String(context.providerPort)],
        cwd: session.path,
        env: { VIBECODING_SESSION_ID: session.session_id }
      }
    },
    async buildResumeCommand(session, externalSessionId, context) {
      return {
        command: 'opencode',
        args: ['--session', externalSessionId, '--port', String(context.providerPort)],
        cwd: session.path,
        env: { VIBECODING_SESSION_ID: session.session_id }
      }
    },
    resolveSessionId(event) {
      return event.session_id
    },
    async installSidecar() {},
    ...overrides
  }
}

describe('session runtime', () => {
  test('uses provider-built resume command when recoverable external session metadata exists', async () => {
    const buildResumeCommand = vi.fn(async () => ({
      command: 'opencode',
      args: ['--session', 'ext-123'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({ buildResumeCommand })
    const installSidecar = vi.spyOn(provider, 'installSidecar')
    const markSessionStarting = vi.fn(async () => {})
    const markSessionRunning = vi.fn(async () => {})
    const start = vi.fn(() => ({ runtimeId: 'session_op_1', sessionId: 'pty-1' }))

    await startSessionRuntime({
      session: {
        id: 'session_op_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Deploy',
        type: 'opencode',
        status: 'running',
        externalSessionId: 'ext-123',
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start } as never,
      manager: {
        markSessionStarting,
        markSessionRunning,
        markSessionExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(installSidecar).toHaveBeenCalledOnce()
    expect(buildResumeCommand).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(
      'session_op_1',
      expect.objectContaining({
        command: 'opencode',
        args: ['--session', 'ext-123'],
        cwd: 'D:/demo'
      }),
      expect.any(Function),
      expect.any(Function)
    )
    expect(markSessionRunning).toHaveBeenCalledWith('session_op_1', 'ext-123')
  })

  test('falls back to provider start command when no resumable external session is available', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'opencode',
      args: ['--port', '43128'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({ buildStartCommand })
    const start = vi.fn(() => ({ runtimeId: 'session_op_1', sessionId: 'pty-2' }))

    await startSessionRuntime({
      session: {
        id: 'session_op_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Deploy',
        type: 'opencode',
        status: 'needs_confirmation',
        externalSessionId: null,
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start } as never,
      manager: {
        markSessionStarting: vi.fn(async () => {}),
        markSessionRunning: vi.fn(async () => {}),
        markSessionExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(
      'session_op_1',
      expect.objectContaining({
        command: 'opencode',
        args: ['--port', '43128'],
        cwd: 'D:/demo'
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })
})
