import { describe, expect, test, vi } from 'vitest'
import type { ProviderDefinition, ProviderRuntimeTarget } from '@extensions/providers'
import type { ProviderCommandContext } from '@shared/project-session'
import { startSessionRuntime, type StartSessionRuntimeOptions } from './session-runtime'

function createProvider(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    providerId: 'test-provider',
    supportsResume: () => true,
    supportsStructuredEvents: () => true,
    async buildStartCommand(target, context) {
      return { command: 'test', args: [], cwd: target.path, env: {} }
    },
    async buildResumeCommand(target, externalSessionId, _context) {
      return { command: 'test', args: ['--resume', externalSessionId], cwd: target.path, env: {} }
    },
    resolveSessionId(event) {
      return event.session_id
    },
    async installSidecar() {},
    ...overrides
  }
}

function createCapturingPtyHost() {
  let capturedOnData: ((data: string) => void) | null = null
  let capturedOnExit: ((exitCode: number) => void) | null = null

  const start = vi.fn((runtimeId: string, _command: unknown, onData: (data: string) => void, onExit: (exitCode: number) => void) => {
    capturedOnData = onData
    capturedOnExit = onExit
    return { runtimeId }
  })

  return {
    start,
    get onData() { return capturedOnData },
    get onExit() { return capturedOnExit }
  }
}

function createBaseSession(
  overrides: Partial<StartSessionRuntimeOptions['session']> = {}
): StartSessionRuntimeOptions['session'] {
  return {
    id: 'session_op_1',
    projectId: 'project_alpha',
    path: 'D:/demo',
    title: 'Deploy',
    type: 'opencode' as const,
    status: 'running' as const,
    externalSessionId: null as string | null,
    sessionSecret: 'secret-1',
    providerPort: 43128,
    ...overrides
  }
}

