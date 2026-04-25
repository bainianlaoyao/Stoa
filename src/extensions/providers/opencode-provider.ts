import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

function opencodeCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'opencode'
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
    command: opencodeCommand(context),
    args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

async function writeSidecarPlugin(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void> {
  const pluginDir = join(target.path, '.opencode', 'plugins')
  const pluginPath = join(pluginDir, 'stoa-status.ts')

  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    pluginPath,
    `const sessionId = process.env.STOA_SESSION_ID\nconst projectId = process.env.STOA_PROJECT_ID\nconst sessionSecret = process.env.STOA_SESSION_SECRET\n\nexport const StoaStatusPlugin = async () => ({\n  event: async ({ event }) => {\n    let payload\n    switch (event.type) {\n      case 'session.idle':\n        payload = {\n          intent: 'agent.turn_completed',\n          agentState: 'idle',\n          hasUnseenCompletion: true,\n          summary: event.type\n        }\n        break\n      case 'permission.asked':\n        payload = {\n          intent: 'agent.permission_requested',\n          agentState: 'blocked',\n          blockingReason: 'permission',\n          summary: event.type\n        }\n        break\n      case 'permission.replied': {\n        const response = event.properties?.response ?? event.properties?.status ?? event.properties?.decision\n        const denied = response === 'denied' || response === 'cancelled'\n        const failed = Boolean(event.properties?.error)\n        payload = {\n          intent: 'agent.permission_resolved',\n          agentState: denied ? (failed ? 'error' : 'idle') : 'working',\n          blockingReason: null,\n          summary: event.type,\n          ...(failed ? { error: String(event.properties.error) } : {})\n        }\n        break\n      }\n      case 'session.error':\n        payload = {\n          intent: 'agent.turn_failed',\n          agentState: 'error',\n          summary: event.type,\n          ...(event.properties?.error ? { error: String(event.properties.error) } : {})\n        }\n        break\n      default:\n        return\n    }\n\n    if (!sessionId || !projectId || !sessionSecret) {\n      return\n    }\n\n    await fetch('http://127.0.0.1:${context.webhookPort}/events', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json',\n        'x-stoa-secret': sessionSecret\n      },\n      body: JSON.stringify({\n        event_version: 1,\n        event_id: event.id ?? crypto.randomUUID(),\n        event_type: event.type ?? 'session.status_changed',\n        timestamp: new Date().toISOString(),\n        session_id: sessionId,\n        project_id: projectId,\n        correlation_id: event.properties?.messageID ?? undefined,\n        source: 'hook-sidecar',\n        payload: {\n          ...payload,\n          externalSessionId: event.properties?.sessionID ?? undefined\n        }\n      })\n    })\n  }\n})\n`,
    'utf-8'
  )
}

export function createOpenCodeProvider(): ProviderDefinition {
  return {
    providerId: 'opencode',
    supportsResume() {
      return true
    },
    supportsStructuredEvents() {
      return true
    },
    async buildStartCommand(target, context) {
      return createCommand(target, context, [])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['--session', externalSessionId])
    },
    resolveSessionId(event: CanonicalSessionEvent) {
      return event.session_id ?? null
    },
    async installSidecar(target, context) {
      await writeSidecarPlugin(target, context)
    }
  }
}

export const opencodeProvider = createOpenCodeProvider()
