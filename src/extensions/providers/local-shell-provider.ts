import type { CanonicalWorkspaceEvent, PersistedWorkspaceState, ProviderCommand, ProviderCommandContext, ProviderDefinition } from '@shared/workspace'

function shellCommand(): string {
  return process.platform === 'win32' ? 'powershell.exe' : 'bash'
}

function createCommand(workspace: PersistedWorkspaceState): ProviderCommand {
  return {
    command: shellCommand(),
    args: [],
    cwd: workspace.path,
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
    async buildStartCommand(workspace, _context) {
      return createCommand(workspace)
    },
    async buildResumeCommand(workspace, _sessionId, _context) {
      return createCommand(workspace)
    },
    resolveSessionId(event: CanonicalWorkspaceEvent) {
      return event.session_id ?? null
    },
    async installSidecar(_workspace, _context) {}
  }
}

export const localShellProvider = createLocalShellProvider()