describe('session runtime callbacks and defaults', () => {
  describe('onData callback triggers appendTerminalData', () => {
    test('ptyHost.start onData callback calls manager.appendTerminalData with session data', async () => {
      const ptyHost = createCapturingPtyHost()
      const appendTerminalData = vi.fn(async () => {})

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider: createProvider(),
        ptyHost: ptyHost as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData
        } as never
      })

      const onData = ptyHost.onData!
      onData('some terminal output')

      expect(appendTerminalData).toHaveBeenCalledOnce()
      expect(appendTerminalData).toHaveBeenCalledWith({ sessionId: 'session_op_1', data: 'some terminal output' })
    })

    test('multiple onData calls trigger multiple appendTerminalData calls', async () => {
      const ptyHost = createCapturingPtyHost()
      const appendTerminalData = vi.fn(async () => {})

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider: createProvider(),
        ptyHost: ptyHost as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData
        } as never
      })

      const onData = ptyHost.onData!
      onData('line 1')
      onData('line 2')
      onData('line 3')

      expect(appendTerminalData).toHaveBeenCalledTimes(3)
    })
  })

  describe('onExit callback triggers markSessionExited', () => {
    test('ptyHost.start onExit callback calls manager.markSessionExited with formatted message', async () => {
      const ptyHost = createCapturingPtyHost()
      const markSessionExited = vi.fn(async () => {})

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider: createProvider(),
        ptyHost: ptyHost as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited,
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      const onExit = ptyHost.onExit!
      onExit(0)

      expect(markSessionExited).toHaveBeenCalledOnce()
      expect(markSessionExited).toHaveBeenCalledWith('session_op_1', 'opencode 已退出 (0)')
    })

    test('onExit with non-zero code includes the code', async () => {
      const ptyHost = createCapturingPtyHost()
      const markSessionExited = vi.fn(async () => {})

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider: createProvider(),
        ptyHost: ptyHost as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited,
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      const onExit = ptyHost.onExit!
      onExit(137)

      expect(markSessionExited).toHaveBeenCalledWith('session_op_1', 'opencode 已退出 (137)')
    })
  })

  describe('markSessionStarting is called before markSessionRunning', () => {
    test('call order: markSessionStarting → ptyHost.start → markSessionRunning', async () => {
      const callOrder: string[] = []
      const markSessionStarting = vi.fn(async () => { callOrder.push('markSessionStarting') })
      const markSessionRunning = vi.fn(async () => { callOrder.push('markSessionRunning') })
      const start = vi.fn(() => {
        callOrder.push('ptyHost.start')
        return { runtimeId: 'session_op_1' }
      })

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider: createProvider(),
        ptyHost: { start } as never,
        manager: {
          markSessionStarting,
          markSessionRunning,
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(callOrder).toEqual(['markSessionStarting', 'ptyHost.start', 'markSessionRunning'])
    })
  })

  describe('providerPort default value', () => {
    test('defaults to webhookPort + 1 when providerPort is null', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession({ providerPort: null }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.providerPort).toBe(43128)
    })

    test('defaults to webhookPort + 1 when providerPort is undefined', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession({ providerPort: undefined }),
        webhookPort: 5000,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.providerPort).toBe(5001)
    })

    test('uses explicit providerPort when provided', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession({ providerPort: 9999 }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.providerPort).toBe(9999)
    })
  })

  describe('sessionSecret default value', () => {
    test('defaults to empty string when sessionSecret is null', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession({ sessionSecret: null }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.sessionSecret).toBe('')
    })

    test('defaults to empty string when sessionSecret is undefined', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession({ sessionSecret: undefined }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.sessionSecret).toBe('')
    })

    test('uses explicit sessionSecret when provided', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession({ sessionSecret: 'my-secret' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.sessionSecret).toBe('my-secret')
    })
  })

  describe('providerPath context value', () => {
    test('passes configured providerPath into provider context', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never,
        providerPath: 'C:/tools/opencode.ps1'
      })

      expect(capturedContext!.providerPath).toBe('C:/tools/opencode.ps1')
    })

    test('defaults providerPath to null when not provided', async () => {
      let capturedContext: ProviderCommandContext | undefined
      const provider = createProvider({
        async installSidecar(_target, context) {
          capturedContext = context
        }
      })

      await startSessionRuntime({
        session: createBaseSession(),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedContext!.providerPath).toBeNull()
    })
  })

  describe('canResume logic branches', () => {
    test('shell sessions never resume even with externalSessionId', async () => {
      const buildStartCommand = vi.fn(async () => ({
        command: 'shell', args: [], cwd: 'D:/demo', env: {}
      }))
      const buildResumeCommand = vi.fn(async () => ({
        command: 'shell', args: ['--resume'], cwd: 'D:/demo', env: {}
      }))
      const provider = createProvider({ buildStartCommand, buildResumeCommand })

      await startSessionRuntime({
        session: createBaseSession({ type: 'shell', externalSessionId: 'ext-1', status: 'running' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(buildStartCommand).toHaveBeenCalledOnce()
      expect(buildResumeCommand).not.toHaveBeenCalled()
    })

    test('opencode with needs_confirmation status does not resume', async () => {
      const buildStartCommand = vi.fn(async () => ({
        command: 'opencode', args: [], cwd: 'D:/demo', env: {}
      }))
      const buildResumeCommand = vi.fn(async () => ({
        command: 'opencode', args: ['--resume'], cwd: 'D:/demo', env: {}
      }))
      const provider = createProvider({ buildStartCommand, buildResumeCommand })

      await startSessionRuntime({
        session: createBaseSession({ type: 'opencode', externalSessionId: 'ext-1', status: 'needs_confirmation' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(buildStartCommand).toHaveBeenCalledOnce()
      expect(buildResumeCommand).not.toHaveBeenCalled()
    })

    test('opencode without externalSessionId does not resume', async () => {
      const buildStartCommand = vi.fn(async () => ({
        command: 'opencode', args: [], cwd: 'D:/demo', env: {}
      }))
      const buildResumeCommand = vi.fn(async () => ({
        command: 'opencode', args: ['--resume'], cwd: 'D:/demo', env: {}
      }))
      const provider = createProvider({ buildStartCommand, buildResumeCommand })

      await startSessionRuntime({
        session: createBaseSession({ type: 'opencode', externalSessionId: null, status: 'running' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(buildStartCommand).toHaveBeenCalledOnce()
      expect(buildResumeCommand).not.toHaveBeenCalled()
    })

    test('codex without externalSessionId can use fallback resume command after bootstrap', async () => {
      const buildStartCommand = vi.fn(async () => ({
        command: 'codex', args: [], cwd: 'D:/demo', env: {}
      }))
      const buildFallbackResumeCommand = vi.fn(async () => ({
        command: 'codex', args: ['resume', '--last'], cwd: 'D:/demo', env: {}
      }))
      const provider = createProvider({
        buildStartCommand,
        buildFallbackResumeCommand
      })

      await startSessionRuntime({
        session: createBaseSession({ type: 'codex', externalSessionId: null, status: 'running' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(buildFallbackResumeCommand).toHaveBeenCalledOnce()
      expect(buildStartCommand).not.toHaveBeenCalled()
    })

    test('opencode with provider that does not support resume does not resume', async () => {
      const buildStartCommand = vi.fn(async () => ({
        command: 'opencode', args: [], cwd: 'D:/demo', env: {}
      }))
      const buildResumeCommand = vi.fn(async () => ({
        command: 'opencode', args: ['--resume'], cwd: 'D:/demo', env: {}
      }))
      const provider = createProvider({ buildStartCommand, buildResumeCommand, supportsResume: () => false })

      await startSessionRuntime({
        session: createBaseSession({ type: 'opencode', externalSessionId: 'ext-1', status: 'running' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(buildStartCommand).toHaveBeenCalledOnce()
      expect(buildResumeCommand).not.toHaveBeenCalled()
    })

    test('opencode with all conditions met does resume', async () => {
      const buildStartCommand = vi.fn(async () => ({
        command: 'opencode', args: [], cwd: 'D:/demo', env: {}
      }))
      const buildResumeCommand = vi.fn(async () => ({
        command: 'opencode', args: ['--resume', 'ext-1'], cwd: 'D:/demo', env: {}
      }))
      const provider = createProvider({ buildStartCommand, buildResumeCommand, supportsResume: () => true })

      await startSessionRuntime({
        session: createBaseSession({ type: 'opencode', externalSessionId: 'ext-1', status: 'running' }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(buildResumeCommand).toHaveBeenCalledOnce()
      expect(buildStartCommand).not.toHaveBeenCalled()
    })
  })

  describe('markSessionRunning receives correct externalSessionId', () => {
    test('fresh opencode start keeps externalSessionId null', async () => {
      const markSessionRunning = vi.fn(async () => {})
      const start = vi.fn(() => ({ runtimeId: 'session_op_1' }))

      await startSessionRuntime({
        session: createBaseSession({ type: 'opencode', externalSessionId: null, status: 'running' }),
        webhookPort: 43127,
        provider: createProvider(),
        ptyHost: { start } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning,
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(markSessionRunning).toHaveBeenCalledWith('session_op_1', null)
    })

    test('fresh shell start keeps externalSessionId null', async () => {
      const markSessionRunning = vi.fn(async () => {})

      await startSessionRuntime({
        session: createBaseSession({ type: 'shell', externalSessionId: null, status: 'running' }),
        webhookPort: 43127,
        provider: createProvider({ supportsResume: () => true }),
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning,
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(markSessionRunning).toHaveBeenCalledWith('session_op_1', null)
    })

    test('resume passes the session externalSessionId', async () => {
      const markSessionRunning = vi.fn(async () => {})

      await startSessionRuntime({
        session: createBaseSession({ type: 'opencode', externalSessionId: 'ext-1', status: 'running' }),
        webhookPort: 43127,
        provider: createProvider({ supportsResume: () => true }),
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning,
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(markSessionRunning).toHaveBeenCalledWith('session_op_1', 'ext-1')
    })
  })

  describe('toProviderTarget mapping', () => {
    test('maps session fields correctly to ProviderRuntimeTarget', async () => {
      let capturedTarget: ProviderRuntimeTarget | undefined
      const provider = createProvider({
        async installSidecar(target, _context) {
          capturedTarget = target
        }
      })

      await startSessionRuntime({
        session: createBaseSession({
          id: 'session_xyz',
          projectId: 'project_abc',
          path: 'C:/workspace/app',
          title: 'My Session',
          type: 'opencode'
        }),
        webhookPort: 43127,
        provider,
        ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_xyz' })) } as never,
        manager: {
          markSessionStarting: vi.fn(async () => {}),
          markSessionRunning: vi.fn(async () => {}),
          markSessionExited: vi.fn(async () => {}),
          appendTerminalData: vi.fn(async () => {})
        } as never
      })

      expect(capturedTarget).toEqual({
        session_id: 'session_xyz',
        project_id: 'project_abc',
        path: 'C:/workspace/app',
        title: 'My Session',
        type: 'opencode',
        external_session_id: null
      })
    })
  })
})
