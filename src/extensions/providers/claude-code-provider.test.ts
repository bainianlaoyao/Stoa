import { describe, expect, test } from 'vitest'
import { exec, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

  test('installSidecar writes Claude hooks config that wraps upstream Evolver commands and preserves Stoa HTTP hooks', async () => {
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
      const sessionStartCommand = readSessionStartHookCommand(content)
      expect(sessionStartCommand).toContain(process.platform === 'win32'
        ? 'stoa-evolver-hook-bridge.cmd'
        : 'stoa-evolver-hook-bridge.sh')
      expect(sessionStartCommand).toContain('$CLAUDE_PROJECT_DIR/.claude/hooks/')
      expect(sessionStartCommand).toContain('SessionStart')
      expect(readWrappedUpstreamCommand(sessionStartCommand)).toContain('evolver-session-start.cjs')
      expect(readWrappedRepoRoot(sessionStartCommand)).toContain(join('research', 'upstreams', 'evolver'))
      expect(readWrappedUpstreamCommand(readHookCommand(content, 'PostToolUse'))).toContain('evolver-signal-detect.cjs')
      expect(readWrappedUpstreamCommand(readHookCommand(content, 'Stop'))).toContain('evolver-session-end.cjs')
      expect(readWrappedUpstreamCommand(readHookCommand(content, 'StopFailure'))).toContain('evolver-session-end.cjs')
      if (process.platform === 'win32') {
        expect(sessionStartCommand.startsWith('"')).toBe(true)
      }
      expect(sessionStartCommand.startsWith('node ')).toBe(false)
      expect(readHttpHook(content, 'UserPromptSubmit')).toMatchObject({
        type: 'http',
        url: 'http://127.0.0.1:43127/hooks/claude-code',
        timeout: 5,
        allowedEnvVars: ['STOA_SESSION_ID', 'STOA_PROJECT_ID', 'STOA_SESSION_SECRET'],
        headers: {
          'x-stoa-session-id': '${STOA_SESSION_ID}',
          'x-stoa-project-id': '${STOA_PROJECT_ID}',
          'x-stoa-secret': '${STOA_SESSION_SECRET}'
        }
      })
      expect(content).not.toContain('session_claude_env')
      expect(content).not.toContain('secret-env')
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('installSidecar writes the shared wrapper plus the real upstream Evolver hook scripts', async () => {
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

      const startWrapper = await readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cjs'), 'utf8')
      expect(startWrapper).toContain("return process.env.CLAUDE_PROJECT_DIR || process.cwd()")
      expect(startWrapper).toContain("const hookEventName = process.argv[2]")
      expect(startWrapper).toContain("const encodedUpstreamCommand = process.argv[3]")
      expect(startWrapper).toContain("const encodedRepoRoot = process.argv[4]")
      expect(startWrapper).toContain('/hooks/claude-code')
      expect(startWrapper).toContain('/memory-notifications')
      if (process.platform === 'win32') {
        const launcher = await readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cmd'), 'utf8')
        expect(launcher).toContain(process.execPath)
        expect(launcher).toContain('ELECTRON_RUN_AS_NODE')
        const nodeShim = await readFile(join(workspaceDir, '.claude', 'hooks', 'node.cmd'), 'utf8')
        expect(nodeShim).toContain(process.execPath)
        expect(nodeShim).toContain('ELECTRON_RUN_AS_NODE')
      } else {
        const launcher = await readFile(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.sh'), 'utf8')
        expect(launcher).toContain(process.execPath)
        expect(launcher).toContain('ELECTRON_RUN_AS_NODE')
        const nodeShim = await readFile(join(workspaceDir, '.claude', 'hooks', 'node'), 'utf8')
        expect(nodeShim).toContain(process.execPath)
        expect(nodeShim).toContain('ELECTRON_RUN_AS_NODE')
      }
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-start.cjs'), 'utf8')).resolves.toEqual(expect.any(String))
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-signal-detect.cjs'), 'utf8')).resolves.toEqual(expect.any(String))
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-end.cjs'), 'utf8')).resolves.toEqual(expect.any(String))
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('generated Claude SessionStart wrapper returns real upstream recall output and also notifies Stoa', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-hook-run-'))
    const received: Array<Record<string, unknown>> = []
    const memoryNotifications: Array<Record<string, unknown>> = []
    const server = await createHookResponseServer('session_claude_evolver_run', 'secret-env', received, memoryNotifications, {
      accepted: true
    })
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
        webhookPort: server.port,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const memoryGraphPath = join(workspaceDir, 'memory-graph.jsonl')
      await writeFile(
        memoryGraphPath,
        `${JSON.stringify({
          timestamp: '2026-04-30T00:00:00.000Z',
          signals: ['test_failure'],
          outcome: {
            status: 'failed',
            score: 0.3,
            note: 'Use uv instead of pip for Python package management.'
          }
        })}\n`,
        'utf8'
      )

      const stdout = await runSessionStartHookFromSettings(workspaceDir, {
        ...process.env,
        MEMORY_GRAPH_PATH: memoryGraphPath,
        PATH: '',
        STOA_SESSION_ID: 'session_claude_evolver_run',
        STOA_PROJECT_ID: 'project_alpha',
        STOA_SESSION_SECRET: 'secret-env',
        STOA_WEBHOOK_PORT: String(server.port)
      })

      const parsedOutput = parseHookJsonOutput(stdout)
      expect(parsedOutput).toMatchObject({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: expect.stringContaining('Use uv instead of pip')
        }
      })
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        hook_event_name: 'SessionStart'
      })
      expect(memoryNotifications).toContainEqual(expect.objectContaining({
        kind: 'recall',
        status: 'success',
        title: 'Memory recalled'
      }))
    } finally {
      await server.stop()
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('generated Claude PostToolUse wrapper returns real upstream signal output and also notifies Stoa', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-post-tool-'))
    const received: Array<Record<string, unknown>> = []
    const memoryNotifications: Array<Record<string, unknown>> = []
    const server = await createHookResponseServer('session_claude_post_tool', 'secret-env', received, memoryNotifications, {
      accepted: true
    })
    try {
      const provider = createClaudeCodeProvider()

      await provider.installSidecar({
        session_id: 'session_claude_post_tool',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-post-tool'
      }, {
        webhookPort: server.port,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const stdout = await runHookFromSettings('PostToolUse', workspaceDir, {
        ...process.env,
        STOA_SESSION_ID: 'session_claude_post_tool',
        STOA_PROJECT_ID: 'project_alpha',
        STOA_SESSION_SECRET: 'secret-env',
        STOA_WEBHOOK_PORT: String(server.port)
      }, {
        tool_name: 'Write',
        path: join(workspaceDir, 'note.txt'),
        content: 'error: test failed'
      })

      const parsedOutput = parseHookJsonOutput(stdout)
      expect(parsedOutput).toMatchObject({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: expect.stringContaining('test_failure')
        }
      })
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write'
      })
      expect(memoryNotifications).toHaveLength(0)
    } finally {
      await server.stop()
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  test('generated Claude Stop wrapper records real git diff signals through the wrapped upstream shell', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-stop-hook-'))
    const received: Array<Record<string, unknown>> = []
    const memoryNotifications: Array<Record<string, unknown>> = []
    const server = await createHookResponseServer('session_claude_stop_hook', 'secret-env', received, memoryNotifications, {
      accepted: true
    })
    try {
      await writeFile(join(workspaceDir, 'memory-note.md'), 'baseline\n', 'utf8')
      runChecked('git', ['init'], workspaceDir)
      runChecked('git', ['config', 'user.name', 'Stoa Test'], workspaceDir)
      runChecked('git', ['config', 'user.email', 'stoa@example.com'], workspaceDir)
      runChecked('git', ['add', '.'], workspaceDir)
      runChecked('git', ['commit', '-m', 'init'], workspaceDir)
      await writeFile(join(workspaceDir, 'memory-note.md'), 'test failed: use uv instead of pip for Python package management.\n', 'utf8')

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_stop_hook',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-stop-hook'
      }, {
        webhookPort: server.port,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const memoryGraphPath = join(workspaceDir, 'memory-graph.jsonl')
      await writeFile(memoryGraphPath, '', 'utf8')
      const stdout = await runHookFromSettings('Stop', workspaceDir, {
        ...process.env,
        MEMORY_GRAPH_PATH: memoryGraphPath,
        STOA_SESSION_ID: 'session_claude_stop_hook',
        STOA_PROJECT_ID: 'project_alpha',
        STOA_SESSION_SECRET: 'secret-env',
        STOA_WEBHOOK_PORT: String(server.port)
      }, {})

      const entries = (await readFile(memoryGraphPath, 'utf8'))
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { signals?: string[]; outcome?: { status?: string } })

      expect(stdout).toContain('Signals: [log_error, test_failure]')
      expect(entries.at(-1)).toMatchObject({
        signals: ['log_error', 'test_failure'],
        outcome: {
          status: 'failed'
        }
      })
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        hook_event_name: 'Stop'
      })
      expect(memoryNotifications).toContainEqual(expect.objectContaining({
        kind: 'solidify',
        status: 'success'
      }))
    } finally {
      await server.stop()
      await rm(workspaceDir, { recursive: true, force: true })
    }
  }, 15000)

  test('generated Claude hooks still execute inside type-module workspaces', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-claude-type-module-'))
    const received: Array<Record<string, unknown>> = []
    const memoryNotifications: Array<Record<string, unknown>> = []
    const server = await createHookResponseServer('session_claude_type_module', 'secret-env', received, memoryNotifications, {
      accepted: true
    })
    try {
      await writeFile(join(workspaceDir, 'package.json'), JSON.stringify({
        name: 'type-module-hook-fixture',
        private: true,
        type: 'module'
      }, null, 2) + '\n', 'utf8')

      const provider = createClaudeCodeProvider()
      await provider.installSidecar({
        session_id: 'session_claude_type_module',
        project_id: 'project_alpha',
        path: workspaceDir,
        title: 'Claude Alpha',
        type: 'claude-code',
        external_session_id: 'external-type-module'
      }, {
        webhookPort: server.port,
        sessionSecret: 'secret-env',
        providerPort: 43128
      })

      const settingsJson = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      expect(readWrappedUpstreamCommand(readHookCommand(settingsJson, 'SessionStart'))).toContain('evolver-session-start.cjs')
      expect(readWrappedUpstreamCommand(readHookCommand(settingsJson, 'PostToolUse'))).toContain('evolver-signal-detect.cjs')
      expect(readWrappedUpstreamCommand(readHookCommand(settingsJson, 'Stop'))).toContain('evolver-session-end.cjs')
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-start.cjs'), 'utf8')).resolves.toEqual(expect.any(String))
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-signal-detect.cjs'), 'utf8')).resolves.toEqual(expect.any(String))
      await expect(readFile(join(workspaceDir, '.claude', 'hooks', 'evolver-session-end.cjs'), 'utf8')).resolves.toEqual(expect.any(String))

      const memoryGraphPath = join(workspaceDir, 'memory-graph.jsonl')
      await writeFile(
        memoryGraphPath,
        `${JSON.stringify({
          timestamp: '2026-04-30T00:00:00.000Z',
          signals: ['test_failure'],
          outcome: {
            status: 'failed',
            score: 0.3,
            note: 'Recall survives type-module workspaces.'
          }
        })}\n`,
        'utf8'
      )

      const stdout = await runSessionStartHookFromSettings(workspaceDir, {
        ...process.env,
        MEMORY_GRAPH_PATH: memoryGraphPath,
        PATH: '',
        STOA_SESSION_ID: 'session_claude_type_module',
        STOA_PROJECT_ID: 'project_alpha',
        STOA_SESSION_SECRET: 'secret-env',
        STOA_WEBHOOK_PORT: String(server.port)
      })

      const parsedOutput = parseHookJsonOutput(stdout)
      expect(parsedOutput).toMatchObject({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: expect.stringContaining('Recall survives type-module workspaces.')
        }
      })
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        hook_event_name: 'SessionStart'
      })
      expect(memoryNotifications).toContainEqual(expect.objectContaining({
        kind: 'recall',
        status: 'success'
      }))
    } finally {
      await server.stop()
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

})

