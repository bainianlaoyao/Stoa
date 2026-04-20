import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext, SessionType } from '@shared/project-session'
import { localShellProvider } from './local-shell-provider'
import { opencodeProvider } from './opencode-provider'

export interface ProviderRuntimeTarget {
  session_id: string
  project_id: string
  path: string
  title: string
  type: SessionType
}

export interface ProviderDefinition {
  providerId: string
  supportsResume(): boolean
  supportsStructuredEvents(): boolean
  buildStartCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<ProviderCommand>
  buildResumeCommand(
    target: ProviderRuntimeTarget,
    externalSessionId: string,
    context: ProviderCommandContext
  ): Promise<ProviderCommand>
  resolveSessionId(event: CanonicalSessionEvent): string | null
  installSidecar(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void>
}

const providers = new Map<string, ProviderDefinition>([
  [localShellProvider.providerId, localShellProvider],
  [opencodeProvider.providerId, opencodeProvider]
])

export function getProvider(providerId: string): ProviderDefinition {
  return providers.get(providerId) ?? localShellProvider
}

export function listProviders(): ProviderDefinition[] {
  return [...providers.values()]
}
