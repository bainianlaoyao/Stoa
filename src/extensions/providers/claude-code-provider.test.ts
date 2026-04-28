import { describe, expect, test } from 'vitest'
import { exec } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
        'PreToolUse',
        'SessionStart',
        'Stop',
        'StopFailure',
        'UserPromptSubmit'
      ])
      const sessionStartCommand = readSessionStartHookCommand(content)
      expect(sessionStartCommand).toContain(process.platform === 'win32'
        ? 'stoa-evolver-session-start.cmd'
        : 'stoa-evolver-session-start.cjs')
      expect(sessionStartCommand.startsWith('node ')).toBe(false)
      expect(content).not.toContain('stoa-evolver-session-end.cjs')
      expect(content).not.toContain('stoa-evolver-signal-detect.cjs')
      expect(content).not.toContain('session_claude_env')
      expect(content).not.toContain('secret-env')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar writes Claude-local Evolver wrapper scripts', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-evolver-wrapper-'))
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

      const startWrapper = await readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-session-start.cjs'), 'utf8')
      expect(startWrapper).toContain('EVOLVER_ROOT')
      expect(startWrapper).toContain('evolver-session-start.js')
      expect(startWrapper).toContain('research/upstreams/evolver')
      if (process.platform === 'win32') {
        const launcher = await readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-session-start.cmd'), 'utf8')
        expect(launcher).toContain(process.execPath)
        expect(launcher).toContain('ELECTRON_RUN_AS_NODE')
      }
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-session-end.cjs'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-signal-detect.cjs'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('generated Claude Evolver session-start wrapper consumes MEMORY_GRAPH_PATH', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-evolver-run-'))
    try {
      const provider = createClaudeCodeProvider()

      await provider.installSidecar({
        session_id: 'session_claude_evolver_run',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-evolver-run'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const memoryGraphPath = join(workspaceDir, 'memory_graph.jsonl')
      await writeFile(memoryGraphPath, [
        JSON.stringify({
          timestamp: '2026-04-27T00:00:00.000Z',
          signals: ['tooling_preference'],
          outcome: {
            status: 'success',
            score: 0.9,
            note: 'Use uv instead of pip for Python package management.'
          }
        })
      ].join('\n') + '\n', 'utf8')

      const stdout = await runSessionStartHookFromSettings(workspaceDir, {
        ...process.env,
        MEMORY_GRAPH_PATH: memoryGraphPath
      })

      const parsed = JSON.parse(stdout) as { agent_message?: string; additionalContext?: string }
      expect(parsed.agent_message).toContain('[Evolution Memory]')
      expect(parsed.additionalContext).toContain('Use successful approaches.')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('generated Claude Evolver session-start wrapper auto-loads published Stoa context file', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-evolver-auto-context-'))
    try {
      const provider = createClaudeCodeProvider()

      await provider.installSidecar({
        session_id: 'session_claude_evolver_auto_context',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-evolver-auto-context'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const generatedDir = join(workspaceDir, '.stoa', 'generated', 'evolver-context')
      const fakeEvolverRoot = join(workspaceDir, 'fake-evolver-root')
      await mkdir(generatedDir, { recursive: true })
      await mkdir(fakeEvolverRoot, { recursive: true })
      await writeFile(join(fakeEvolverRoot, 'package.json'), JSON.stringify({ name: '@evomap/evolver' }) + '\n', 'utf8')
      await writeFile(join(generatedDir, 'claude-code.jsonl'), [
        JSON.stringify({
          timestamp: '2026-04-27T00:00:00.000Z',
          signals: ['tooling_preference'],
          outcome: {
            status: 'success',
            score: 0.9,
            note: 'Use uv instead of pip for Python package management.'
          }
        })
      ].join('\n') + '\n', 'utf8')

      const stdout = await runSessionStartHookFromSettings(workspaceDir, {
        ...process.env,
        EVOLVER_ROOT: fakeEvolverRoot
      })

      const parsed = JSON.parse(stdout) as { agent_message?: string; additionalContext?: string }
      expect(parsed.agent_message).toContain('Use uv instead of pip')
      expect(parsed.additionalContext).toContain('Use successful approaches.')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})

function readSessionStartHookCommand(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
  }
  const command = settings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
  if (!command) {
    throw new Error('SessionStart hook command is missing.')
  }
  return command
}

async function runSessionStartHookFromSettings(
  workspaceDir: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const settingsJson = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
  const command = readSessionStartHookCommand(settingsJson)
  return await new Promise<string>((resolve, reject) => {
    exec(
      command,
      {
        cwd: workspaceDir,
        env,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        resolve(stdout)
      }
    )
  })
}
