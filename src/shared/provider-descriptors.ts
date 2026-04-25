import type { SessionType } from './project-session'

export interface ProviderDescriptor {
  sessionType: SessionType
  providerId: string
  executableName: string
  displayName: string
  titlePrefix: string
  supportsResume: boolean
  supportsStructuredEvents: boolean
  seedsExternalSessionId: boolean
  prefersShellWrap: boolean
}

const PROVIDER_DESCRIPTORS: Record<SessionType, ProviderDescriptor> = {
  shell: {
    sessionType: 'shell',
    providerId: 'local-shell',
    executableName: 'shell',
    displayName: 'Shell',
    titlePrefix: 'shell',
    supportsResume: false,
    supportsStructuredEvents: false,
    seedsExternalSessionId: false,
    prefersShellWrap: false
  },
  opencode: {
    sessionType: 'opencode',
    providerId: 'opencode',
    executableName: 'opencode',
    displayName: 'OpenCode',
    titlePrefix: 'opencode',
    supportsResume: true,
    supportsStructuredEvents: true,
    seedsExternalSessionId: false,
    prefersShellWrap: true
  },
  codex: {
    sessionType: 'codex',
    providerId: 'codex',
    executableName: 'codex',
    displayName: 'Codex',
    titlePrefix: 'codex',
    supportsResume: true,
    supportsStructuredEvents: true,
    seedsExternalSessionId: false,
    prefersShellWrap: true
  },
  'claude-code': {
    sessionType: 'claude-code',
    providerId: 'claude-code',
    executableName: 'claude',
    displayName: 'Claude Code',
    titlePrefix: 'claude',
    supportsResume: true,
    supportsStructuredEvents: true,
    seedsExternalSessionId: true,
    prefersShellWrap: false
  }
}

export const SESSION_PROVIDER_ORDER: SessionType[] = ['opencode', 'codex', 'claude-code', 'shell']

export function getProviderDescriptorBySessionType(type: SessionType): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[type]
}

export function getProviderDescriptorByProviderId(providerId: string): ProviderDescriptor | null {
  return Object.values(PROVIDER_DESCRIPTORS).find(descriptor => descriptor.providerId === providerId) ?? null
}

export function listProviderDescriptors(): ProviderDescriptor[] {
  return SESSION_PROVIDER_ORDER.map(getProviderDescriptorBySessionType)
}
