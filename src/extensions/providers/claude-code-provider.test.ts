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

  test('injects lease-driven hook environment variables into Claude command env', async () => {
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
      providerPort: 43128,
      hookLeasePath: 'D:/runtime/hook-leases/session_claude_env.json',
      hookManaged: true,
      hookSessionId: 'session_claude_env',
      hookProjectId: 'project_alpha',
      hookProvider: 'claude-code',
      hookSpawnOwnerInstanceId: 'instance-a',
      hookSpawnGeneration: 7
    })

    expect(command.env.STOA_HOOK_LEASE_PATH).toBe('D:/runtime/hook-leases/session_claude_env.json')
    expect(command.env.STOA_HOOK_MANAGED).toBe('1')
    expect(command.env.STOA_HOOK_SESSION_ID).toBe('session_claude_env')
    expect(command.env.STOA_HOOK_PROJECT_ID).toBe('project_alpha')
    expect(command.env.STOA_HOOK_PROVIDER).toBe('claude-code')
    expect(command.env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID).toBe('instance-a')
    expect(command.env.STOA_HOOK_SPAWN_GENERATION).toBe('7')
    expect(command.env.STOA_PROVIDER_PORT).toBe('43128')
    expect(command.env.STOA_SESSION_SECRET).toBeUndefined()
    expect(command.env.STOA_WEBHOOK_PORT).toBeUndefined()
  })

  test('installSidecar writes shared Claude command hooks through the stable dispatcher launcher', async () => {
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
      expect(readCommandHook(content, 'SessionStart')).toMatchObject({
        type: 'command',
        command: '.stoa/hook-dispatch claude-code SessionStart',
        timeout: 5,
        allowedEnvVars: [
          'STOA_HOOK_LEASE_PATH',
          'STOA_HOOK_MANAGED',
          'STOA_HOOK_SESSION_ID',
          'STOA_HOOK_PROJECT_ID',
          'STOA_HOOK_PROVIDER',
          'STOA_HOOK_SPAWN_OWNER_INSTANCE_ID',
          'STOA_HOOK_SPAWN_GENERATION'
        ]
      })
      expect(readCommandHook(content, 'UserPromptSubmit')).toMatchObject({
        type: 'command',
        command: '.stoa/hook-dispatch claude-code UserPromptSubmit',
        timeout: 5
      })
      expect(content).not.toContain('secret-env')
      expect(content).not.toContain('session_claude_env')
      expect(content).not.toContain('http://127.0.0.1:')
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
      expect(manifest.artifactPaths).toEqual([
        '.stoa/hook-contract.json',
        '.stoa/hook-dispatch',
        '.stoa/hook-dispatch.cmd',
        '.stoa/hook-dispatch.mjs'
      ])
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar preserves user local settings while project settings provide Stoa Stop hooks', async () => {
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

      await expect(readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')).resolves.toContain(
        '"url": "http://127.0.0.1:54198/hooks/claude-code"'
      )
      const content = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      expect(readCommandHook(content, 'Stop')).toMatchObject({
        type: 'command',
        command: '.stoa/hook-dispatch claude-code Stop'
      })
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar preserves existing project settings while adding Stoa hooks', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-existing-settings-'))
    try {
      await mkdir(join(workspaceDir, '.claude'), { recursive: true })
      await writeFile(
        join(workspaceDir, '.claude', 'settings.json'),
        JSON.stringify({
          permissions: {
            allow: ['Bash(git status)']
          },
          hooks: {
            SessionStart: [{
              hooks: [{
                type: 'command',
                command: 'user-session-start'
              }]
            }]
          }
        }, null, 2) + '\n',
        'utf8'
      )

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_preserve',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-preserve'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const content = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      expect(content).toContain('"permissions"')
      expect(content).toContain('Bash(git status)')
      expect(content).toContain('"command": "user-session-start"')
      expect(content).toContain('.stoa/hook-dispatch claude-code SessionStart')
      expect(content).toContain('.stoa/hook-dispatch claude-code Stop')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar preserves existing local settings file', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-existing-local-settings-'))
    try {
      await mkdir(join(workspaceDir, '.claude'), { recursive: true })
      await writeFile(
        join(workspaceDir, '.claude', 'settings.local.json'),
        JSON.stringify({
          env: {
            DEBUG: '1'
          }
        }, null, 2) + '\n',
        'utf8'
      )

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_local_preserve',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-local-preserve'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const localContent = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
      expect(localContent).toContain('"DEBUG": "1"')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('uninstallSidecar removes only Stoa hooks and keeps user Claude settings files', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-uninstall-settings-'))
    try {
      await mkdir(join(workspaceDir, '.claude'), { recursive: true })
      await writeFile(
        join(workspaceDir, '.claude', 'settings.json'),
        JSON.stringify({
          permissions: {
            allow: ['Bash(git status)']
          }
        }, null, 2) + '\n',
        'utf8'
      )
      await writeFile(
        join(workspaceDir, '.claude', 'settings.local.json'),
        JSON.stringify({
          env: {
            DEBUG: '1'
          }
        }, null, 2) + '\n',
        'utf8'
      )

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_uninstall_preserve',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-uninstall-preserve'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      await provider.uninstallSidecar?.(workspaceDir)

      const projectContent = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      const localContent = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')

      expect(projectContent).toContain('"permissions"')
      expect(projectContent).toContain('Bash(git status)')
      expect(projectContent).not.toContain('.stoa/hook-dispatch claude-code SessionStart')
      expect(projectContent).not.toContain('.stoa/hook-dispatch claude-code Stop')
      expect(localContent).toContain('"DEBUG": "1"')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar refuses to overwrite malformed project settings JSON', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-malformed-settings-'))
    try {
      await mkdir(join(workspaceDir, '.claude'), { recursive: true })
      await writeFile(
        join(workspaceDir, '.claude', 'settings.json'),
        '{ invalid json }\n',
        'utf8'
      )

      const provider = createClaudeCodeProvider()
      await expect(provider.installSidecar({
        session_id: 'session_claude_bad_json',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-bad-json'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })).rejects.toThrow()

      const content = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      expect(content).toBe('{ invalid json }\n')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})

function readCommandHook(settingsJson: string, eventName: string): {
  type?: string
  command?: string
  timeout?: number
  timeout_sec?: number
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
    command?: string
    timeout?: number
    timeout_sec?: number
    allowedEnvVars?: string[]
  }
}
