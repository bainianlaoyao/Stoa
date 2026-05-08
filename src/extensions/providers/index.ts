import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext, SessionType } from '@shared/project-session'
import { claudeCodeProvider } from './claude-code-provider'
import { codexProvider } from './codex-provider'
import { hermesAgentProvider } from './hermes-agent-provider'
import { localShellProvider } from './local-shell-provider'
import { opencodeProvider } from './opencode-provider'

export interface ProviderRuntimeTarget {
  session_id: string
  project_id: string
  path: string
  title: string
  type: SessionType
  external_session_id?: string | null
}

export interface ProviderDefinition {
  providerId: string
  supportsResume(): boolean
  supportsStructuredEvents(): boolean
  buildStartCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<ProviderCommand>
  buildFallbackResumeCommand?(
    target: ProviderRuntimeTarget,
    context: ProviderCommandContext
  ): Promise<ProviderCommand | null>
  buildResumeCommand(
    target: ProviderRuntimeTarget,
    externalSessionId: string,
    context: ProviderCommandContext
  ): Promise<ProviderCommand>
  resolveSessionId(event: CanonicalSessionEvent): string | null
  installSidecar(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void>
  uninstallSidecar?(projectPath: string): Promise<void>
  discoverExternalSessionIdAfterStart?(
    target: ProviderRuntimeTarget,
    context: ProviderCommandContext
  ): Promise<string | null>
}

const providers = new Map<string, ProviderDefinition>([
  [localShellProvider.providerId, localShellProvider],
  [opencodeProvider.providerId, opencodeProvider],
  [codexProvider.providerId, codexProvider],
  [claudeCodeProvider.providerId, claudeCodeProvider],
  [hermesAgentProvider.providerId, hermesAgentProvider]
])

export function getProvider(providerId: string): ProviderDefinition {
  return providers.get(providerId) ?? localShellProvider
}

export function listProviders(): ProviderDefinition[] {
  return [...providers.values()]
}
