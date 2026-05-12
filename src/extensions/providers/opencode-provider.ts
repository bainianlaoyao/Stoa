import { join } from 'node:path'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'
import { buildSharedHookArtifacts } from './shared-hook-dispatch'

function opencodeCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'opencode'
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
    command: opencodeCommand(context),
    args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

async function writeSidecarPlugin(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void> {
  const pluginPath = join('.opencode', 'plugins', 'stoa-status.ts')
  const pluginContent = `const hookLeasePath = process.env.STOA_HOOK_LEASE_PATH
const hookManaged = process.env.STOA_HOOK_MANAGED

function hookCommand(eventName) {
  if (process.platform === 'win32') {
    return ['cmd.exe', '/d', '/s', '/c', \`.stoa\\\\hook-dispatch.cmd opencode \${eventName}\`]
  }
  return ['sh', '-c', \`exec ./.stoa/hook-dispatch opencode \${eventName}\`]
}

async function dispatchEvent(eventName, body) {
  if (!hookLeasePath || hookManaged !== '1') {
    return
  }

  try {
    const json = JSON.stringify(body)
    const proc = Bun.spawn(hookCommand(eventName), {
      cwd: '.',
      stdin: new Blob([json + '\\n']),
      stdout: 'ignore',
      stderr: 'ignore',
      env: process.env
    })
    await proc.exited
  } catch {}
}

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
  event: async ({ event }) => {
    const body = buildEventBody(event)
    if (event.type === 'session.idle') {
      await enrichWithMessages(client, event, body)
    }
    if (event.type === 'session.error') {
      body.error = toFailureReason(event)
    }
    if (event.type === 'permission.replied' && event.properties?.error) {
      body.error = toFailureReason(event)
    }
    await dispatchEvent(event.type, body)
  }
})
`

  const sharedArtifacts = buildSharedHookArtifacts()
  await installManagedSidecar({
    rootDir: target.path,
    manifestRelativePath: '.opencode/.stoa-managed-sidecar.json',
    currentArtifacts: [
      pluginPath,
      '.stoa/hook-contract.json',
      '.stoa/hook-dispatch',
      '.stoa/hook-dispatch.cmd',
      '.stoa/hook-dispatch.mjs'
    ],
    writes: [
      {
        relativePath: pluginPath,
        content: pluginContent
      },
      ...sharedArtifacts
    ]
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
