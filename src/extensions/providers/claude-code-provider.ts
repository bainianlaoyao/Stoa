import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
import { installClaudeHooks, uninstallClaudeHooks } from './claude-hook-sidecar'

function claudeCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'claude'
}

function createProviderEnv(target: ProviderRuntimeTarget, context: ProviderCommandContext): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    STOA_SESSION_ID: target.session_id,
    STOA_PROJECT_ID: target.project_id,
    STOA_SESSION_SECRET: context.sessionSecret,
    STOA_WEBHOOK_PORT: String(context.webhookPort),
    STOA_PROVIDER_PORT: String(context.providerPort)
  }
}

function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]): ProviderCommand {
  return {
    command: claudeCommand(context),
    args: context.claudeDangerouslySkipPermissions === true
      ? [...args, '--dangerously-skip-permissions']
      : args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

function requireExternalSessionId(target: ProviderRuntimeTarget): string {
  if (!target.external_session_id) {
    throw new Error('claude-code sessions require an external_session_id')
  }

  return target.external_session_id
}

export function createClaudeCodeProvider(): ProviderDefinition {
  return {
    providerId: 'claude-code',
    supportsResume() {
      return true
    },
    supportsStructuredEvents() {
      return true
    },
    async buildStartCommand(target, context) {
      return createCommand(target, context, ['--session-id', requireExternalSessionId(target)])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['--resume', externalSessionId])
    },
    resolveSessionId(_event: CanonicalSessionEvent) {
      return null
    },
    async installSidecar(target, context) {
      await installClaudeHooks({
        projectRoot: target.path,
        webhookPort: context.webhookPort
      })
    },
    async uninstallSidecar(projectPath) {
      await uninstallClaudeHooks(projectPath)
    },
    async discoverExternalSessionIdAfterStart(target) {
      return target.external_session_id ?? null
    }
  }
}

export const claudeCodeProvider = createClaudeCodeProvider()
