import { describe, expect, test, vi } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import { launchTrackedSessionRuntime } from './launch-tracked-session-runtime'
import { createTestGlobalStatePath, createTestWorkspace } from '../../tests/e2e/helpers'

describe('launchTrackedSessionRuntime', () => {
  test('launches an existing persisted session with resolved runtime dependencies', async () => {
    const globalStatePath = await createTestGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })
    const project = await manager.createProject({
      path: await createTestWorkspace('launch-existing-'),
      name: 'restore-project'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Restored shell'
    })

    const provider = { providerId: 'local-shell' }
    const getProvider = vi.fn(() => provider)
    const resolveRuntimePaths = vi.fn(async () => ({
      shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      providerPath: null,
      claudeDangerouslySkipPermissions: false
    }))
    const ensureLease = vi.fn(async () => ({
      path: 'D:/tmp/runtime/hook-leases/session.json',
      lease: {
        version: 1,
        sessionId: session.id,
        projectId: project.id,
        provider: 'opencode',
        leaseState: 'active',
        ownerInstanceId: 'instance-a',
        generation: 1,
        webhookBaseUrl: 'http://127.0.0.1:43127',
        sessionSecret: 'secret-1',
        commitLockNonce: 'nonce-1',
        commitToken: 'token-1',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
        heartbeatAt: '2026-05-10T12:00:00.000Z',
        expiresAt: '2026-05-10T12:00:20.000Z'
      }
    }))
    const registerSessionSecret = vi.fn()
    const startRuntime = vi.fn(async () => {})

    const launched = await launchTrackedSessionRuntime({
      sessionId: session.id,
      manager,
      webhookPort: 43127,
      ptyHost: { start: vi.fn(() => ({ runtimeId: session.id })) } as never,
      runtimeController: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      },
      sessionEventBridge: {
        registerSessionSecret
      } as never,
      hookLeaseManager: {
        ensureLease
      } as never,
      resolveRuntimePaths,
      getProvider: getProvider as never,
      startRuntime
    })

    expect(launched).toBe(true)
    expect(resolveRuntimePaths).toHaveBeenCalledWith('shell')
    expect(getProvider).toHaveBeenCalledWith('local-shell')
    expect(ensureLease).toHaveBeenCalledWith({
      sessionId: session.id,
      projectId: project.id,
      sessionType: 'shell',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })
    expect(registerSessionSecret).toHaveBeenCalledWith(session.id, 'secret-1')
    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: session.id,
          projectId: project.id,
          path: project.path,
          title: 'Restored shell',
          type: 'shell',
          runtimeState: 'created',
          turnState: 'idle',
          externalSessionId: null,
          sessionSecret: 'secret-1',
          hookLeasePath: 'D:/tmp/runtime/hook-leases/session.json',
          hookSpawnOwnerInstanceId: 'instance-a',
          hookSpawnGeneration: 1
        }),
        webhookPort: 43127,
        provider,
        shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        providerPath: null
      })
    )
  })

  test('returns false and does not start runtime when session is missing', async () => {
    const globalStatePath = await createTestGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })
    const startRuntime = vi.fn(async () => {})

    const launched = await launchTrackedSessionRuntime({
      sessionId: 'missing-session',
      manager,
      webhookPort: 43127,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'missing-session' })) } as never,
      runtimeController: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      },
      sessionEventBridge: {} as never,
      hookLeaseManager: {
        ensureLease: vi.fn(async () => null)
      } as never,
      resolveRuntimePaths: vi.fn(async () => ({
        shellPath: null,
        providerPath: null,
        claudeDangerouslySkipPermissions: false
      })),
      getProvider: vi.fn() as never,
      startRuntime
    })

    expect(launched).toBe(false)
    expect(startRuntime).not.toHaveBeenCalled()
  })

  test('launches Claude sessions without a pre-start injector step', async () => {
    const globalStatePath = await createTestGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })
    const project = await manager.createProject({
      path: await createTestWorkspace('launch-claude-failure-'),
      name: 'claude-project'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })

    const startRuntime = vi.fn(async () => {})
    const launched = await launchTrackedSessionRuntime({
      sessionId: session.id,
      manager,
      webhookPort: 43127,
      ptyHost: { start: vi.fn(() => ({ runtimeId: session.id })) } as never,
      runtimeController: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      },
      sessionEventBridge: {} as never,
      hookLeaseManager: {
        ensureLease: vi.fn(async () => null)
      } as never,
      resolveRuntimePaths: vi.fn(async () => ({
        shellPath: null,
        providerPath: 'claude',
        claudeDangerouslySkipPermissions: false
      })),
      startRuntime
    })

    expect(launched).toBe(true)
    expect(startRuntime).toHaveBeenCalledTimes(1)
  })

  test('launches codex sessions when the manager snapshot provides a codex-scoped entry', async () => {
    const provider = { providerId: 'codex' }
    const getProvider = vi.fn(() => provider)
    const resolveRuntimePaths = vi.fn(async () => ({
      shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      providerPath: 'codex',
      claudeDangerouslySkipPermissions: false
    }))
    const ensureLease = vi.fn(async () => null)
    const startRuntime = vi.fn(async () => {})

    const launched = await launchTrackedSessionRuntime({
      sessionId: 'session_codex_1',
      manager: {
        snapshot() {
          return {
            activeProjectId: null,
            activeSessionId: null,
            terminalWebhookPort: null,
            projects: [{
              id: 'stoa-codex',
              name: 'Codex',
              path: 'D:/Data/DEV/ultra_simple_panel',
              createdAt: '2026-05-07T08:00:00.000Z',
              updatedAt: '2026-05-07T08:00:00.000Z'
            }],
            sessions: [{
              id: 'session_codex_1',
              projectId: 'stoa-codex',
              type: 'codex',
              runtimeState: 'created',
              turnState: 'idle',
              turnEpoch: 0,
              lastTurnOutcome: 'none',
              hasUnseenCompletion: false,
              runtimeExitCode: null,
              runtimeExitReason: null,
              lastStateSequence: 0,
              blockingReason: null,
              failureReason: null,
              title: 'global-triage',
              summary: 'Waiting for Codex to start',
              recoveryMode: 'resume-external',
              externalSessionId: 'resume-codex-1',
              createdAt: '2026-05-07T08:00:00.000Z',
              updatedAt: '2026-05-07T08:00:00.000Z',
              lastActivatedAt: null,
              archived: false
            }]
          }
        }
      } as never,
      webhookPort: 43127,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'session_codex_1' })) } as never,
      runtimeController: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      },
      sessionEventBridge: {} as never,
      hookLeaseManager: {
        ensureLease
      } as never,
      resolveRuntimePaths,
      getProvider: getProvider as never,
      startRuntime
    })

    expect(launched).toBe(true)
    expect(resolveRuntimePaths).toHaveBeenCalledWith('codex')
    expect(getProvider).toHaveBeenCalledWith('codex')
    expect(ensureLease).toHaveBeenCalledWith({
      sessionId: 'session_codex_1',
      projectId: 'stoa-codex',
      sessionType: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })
    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: 'session_codex_1',
          type: 'codex',
          externalSessionId: 'resume-codex-1',
          sessionSecret: null,
          hookLeasePath: null
        }),
        providerPath: 'codex'
      })
    )
  })

  test('passes the lease-derived session secret through to startRuntime for meta sessions', async () => {
    const provider = { providerId: 'claude-code' }
    const getProvider = vi.fn(() => provider)
    const resolveRuntimePaths = vi.fn(async () => ({
      shellPath: null,
      providerPath: 'claude',
      claudeDangerouslySkipPermissions: false
    }))
    const ensureLease = vi.fn(async () => ({
      path: 'D:/tmp/runtime/hook-leases/meta_session_1.json',
      lease: {
        version: 1,
        sessionId: 'meta_session_1',
        projectId: 'stoa-meta-session',
        provider: 'claude-code',
        leaseState: 'active',
        ownerInstanceId: 'instance-a',
        generation: 1,
        webhookBaseUrl: 'http://127.0.0.1:43127',
        sessionSecret: 'lease-secret-1',
        commitLockNonce: 'nonce-1',
        commitToken: 'token-1',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
        heartbeatAt: '2026-05-10T12:00:00.000Z',
        expiresAt: '2026-05-10T12:00:20.000Z'
      }
    }))
    const registerSessionSecret = vi.fn()
    const startRuntime = vi.fn(async () => {})

    const launched = await launchTrackedSessionRuntime({
      sessionId: 'meta_session_1',
      manager: {
        snapshot() {
          return {
            activeProjectId: 'stoa-meta-session',
            activeSessionId: 'meta_session_1',
            terminalWebhookPort: 43127,
            projects: [{
              id: 'stoa-meta-session',
              name: 'Meta Session',
              path: 'D:/Data/DEV/ultra_simple_panel',
              createdAt: '2026-05-07T08:00:00.000Z',
              updatedAt: '2026-05-07T08:00:00.000Z'
            }],
            sessions: [{
              id: 'meta_session_1',
              projectId: 'stoa-meta-session',
              type: 'claude-code',
              runtimeState: 'created',
              turnState: 'idle',
              turnEpoch: 0,
              lastTurnOutcome: 'none',
              hasUnseenCompletion: false,
              runtimeExitCode: null,
              runtimeExitReason: null,
              lastStateSequence: 0,
              blockingReason: null,
              failureReason: null,
              title: 'Global Triage',
              summary: '',
              recoveryMode: 'resume-external',
              externalSessionId: 'backend-meta-session-1',
              createdAt: '2026-05-07T08:00:00.000Z',
              updatedAt: '2026-05-07T08:00:00.000Z',
              lastActivatedAt: null,
              archived: false
            }]
          }
        }
      } as never,
      webhookPort: 43127,
      ptyHost: { start: vi.fn(() => ({ runtimeId: 'meta_session_1' })) } as never,
      runtimeController: {
        markRuntimeStarting: vi.fn(async () => {}),
        markRuntimeAlive: vi.fn(async () => {}),
        markRuntimeExited: vi.fn(async () => {}),
        markRuntimeFailedToStart: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      },
      sessionEventBridge: {
        registerSessionSecret
      } as never,
      hookLeaseManager: {
        ensureLease
      } as never,
      resolveRuntimePaths,
      getProvider: getProvider as never,
      startRuntime,
      commandEnv: {}
    })

    expect(launched).toBe(true)
    expect(ensureLease).toHaveBeenCalledWith({
      sessionId: 'meta_session_1',
      projectId: 'stoa-meta-session',
      sessionType: 'claude-code',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })
    expect(registerSessionSecret).toHaveBeenCalledWith('meta_session_1', 'lease-secret-1')
    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          sessionSecret: 'lease-secret-1'
        })
      })
    )
  })
})
