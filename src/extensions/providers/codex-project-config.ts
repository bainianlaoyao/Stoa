import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

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
  return mergeCodexProjectConfigContent('', projectRoot)
}

export async function ensureCodexProjectConfig(projectRoot: string): Promise<void> {
  const configPath = codexProjectConfigPath(projectRoot)
  let content = ''

  try {
    content = await readFile(configPath, 'utf8')
  } catch {
    content = ''
  }

  const nextContent = mergeCodexProjectConfigContent(content, projectRoot)
  if (nextContent === content) {
    return
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, nextContent, 'utf8')
}

export async function cleanupCodexProjectConfig(projectRoot: string): Promise<void> {
  const configPath = codexProjectConfigPath(projectRoot)
  let content = ''

  try {
    content = await readFile(configPath, 'utf8')
  } catch {
    return
  }

  const nextContent = cleanupCodexProjectConfigContent(content)
  if (nextContent === content) {
    return
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, nextContent, 'utf8')
}

export function mergeCodexProjectConfigContent(content: string, projectRoot: string): string {
  const withFeatures = ensureFeaturesHooksEnabled(content)
  let nextContent = withFeatures

  for (const hook of CODEX_HOOKS) {
    nextContent = upsertManagedProjectHookBlock(nextContent, hook)
  }

  return normalizeTrailingNewline(nextContent)
}

export function cleanupCodexProjectConfigContent(content: string): string {
  let nextContent = content
  for (const hook of CODEX_HOOKS) {
    nextContent = removeManagedProjectHookBlock(nextContent, hook)
  }

  return normalizeTrailingNewline(nextContent)
}

function codexHookCommand(eventName: CodexHookEventName): string {
  return process.platform === 'win32'
    ? `.\\.stoa\\hook-dispatch.cmd codex ${eventName}`
    : `.stoa/hook-dispatch codex ${eventName}`
}

function codexProjectConfigPath(projectRoot: string): string {
  return normalizeCodexPath(resolve(projectRoot, '.codex', 'config.toml'))
}

function normalizeCodexPath(path: string): string {
  if (process.platform === 'win32' && path.startsWith('\\\\?\\')) {
    return path.slice(4)
  }
  return path
}

function ensureFeaturesHooksEnabled(content: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const range = findFeaturesTableRange(lines)
  if (!range) {
    const appended = [...lines]
    if (appended.length > 0 && appended[appended.length - 1] !== '') {
      appended.push('')
    }
    appended.push('[features]')
    appended.push('hooks = true')
    return normalizeTrailingNewline(appended.join('\n'))
  }

  const block = lines.slice(range.start, range.end)
  const hooksLineIndex = block.findIndex((line, index) => index > 0 && /^\s*hooks\s*=/.test(line))
  if (hooksLineIndex >= 0) {
    if (/^\s*hooks\s*=\s*true\s*$/u.test(block[hooksLineIndex] ?? '')) {
      return content
    }
    block[hooksLineIndex] = 'hooks = true'
  } else {
    block.splice(1, 0, 'hooks = true')
  }

  const nextLines = [...lines.slice(0, range.start), ...block, ...lines.slice(range.end)]
  return normalizeTrailingNewline(nextLines.join('\n'))
}

function upsertManagedProjectHookBlock(content: string, hook: CodexHookDefinition): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const range = findProjectHookTableRange(lines, hook.eventName, hook.matcher)
  const blockLines = buildProjectHookBlockLines(hook)

  if (!range) {
    const appended = [...lines]
    if (appended.length > 0 && appended[appended.length - 1] !== '') {
      appended.push('')
    }
    appended.push(...blockLines)
    return normalizeTrailingNewline(appended.join('\n'))
  }

  const currentBlock = lines.slice(range.start, range.end)
  if (currentBlock.join('\n') === blockLines.join('\n')) {
    return content
  }

  const nextLines = [...lines.slice(0, range.start), ...blockLines, ...lines.slice(range.end)]
  return normalizeTrailingNewline(nextLines.join('\n'))
}

