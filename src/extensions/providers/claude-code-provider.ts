import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

const CLAUDE_HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'PermissionRequest'] as const
const CLAUDE_SETTINGS_SOURCE_ARGS = ['--setting-sources', 'user,project,local'] as const

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
  const effectiveArgs = [...args, ...CLAUDE_SETTINGS_SOURCE_ARGS]
  return {
    command: claudeCommand(context),
    args: context.claudeDangerouslySkipPermissions === true
      ? [...effectiveArgs, '--dangerously-skip-permissions']
      : effectiveArgs,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

async function writeSharedClaudeHooks(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void> {
  const claudeDir = join(target.path, '.claude')
  await mkdir(claudeDir, { recursive: true })
  const httpHook = {
    matcher: '*',
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${context.webhookPort}/hooks/claude-code`,
      headers: {
        'x-stoa-session-id': '${STOA_SESSION_ID}',
        'x-stoa-project-id': '${STOA_PROJECT_ID}',
        'x-stoa-secret': '${STOA_SESSION_SECRET}'
      },
      allowedEnvVars: [
        'STOA_SESSION_ID',
        'STOA_PROJECT_ID',
        'STOA_SESSION_SECRET'
      ],
      timeout: 5
    }]
  }

  const settings = {
    hooks: Object.fromEntries(CLAUDE_HOOK_EVENTS.map((eventName) => [eventName, [httpHook]]))
  }

  await writeFile(
    join(claudeDir, 'settings.local.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf-8'
  )
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
      await writeSharedClaudeHooks(target, context)
    },
    async discoverExternalSessionIdAfterStart(target) {
      return target.external_session_id ?? null
    }
  }
}

export const claudeCodeProvider = createClaudeCodeProvider()
