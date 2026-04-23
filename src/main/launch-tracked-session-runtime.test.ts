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
    const issueSessionSecret = vi.fn(() => 'secret-1')
    const startRuntime = vi.fn(async () => {})

    const launched = await launchTrackedSessionRuntime({
      sessionId: session.id,
      manager,
      webhookPort: 43127,
      ptyHost: { start: vi.fn(() => ({ runtimeId: session.id })) } as never,
      runtimeController: {
        markSessionStarting: vi.fn(async () => {}),
        markSessionRunning: vi.fn(async () => {}),
        markSessionExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never,
      sessionEventBridge: {
        issueSessionSecret
      } as never,
      resolveRuntimePaths,
      getProvider: getProvider as never,
      startRuntime
    })

    expect(launched).toBe(true)
    expect(resolveRuntimePaths).toHaveBeenCalledWith('shell')
    expect(issueSessionSecret).toHaveBeenCalledWith(session.id)
    expect(getProvider).toHaveBeenCalledWith('local-shell')
    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: session.id,
          projectId: project.id,
          path: project.path,
          title: 'Restored shell',
          type: 'shell',
          status: 'bootstrapping',
          externalSessionId: null,
          sessionSecret: 'secret-1'
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
        markSessionStarting: vi.fn(async () => {}),
        markSessionRunning: vi.fn(async () => {}),
        markSessionExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never,
      sessionEventBridge: {
        issueSessionSecret: vi.fn(() => 'secret-1')
      } as never,
      resolveRuntimePaths: vi.fn(async () => ({ shellPath: null, providerPath: null })),
      getProvider: vi.fn() as never,
      startRuntime
    })

    expect(launched).toBe(false)
    expect(startRuntime).not.toHaveBeenCalled()
  })
})
