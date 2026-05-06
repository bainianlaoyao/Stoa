import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'

interface ClaudeHttpHook {
  type: 'http'
  url: string
  headers: Record<string, string>
  allowedEnvVars: string[]
  timeout: number
}

interface ClaudeHookMatcher {
  matcher?: string
  hooks: ClaudeHttpHook[]
}

interface ClaudeHookSettings {
  hooks: Record<string, ClaudeHookMatcher[]>
}

interface InstallClaudeHooksOptions {
  projectRoot: string
  webhookPort: number
}

const STOA_HOOK_ALLOWED_ENV_VARS = [
  'STOA_SESSION_ID',
  'STOA_PROJECT_ID',
  'STOA_SESSION_SECRET'
] as const
const CURRENT_ARTIFACTS = [
  '.claude/settings.json'
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
  const settings: ClaudeHookSettings = {
    hooks: {
      SessionStart: [createStoaHttpHook(options.webhookPort)],
      UserPromptSubmit: [createStoaHttpHook(options.webhookPort)],
      PostToolUse: [createStoaHttpHook(options.webhookPort)],
      Stop: [createStoaHttpHook(options.webhookPort)],
      PermissionRequest: [createStoaHttpHook(options.webhookPort)]
    }
  }

  await installManagedSidecar({
    rootDir: options.projectRoot,
    manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
    currentArtifacts: [...CURRENT_ARTIFACTS],
    legacyArtifacts: [...LEGACY_ARTIFACTS],
    writes: [{
      relativePath: '.claude/settings.json',
      content: `${JSON.stringify(settings, null, 2)}\n`
    }]
  })
}

export async function uninstallClaudeHooks(projectRoot: string): Promise<void> {
  await uninstallManagedSidecar({
    rootDir: projectRoot,
    manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
    legacyArtifacts: [...LEGACY_ARTIFACTS]
  })
}

function createStoaHttpHook(webhookPort: number, matcher?: string): ClaudeHookMatcher {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${webhookPort}/hooks/claude-code`,
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
