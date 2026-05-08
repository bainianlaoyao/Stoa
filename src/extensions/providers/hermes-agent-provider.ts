import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

function hermesAgentCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'hermes-agent'
}

function createProviderEnv(target: ProviderRuntimeTarget, context: ProviderCommandContext): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    STOA_HERMES: '1',
    STOA_HERMES_SESSION_ID: target.session_id,
    STOA_SESSION_ID: target.session_id,
    STOA_PROJECT_ID: target.project_id,
    STOA_SESSION_SECRET: context.sessionSecret,
    STOA_WEBHOOK_PORT: String(context.webhookPort),
    STOA_PROVIDER_PORT: String(context.providerPort),
    STOA_CTL_BASE_URL: `http://127.0.0.1:${context.webhookPort}`,
    STOA_CTL_TOKEN: context.sessionSecret
  }
}

function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]): ProviderCommand {
  return {
    command: hermesAgentCommand(context),
    args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

export const hermesAgentProvider: ProviderDefinition = {
  providerId: 'hermes-agent',
  supportsResume() {
    return true
  },
  supportsStructuredEvents() {
    return true
  },
  async buildStartCommand(target, context) {
    return createCommand(target, context, ['start', '--stoa-hermes', '--session-id', target.session_id])
  },
  async buildResumeCommand(target, externalSessionId, context) {
    return createCommand(target, context, ['resume', externalSessionId, '--stoa-hermes'])
  },
  resolveSessionId(event: CanonicalSessionEvent) {
    return event.payload.externalSessionId ?? event.session_id ?? null
  },
  async installSidecar() {},
  async discoverExternalSessionIdAfterStart(target) {
    return target.external_session_id ?? null
  }
}
