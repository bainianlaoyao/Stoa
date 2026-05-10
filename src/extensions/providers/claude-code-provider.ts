import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
import { installClaudeHooks, uninstallClaudeHooks } from './claude-hook-sidecar'

function claudeCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'claude'
}

function createProviderEnv(target: ProviderRuntimeTarget, context: ProviderCommandContext): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    STOA_PROVIDER_PORT: String(context.providerPort)
  }

  delete env.STOA_SESSION_ID
  delete env.STOA_PROJECT_ID
  delete env.STOA_SESSION_SECRET
  delete env.STOA_WEBHOOK_PORT

  if (context.hookLeasePath) {
    env.STOA_HOOK_LEASE_PATH = context.hookLeasePath
  }
  if (context.hookManaged) {
    env.STOA_HOOK_MANAGED = '1'
  }
  if (context.hookSessionId) {
    env.STOA_HOOK_SESSION_ID = context.hookSessionId
  }
  if (context.hookProjectId) {
    env.STOA_HOOK_PROJECT_ID = context.hookProjectId
  }
  if (context.hookProvider) {
    env.STOA_HOOK_PROVIDER = context.hookProvider
  }
  if (context.hookSpawnOwnerInstanceId) {
    env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID = context.hookSpawnOwnerInstanceId
  }
  if (context.hookSpawnGeneration !== null && context.hookSpawnGeneration !== undefined) {
    env.STOA_HOOK_SPAWN_GENERATION = String(context.hookSpawnGeneration)
  }

  return env
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
        managedArtifacts: true
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
