import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
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

  test('installSidecar writes shared Claude HTTP hooks without embedding secrets', async () => {
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

      const content = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      const settings = JSON.parse(content) as { hooks: Record<string, unknown> }
      expect(Object.keys(settings.hooks).sort()).toEqual([
        'PermissionRequest',
        'PostToolUse',
        'SessionStart',
        'Stop',
        'UserPromptSubmit'
      ])
      expect(readHttpHook(content, 'SessionStart')).toMatchObject({
        type: 'http',
        url: 'http://127.0.0.1:43127/hooks/claude-code',
        timeout: 5,
        headers: {
          'x-stoa-session-id': '${STOA_SESSION_ID}',
          'x-stoa-project-id': '${STOA_PROJECT_ID}',
          'x-stoa-secret': '${STOA_SESSION_SECRET}'
        },
        allowedEnvVars: ['STOA_SESSION_ID', 'STOA_PROJECT_ID', 'STOA_SESSION_SECRET']
      })
      expect(readHttpHook(content, 'UserPromptSubmit')).toMatchObject({
        type: 'http',
        url: 'http://127.0.0.1:43127/hooks/claude-code',
        timeout: 5
      })
      expect(content).not.toContain('secret-env')
      expect(content).not.toContain('session_claude_env')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar removes legacy Evolver wrapper artifacts and writes provider-scoped manifest', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-cleanup-'))
    try {
      await mkdir(join(workspaceDir, '.claude', 'hooks'), { recursive: true })
      await writeFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cjs'), 'legacy\n', 'utf8')
      await writeFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cmd'), 'legacy\n', 'utf8')
      await writeFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-start.cjs'), 'legacy\n', 'utf8')
      await writeFile(join(workspaceDir, '.claude', 'hooks', 'evolver-signal-detect.cjs'), 'legacy\n', 'utf8')
      await writeFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-end.cjs'), 'legacy\n', 'utf8')
      await writeFile(join(workspaceDir, '.stoa-managed-sidecar.json'), '{}\n', 'utf8')

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_cleanup',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-cleanup'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cmd'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-start.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-signal-detect.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-end.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.stoa-managed-sidecar.json'), 'utf8')).rejects.toThrow()

      const manifest = JSON.parse(await readFile(join(workspaceDir, '.claude', '.stoa-managed-sidecar.json'), 'utf8')) as {
        artifactPaths: string[]
      }
      expect(manifest.artifactPaths).toEqual(['.claude/settings.json'])
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar removes legacy settings.local.json to avoid duplicate Stop hooks', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-local-settings-'))
    try {
      await mkdir(join(workspaceDir, '.claude'), { recursive: true })
      await writeFile(
        join(workspaceDir, '.claude', 'settings.local.json'),
        JSON.stringify({
          hooks: {
            Stop: [{
              hooks: [{
                type: 'http',
                url: 'http://127.0.0.1:54198/hooks/claude-code'
              }]
            }]
          }
        }, null, 2),
        'utf8'
      )

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_cleanup_local',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-cleanup-local'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      await expect(readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')).rejects.toThrow()
      const content = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      expect(readHttpHook(content, 'Stop')).toMatchObject({
        type: 'http',
        url: 'http://127.0.0.1:43127/hooks/claude-code'
      })
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})

function readHttpHook(settingsJson: string, eventName: string): {
  type?: string
  url?: string
  timeout?: number
  headers?: Record<string, string>
  allowedEnvVars?: string[]
} {
  const settings = JSON.parse(settingsJson) as {
    hooks?: Record<string, Array<{ hooks?: Array<Record<string, unknown>> }>>
  }
  const hook = settings.hooks?.[eventName]?.[0]?.hooks?.[0]
  if (!hook || typeof hook !== 'object') {
    throw new Error(`${eventName} HTTP hook is missing.`)
  }

  return hook as {
    type?: string
    url?: string
    timeout?: number
    headers?: Record<string, string>
    allowedEnvVars?: string[]
  }
}
