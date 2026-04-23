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
        args: [],
        cwd: session.path,
        env: { VIBECODING_SESSION_ID: session.session_id }
      }
    },
    async buildResumeCommand(session, externalSessionId, context) {
      return {
        command: 'opencode',
        args: ['--session', externalSessionId],
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
  test('spawns opencode sessions through configured user shell', async () => {
    const provider = createProvider({
      async buildStartCommand(session) {
        return {
          command: 'opencode',
          args: [],
          cwd: session.path,
          env: { TEST_ENV: '1' }
        }
      }
    })
    const start = vi.fn(() => ({ runtimeId: 'session_op_1' }))

    await startSessionRuntime({
      session: {
        id: 'session_op_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Deploy',
        type: 'opencode',
        status: 'running',
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
      } as never,
      shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    })

    expect(start).toHaveBeenCalledWith(
      'session_op_1',
      expect.objectContaining({
        command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  test('shell sessions remain direct even when shellPath is configured', async () => {
    const provider = createProvider({
      async buildStartCommand(session) {
        return {
          command: 'powershell.exe',
          args: [],
          cwd: session.path,
          env: { TEST_ENV: '1' }
        }
      }
    })
    const start = vi.fn(() => ({ runtimeId: 'session_shell_1' }))

    await startSessionRuntime({
      session: {
        id: 'session_shell_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Shell',
        type: 'shell',
        status: 'running',
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
      } as never,
      shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    })

    expect(start).toHaveBeenCalledWith(
      'session_shell_1',
      expect.objectContaining({
        command: 'powershell.exe',
        args: []
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

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
    const start = vi.fn(() => ({ runtimeId: 'session_op_1' }))

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

  test('falls back to provider start command and leaves externalSessionId null when no resumable external session is available', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'opencode',
      args: [],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({ buildStartCommand })
    const start = vi.fn(() => ({ runtimeId: 'session_op_1' }))
    const markSessionRunning = vi.fn(async () => {})

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
        markSessionRunning,
        markSessionExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(
      'session_op_1',
        expect.objectContaining({
          command: 'opencode',
          args: [],
          cwd: 'D:/demo'
        }),
      expect.any(Function),
      expect.any(Function)
    )
    expect(markSessionRunning).toHaveBeenCalledWith('session_op_1', null)
  })

  test('clears stale externalSessionId on fresh start when resume is not allowed', async () => {
    const markSessionStarting = vi.fn(async () => {})
    const markSessionRunning = vi.fn(async () => {})

    await startSessionRuntime({
      session: {
        id: 'session_op_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Deploy',
        type: 'opencode',
        status: 'needs_confirmation',
        externalSessionId: 'stale-ext-1',
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider: createProvider(),
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
      manager: {
        markSessionStarting,
        markSessionRunning,
        markSessionExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(markSessionStarting).toHaveBeenCalledWith('session_op_1', '正在启动 opencode', null)
    expect(markSessionRunning).toHaveBeenCalledWith('session_op_1', null)
  })
})
