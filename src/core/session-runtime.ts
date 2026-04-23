import type { ProviderCommand } from '@shared/project-session'
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
    type: 'shell' | 'opencode'
    status: string
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
}

function toProviderTarget(session: StartSessionRuntimeOptions['session']): ProviderRuntimeTarget {
  return {
    session_id: session.id,
    project_id: session.projectId,
    path: session.path,
    title: session.title,
    type: session.type
  }
}

export async function startSessionRuntime(options: StartSessionRuntimeOptions): Promise<void> {
  const { session, webhookPort, provider, ptyHost, manager } = options
  const target = toProviderTarget(session)
  const sessionSecret = session.sessionSecret ?? ''
  const providerPort = session.providerPort ?? webhookPort + 1
  const context = {
    webhookPort,
    sessionSecret,
    providerPort,
    providerPath: options.providerPath ?? null
  }

  console.log(`[session-runtime] installSidecar for ${session.id}`)
  await provider.installSidecar(target, context)
  console.log(`[session-runtime] installSidecar done for ${session.id}`)

  const canResume =
    session.type === 'opencode'
    && provider.supportsResume()
    && !!session.externalSessionId
    && session.status !== 'needs_confirmation'

  const providerCommand = canResume
    ? await provider.buildResumeCommand(target, session.externalSessionId!, context)
    : await provider.buildStartCommand(target, context)

  const command =
    session.type === 'opencode' && options.shellPath
      ? wrapCommandForShell(options.shellPath, providerCommand)
      : providerCommand
  const activeExternalSessionId = canResume ? session.externalSessionId : null

  console.log(`[session-runtime] markSessionStarting for ${session.id} (command: ${command.command} ${command.args.join(' ')})`)
  await manager.markSessionStarting(session.id, `正在启动 ${session.type}`, activeExternalSessionId)
  console.log(`[session-runtime] markSessionStarting done, spawning PTY for ${session.id}`)

  const started = ptyHost.start(
    session.id,
    command,
    (data) => {
      void manager.appendTerminalData({ sessionId: session.id, data })
    },
    (exitCode) => {
      console.log(`[session-runtime] Process exited for ${session.id} with code ${exitCode}`)
      void manager.markSessionExited(session.id, `${session.type} 已退出 (${exitCode})`)
    }
  )

  console.log(`[session-runtime] markSessionRunning for ${session.id} (runtimeId: ${started.runtimeId})`)
  await manager.markSessionRunning(session.id, activeExternalSessionId)
  console.log(`[session-runtime] markSessionRunning done for ${session.id}`)
}
