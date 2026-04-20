import type { CanonicalSessionEvent, ProviderCommand } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

function shellCommand(): string {
  return process.platform === 'win32' ? 'powershell.exe' : 'bash'
}

function createCommand(target: ProviderRuntimeTarget): ProviderCommand {
  return {
    command: shellCommand(),
    args: [],
    cwd: target.path,
    env: process.env as Record<string, string>
  }
}

export function createLocalShellProvider(): ProviderDefinition {
  return {
    providerId: 'local-shell',
    supportsResume() {
      return false
    },
    supportsStructuredEvents() {
      return false
    },
    async buildStartCommand(target, _context) {
      return createCommand(target)
    },
    async buildResumeCommand(target, _externalSessionId, _context) {
      return createCommand(target)
    },
    resolveSessionId(event: CanonicalSessionEvent) {
      return event.session_id ?? null
    },
    async installSidecar(_workspace, _context) {}
  }
}

export const localShellProvider = createLocalShellProvider()
