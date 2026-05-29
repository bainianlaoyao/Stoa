import type { ProviderCommand, SessionRuntimeState, SessionType, TurnState } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import type { ProviderDefinition, ProviderRuntimeTarget } from '@extensions/providers'
import { wrapCommandForShell } from './shell-command'

export interface SessionRuntimeManager {
  markRuntimeStarting: (sessionId: string, summary: string, externalSessionId: string | null) => Promise<void>
  markRuntimeAlive: (sessionId: string, externalSessionId: string | null) => Promise<void>
  markRuntimeExited: (sessionId: string, exitCode: number | null, summary: string) => Promise<void>
  markRuntimeFailedToStart: (sessionId: string, summary: string) => Promise<void>
  appendTerminalData: (chunk: { sessionId: string; data: string }) => Promise<void>
  registerSessionToken?: (sessionId: string, token: string) => void
}

interface SessionRuntimePtyHost {
  start: (
    runtimeId: string,
    command: ProviderCommand,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
    shellIntegration?: { enabled: boolean; shellPath: string }
  ) => { runtimeId: string }
}

export interface StartSessionRuntimeOptions {
  session: {
    id: string
    projectId: string
    path: string
    title: string
    type: SessionType
    runtimeState: SessionRuntimeState
    turnState: TurnState
    externalSessionId: string | null
    sessionSecret?: string | null
    providerPort?: number | null
    hookLeasePath?: string | null
    hookSpawnOwnerInstanceId?: string | null
    hookSpawnGeneration?: number | null
  }
  webhookPort: number
  provider: ProviderDefinition
  ptyHost: SessionRuntimePtyHost
  manager: SessionRuntimeManager
  shellPath?: string | null
  providerPath?: string | null
  claudeDangerouslySkipPermissions?: boolean
  initialDimensions?: { cols: number; rows: number }
  commandEnv?: Record<string, string>
  initialPrompt?: string
  launchToken?: number
  isLaunchTokenCurrent?: (launchToken: number) => boolean
  requireExternalSessionIdForResume?: boolean
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
    hookLeasePath: session.hookLeasePath ?? null,
    hookManaged: session.hookLeasePath !== undefined && session.hookLeasePath !== null,
    hookSessionId: session.id,
    hookProjectId: session.projectId,
    hookProvider:
      session.type === 'claude-code' || session.type === 'codex' || session.type === 'opencode'
        ? session.type
        : null,
    hookSpawnOwnerInstanceId: session.hookSpawnOwnerInstanceId ?? null,
    hookSpawnGeneration: session.hookSpawnGeneration ?? null,
    providerPath: options.providerPath ?? null,
    claudeDangerouslySkipPermissions: options.claudeDangerouslySkipPermissions === true,
    startedAt: Date.now(),
    initialPrompt: options.initialPrompt
  }
  console.log(`[session-runtime] installSidecar for ${session.id}`)
  await provider.installSidecar(target, context)
  console.log(`[session-runtime] installSidecar done for ${session.id}`)

  const hasResumeBoundary = session.runtimeState !== 'created' && session.runtimeState !== 'starting'
  const canResume =
    descriptor.supportsResume
    && provider.supportsResume()
    && !!session.externalSessionId
    && hasResumeBoundary

  if (
    options.requireExternalSessionIdForResume
    && descriptor.supportsResume
    && provider.supportsResume()
    && !session.externalSessionId
  ) {
    throw new Error(`Cannot restart ${session.type} session without a stored external session id`)
  }

  const providerCommand = canResume
    ? await provider.buildResumeCommand(target, session.externalSessionId!, context)
    : await provider.buildStartCommand(target, context)

  if (options.commandEnv) {
    providerCommand.env = {
      ...providerCommand.env,
      ...options.commandEnv
    }
  }

  const command =
    descriptor.prefersShellWrap && options.shellPath
      ? wrapCommandForShell(options.shellPath, providerCommand)
      : providerCommand
  const activeExternalSessionId = session.externalSessionId

  if (options.initialDimensions) {
    command.initialCols = options.initialDimensions.cols
    command.initialRows = options.initialDimensions.rows
  }

  console.log(`[session-runtime] markRuntimeStarting for ${session.id} (command: ${command.command} ${command.args.join(' ')})`)
  await manager.markRuntimeStarting(session.id, `Starting ${session.type}`, activeExternalSessionId)
  console.log(`[session-runtime] markRuntimeStarting done, spawning PTY for ${session.id}`)

  let started: { runtimeId: string }
  let exitObservedDuringStart = false

  const shellIntegration = session.type === 'shell' && options.shellPath
    ? { enabled: true, shellPath: options.shellPath }
    : undefined

  try {
    started = ptyHost.start(
      session.id,
      command,
      (data) => {
        void manager.appendTerminalData({ sessionId: session.id, data })
      },
      (exitCode) => {
        if (
          options.launchToken !== undefined
          && options.isLaunchTokenCurrent
          && !options.isLaunchTokenCurrent(options.launchToken)
        ) {
          console.log(`[session-runtime] Ignoring stale exit for ${session.id} from launch token ${options.launchToken}`)
          return
        }

        exitObservedDuringStart = true
        console.log(`[session-runtime] Process exited for ${session.id} with code ${exitCode}`)
        void manager
          .markRuntimeExited(session.id, exitCode, `${session.type} exited (${exitCode})`)
          .catch((error) => {
            console.error(`[session-runtime] Failed to mark runtime exit for ${session.id}:`, error)
          })
      },
      shellIntegration
    )
  } catch (error) {
    await manager.markRuntimeFailedToStart(session.id, `${session.type} failed to start: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  if (exitObservedDuringStart) {
    console.log(`[session-runtime] skipped markRuntimeAlive for ${session.id}; process exited during start`)
    return
  }

  console.log(`[session-runtime] markRuntimeAlive for ${session.id} (runtimeId: ${started.runtimeId})`)
  await manager.markRuntimeAlive(session.id, activeExternalSessionId ?? null)

  console.log(`[session-runtime] markRuntimeAlive done for ${session.id}`)
}
