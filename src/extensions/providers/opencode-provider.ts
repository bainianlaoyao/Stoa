import { join } from 'node:path'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'

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
  const pluginPath = join('.opencode', 'plugins', 'stoa-status.ts')
  const pluginContent = `const sessionId = process.env.STOA_SESSION_ID\nconst projectId = process.env.STOA_PROJECT_ID\nconst sessionSecret = process.env.STOA_SESSION_SECRET\n\nfunction toFailureReason(event) {\n  const raw = event.properties?.error ?? event.properties?.reason ?? null\n  if (typeof raw !== 'string') {\n    return 'provider_error'\n  }\n\n  const normalized = raw.toLowerCase()\n  if (normalized.includes('permission')) {\n    return 'permission_denied'\n  }\n  if (normalized.includes('rate')) {\n    return 'rate_limit'\n  }\n  if (normalized.includes('auth')) {\n    return 'authentication_failed'\n  }\n  return 'provider_error'\n}\n\nexport const StoaStatusPlugin = async () => ({\n  event: async ({ event }) => {\n    let payload\n    switch (event.type) {\n      case 'tool.execute.before':\n        payload = {\n          intent: 'agent.tool_started',\n          summary: event.type\n        }\n        break\n      case 'session.idle':\n        payload = {\n          intent: 'agent.turn_completed',\n          summary: event.type\n        }\n        break\n      case 'permission.asked':\n        payload = {\n          intent: 'agent.permission_requested',\n          blockingReason: 'permission',\n          summary: event.type\n        }\n        break\n      case 'permission.replied': {\n        const failed = Boolean(event.properties?.error)\n        if (failed) {\n          payload = {\n            intent: 'agent.turn_failed',\n            failureReason: toFailureReason(event),\n            summary: event.type\n          }\n          break\n        }\n\n        payload = {\n          intent: 'agent.permission_resolved',\n          summary: event.type\n        }\n        break\n      }\n      case 'session.error':\n        payload = {\n          intent: 'agent.turn_failed',\n          failureReason: toFailureReason(event),\n          summary: event.type\n        }\n        break\n      default:\n        return\n    }\n\n    if (!sessionId || !projectId || !sessionSecret) {\n      return\n    }\n\n    await fetch('http://127.0.0.1:${context.webhookPort}/events', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json',\n        'x-stoa-secret': sessionSecret\n      },\n      body: JSON.stringify({\n        event_version: 1,\n        event_id: event.id ?? crypto.randomUUID(),\n        event_type: event.type ?? 'session.event',\n        timestamp: new Date().toISOString(),\n        session_id: sessionId,\n        project_id: projectId,\n        correlation_id: event.properties?.messageID ?? event.properties?.tool?.messageID ?? event.properties?.sessionID ?? undefined,\n        source: 'hook-sidecar',\n        payload: {\n          ...payload,\n          sourceTurnId: event.properties?.messageID ?? undefined,\n          externalSessionId: event.properties?.sessionID ?? undefined\n        }\n      })\n    })\n  }\n})\n`

  await installManagedSidecar({
    rootDir: target.path,
    manifestRelativePath: '.opencode/.stoa-managed-sidecar.json',
    currentArtifacts: [pluginPath],
    writes: [{
      relativePath: pluginPath,
      content: pluginContent
    }]
  })
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
    },
    async uninstallSidecar(projectPath) {
      await uninstallManagedSidecar({
        rootDir: projectPath,
        manifestRelativePath: '.opencode/.stoa-managed-sidecar.json'
      })
    }
  }
}

export const opencodeProvider = createOpenCodeProvider()
