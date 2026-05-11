import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

export type CodexHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'

interface CodexHookDefinition {
  eventName: CodexHookEventName
  matcher?: string
}

const CODEX_HOOK_TIMEOUT_SECONDS = 5

export const CODEX_HOOKS: CodexHookDefinition[] = [
  { eventName: 'SessionStart', matcher: 'startup|resume|clear' },
  { eventName: 'UserPromptSubmit' },
  { eventName: 'PreToolUse', matcher: '.*' },
  { eventName: 'PostToolUse', matcher: '.*' },
  { eventName: 'Stop' }
]

const HOOK_EVENT_KEY_LABELS: Record<CodexHookEventName, string> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop'
}

export function buildCodexProjectConfigToml(_projectRoot: string): string {
  const lines = [
    '[features]',
    'hooks = true',
    ''
  ]

  for (const hook of CODEX_HOOKS) {
    const command = codexHookCommand(hook.eventName)
    lines.push(`[[hooks.${hook.eventName}]]`)
    if (hook.matcher) {
      lines.push(`matcher = ${tomlString(hook.matcher)}`)
    }
    lines.push('')
    lines.push(`[[hooks.${hook.eventName}.hooks]]`)
    lines.push('type = "command"')
    lines.push(`command = ${tomlString(command)}`)
    lines.push(`timeout = ${CODEX_HOOK_TIMEOUT_SECONDS}`)
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export async function buildCodexTrustConfigOverrides(projectRoot: string): Promise<string[]> {
  const projectKey = await codexProjectTrustKey(projectRoot)
  const hookStates = buildCodexHookStates(projectRoot)
  const hooksStateInline = hookStates
    .map((state) => `${tomlString(state.key)} = { trusted_hash = ${tomlString(state.trustedHash)} }`)
    .join(', ')

  return [
    `projects = { ${tomlString(projectKey)} = { trust_level = "trusted" } }`,
    `hooks.state = { ${hooksStateInline} }`
  ]
}

function buildCodexHookStates(projectRoot: string): Array<{ key: string; trustedHash: string }> {
  const configPath = codexProjectConfigPath(projectRoot)
  return CODEX_HOOKS.map((hook) => buildCodexHookState(configPath, hook))
}

function buildCodexHookState(configPath: string, hook: CodexHookDefinition): { key: string; trustedHash: string } {
  const command = codexHookCommand(hook.eventName)
  const matcher = normalizedMatcher(hook)
  const key = `${configPath}:${HOOK_EVENT_KEY_LABELS[hook.eventName]}:0:0`
  const trustedHash = sha256ForCanonicalJson({
    event_name: HOOK_EVENT_KEY_LABELS[hook.eventName],
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'command',
      command,
      timeout: CODEX_HOOK_TIMEOUT_SECONDS,
      async: false
    }]
  })

  return { key, trustedHash }
}

function normalizedMatcher(hook: CodexHookDefinition): string | undefined {
  return hook.matcher?.trim() || undefined
}

function codexHookCommand(eventName: CodexHookEventName): string {
  return process.platform === 'win32'
    ? `.\\.stoa\\hook-dispatch.cmd codex ${eventName}`
    : `.stoa/hook-dispatch codex ${eventName}`
}

function codexProjectConfigPath(projectRoot: string): string {
  return normalizeCodexPath(resolve(projectRoot, '.codex', 'config.toml'))
}

async function codexProjectTrustKey(projectRoot: string): Promise<string> {
  const rawPath = normalizeProjectTrustLookupKey(normalizeCodexPath(resolve(projectRoot)))
  let canonicalPath = rawPath
  try {
    canonicalPath = normalizeProjectTrustLookupKey(normalizeCodexPath(await realpath(resolve(projectRoot))))
  } catch {
    canonicalPath = rawPath
  }

  return canonicalPath
}

function normalizeProjectTrustLookupKey(key: string): string {
  return process.platform === 'win32' ? key.toLowerCase() : key
}

function normalizeCodexPath(path: string): string {
  if (process.platform === 'win32' && path.startsWith('\\\\?\\')) {
    return path.slice(4)
  }
  return path
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function sha256ForCanonicalJson(value: unknown): string {
  const canonical = canonicalizeJson(value)
  const serialized = JSON.stringify(canonical)
  const hash = createHash('sha256').update(serialized).digest('hex')
  return `sha256:${hash}`
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalizeJson(nestedValue)])
    )
  }

  return value
}