function removeManagedProjectHookBlock(content: string, hook: CodexHookDefinition): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const range = findProjectHookTableRange(lines, hook.eventName, hook.matcher)
  if (!range) {
    return normalizeTrailingNewline(content)
  }

  const nextLines = [...lines.slice(0, range.start), ...lines.slice(range.end)]
  return normalizeTrailingNewline(trimExtraBlankLines(nextLines).join('\n'))
}

function buildProjectHookBlockLines(hook: CodexHookDefinition): string[] {
  const command = codexHookCommand(hook.eventName)
  const lines = [`[[hooks.${hook.eventName}]]`]
  if (hook.matcher) {
    lines.push(`matcher = ${tomlString(hook.matcher)}`)
  }
  lines.push('')
  lines.push(`[[hooks.${hook.eventName}.hooks]]`)
  lines.push('type = "command"')
  lines.push(`command = ${tomlString(command)}`)
  lines.push(`timeout = ${CODEX_HOOK_TIMEOUT_SECONDS}`)
  lines.push('async = false')
  return lines
}

function findFeaturesTableRange(lines: string[]): { start: number; end: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^\s*\[features\](?:\s+#.*)?\s*$/u.test(line)) {
      let end = index + 1
      while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) {
        end += 1
      }
      return { start: index, end }
    }
  }

  return null
}

function findProjectHookTableRange(
  lines: string[],
  eventName: CodexHookEventName,
  matcher: string | undefined
): { start: number; end: number } | null {
  const header = `[[hooks.${eventName}]]`
  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() !== header) {
      continue
    }

    let end = index + 1
    while (end < lines.length) {
      const line = lines[end] ?? ''
      if (isTopLevelHookHeader(line) || /^\s*\[[^\[]/.test(line)) {
        break
      }
      end += 1
    }

    if (isManagedProjectHookBlock(lines.slice(index, end), eventName, matcher)) {
      return { start: index, end }
    }
  }

  return null
}

function isManagedProjectHookBlock(
  lines: string[],
  eventName: CodexHookEventName,
  matcher: string | undefined
): boolean {
  const command = codexHookCommand(eventName)
  const matcherLine = matcher ? `matcher = ${tomlString(matcher)}` : null
  const eventNameLine = `event_name = ${tomlString(HOOK_EVENT_KEY_LABELS[eventName])}`
  const normalized = new Set(lines.map((line) => line.trim()).filter(Boolean))

  if (!normalized.has(`[[hooks.${eventName}]]`)) {
    return false
  }
  if (matcherLine && !normalized.has(matcherLine)) {
    return false
  }
  if (!matcherLine && [...normalized].some((line) => line.startsWith('matcher = '))) {
    return false
  }
  const eventNameEntries = [...normalized].filter((line) => line.startsWith('event_name = '))
  if (eventNameEntries.length > 0 && !normalized.has(eventNameLine)) {
    return false
  }
  const asyncEntries = [...normalized].filter((line) => line.startsWith('async = '))
  if (asyncEntries.length > 0 && !normalized.has('async = false')) {
    return false
  }

  return normalized.has(`[[hooks.${eventName}.hooks]]`)
    && normalized.has('type = "command"')
    && normalized.has(`command = ${tomlString(command)}`)
    && normalized.has(`timeout = ${CODEX_HOOK_TIMEOUT_SECONDS}`)
}

function isTopLevelHookHeader(line: string): boolean {
  return /^\s*\[\[hooks\.[^.]+\]\]\s*$/u.test(line)
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function trimExtraBlankLines(lines: string[]): string[] {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[0] === '') {
    trimmed.shift()
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
    trimmed.pop()
  }

  const collapsed: string[] = []
  let previousBlank = false
  for (const line of trimmed) {
    const isBlank = line === ''
    if (isBlank && previousBlank) {
      continue
    }
    collapsed.push(line)
    previousBlank = isBlank
  }
  return collapsed
}

function normalizeTrailingNewline(content: string): string {
  if (!content) {
    return ''
  }
  return `${content.replace(/\n+$/u, '')}\n`
}
