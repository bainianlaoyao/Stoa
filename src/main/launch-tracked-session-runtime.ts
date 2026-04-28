import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import type { ClaudeCodeInjector } from '@core/memory/claude-code-injector'
import { getProvider } from '@extensions/providers'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { SessionRuntimeManager, StartSessionRuntimeOptions } from '@core/session-runtime'
import { startSessionRuntime } from '@core/session-runtime'
import type { PtyHost } from '@core/pty-host'
import type { SessionEventBridge } from './session-event-bridge'

interface RuntimePaths {
  shellPath: string | null
  providerPath: string | null
  claudeDangerouslySkipPermissions: boolean
}

interface LaunchTrackedSessionRuntimeOptions {
  sessionId: string
  manager: ProjectSessionManager
  webhookPort: number
  ptyHost: PtyHost
  runtimeController: SessionRuntimeManager
  sessionEventBridge: SessionEventBridge
  claudeCodeInjector?: Pick<ClaudeCodeInjector, 'injectLatestContext'>
  resolveRuntimePaths: (
    sessionType: StartSessionRuntimeOptions['session']['type']
  ) => Promise<RuntimePaths>
  getProvider?: typeof getProvider
  startRuntime?: typeof startSessionRuntime
}

export async function launchTrackedSessionRuntime(options: LaunchTrackedSessionRuntimeOptions): Promise<boolean> {
  const snapshot = options.manager.snapshot()
  const session = snapshot.sessions.find((candidate) => candidate.id === options.sessionId)
  if (!session) {
    return false
  }

  const project = snapshot.projects.find((candidate) => candidate.id === session.projectId)
  if (!project) {
    return false
  }

  const descriptor = getProviderDescriptorBySessionType(session.type)
  const provider = (options.getProvider ?? getProvider)(descriptor.providerId)
  const sessionSecret = options.sessionEventBridge.issueSessionSecret(session.id)
  const { shellPath, providerPath, claudeDangerouslySkipPermissions } = await options.resolveRuntimePaths(session.type)

  if (session.type === 'claude-code' && options.claudeCodeInjector) {
    try {
      await options.claudeCodeInjector.injectLatestContext({
        projectId: project.id,
        stoaSessionId: session.id,
        projectPath: project.path
      })
    } catch (error) {
      console.error(
        `[launch-tracked-session-runtime] Failed to inject Claude Code memory for session ${session.id}:`,
        error
      )
    }
  }

  await (options.startRuntime ?? startSessionRuntime)({
    session: {
      id: session.id,
      projectId: session.projectId,
      path: project.path,
      title: session.title,
      type: session.type,
      runtimeState: session.runtimeState,
      agentState: session.agentState,
      externalSessionId: session.externalSessionId,
      sessionSecret
    },
    webhookPort: options.webhookPort,
    provider,
    ptyHost: options.ptyHost,
    manager: options.runtimeController,
    shellPath,
    providerPath,
    claudeDangerouslySkipPermissions
  })

  return true
}
