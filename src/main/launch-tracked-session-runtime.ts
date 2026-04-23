import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
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

  await (options.startRuntime ?? startSessionRuntime)({
    session: {
      id: session.id,
      projectId: session.projectId,
      path: project.path,
      title: session.title,
      type: session.type,
      status: session.status,
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
