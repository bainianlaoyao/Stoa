import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { getProvider } from '@extensions/providers'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { SessionRuntimeManager, StartSessionRuntimeOptions } from '@core/session-runtime'
import { startSessionRuntime } from '@core/session-runtime'
import type { PtyHost } from '@core/pty-host'
import type { SessionEventBridge } from './session-event-bridge'
import type { createHookLeaseManager } from './hook-lease-manager'

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
  hookLeaseManager: ReturnType<typeof createHookLeaseManager>
  resolveRuntimePaths: (
    sessionType: StartSessionRuntimeOptions['session']['type']
  ) => Promise<RuntimePaths>
  getProvider?: typeof getProvider
  startRuntime?: typeof startSessionRuntime
  initialDimensions?: { cols?: number; rows?: number }
  commandEnv?: Record<string, string>
  initialPrompt?: string
  launchToken?: number
  isLaunchTokenCurrent?: (launchToken: number) => boolean
  requireExternalSessionIdForResume?: boolean
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
  const { shellPath, providerPath, claudeDangerouslySkipPermissions } = await options.resolveRuntimePaths(session.type)
  const hookLease = await options.hookLeaseManager.ensureLease({
    sessionId: session.id,
    projectId: session.projectId,
    sessionType: session.type,
    webhookBaseUrl: `http://127.0.0.1:${options.webhookPort}`
  })

  if (hookLease?.lease.sessionSecret) {
    options.sessionEventBridge.registerSessionSecret(session.id, hookLease.lease.sessionSecret)
    options.runtimeController.registerSessionToken?.(session.id, hookLease.lease.sessionSecret)
  }

  const commandEnv = {
    ...options.commandEnv,
    STOA_CTL_SESSION_TOKEN: hookLease?.lease.sessionSecret ?? ''
  }

  if (session.type === 'codex') {
    const codexLaunchIntent =
      session.runtimeState !== 'created' && session.runtimeState !== 'starting' && session.externalSessionId
        ? 'resume'
        : 'startup'
    options.sessionEventBridge.registerCodexLaunchIntent?.(session.id, codexLaunchIntent)
  }

  await (options.startRuntime ?? startSessionRuntime)({
    session: {
      id: session.id,
      projectId: session.projectId,
      path: project.path,
      title: session.title,
      type: session.type,
      runtimeState: session.runtimeState,
      turnState: session.turnState,
      externalSessionId: session.externalSessionId,
      sessionSecret: hookLease?.lease.sessionSecret ?? null,
      hookLeasePath: hookLease?.path ?? null,
      hookSpawnOwnerInstanceId: hookLease?.lease.ownerInstanceId ?? null,
      hookSpawnGeneration: hookLease?.lease.generation ?? null
    },
    webhookPort: options.webhookPort,
    provider,
    ptyHost: options.ptyHost,
    manager: options.runtimeController,
    shellPath,
    providerPath,
    claudeDangerouslySkipPermissions,
    initialDimensions: options.initialDimensions,
    commandEnv,
    initialPrompt: options.initialPrompt,
    launchToken: options.launchToken,
    isLaunchTokenCurrent: options.isLaunchTokenCurrent,
    requireExternalSessionIdForResume: options.requireExternalSessionIdForResume
  })

  return true
}
