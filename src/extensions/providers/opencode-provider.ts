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
  const pluginContent = `const sessionId = process.env.STOA_SESSION_ID
const projectId = process.env.STOA_PROJECT_ID
const sessionSecret = process.env.STOA_SESSION_SECRET
const webhookPort = process.env.STOA_WEBHOOK_PORT

function toFailureReason(event) {
  const raw = event.properties?.error ?? event.properties?.reason ?? null
  if (typeof raw !== 'string') {
    return 'provider_error'
  }

  const normalized = raw.toLowerCase()
  if (normalized.includes('permission')) {
    return 'permission_denied'
  }
  if (normalized.includes('rate')) {
    return 'rate_limit'
  }
  if (normalized.includes('auth')) {
    return 'authentication_failed'
  }
  return 'provider_error'
}

async function enrichWithMessages(client, event, body) {
  if (event.type !== 'session.idle') return
  if (!event.properties?.sessionID) return
  try {
    const result = await client.session.messages({ path: { id: event.properties.sessionID } })
    if (result && result.data && Array.isArray(result.data)) {
      const recent = result.data.slice(-10)
      const summary = recent.map((msg) => {
        const info = msg.info ?? {}
        const role = info.role ?? 'unknown'
        const parts = (msg.parts ?? []).map((p) => p.text ?? p.type ?? '').filter(Boolean).join(' ')
        return { role, content: parts.slice(0, 500) }
      })
      const serialized = JSON.stringify(summary)
      body.last_assistant_message = serialized.length > 10240 ? serialized.slice(0, 10240) : serialized
    }
  } catch {
    // enrichment is best-effort, never block the event
  }
}

async function sendEvent(body) {
  if (!sessionId || !projectId || !sessionSecret) {
    return
  }

  try {
    await fetch('http://127.0.0.1:${context.webhookPort}/hooks/opencode', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-stoa-session-id': sessionId,
        'x-stoa-project-id': projectId,
        'x-stoa-secret': sessionSecret
      },
      body: JSON.stringify(body)
    })
  } catch {}
}

function buildEventBody(event) {
  return {
    hook_event_name: event.type,
    session_id: event.properties?.sessionID ?? undefined,
    turn_id: event.properties?.messageID ?? undefined,
    tool_name: event.properties?.toolName ?? undefined,
    tool_input: event.properties?.toolInput ?? undefined,
    model: event.properties?.model ?? undefined,
    last_assistant_message: undefined,
    prompt_text: event.properties?.promptText ?? undefined,
    provider_session_id: event.properties?.sessionID ?? undefined,
    message_id: event.properties?.messageID ?? undefined
  }
}

export const StoaStatusPlugin = async ({ client }) => ({
  'tool.execute.before': async ({ event }) => {
    const body = buildEventBody(event)
    await sendEvent(body)
  },
  'tool.execute.after': async ({ event }) => {
    const body = buildEventBody(event)
    await sendEvent(body)
  },
  'session.created': async ({ event }) => {
    const body = buildEventBody(event)
    await sendEvent(body)
  },
  'session.idle': async ({ event }) => {
    const body = buildEventBody(event)
    await enrichWithMessages(client, event, body)
    await sendEvent(body)
  },
  'session.error': async ({ event }) => {
    const body = buildEventBody(event)
    body.error = toFailureReason(event)
    await sendEvent(body)
  },
  'message.updated': async ({ event }) => {
    const body = buildEventBody(event)
    await sendEvent(body)
  },
  'permission.asked': async ({ event }) => {
    const body = buildEventBody(event)
    await sendEvent(body)
  },
  'permission.replied': async ({ event }) => {
    const body = buildEventBody(event)
    const failed = Boolean(event.properties?.error)
    if (failed) {
      body.error = toFailureReason(event)
    }
    await sendEvent(body)
  }
})
`

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