function runChecked(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}

function readHookCommand(settingsJson: string, eventName: string): string {
  const settings = JSON.parse(settingsJson) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
  }
  const command = settings.hooks?.[eventName]?.[0]?.hooks?.[0]?.command
  if (!command) {
    throw new Error(`${eventName} hook command is missing.`)
  }
  return command
}

function readSessionStartHookCommand(settingsJson: string): string {
  return readHookCommand(settingsJson, 'SessionStart')
}

function readWrappedUpstreamCommand(command: string): string {
  const encoded = readWrappedEncodedArgument(command, 2)
  return Buffer.from(encoded, 'base64').toString('utf8')
}

function readWrappedRepoRoot(command: string): string {
  const encoded = readWrappedEncodedArgument(command, 3)
  return Buffer.from(encoded, 'base64').toString('utf8')
}

function readWrappedEncodedArgument(command: string, quotedIndex: number): string {
  const matches = [...command.matchAll(/"([^"]+)"/g)]
  const encoded = matches[quotedIndex]?.[1]
  if (!encoded) {
    throw new Error(`Unable to decode wrapped upstream command from: ${command}`)
  }
  return encoded
}

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

function parseHookJsonOutput(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>
}

async function runSessionStartHookFromSettings(
  workspaceDir: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return await runHookFromSettings('SessionStart', workspaceDir, env)
}

