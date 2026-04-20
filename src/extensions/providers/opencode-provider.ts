import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

function createProviderEnv(target: ProviderRuntimeTarget, context: ProviderCommandContext): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    VIBECODING_SESSION_ID: target.session_id,
    VIBECODING_PROJECT_ID: target.project_id,
    VIBECODING_SESSION_SECRET: context.sessionSecret,
    VIBECODING_WEBHOOK_PORT: String(context.webhookPort),
    VIBECODING_PROVIDER_PORT: String(context.providerPort)
  }
}

function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]): ProviderCommand {
  return {
    command: 'opencode',
    args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

async function writeSidecarPlugin(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void> {
  const pluginDir = join(target.path, '.opencode', 'plugins')
  const pluginPath = join(pluginDir, 'vibecoding-status.ts')

  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    pluginPath,
    `export const VibecodingStatusPlugin = async () => ({\n  event: async ({ event }) => {\n    await fetch('http://127.0.0.1:${context.webhookPort}/events', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json',\n        'x-vibecoding-secret': '${context.sessionSecret}'\n      },\n      body: JSON.stringify({\n        event_version: 1,\n        event_id: event.id ?? crypto.randomUUID(),\n        event_type: event.type ?? 'session.status_changed',\n        timestamp: new Date().toISOString(),\n        session_id: event.properties?.sessionID ?? '${target.session_id}',\n        project_id: '${target.project_id}',\n        correlation_id: event.properties?.messageID ?? undefined,\n        source: 'hook-sidecar',\n        payload: {\n          status: event.type === 'session.idle' ? 'awaiting_input' : 'running',\n          summary: event.type,\n          isProvisional: false\n        }\n      })\n    })\n  }\n})\n`,
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
      return createCommand(target, context, ['--port', String(context.providerPort)])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['--port', String(context.providerPort), '--session', externalSessionId])
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
