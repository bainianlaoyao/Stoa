import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'
import { buildSharedHookArtifacts } from './shared-hook-dispatch'

interface ClaudeCommandHook {
  type: 'command'
  command: string
  allowedEnvVars: string[]
  timeout: number
}

interface ClaudeHookMatcher {
  matcher?: string
  hooks: ClaudeCommandHook[]
}

interface ClaudeSettings {
  hooks?: Record<string, unknown>
  [key: string]: unknown
}

interface InstallClaudeHooksOptions {
  projectRoot: string
  managedArtifacts: true
}

const STOA_HOOK_ALLOWED_ENV_VARS = [
  'STOA_HOOK_LEASE_PATH',
  'STOA_HOOK_MANAGED',
  'STOA_HOOK_SESSION_ID',
  'STOA_HOOK_PROJECT_ID',
  'STOA_HOOK_PROVIDER',
  'STOA_HOOK_SPAWN_OWNER_INSTANCE_ID',
  'STOA_HOOK_SPAWN_GENERATION'
] as const

const CLAUDE_HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'Stop',
  'PermissionRequest'
] as const

const CURRENT_ARTIFACTS = [
  '.stoa/hook-contract.json',
  '.stoa/hook-dispatch',
  '.stoa/hook-dispatch.cmd',
  '.stoa/hook-dispatch.mjs'
] as const

const PRESERVED_SETTINGS_ARTIFACTS = [
  '.claude/settings.json',
  '.claude/settings.local.json'
] as const

const LEGACY_ARTIFACTS = [
  '.stoa-managed-sidecar.json',
  '.claude/hooks/stoa-evolver-hook-bridge.cjs',
  '.claude/hooks/stoa-evolver-hook-bridge.cmd',
  '.claude/hooks/stoa-evolver-hook-bridge.sh',
  '.claude/hooks/stoa-hook-user-prompt-submit.cjs',
  '.claude/hooks/node.cmd',
  '.claude/hooks/node',
  '.claude/hooks/evolver-session-start.cjs',
  '.claude/hooks/evolver-signal-detect.cjs',
  '.claude/hooks/evolver-session-end.cjs',
  '.claude/hooks/evolver-session-start.js',
  '.claude/hooks/evolver-signal-detect.js',
  '.claude/hooks/evolver-session-end.js'
] as const

export async function installClaudeHooks(options: InstallClaudeHooksOptions): Promise<void> {
  await ensureClaudeProjectSettings(options.projectRoot)

  const sharedArtifacts = buildSharedHookArtifacts()
  await installManagedSidecar({
    rootDir: options.projectRoot,
    manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
    currentArtifacts: [...CURRENT_ARTIFACTS],
    preserveArtifacts: [...PRESERVED_SETTINGS_ARTIFACTS],
    legacyArtifacts: [...LEGACY_ARTIFACTS],
    writes: [...sharedArtifacts]
  })
}

export async function uninstallClaudeHooks(projectRoot: string): Promise<void> {
  await cleanupClaudeProjectSettings(projectRoot)
  await uninstallManagedSidecar({
    rootDir: projectRoot,
    manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
    preserveArtifacts: [...PRESERVED_SETTINGS_ARTIFACTS],
    legacyArtifacts: [...LEGACY_ARTIFACTS]
  })
}

async function ensureClaudeProjectSettings(projectRoot: string): Promise<void> {
  const settingsPath = join(projectRoot, '.claude', 'settings.json')
  const hasExistingFile = await fileExists(settingsPath)
  if (!hasExistingFile) {
    const next = applyStoaClaudeHooks(null)
    await mkdir(dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return
  }

  const content = await readExistingJsonFile(settingsPath)
  if (content === null) {
    throw new Error(`Claude settings file is not valid JSON: ${settingsPath}`)
  }
  const next = applyStoaClaudeHooks(content)
  if (stableJson(next) === stableJson(content)) {
    return
  }

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

async function cleanupClaudeProjectSettings(projectRoot: string): Promise<void> {
  const settingsPath = join(projectRoot, '.claude', 'settings.json')
  const hasExistingFile = await fileExists(settingsPath)
  if (!hasExistingFile) {
    return
  }

  const content = await readExistingJsonFile(settingsPath)
  if (content === null) {
    throw new Error(`Claude settings file is not valid JSON: ${settingsPath}`)
  }

  const next = removeStoaClaudeHooks(content)
  if (stableJson(next) === stableJson(content)) {
    return
  }

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function applyStoaClaudeHooks(settings: ClaudeSettings | null): ClaudeSettings {
  const next: ClaudeSettings = settings ? deepClone(settings) : {}
  const hooks = normalizeHooksRecord(next.hooks)

  for (const eventName of CLAUDE_HOOK_EVENT_NAMES) {
    const entries = Array.isArray(hooks[eventName]) ? [...hooks[eventName] as unknown[]] : []
    const withoutManaged = entries.filter((entry) => !isManagedClaudeHookEntry(entry, eventName))
    hooks[eventName] = [...withoutManaged, createStoaCommandHook(eventName)]
  }

  next.hooks = hooks
  return next
}

function removeStoaClaudeHooks(settings: ClaudeSettings): ClaudeSettings {
  const next: ClaudeSettings = deepClone(settings)
  const hooks = normalizeHooksRecord(next.hooks)

  for (const eventName of CLAUDE_HOOK_EVENT_NAMES) {
    const entries = Array.isArray(hooks[eventName]) ? [...hooks[eventName] as unknown[]] : []
    const remaining = entries.filter((entry) => !isManagedClaudeHookEntry(entry, eventName))
    if (remaining.length === 0) {
      delete hooks[eventName]
    } else {
      hooks[eventName] = remaining
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete next.hooks
  } else {
    next.hooks = hooks
  }

  return next
}

function createStoaCommandHook(eventName: ClaudeHookEventName): ClaudeHookMatcher {
  return {
    hooks: [{
      type: 'command',
      command: `.stoa/hook-dispatch claude-code ${eventName}`,
      allowedEnvVars: [...STOA_HOOK_ALLOWED_ENV_VARS],
      timeout: 5
    }]
  }
}

type ClaudeHookEventName = (typeof CLAUDE_HOOK_EVENT_NAMES)[number]

function isManagedClaudeHookEntry(value: unknown, eventName: ClaudeHookEventName): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  const hooks = (value as { hooks?: unknown }).hooks
  if (!Array.isArray(hooks) || hooks.length !== 1) {
    return false
  }

  const hook = hooks[0]
  if (!hook || typeof hook !== 'object') {
    return false
  }

  const command = (hook as { command?: unknown }).command
  const type = (hook as { type?: unknown }).type
  const timeout = (hook as { timeout?: unknown }).timeout
  const allowedEnvVars = (hook as { allowedEnvVars?: unknown }).allowedEnvVars

  return type === 'command'
    && command === `.stoa/hook-dispatch claude-code ${eventName}`
    && timeout === 5
    && Array.isArray(allowedEnvVars)
    && allowedEnvVars.length === STOA_HOOK_ALLOWED_ENV_VARS.length
    && STOA_HOOK_ALLOWED_ENV_VARS.every((envVar) => allowedEnvVars.includes(envVar))
}

function normalizeHooksRecord(hooks: unknown): Record<string, unknown> {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return {}
  }
  return { ...(hooks as Record<string, unknown>) }
}

async function readExistingJsonFile(path: string): Promise<ClaudeSettings | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as ClaudeSettings
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8')
    return true
  } catch {
    return false
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}
