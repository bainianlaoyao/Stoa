import { describe, expect, test, vi } from 'vitest'
import type { ProviderDefinition } from '@shared/workspace'
import { startWorkspaceRuntime } from './workspace-runtime'

function createProvider(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    providerId: 'opencode',
    supportsResume: () => true,
    supportsStructuredEvents: () => true,
    async buildStartCommand(workspace, context) {
      return {
        command: 'opencode',
        args: ['--port', String(context.providerPort)],
        cwd: workspace.path,
        env: { VIBECODING_WORKSPACE_ID: workspace.workspace_id }
      }
    },
    async buildResumeCommand(workspace, sessionId, context) {
      return {
        command: 'opencode',
        args: ['--session', sessionId, '--port', String(context.providerPort)],
        cwd: workspace.path,
        env: { VIBECODING_WORKSPACE_ID: workspace.workspace_id }
      }
    },
    resolveSessionId(event) {
      return event.session_id
    },
    async installSidecar() {},
    ...overrides
  }
}

describe('workspace runtime', () => {
  test('uses provider-built resume command when recoverable session metadata exists', async () => {
    const buildResumeCommand = vi.fn(async () => ({
      command: 'opencode',
      args: ['--session', 'chat-123'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({ buildResumeCommand })
    const installSidecar = vi.spyOn(provider, 'installSidecar')
    const markWorkspaceStarting = vi.fn(async () => {})
    const markWorkspaceRunning = vi.fn(async () => {})
    const start = vi.fn(() => ({ workspaceId: 'ws_demo', sessionId: 'pty-1' }))

    await startWorkspaceRuntime({
      workspace: {
        workspaceId: 'ws_demo',
        name: 'demo',
        path: 'D:/demo',
        providerId: 'opencode',
        status: 'running',
        summary: 'ready',
        cliSessionId: 'chat-123',
        isProvisional: true,
        workspaceSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start } as never,
      sessionManager: {
        markWorkspaceStarting,
        markWorkspaceRunning,
        markWorkspaceExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(installSidecar).toHaveBeenCalledOnce()
    expect(buildResumeCommand).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(
      'ws_demo',
      expect.objectContaining({
        command: 'opencode',
        args: ['--session', 'chat-123'],
        cwd: 'D:/demo'
      }),
      expect.any(Function),
      expect.any(Function)
    )
    expect(markWorkspaceRunning).toHaveBeenCalledWith('ws_demo', 'pty-1')
  })

  test('falls back to provider start command when no resumable session is available', async () => {
    const buildStartCommand = vi.fn(async () => ({
      command: 'opencode',
      args: ['--port', '43128'],
      cwd: 'D:/demo',
      env: { TEST_ENV: '1' }
    }))
    const provider = createProvider({ buildStartCommand })
    const start = vi.fn(() => ({ workspaceId: 'ws_demo', sessionId: 'pty-2' }))

    await startWorkspaceRuntime({
      workspace: {
        workspaceId: 'ws_demo',
        name: 'demo',
        path: 'D:/demo',
        providerId: 'opencode',
        status: 'needs_confirmation',
        summary: 'confirm first',
        cliSessionId: null,
        isProvisional: true,
        workspaceSecret: 'secret-1',
        providerPort: 43128
      },
      webhookPort: 43127,
      provider,
      ptyHost: { start } as never,
      sessionManager: {
        markWorkspaceStarting: vi.fn(async () => {}),
        markWorkspaceRunning: vi.fn(async () => {}),
        markWorkspaceExited: vi.fn(async () => {}),
        appendTerminalData: vi.fn(async () => {})
      } as never
    })

    expect(buildStartCommand).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(
      'ws_demo',
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
