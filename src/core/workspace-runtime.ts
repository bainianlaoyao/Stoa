import type { ProviderCommand, ProviderDefinition, ProviderWorkspaceRuntimeInput, PersistedWorkspaceState } from '@shared/workspace'

interface WorkspaceRuntimeSessionManager {
  markWorkspaceStarting: (workspaceId: string, summary: string, sessionId: string | null) => Promise<void>
  markWorkspaceRunning: (workspaceId: string, sessionId: string | null) => Promise<void>
  markWorkspaceExited: (workspaceId: string, summary: string) => Promise<void>
  appendTerminalData: (chunk: { workspaceId: string; data: string }) => Promise<void>
}

interface WorkspaceRuntimePtyHost {
  start: (
    workspaceId: string,
    command: ProviderCommand,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void
  ) => { workspaceId: string; sessionId: string }
}

export interface StartWorkspaceRuntimeOptions {
  workspace: ProviderWorkspaceRuntimeInput
  webhookPort: number
  provider: ProviderDefinition
  ptyHost: WorkspaceRuntimePtyHost
  sessionManager: WorkspaceRuntimeSessionManager
}

function toPersistedWorkspace(workspace: ProviderWorkspaceRuntimeInput): PersistedWorkspaceState {
  return {
    workspace_id: workspace.workspaceId,
    path: workspace.path,
    name: workspace.name,
    provider_id: workspace.providerId,
    last_cli_session_id: workspace.cliSessionId,
    last_known_status: workspace.status,
    updated_at: new Date().toISOString()
  }
}

export async function startWorkspaceRuntime(options: StartWorkspaceRuntimeOptions): Promise<void> {
  const { workspace, webhookPort, provider, ptyHost, sessionManager } = options
  const persistedWorkspace = toPersistedWorkspace(workspace)
  const workspaceSecret = workspace.workspaceSecret ?? ''
  const providerPort = workspace.providerPort ?? webhookPort + 1
  const context = {
    webhookPort,
    workspaceSecret,
    providerPort
  }

  await provider.installSidecar(persistedWorkspace, context)

  const canResume = provider.supportsResume() && !!workspace.cliSessionId && workspace.status !== 'needs_confirmation'
  const command = canResume
    ? await provider.buildResumeCommand(persistedWorkspace, workspace.cliSessionId!, context)
    : await provider.buildStartCommand(persistedWorkspace, context)

  await sessionManager.markWorkspaceStarting(workspace.workspaceId, `正在启动 ${workspace.providerId}`, workspace.cliSessionId)
  const started = ptyHost.start(
    workspace.workspaceId,
    command,
    (data) => {
      void sessionManager.appendTerminalData({ workspaceId: workspace.workspaceId, data })
    },
    (exitCode) => {
      void sessionManager.markWorkspaceExited(workspace.workspaceId, `${workspace.providerId} 已退出 (${exitCode})`)
    }
  )

  await sessionManager.markWorkspaceRunning(workspace.workspaceId, started.sessionId)
}
