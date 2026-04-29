import { describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeCodeProvider } from './claude-code-provider'

describe('claude-code provider', () => {
  test('builds a start command with seeded session id', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_1',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-123'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual(['--session-id', 'external-123'])
    expect(command.cwd).toBe('D:/alpha')
  })

  test('does not add diagnostic-only settings source args to production sessions', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_settings',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-settings'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128
    })

    expect(command.args).not.toContain('--setting-sources')
    expect(command.args).not.toContain('user,project,local')
  })

  test('appends dangerously-skip-permissions on fresh start when enabled', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_2',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-456'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128,
      claudeDangerouslySkipPermissions: true
    })

    expect(command.args).toEqual([
      '--session-id',
      'external-456',
      '--dangerously-skip-permissions'
    ])
  })

  test('appends dangerously-skip-permissions on resume when enabled', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildResumeCommand({
      session_id: 'session_claude_3',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-789'
    }, 'external-789', {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128,
      claudeDangerouslySkipPermissions: true
    })

    expect(command.args).toEqual([
      '--resume',
      'external-789',
      '--dangerously-skip-permissions'
    ])
  })

  test('uses configured provider path when provided in context', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_4',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-012'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128,
      providerPath: 'C:\\Users\\30280\\AppData\\Roaming\\npm\\claude.cmd'
    })

    expect(command.command).toBe('C:\\Users\\30280\\AppData\\Roaming\\npm\\claude.cmd')
  })

  test('injects STOA_* environment variables into Claude command env', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_env',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-env'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret-env',
      providerPort: 43128
    })

    expect(command.env.STOA_SESSION_ID).toBe('session_claude_env')
    expect(command.env.STOA_PROJECT_ID).toBe('project_alpha')
    expect(command.env.STOA_SESSION_SECRET).toBe('secret-env')
    expect(command.env.STOA_WEBHOOK_PORT).toBe('43127')
  })

  test('installSidecar writes shared Claude hooks config with env-driven headers', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-sidecar-'))
    try {
      const provider = createClaudeCodeProvider()

      await provider.installSidecar({
        session_id: 'session_claude_env',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-env'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const content = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
      const settings = JSON.parse(content) as { hooks: Record<string, unknown> }
      expect(content).toContain('http://127.0.0.1:43127/hooks/claude-code')
      expect(content).toContain('x-stoa-session-id')
      expect(content).toContain('x-stoa-project-id')
      expect(content).toContain('x-stoa-secret')
      expect(content).toContain('STOA_SESSION_ID')
      expect(content).toContain('STOA_PROJECT_ID')
      expect(content).toContain('STOA_SESSION_SECRET')
      expect(Object.keys(settings.hooks).sort()).toEqual([
        'PermissionRequest',
        'PostToolUse',
        'SessionStart',
        'Stop',
        'StopFailure',
        'UserPromptSubmit'
      ])
      const sessionStartHook = readHookEntry(content, 'SessionStart')
      expect(sessionStartHook.type).toBe('command')
      expect(sessionStartHook.command).toBe('node .claude/hooks/stoa-hook-session-start.cjs SessionStart')
      expect(content).not.toContain('stoa-evolver-session-end.cjs')
      expect(content).not.toContain('stoa-evolver-signal-detect.cjs')
      expect(content).not.toContain('session_claude_env')
      expect(content).not.toContain('secret-env')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar uses a command bridge for SessionStart and HTTP for later Claude hooks', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-hook-wrapper-'))
    try {
      const provider = createClaudeCodeProvider()

      await provider.installSidecar({
        session_id: 'session_claude_evolver',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-evolver'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const content = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
      const sessionStartBridge = await readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-hook-session-start.cjs'), 'utf8')
      const sessionStartHook = readHookEntry(content, 'SessionStart')
      const userPromptHook = readHookEntry(content, 'UserPromptSubmit')
      expect(sessionStartHook.type).toBe('command')
      expect(sessionStartHook.command).toBe('node .claude/hooks/stoa-hook-session-start.cjs SessionStart')
      expect(userPromptHook.type).toBe('http')
      expect(userPromptHook.url).toBe('http://127.0.0.1:43127/hooks/claude-code')
      expect(userPromptHook.allowedEnvVars).toEqual([
        'STOA_SESSION_ID',
        'STOA_PROJECT_ID',
        'STOA_SESSION_SECRET'
      ])
      expect(userPromptHook.headers).toEqual({
        'x-stoa-session-id': '${STOA_SESSION_ID}',
        'x-stoa-project-id': '${STOA_PROJECT_ID}',
        'x-stoa-secret': '${STOA_SESSION_SECRET}'
      })
      expect(sessionStartBridge).toContain('process.env.STOA_SESSION_ID')
      expect(sessionStartBridge).toContain('process.env.STOA_PROJECT_ID')
      expect(sessionStartBridge).toContain('process.env.STOA_SESSION_SECRET')
      expect(sessionStartBridge).toContain('process.env.STOA_WEBHOOK_PORT')
      expect(sessionStartBridge).not.toContain('session_claude_evolver')
      expect(sessionStartBridge).not.toContain('project_alpha')
      expect(sessionStartBridge).not.toContain('secret-env')
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-hook-user-prompt-submit.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-session-end.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-signal-detect.cjs'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})

function readHookEntry(settingsJson: string, hookName: string): {
  type?: string
  url?: string
  command?: string
  headers?: Record<string, string>
  allowedEnvVars?: string[]
} {
  const settings = JSON.parse(settingsJson) as {
    hooks?: Record<string, Array<{ hooks?: Array<{
      type?: string
      url?: string
      command?: string
      headers?: Record<string, string>
      allowedEnvVars?: string[]
    }> }>>
  }
  const hook = settings.hooks?.[hookName]?.[0]?.hooks?.[0]
  if (!hook) {
    throw new Error(`${hookName} hook is missing.`)
  }
  return hook
}
