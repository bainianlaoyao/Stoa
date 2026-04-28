import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveBundledEvolverRepoRoot } from '@core/memory/bundled-evolver'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

const CLAUDE_HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'PermissionRequest'] as const
const STOA_HOOK_ALLOWED_ENV_VARS = [
  'STOA_SESSION_ID',
  'STOA_PROJECT_ID',
  'STOA_SESSION_SECRET'
] as const
const EVOLVER_HOOK_SCRIPT_NAMES = {
  sessionStart: 'stoa-evolver-session-start.cjs',
  sessionStartLauncher: 'stoa-evolver-session-start.cmd'
} as const

interface ClaudeCommandHook {
  type: 'command'
  command: string
  timeout: number
}

interface ClaudeHttpHook {
  type: 'http'
  url: string
  headers: Record<string, string>
  allowedEnvVars: string[]
  timeout: number
}

interface ClaudeHookMatcher {
  matcher?: string
  hooks: Array<ClaudeCommandHook | ClaudeHttpHook>
}

interface ClaudeHookSettings {
  hooks: Record<string, ClaudeHookMatcher[]>
}

function claudeCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'claude'
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
    command: claudeCommand(context),
    args: context.claudeDangerouslySkipPermissions === true
      ? [...args, '--dangerously-skip-permissions']
      : args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

function createStoaHttpHook(context: ProviderCommandContext): ClaudeHookMatcher {
  return {
    matcher: '*',
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${context.webhookPort}/hooks/claude-code`,
      headers: {
        'x-stoa-session-id': '${STOA_SESSION_ID}',
        'x-stoa-project-id': '${STOA_PROJECT_ID}',
        'x-stoa-secret': '${STOA_SESSION_SECRET}'
      },
      // Claude already posts the raw hook payload; Stoa normalizes evidence on receipt.
      allowedEnvVars: [...STOA_HOOK_ALLOWED_ENV_VARS],
      timeout: 5
    }]
  }
}

function createEvolverCommandHook(
  command: string,
  timeout: number,
  matcher?: string
): ClaudeHookMatcher {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'command',
      command,
      timeout
    }]
  }
}

function buildClaudeHooks(
  context: ProviderCommandContext,
  includeSessionStartHook: boolean
): ClaudeHookSettings {
  const stoaHttpHook = createStoaHttpHook(context)
  const hooks: ClaudeHookSettings['hooks'] = Object.fromEntries(
    CLAUDE_HOOK_EVENTS.map((eventName) => [eventName, [stoaHttpHook]])
  )

  if (!includeSessionStartHook) {
    return { hooks }
  }

  hooks.SessionStart = [
    createEvolverCommandHook(
      buildSessionStartHookCommand(),
      3
    )
  ]

  return { hooks }
}

function buildSessionStartHookCommand(): string {
  if (process.platform === 'win32') {
    return `.\\.claude\\hooks\\${EVOLVER_HOOK_SCRIPT_NAMES.sessionStartLauncher}`
  }

  return `"${process.execPath}" "./.claude/hooks/${EVOLVER_HOOK_SCRIPT_NAMES.sessionStart}"`
}

function buildEvolverWrapperSource(
  evolverRepoRoot: string,
  scriptFileName: string,
  options?: {
    publishedContextTarget?: 'claude-code'
  }
): string {
  const normalizedRepoRoot = evolverRepoRoot.replace(/\\/g, '/')
  const scriptPath = join(normalizedRepoRoot, 'src', 'adapters', 'scripts', scriptFileName).replace(/\\/g, '/')
  const publishedContextPrelude = options?.publishedContextTarget
    ? [
      "const { existsSync } = require('node:fs');",
      "const { join } = require('node:path');",
      `const publishedContextPath = join(process.cwd(), '.stoa', 'generated', 'evolver-context', ${JSON.stringify(`${options.publishedContextTarget}.jsonl`)});`,
      'if (!process.env.MEMORY_GRAPH_PATH && existsSync(publishedContextPath)) {',
      '  process.env.MEMORY_GRAPH_PATH = publishedContextPath;',
      '}'
    ].join('\n')
    : null

  return [
    publishedContextPrelude,
    `process.env.EVOLVER_ROOT = process.env.EVOLVER_ROOT || ${JSON.stringify(normalizedRepoRoot)};`,
    `require(${JSON.stringify(scriptPath)});`,
    ''
  ].filter((line): line is string => !!line).join('\n')
}

async function writeEvolverHookWrappers(
  claudeDir: string,
  evolverRepoRoot: string
): Promise<void> {
  const hooksDir = join(claudeDir, 'hooks')
  await mkdir(hooksDir, { recursive: true })

  await writeFile(
    join(hooksDir, EVOLVER_HOOK_SCRIPT_NAMES.sessionStart),
    buildEvolverWrapperSource(evolverRepoRoot, 'evolver-session-start.js', {
      publishedContextTarget: 'claude-code'
    }),
    'utf-8'
  )

  if (process.platform === 'win32') {
    await writeFile(
      join(hooksDir, EVOLVER_HOOK_SCRIPT_NAMES.sessionStartLauncher),
      buildWindowsNodeLauncherSource({
        runtimePath: process.execPath,
        scriptFileName: EVOLVER_HOOK_SCRIPT_NAMES.sessionStart
      }),
      'utf-8'
    )
  }
}

function buildWindowsNodeLauncherSource(input: {
  runtimePath: string
  scriptFileName: string
}): string {
  return [
    '@echo off',
    'setlocal',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${input.runtimePath}" "%~dp0${input.scriptFileName}"`,
    ''
  ].join('\r\n')
}

async function writeSharedClaudeHooks(target: ProviderRuntimeTarget, context: ProviderCommandContext): Promise<void> {
  const claudeDir = join(target.path, '.claude')
  await mkdir(claudeDir, { recursive: true })

  const evolverRepoRoot = await resolveBundledEvolverRepoRoot().catch(() => null)
  if (evolverRepoRoot !== null) {
    await writeEvolverHookWrappers(claudeDir, evolverRepoRoot)
  }

  const settings = buildClaudeHooks(context, evolverRepoRoot !== null)
  await writeFile(
    join(claudeDir, 'settings.local.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf-8'
  )
}

function requireExternalSessionId(target: ProviderRuntimeTarget): string {
  if (!target.external_session_id) {
    throw new Error('claude-code sessions require an external_session_id')
  }

  return target.external_session_id
}

export function createClaudeCodeProvider(): ProviderDefinition {
  return {
    providerId: 'claude-code',
    supportsResume() {
      return true
    },
    supportsStructuredEvents() {
      return true
    },
    async buildStartCommand(target, context) {
      return createCommand(target, context, ['--session-id', requireExternalSessionId(target)])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['--resume', externalSessionId])
    },
    resolveSessionId(_event: CanonicalSessionEvent) {
      return null
    },
    async installSidecar(target, context) {
      await writeSharedClaudeHooks(target, context)
    },
    async discoverExternalSessionIdAfterStart(target) {
      return target.external_session_id ?? null
    }
  }
}

export const claudeCodeProvider = createClaudeCodeProvider()
