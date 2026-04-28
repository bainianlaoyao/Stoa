import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
const STOA_HOOK_ALLOWED_ENV_VARS = [
  'STOA_SESSION_ID',
  'STOA_PROJECT_ID',
  'STOA_SESSION_SECRET'
] as const

const STOA_CLAUDE_HOOK_SCRIPT_NAMES = {
  sessionStart: 'stoa-hook-session-start.cjs',
  sessionStartLauncher: 'stoa-hook-session-start.cmd',
  userPromptSubmit: 'stoa-hook-user-prompt-submit.cjs',
  userPromptSubmitLauncher: 'stoa-hook-user-prompt-submit.cmd'
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

function createStoaHttpHook(context: ProviderCommandContext, matcher?: string): ClaudeHookMatcher {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${context.webhookPort}/hooks/claude-code`,
      headers: {
        'x-stoa-session-id': '${STOA_SESSION_ID}',
        'x-stoa-project-id': '${STOA_PROJECT_ID}',
        'x-stoa-secret': '${STOA_SESSION_SECRET}'
      },
      allowedEnvVars: [...STOA_HOOK_ALLOWED_ENV_VARS],
      timeout: 5
    }]
  }
}

function createClaudeCommandHook(command: string, timeout: number): ClaudeHookMatcher {
  return {
    hooks: [{
      type: 'command',
      command,
      timeout
    }]
  }
}

function buildClaudeHooksForContext(context: ProviderCommandContext): ClaudeHookSettings {
  return {
    hooks: {
      SessionStart: [
        createClaudeCommandHook(buildHookCommand('SessionStart'), 4)
      ],
      UserPromptSubmit: [
        createClaudeCommandHook(buildHookCommand('UserPromptSubmit'), 5)
      ],
      PostToolUse: [
        createStoaHttpHook(context, 'Write')
      ],
      Stop: [
        createStoaHttpHook(context)
      ],
      StopFailure: [
        createStoaHttpHook(context)
      ],
      PermissionRequest: [
        createStoaHttpHook(context)
      ]
    }
  }
}

function buildHookCommand(eventName: 'SessionStart' | 'UserPromptSubmit'): string {
  const scriptFileName = eventName === 'SessionStart'
    ? STOA_CLAUDE_HOOK_SCRIPT_NAMES.sessionStart
    : STOA_CLAUDE_HOOK_SCRIPT_NAMES.userPromptSubmit
  const launcherFileName = eventName === 'SessionStart'
    ? STOA_CLAUDE_HOOK_SCRIPT_NAMES.sessionStartLauncher
    : STOA_CLAUDE_HOOK_SCRIPT_NAMES.userPromptSubmitLauncher

  if (process.platform === 'win32') {
    return `.\\.claude\\hooks\\${launcherFileName}`
  }

  return `"${process.execPath}" "./.claude/hooks/${scriptFileName}"`
}

function buildHookBridgeSource(eventName: 'SessionStart' | 'UserPromptSubmit'): string {
  return [
    'async function main() {',
    "  const sessionId = process.env.STOA_SESSION_ID;",
    "  const projectId = process.env.STOA_PROJECT_ID;",
    "  const sessionSecret = process.env.STOA_SESSION_SECRET;",
    "  const webhookPort = process.env.STOA_WEBHOOK_PORT;",
    '  if (!sessionId || !projectId || !sessionSecret || !webhookPort) {',
    '    return;',
    '  }',
    "  let input = '';",
    "  process.stdin.setEncoding('utf8');",
    '  for await (const chunk of process.stdin) {',
    '    input += chunk;',
    '  }',
    '  let body = {};',
    '  if (input.trim()) {',
    '    try {',
    '      body = JSON.parse(input);',
    '    } catch {',
    '      body = {};',
    '    }',
    '  }',
    `  body = { hook_event_name: ${JSON.stringify(eventName)}, ...body };`,
    "  const response = await fetch(`http://127.0.0.1:${webhookPort}/hooks/claude-code`, {",
    "    method: 'POST',",
    '    headers: {',
    "      'content-type': 'application/json',",
    "      'x-stoa-session-id': sessionId,",
    "      'x-stoa-project-id': projectId,",
    "      'x-stoa-secret': sessionSecret",
    '    },',
    '    body: JSON.stringify(body)',
    '  });',
    "  const text = await response.text();",
    "  if (response.ok && text.trim()) {",
    '    process.stdout.write(text.trim());',
    '  }',
    '}',
    "main().catch(() => { process.exit(0); });",
    ''
  ].join('\n')
}

async function writeHookBridgeScripts(claudeDir: string): Promise<void> {
  const hooksDir = join(claudeDir, 'hooks')
  await mkdir(hooksDir, { recursive: true })

  await writeFile(
    join(hooksDir, STOA_CLAUDE_HOOK_SCRIPT_NAMES.sessionStart),
    buildHookBridgeSource('SessionStart'),
    'utf-8'
  )
  await writeFile(
    join(hooksDir, STOA_CLAUDE_HOOK_SCRIPT_NAMES.userPromptSubmit),
    buildHookBridgeSource('UserPromptSubmit'),
    'utf-8'
  )

  if (process.platform === 'win32') {
    await writeFile(
      join(hooksDir, STOA_CLAUDE_HOOK_SCRIPT_NAMES.sessionStartLauncher),
      buildWindowsNodeLauncherSource({
        runtimePath: process.execPath,
        scriptFileName: STOA_CLAUDE_HOOK_SCRIPT_NAMES.sessionStart
      }),
      'utf-8'
    )
    await writeFile(
      join(hooksDir, STOA_CLAUDE_HOOK_SCRIPT_NAMES.userPromptSubmitLauncher),
      buildWindowsNodeLauncherSource({
        runtimePath: process.execPath,
        scriptFileName: STOA_CLAUDE_HOOK_SCRIPT_NAMES.userPromptSubmit
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
  await writeHookBridgeScripts(claudeDir)

  const settings = buildClaudeHooksForContext(context)
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
