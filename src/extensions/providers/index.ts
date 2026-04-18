import type { ProviderDefinition } from '@shared/workspace'
import { localShellProvider } from './local-shell-provider'
import { opencodeProvider } from './opencode-provider'

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