async function runHookFromSettings(
  eventName: string,
  workspaceDir: string,
  env: NodeJS.ProcessEnv,
  stdinPayload?: Record<string, unknown>
): Promise<string> {
  const settingsJson = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
  const command = readHookCommand(settingsJson, eventName)
  return await runHookCommand(command, workspaceDir, env, stdinPayload)
}

async function runHookCommand(
  command: string,
  workspaceDir: string,
  env: NodeJS.ProcessEnv,
  stdinPayload?: Record<string, unknown>
): Promise<string> {
  const expandedCommand = command.replaceAll('$CLAUDE_PROJECT_DIR', workspaceDir.replace(/\\/g, '/'))
  return await new Promise<string>((resolve, reject) => {
    exec(
      expandedCommand,
      {
        cwd: workspaceDir,
        env: {
          ...env,
          CLAUDE_PROJECT_DIR: workspaceDir.replace(/\\/g, '/')
        },
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        resolve(stdout)
      }
    ).stdin?.end(stdinPayload ? JSON.stringify(stdinPayload) : '')
  })
}

async function createHookResponseServer(
  expectedSessionId: string,
  expectedSecret: string,
  received: Array<Record<string, unknown>>,
  memoryNotifications: Array<Record<string, unknown>>,
  responsePayload: Record<string, unknown>
): Promise<{
  port: number
  stop: () => Promise<void>
}> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || (request.url !== '/hooks/claude-code' && request.url !== '/memory-notifications')) {
      response.statusCode = 404
      response.end()
      return
    }

    if (
      request.headers['x-stoa-session-id'] !== expectedSessionId
      || request.headers['x-stoa-secret'] !== expectedSecret
    ) {
      response.statusCode = 401
      response.end(JSON.stringify({ accepted: false, reason: 'invalid_secret' }))
      return
    }

    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>
      if (request.url === '/memory-notifications') {
        memoryNotifications.push(parsed)
      } else {
        received.push(parsed)
      }
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(responsePayload))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start local hook response server.')
  }

  return {
    port: address.port,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }
}
