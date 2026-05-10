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

interface ClaudeHookSettings {
  hooks: Record<string, ClaudeHookMatcher[]>
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
const CURRENT_ARTIFACTS = [
  '.claude/settings.json',
  '.stoa/hook-contract.json',
  '.stoa/hook-dispatch',
  '.stoa/hook-dispatch.cmd',
  '.stoa/hook-dispatch.mjs'
] as const
const LEGACY_ARTIFACTS = [
  '.stoa-managed-sidecar.json',
  '.claude/settings.local.json',
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
      SessionStart: [createStoaCommandHook('SessionStart')],
      UserPromptSubmit: [createStoaCommandHook('UserPromptSubmit')],
      PostToolUse: [createStoaCommandHook('PostToolUse')],
      Stop: [createStoaCommandHook('Stop')],
      PermissionRequest: [createStoaCommandHook('PermissionRequest')]
    }
  }

  const sharedArtifacts = buildSharedHookArtifacts()
  await installManagedSidecar({
    rootDir: options.projectRoot,
    manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
    currentArtifacts: [...CURRENT_ARTIFACTS],
    legacyArtifacts: [...LEGACY_ARTIFACTS],
    writes: [
      {
        relativePath: '.claude/settings.json',
        content: `${JSON.stringify(settings, null, 2)}\n`
      },
      ...sharedArtifacts
    ]
  })
}

export async function uninstallClaudeHooks(projectRoot: string): Promise<void> {
  await uninstallManagedSidecar({
    rootDir: projectRoot,
    manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
    legacyArtifacts: [...LEGACY_ARTIFACTS]
  })
}

function createStoaCommandHook(eventName: string, matcher?: string): ClaudeHookMatcher {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'command',
      command: `.stoa/hook-dispatch claude-code ${eventName}`,
      allowedEnvVars: [...STOA_HOOK_ALLOWED_ENV_VARS],
      timeout: 5
    }]
  }
}
