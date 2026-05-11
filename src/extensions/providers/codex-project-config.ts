import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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

export function buildCodexProjectConfigToml(projectRoot: string): string {
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

export async function ensureCodexProjectTrusted(projectRoot: string): Promise<void> {
  const configPath = join(resolveCodexHome(), 'config.toml')
  const projectKey = await codexProjectTrustKey(projectRoot)
  let content = ''

  try {
    content = await readFile(configPath, 'utf8')
  } catch {
    content = ''
  }

  const nextContent = upsertHookStateBlocks(
    upsertTrustedProjectBlock(content, projectKey),
    buildCodexHookStates(projectRoot)
  )
  if (nextContent === content) {
    return
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, nextContent, 'utf8')
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

function resolveCodexHome(): string {
  const configuredHome = process.env.CODEX_HOME?.trim()
  if (configuredHome) {
    return resolve(configuredHome)
  }
  return join(homedir(), '.codex')
}

function upsertTrustedProjectBlock(content: string, projectKey: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const range = findProjectTableRange(lines, projectKey)

  if (!range) {
    const appended = [...lines]
    if (appended.length > 0 && appended[appended.length - 1] !== '') {
      appended.push('')
    }
    appended.push(projectTableHeader(projectKey))
    appended.push('trust_level = "trusted"')
    return `${appended.join('\n').replace(/\n+$/u, '\n')}`
  }

  const block = lines.slice(range.start, range.end)
  const trustLineIndex = block.findIndex((line, index) => index > 0 && /^\s*trust_level\s*=/.test(line))
  if (trustLineIndex >= 0) {
    if (block[trustLineIndex] === 'trust_level = "trusted"') {
      return content
    }
    block[trustLineIndex] = 'trust_level = "trusted"'
  } else {
    block.splice(1, 0, 'trust_level = "trusted"')
  }

  const nextLines = [...lines.slice(0, range.start), ...block, ...lines.slice(range.end)]
  return `${nextLines.join('\n').replace(/\n+$/u, '\n')}`
}

function upsertHookStateBlocks(
  content: string,
  states: Array<{ key: string; trustedHash: string }>
): string {
  return states.reduce((currentContent, state) => upsertHookStateBlock(currentContent, state), content)
}

function upsertHookStateBlock(
  content: string,
  state: { key: string; trustedHash: string }
): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const range = findHookStateTableRange(lines, state.key)

  if (!range) {
    const appended = [...lines]
    if (appended.length > 0 && appended[appended.length - 1] !== '') {
      appended.push('')
    }
    appended.push(hookStateTableHeader(state.key))
    appended.push(`trusted_hash = ${tomlString(state.trustedHash)}`)
    return `${appended.join('\n').replace(/\n+$/u, '\n')}`
  }

  const block = lines.slice(range.start, range.end)
  const trustedHashLineIndex = block.findIndex((line, index) => index > 0 && /^\s*trusted_hash\s*=/.test(line))
  const trustedHashLine = `trusted_hash = ${tomlString(state.trustedHash)}`
  if (trustedHashLineIndex >= 0) {
    if (block[trustedHashLineIndex] === trustedHashLine) {
      return content
    }
    block[trustedHashLineIndex] = trustedHashLine
  } else {
    block.splice(1, 0, trustedHashLine)
  }

  const nextLines = [...lines.slice(0, range.start), ...block, ...lines.slice(range.end)]
  return `${nextLines.join('\n').replace(/\n+$/u, '\n')}`
}

function findProjectTableRange(
  lines: string[],
  projectKey: string
): { start: number; end: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const headerKey = parseProjectTableHeader(lines[index] ?? '')
    if (headerKey === projectKey) {
      let end = index + 1
      while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) {
        end += 1
      }
      return { start: index, end }
    }
  }

  return null
}

function findHookStateTableRange(
  lines: string[],
  hookStateKey: string
): { start: number; end: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const headerKey = parseHookStateTableHeader(lines[index] ?? '')
    if (headerKey === hookStateKey) {
      let end = index + 1
      while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) {
        end += 1
      }
      return { start: index, end }
    }
  }

  return null
}

function parseProjectTableHeader(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('[projects.') || !trimmed.endsWith(']')) {
    return null
  }

  const quotedKey = trimmed.slice('[projects.'.length, -1)
  return parseTomlQuotedString(quotedKey)
}

function parseHookStateTableHeader(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('[hooks.state.') || !trimmed.endsWith(']')) {
    return null
  }

  const quotedKey = trimmed.slice('[hooks.state.'.length, -1)
  return parseTomlQuotedString(quotedKey)
}

function parseTomlQuotedString(value: string): string | null {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }

  return null
}

function projectTableHeader(projectKey: string): string {
  return `[projects.${tomlString(projectKey)}]`
}

function hookStateTableHeader(hookStateKey: string): string {
  return `[hooks.state.${tomlString(hookStateKey)}]`
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
