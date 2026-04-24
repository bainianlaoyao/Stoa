import type { ProviderCommand, SessionStatus } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import type { ProviderDefinition, ProviderRuntimeTarget } from '@extensions/providers'
import { wrapCommandForShell } from './shell-command'

export interface SessionRuntimeManager {
  markSessionStarting: (sessionId: string, summary: string, externalSessionId: string | null) => Promise<void>
  markSessionRunning: (sessionId: string, externalSessionId: string | null) => Promise<void>
  markSessionExited: (sessionId: string, summary: string) => Promise<void>
  appendTerminalData: (chunk: { sessionId: string; data: string }) => Promise<void>
}

interface SessionRuntimePtyHost {
  start: (
    runtimeId: string,
    command: ProviderCommand,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void
  ) => { runtimeId: string }
}

export interface StartSessionRuntimeOptions {
  session: {
    id: string
    projectId: string
    path: string
    title: string
    type: 'shell' | 'opencode' | 'codex' | 'claude-code'
    status: SessionStatus
    externalSessionId: string | null
    sessionSecret?: string | null
    providerPort?: number | null
  }
  webhookPort: number
  provider: ProviderDefinition
  ptyHost: SessionRuntimePtyHost
  manager: SessionRuntimeManager
  shellPath?: string | null
  providerPath?: string | null
  claudeDangerouslySkipPermissions?: boolean
}

function toProviderTarget(session: StartSessionRuntimeOptions['session']): ProviderRuntimeTarget {
  return {
    session_id: session.id,
    project_id: session.projectId,
    path: session.path,
    title: session.title,
    type: session.type,
    external_session_id: session.externalSessionId
  }
}

export async function startSessionRuntime(options: StartSessionRuntimeOptions): Promise<void> {
  const { session, webhookPort, provider, ptyHost, manager } = options
  const descriptor = getProviderDescriptorBySessionType(session.type)
  const target = toProviderTarget(session)
  const sessionSecret = session.sessionSecret ?? ''
  const providerPort = session.providerPort ?? webhookPort + 1
  const context = {
    webhookPort,
    sessionSecret,
    providerPort,
    providerPath: options.providerPath ?? null,
    claudeDangerouslySkipPermissions: options.claudeDangerouslySkipPermissions === true,
    startedAt: Date.now()
  }

  console.log(`[session-runtime] installSidecar for ${session.id}`)
  await provider.installSidecar(target, context)
  console.log(`[session-runtime] installSidecar done for ${session.id}`)

  const canResume =
    descriptor.supportsResume
    && provider.supportsResume()
    && !!session.externalSessionId
    && session.status !== 'bootstrapping'
    && session.status !== 'needs_confirmation'

  const canFallbackResume =
    descriptor.supportsResume
    && provider.supportsResume()
    && !session.externalSessionId
    && session.status !== 'bootstrapping'
    && session.status !== 'needs_confirmation'
    && !!provider.buildFallbackResumeCommand

  const providerCommand = canResume
    ? await provider.buildResumeCommand(target, session.externalSessionId!, context)
    : canFallbackResume
      ? await provider.buildFallbackResumeCommand!(target, context) ?? await provider.buildStartCommand(target, context)
      : await provider.buildStartCommand(target, context)

  const command =
    descriptor.prefersShellWrap && options.shellPath
      ? wrapCommandForShell(options.shellPath, providerCommand)
      : providerCommand
  const activeExternalSessionId = session.externalSessionId

  console.log(`[session-runtime] markSessionStarting for ${session.id} (command: ${command.command} ${command.args.join(' ')})`)
  await manager.markSessionStarting(session.id, `Starting ${session.type}`, activeExternalSessionId)
  console.log(`[session-runtime] markSessionStarting done, spawning PTY for ${session.id}`)

  const started = ptyHost.start(
    session.id,
    command,
    (data) => {
      void manager.appendTerminalData({ sessionId: session.id, data })
    },
    (exitCode) => {
      console.log(`[session-runtime] Process exited for ${session.id} with code ${exitCode}`)
      void manager.markSessionExited(session.id, `${session.type} exited (${exitCode})`)
    }
  )

  console.log(`[session-runtime] markSessionRunning for ${session.id} (runtimeId: ${started.runtimeId})`)
  await manager.markSessionRunning(session.id, activeExternalSessionId ?? null)

  if (!session.externalSessionId && provider.discoverExternalSessionIdAfterStart) {
    void provider.discoverExternalSessionIdAfterStart(target, context)
      .then(async (discoveredExternalSessionId) => {
        if (!discoveredExternalSessionId) {
          return
        }
        await manager.markSessionRunning(session.id, discoveredExternalSessionId)
      })
      .catch((error) => {
        console.error(`[session-runtime] Failed external session discovery for ${session.id}:`, error)
      })
  }

  console.log(`[session-runtime] markSessionRunning done for ${session.id}`)
}
