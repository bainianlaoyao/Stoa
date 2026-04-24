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
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
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
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
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
    const markRuntimeStarting = vi.fn(async () => {})
    const markRuntimeAlive = vi.fn(async () => {})
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
        markRuntimeStarting,
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
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
    expect(markRuntimeAlive).toHaveBeenCalledWith('session_op_1', 'ext-123')
  })

  test('does not mark runtime alive after synchronous process exit during start', async () => {
    const provider = createProvider()
    const markRuntimeStarting = vi.fn(async () => {})
    const markRuntimeAlive = vi.fn(async () => {})
    const markRuntimeExited = vi.fn(async () => {})
    const start = vi.fn((runtimeId, command, onData, onExit: (exitCode: number) => void) => {
      onExit(0)
      return { runtimeId }
    })

    await startSessionRuntime({
      session: {
        id: 'session_fast_exit',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Fast exit',
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
        markRuntimeStarting,
        markRuntimeAlive,
        markRuntimeExited,
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(markRuntimeStarting).toHaveBeenCalledWith('session_fast_exit', 'Starting opencode', null)
    expect(markRuntimeExited).toHaveBeenCalledWith('session_fast_exit', 0, 'opencode exited (0)')
    expect(markRuntimeAlive).not.toHaveBeenCalled()
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
    const markRuntimeAlive = vi.fn(async () => {})

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
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
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
    expect(markRuntimeAlive).toHaveBeenCalledWith('session_op_1', null)
  })

  test('preserves existing externalSessionId on fresh start when resume is not allowed', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'opencode',
      args: [],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const discoverExternalSessionIdAfterStart = vi.fn(async () => 'wrong-ext-2')
    const markRuntimeStarting = vi.fn(async () => {})
    const markRuntimeAlive = vi.fn(async () => {})

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
      provider: createProvider({
        buildStartCommand,
        discoverExternalSessionIdAfterStart
      }),
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
      manager: {
        markRuntimeStarting,
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(discoverExternalSessionIdAfterStart).not.toHaveBeenCalled()
    expect(markRuntimeStarting).toHaveBeenCalledWith('session_op_1', 'Starting opencode', 'stale-ext-1')
    expect(markRuntimeAlive).toHaveBeenCalledWith('session_op_1', 'stale-ext-1')
  })

  test('keeps seeded externalSessionId for fresh claude-code starts', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'claude',
      args: ['--session-id', 'claude-seeded-1'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({
      providerId: 'claude-code',
      supportsStructuredEvents: () => false,
      buildStartCommand,
      discoverExternalSessionIdAfterStart: vi.fn(async () => 'claude-seeded-1')
    })
    const markRuntimeStarting = vi.fn(async () => {})
    const markRuntimeAlive = vi.fn(async () => {})

    await startSessionRuntime({
      session: {
        id: 'session_claude_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Claude',
        type: 'claude-code',
        status: 'bootstrapping',
        externalSessionId: 'claude-seeded-1',
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_claude_1' })) } as never,
      manager: {
        markRuntimeStarting,
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(markRuntimeStarting).toHaveBeenCalledWith('session_claude_1', 'Starting claude-code', 'claude-seeded-1')
    expect(markRuntimeAlive).toHaveBeenCalledWith('session_claude_1', 'claude-seeded-1')
  })

  test('patches discovered externalSessionId asynchronously for fresh codex starts', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'codex',
      args: [],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const discoverExternalSessionIdAfterStart = vi.fn(async () => 'codex-real-123')
    const provider = createProvider({
      providerId: 'codex',
      supportsStructuredEvents: () => false,
      buildStartCommand,
      discoverExternalSessionIdAfterStart
    })
    const markRuntimeStarting = vi.fn(async () => {})
    const markRuntimeAlive = vi.fn(async () => {})

    await startSessionRuntime({
      session: {
        id: 'session_codex_1',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Codex',
        type: 'codex',
        status: 'bootstrapping',
        externalSessionId: null,
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_codex_1' })) } as never,
      manager: {
        markRuntimeStarting,
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never,
      shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(discoverExternalSessionIdAfterStart).toHaveBeenCalledOnce()
    expect(markRuntimeStarting).toHaveBeenCalledWith('session_codex_1', 'Starting codex', null)
    expect(markRuntimeAlive).toHaveBeenNthCalledWith(1, 'session_codex_1', null)
    await vi.waitFor(() => {
      expect(markRuntimeAlive).toHaveBeenNthCalledWith(2, 'session_codex_1', 'codex-real-123')
    })
  })

  test('uses codex resume --last fallback when recovering without externalSessionId', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'codex',
      args: [],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const buildFallbackResumeCommand = vi.fn(async () => ({
      command: 'codex',
      args: ['resume', '--last'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({
      providerId: 'codex',
      supportsStructuredEvents: () => false,
      buildStartCommand,
      buildFallbackResumeCommand
    })
    const start = vi.fn(() => ({ runtimeId: 'session_codex_2' }))

    await startSessionRuntime({
      session: {
        id: 'session_codex_2',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Codex recovered',
        type: 'codex',
        status: 'running',
        externalSessionId: null,
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start } as never,
      manager: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never,
      shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    })

    expect(buildFallbackResumeCommand).toHaveBeenCalledOnce()
    expect(buildStartCommand).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith(
      'session_codex_2',
      expect.objectContaining({
        command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  test('does not let discovered ids overwrite an existing resumed externalSessionId', async () => {
    const buildResumeCommand = vi.fn(async () => ({
      command: 'codex',
      args: ['resume', 'codex-known-123'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const discoverExternalSessionIdAfterStart = vi.fn(async () => 'codex-wrong-999')
    const provider = createProvider({
      providerId: 'codex',
      supportsStructuredEvents: () => false,
      buildResumeCommand,
      discoverExternalSessionIdAfterStart
    })
    const markRuntimeAlive = vi.fn(async () => {})

    await startSessionRuntime({
      session: {
        id: 'session_codex_3',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Codex resume',
        type: 'codex',
        status: 'running',
        externalSessionId: 'codex-known-123',
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_codex_3' })) } as never,
      manager: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildResumeCommand).toHaveBeenCalledOnce()
    expect(discoverExternalSessionIdAfterStart).not.toHaveBeenCalled()
    expect(markRuntimeAlive).toHaveBeenCalledTimes(1)
    expect(markRuntimeAlive).toHaveBeenCalledWith('session_codex_3', 'codex-known-123')
  })

  test('does not run discovery when an externalSessionId exists but resume is suppressed by status', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'claude',
      args: ['--session-id', 'claude-seeded-boot'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const discoverExternalSessionIdAfterStart = vi.fn(async () => 'wrong-id')
    const provider = createProvider({
      providerId: 'claude-code',
      supportsStructuredEvents: () => false,
      buildStartCommand,
      discoverExternalSessionIdAfterStart
    })
    const markRuntimeAlive = vi.fn(async () => {})

    await startSessionRuntime({
      session: {
        id: 'session_claude_boot',
        projectId: 'project_alpha',
        path: 'D:/demo',
        title: 'Claude boot',
        type: 'claude-code',
        status: 'bootstrapping',
        externalSessionId: 'claude-seeded-boot',
        sessionSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_claude_boot' })) } as never,
      manager: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive,
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(discoverExternalSessionIdAfterStart).not.toHaveBeenCalled()
    expect(markRuntimeAlive).toHaveBeenCalledTimes(1)
    expect(markRuntimeAlive).toHaveBeenCalledWith('session_claude_boot', 'claude-seeded-boot')
  })
})
