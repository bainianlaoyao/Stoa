import type { AppSettings, SessionType } from '@shared/project-session'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from '@shared/provider-descriptors'

interface ProviderPathResolverDependencies {
  detectShell: () => Promise<string | null>
  detectProvider: (executableName: string, shellPath: string | null) => Promise<string | null>
}

export interface ResolvedProviderExecutablePath {
  shellPath: string | null
  providerPath: string | null
}

function resolveConfiguredShellPath(settings: AppSettings): string {
  return settings.shellPath.trim()
}

function resolveConfiguredProviderPath(settings: AppSettings, providerId: string): string {
  return settings.providers[providerId]?.trim() ?? ''
}

export async function resolveProviderExecutablePath(
  providerId: string,
  settings: AppSettings,
  dependencies: ProviderPathResolverDependencies
): Promise<ResolvedProviderExecutablePath> {
  const descriptor = getProviderDescriptorByProviderId(providerId)
  if (!descriptor) {
    throw new Error(`Unknown provider id: ${providerId}`)
  }

  const configuredProviderPath = resolveConfiguredProviderPath(settings, providerId)
  if (configuredProviderPath.length > 0) {
    return {
      shellPath: null,
      providerPath: configuredProviderPath
    }
  }

  const configuredShellPath = resolveConfiguredShellPath(settings)
  const shellPath = configuredShellPath.length > 0
    ? configuredShellPath
    : await dependencies.detectShell()

  const providerPath = await dependencies.detectProvider(descriptor.executableName, shellPath)

  return {
    shellPath,
    providerPath
  }
}

export async function resolveRuntimePaths(
  sessionType: SessionType,
  settings: AppSettings,
  dependencies: ProviderPathResolverDependencies
): Promise<ResolvedProviderExecutablePath> {
  const descriptor = getProviderDescriptorBySessionType(sessionType)

  if (descriptor.providerId === 'local-shell') {
    const configuredShellPath = resolveConfiguredShellPath(settings)
    return {
      shellPath: configuredShellPath.length > 0
        ? configuredShellPath
        : await dependencies.detectShell(),
      providerPath: null
    }
  }

  return await resolveProviderExecutablePath(descriptor.providerId, settings, dependencies)
}
