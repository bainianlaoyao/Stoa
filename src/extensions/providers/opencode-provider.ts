import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CanonicalWorkspaceEvent, PersistedWorkspaceState, ProviderCommand, ProviderCommandContext, ProviderDefinition } from '@shared/workspace'

function opencodeCommand(): string {
  return process.platform === 'win32' ? 'opencode.cmd' : 'opencode'
}

function createProviderEnv(workspace: PersistedWorkspaceState, context: ProviderCommandContext): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    VIBECODING_WORKSPACE_ID: workspace.workspace_id,
    VIBECODING_WORKSPACE_SECRET: context.workspaceSecret,
    VIBECODING_WEBHOOK_PORT: String(context.webhookPort),
    VIBECODING_PROVIDER_PORT: String(context.providerPort)
  }
}

function createCommand(workspace: PersistedWorkspaceState, context: ProviderCommandContext, args: string[]): ProviderCommand {
  return {
    command: opencodeCommand(),
    args,
    cwd: workspace.path,
    env: createProviderEnv(workspace, context)
  }
}

async function writeSidecarPlugin(workspace: PersistedWorkspaceState, context: ProviderCommandContext): Promise<void> {
  const pluginDir = join(workspace.path, '.opencode', 'plugins')
  const pluginPath = join(pluginDir, 'vibecoding-status.ts')

  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    pluginPath,
    `export const VibecodingStatusPlugin = async () => ({\n  event: async ({ event }) => {\n    await fetch('http://127.0.0.1:${context.webhookPort}/events', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json',\n        'x-vibecoding-secret': '${context.workspaceSecret}'\n      },\n      body: JSON.stringify({\n        event_version: 1,\n        event_id: event.id ?? crypto.randomUUID(),\n        event_type: event.type ?? 'workspace.status_changed',\n        timestamp: new Date().toISOString(),\n        workspace_id: '${workspace.workspace_id}',\n        provider_id: '${workspace.provider_id}',\n        session_id: event.properties?.sessionID ?? null,\n        correlation_id: event.properties?.messageID ?? undefined,\n        source: 'hook-sidecar',\n        payload: {\n          status: event.type === 'session.idle' ? 'awaiting_input' : 'running',\n          summary: event.type,\n          is_provisional: false\n        }\n      })\n    })\n  }\n})\n`,
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
    async buildStartCommand(workspace, context) {
      return createCommand(workspace, context, ['--port', String(context.providerPort)])
    },
    async buildResumeCommand(workspace, sessionId, context) {
      return createCommand(workspace, context, ['--port', String(context.providerPort), '--session', sessionId])
    },
    resolveSessionId(event: CanonicalWorkspaceEvent) {
      return event.session_id ?? null
    },
    async installSidecar(workspace, context) {
      await writeSidecarPlugin(workspace, context)
    }
  }
}

export const opencodeProvider = createOpenCodeProvider()
