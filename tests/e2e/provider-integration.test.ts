import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { getProvider, listProviders } from '@extensions/providers'
import type { CanonicalSessionEvent, ProviderCommandContext } from '@shared/project-session'
import type { ProviderRuntimeTarget } from '@extensions/providers'
import { createLocalWebhookServer } from '@core/webhook-server'
import { createTestTempDir } from '../../testing/test-temp'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  )
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await createTestTempDir(prefix)
  tempDirs.push(dir)
  return dir
}

async function createExternalTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function withTempCodexHome<T>(run: (codexHomeDir: string) => Promise<T>): Promise<T> {
  const codexHomeDir = await createTempDir('stoa-codex-home-')
  const previousCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = codexHomeDir
  try {
    return await run(codexHomeDir)
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = previousCodexHome
    }
  }
}

async function withRealCodexHome<T>(run: (codexHomeDir: string) => Promise<T>): Promise<T> {
  const codexHomeDir = await createTempDir('stoa-real-codex-home-')
  const homeDir = process.env.USERPROFILE ?? process.env.HOME
  if (!homeDir) {
    throw new Error('Cannot resolve user home directory for real Codex test.')
  }

  await cp(join(homeDir, '.codex', 'config.toml'), join(codexHomeDir, 'config.toml'))
  await cp(join(homeDir, '.codex', 'auth.json'), join(codexHomeDir, 'auth.json'))

  const previousCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = codexHomeDir
  try {
    return await run(codexHomeDir)
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = previousCodexHome
    }
  }
}

function resolveCodexCliPath(): string {
  const configured = process.env.CODEX_CLI_PATH?.trim()
  if (configured) {
    return configured
  }

  const lookup = spawnSync('where.exe', ['codex'], { encoding: 'utf8', shell: false })
  if (lookup.status !== 0) {
    throw new Error(`Codex CLI executable was not found.\n${lookup.stderr}`)
  }

  const candidates = lookup.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const preferred = candidates.find((line) => line.toLowerCase().endsWith('.cmd'))
  return preferred ?? candidates[0]!
}

function canRunRealCodexTests(): boolean {
  try {
    const cliPath = resolveCodexCliPath()
    if (!existsSync(cliPath)) {
      return false
    }

    const homeDir = process.env.USERPROFILE ?? process.env.HOME
    if (!homeDir) {
      return false
    }

    return existsSync(join(homeDir, '.codex', 'config.toml'))
      && existsSync(join(homeDir, '.codex', 'auth.json'))
  } catch {
    return false
  }
}

const SHOULD_RUN_REAL_CODEX_TESTS = canRunRealCodexTests()

function runCodexCli(
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined>; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', resolveCodexCliPath(), ...args], {
      cwd: options.cwd,
      env: Object.fromEntries(
        Object.entries(options.env).filter(([, value]) => value !== undefined)
      ) as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      void terminateChildProcessTree(child).finally(() => {
        reject(new Error(`Timed out running Codex CLI: codex ${args.join(' ')}`))
      })
    }, options.timeoutMs ?? 30_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timeout)
      resolve({ stdout, stderr, exitCode })
    })
  })
}

function spawnCodexCli(
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> }
): {
  child: import('node:child_process').ChildProcessWithoutNullStreams
  output: { stdout: string; stderr: string }
} {
  const child = spawn('cmd.exe', ['/c', resolveCodexCliPath(), ...args], {
    cwd: options.cwd,
    env: Object.fromEntries(
      Object.entries(options.env).filter(([, value]) => value !== undefined)
    ) as Record<string, string>,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false
  })
  child.stdin.end()

  const output = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.on('data', (chunk) => { output.stderr += chunk })

  return { child, output }
}

async function terminateChildProcessTree(
  child: import('node:child_process').ChildProcess
): Promise<void> {
  if (!child.pid) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Best-effort shutdown cleanup.
    }
    return
  }

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        shell: false
      })
      return
    } catch {
      // Fall through to direct child kill.
    }
  }

  try {
    child.kill('SIGKILL')
  } catch {
    // Best-effort shutdown cleanup.
  }
}

function waitForChildClose(
  child: import('node:child_process').ChildProcess
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const onClose = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      child.off('close', onClose)
      child.off('error', onError)
    }

    child.once('close', onClose)
    child.once('error', onError)

    if (child.exitCode !== null || child.signalCode !== null) {
      cleanup()
      resolve()
    }
  })
}

async function waitForCondition(
  condition: () => boolean,
  options: { timeoutMs: number; intervalMs?: number; timeoutMessage: string }
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < options.timeoutMs) {
    if (condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 100))
  }
  throw new Error(options.timeoutMessage)
}

async function listCodexHooksThroughAppServer(
  cwd: string,
  codexHomeDir: string
): Promise<Array<Record<string, unknown>>> {
  return await new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', resolveCodexCliPath(), 'app-server'], {
      cwd,
      env: {
        ...process.env as Record<string, string | undefined>,
        CODEX_HOME: codexHomeDir
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })

    let stdoutBuffer = ''
    let stderr = ''
    let resolved = false
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out waiting for Codex hooks/list response.\nstderr:\n${stderr}`))
    }, 10_000)

    const finish = (hooks: Array<Record<string, unknown>>) => {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timeout)
      child.kill()
      resolve(hooks)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }

        const message = JSON.parse(trimmed) as {
          id?: number
          result?: { data?: Array<{ hooks?: Array<Record<string, unknown>> }> }
        }
        if (message.id === 1) {
          finish(message.result?.data?.[0]?.hooks ?? [])
          break
        }
      }
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', () => {
      if (!resolved) {
        clearTimeout(timeout)
        reject(new Error(`Codex app-server exited before hooks/list response.\nstderr:\n${stderr}`))
      }
    })

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        clientInfo: { name: 'stoa-provider-integration', version: '0.1.0' },
        capabilities: { experimentalApi: true }
      }
    }) + '\n')
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }) + '\n')
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'hooks/list',
      params: { cwds: [cwd] }
    }) + '\n')
  })
}

async function postCanonicalEvent(
  port: number,
  secret: string,
  event: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(event)
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/events',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-stoa-secret': secret
        }
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }))
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function createTarget(overrides: Partial<ProviderRuntimeTarget> = {}): ProviderRuntimeTarget {
  return {
    session_id: 'session_test_001',
    project_id: 'project_test_001',
    path: 'D:/test_workspace',
    title: 'Test Session',
    type: 'opencode',
    ...overrides
  }
}

function createContext(overrides: Partial<ProviderCommandContext> = {}): ProviderCommandContext {
  return {
    webhookPort: 43127,
    sessionSecret: 'test-secret-abc',
    providerPort: 43128,
    hookLeasePath: 'D:/runtime/hook-leases/session_test_001.json',
    hookManaged: true,
    hookSessionId: 'session_test_001',
    hookProjectId: 'project_test_001',
    hookProvider: 'opencode',
    hookSpawnOwnerInstanceId: 'instance-test',
    hookSpawnGeneration: 1,
    ...overrides
  }
}

function expectedCodexHookCommand(eventName: string): string {
  return process.platform === 'win32'
    ? `.\\.stoa\\hook-dispatch.cmd codex ${eventName}`
    : `.stoa/hook-dispatch codex ${eventName}`
}

describe('Provider integration test helpers', () => {
  test('waitForChildClose resolves after the child already exited', async () => {
    const child = spawn('cmd.exe', ['/c', 'exit', '0'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    child.stdin.end()

    await new Promise((resolve) => child.once('close', resolve))

    await expect(Promise.race([
      waitForChildClose(child).then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 250))
    ])).resolves.toBe('closed')
  })

  test.skipIf(process.platform !== 'win32')(
    'terminateChildProcessTree closes a cmd child that spawned descendants',
    async () => {
    const child = spawn('cmd.exe', ['/c', 'ping', '-t', '127.0.0.1'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    child.stdin.end()

    await new Promise((resolve) => setTimeout(resolve, 250))

    try {
      await expect(Promise.race([
        (async () => {
          await terminateChildProcessTree(child)
          await waitForChildClose(child)
          return 'closed'
        })(),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 5_000))
      ])).resolves.toBe('closed')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await terminateChildProcessTree(child)
      }
    }
    }
  )
})

describe('E2E: Provider Integration', () => {
  describe('Provider registry', () => {
    test('listProviders returns local-shell opencode codex and claude-code providers', () => {
      const providers = listProviders()
      const ids = providers.map(p => p.providerId)
      expect(ids).toContain('local-shell')
      expect(ids).toContain('opencode')
      expect(ids).toContain('codex')
      expect(ids).toContain('claude-code')
      expect(providers).toHaveLength(4)
    })

    test('getProvider returns local shell provider', () => {
      const provider = getProvider('local-shell')
      expect(provider.providerId).toBe('local-shell')
    })

    test('getProvider returns opencode provider', () => {
      const provider = getProvider('opencode')
      expect(provider.providerId).toBe('opencode')
    })

    test('getProvider returns codex provider', () => {
      const provider = getProvider('codex')
      expect(provider.providerId).toBe('codex')
    })

    test('getProvider returns claude-code provider', () => {
      const provider = getProvider('claude-code')
      expect(provider.providerId).toBe('claude-code')
    })

    test('getProvider falls back to local-shell for unknown provider', () => {
      const provider = getProvider('unknown-nonexistent')
      expect(provider.providerId).toBe('local-shell')
    })
  })

  describe('Local shell provider', () => {
    test('buildStartCommand returns platform shell command', async () => {
      const provider = getProvider('local-shell')
      const target = createTarget({ type: 'shell' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      const expectedShell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
      expect(command.command).toBe(expectedShell)
      expect(command.args).toEqual([])
      expect(command.cwd).toBe(target.path)
    })

    test('buildResumeCommand returns same as start (no resume support)', async () => {
      const provider = getProvider('local-shell')
      const target = createTarget({ type: 'shell' })
      const context = createContext()

      const startCommand = await provider.buildStartCommand(target, context)
      const resumeCommand = await provider.buildResumeCommand(target, 'ext-123', context)

      expect(resumeCommand.command).toBe(startCommand.command)
      expect(resumeCommand.args).toEqual(startCommand.args)
      expect(resumeCommand.cwd).toBe(startCommand.cwd)
    })

    test('supportsResume() returns false', () => {
      const provider = getProvider('local-shell')
      expect(provider.supportsResume()).toBe(false)
    })

    test('supportsStructuredEvents() returns false', () => {
      const provider = getProvider('local-shell')
      expect(provider.supportsStructuredEvents()).toBe(false)
    })

    test('installSidecar is a no-op (no files created)', async () => {
      const provider = getProvider('local-shell')
      const workspaceDir = await createTempDir('stoa-e2e-nosidecar-')
      const target = createTarget({ path: workspaceDir, type: 'shell' })
      const context = createContext()

      await provider.installSidecar(target, context)

      const sidecarPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      await expect(stat(sidecarPath)).rejects.toThrow()
    })

    test('resolveSessionId returns session_id from event', () => {
      const provider = getProvider('local-shell')
      const event = {
        event_version: 1,
        event_id: 'evt_001',
        event_type: 'session.started',
        timestamp: new Date().toISOString(),
        session_id: 'session_xyz',
        project_id: 'project_abc',
        source: 'hook-sidecar' as const,
        payload: {
          intent: 'agent.turn_started' as const,
          sourceTurnId: 'turn-001',
          summary: 'event accepted'
        }
      }

      expect(provider.resolveSessionId(event)).toBe('session_xyz')
    })
  })

  describe('OpenCode provider', () => {
    test('buildStartCommand keeps semantic command name when no provider path is configured', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext({ providerPort: 44000 })

      const command = await provider.buildStartCommand(target, context)

      expect(command.command).toBe('opencode')
      expect(command.args).toEqual([])
    })

    test('buildStartCommand uses configured provider path when provided', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = {
        ...createContext(),
        providerPath: 'C:/Users/test/AppData/Roaming/npm/opencode.ps1'
      } as ProviderCommandContext

      const command = await provider.buildStartCommand(target, context)

      expect(command.command).toBe('C:/Users/test/AppData/Roaming/npm/opencode.ps1')
      expect(command.args).toEqual([])
    })

    test('buildStartCommand does not force pure mode', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext({ providerPort: 44000 })

      const command = await provider.buildStartCommand(target, context)

      expect(command.args).toEqual([])
    })

    test('buildStartCommand sets lease-driven hook environment variables', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({
        session_id: 'session_s1',
        project_id: 'project_p1',
        type: 'opencode'
      })
      const context = createContext({
        sessionSecret: 'my-secret-123',
        webhookPort: 55555,
        providerPort: 55556,
        hookLeasePath: 'D:/runtime/hook-leases/session_s1.json',
        hookSessionId: 'session_s1',
        hookProjectId: 'project_p1',
        hookProvider: 'opencode',
        hookSpawnOwnerInstanceId: 'instance-opencode',
        hookSpawnGeneration: 4
      })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_HOOK_LEASE_PATH).toBe('D:/runtime/hook-leases/session_s1.json')
      expect(command.env.STOA_HOOK_MANAGED).toBe('1')
      expect(command.env.STOA_HOOK_SESSION_ID).toBe('session_s1')
      expect(command.env.STOA_HOOK_PROJECT_ID).toBe('project_p1')
      expect(command.env.STOA_HOOK_PROVIDER).toBe('opencode')
      expect(command.env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID).toBe('instance-opencode')
      expect(command.env.STOA_HOOK_SPAWN_GENERATION).toBe('4')
      expect(command.env.STOA_PROVIDER_PORT).toBe('55556')
      expect(command.env.STOA_SESSION_SECRET).toBeUndefined()
      expect(command.env.STOA_WEBHOOK_PORT).toBeUndefined()
    })

    test('buildResumeCommand includes --session flag with external ID', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const command = await provider.buildResumeCommand(target, 'ext-session-42', context)

      expect(command.args).toEqual(['--session', 'ext-session-42'])
    })

    test('buildResumeCommand only adds the resume session id', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext({ providerPort: 44000 })

      const command = await provider.buildResumeCommand(target, 'ext-1', context)

      expect(command.args).toEqual(['--session', 'ext-1'])
    })

    test('supportsResume() returns true', () => {
      const provider = getProvider('opencode')
      expect(provider.supportsResume()).toBe(true)
    })

    test('supportsStructuredEvents() returns true', () => {
      const provider = getProvider('opencode')
      expect(provider.supportsStructuredEvents()).toBe(true)
    })
  })

  describe('Codex provider', () => {
    test('buildStartCommand keeps semantic command name when no provider path is configured', async () => {
      const provider = getProvider('codex')
      const target = createTarget({ type: 'codex' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.command).toBe('codex')
      expect(command.args).toEqual([])
    })

    test('buildResumeCommand resumes by external session id', async () => {
      const provider = getProvider('codex')
      const target = createTarget({ type: 'codex' })
      const context = createContext()

      const command = await provider.buildResumeCommand(target, '019c75d6-5db6-7c21-8d2f-f0602da4f64d', context)

      expect(command.args).toEqual(['resume', '019c75d6-5db6-7c21-8d2f-f0602da4f64d'])
    })

    test('buildFallbackResumeCommand is unavailable when external session id is unavailable', async () => {
      const provider = getProvider('codex')
      const target = createTarget({ type: 'codex' })
      const context = createContext()

      const command = await provider.buildFallbackResumeCommand?.(target, context)

      expect(command).toBeUndefined()
    })

    test('supportsStructuredEvents() returns true', () => {
      const provider = getProvider('codex')
      expect(provider.supportsStructuredEvents()).toBe(true)
    })

    test('buildStartCommand sets lease-driven hook environment variables', async () => {
      const provider = getProvider('codex')
      const target = createTarget({
        session_id: 'session_codex_1',
        project_id: 'project_codex_1',
        type: 'codex'
      })
      const context = createContext({
        sessionSecret: 'codex-secret',
        webhookPort: 47770,
        providerPort: 47771,
        hookLeasePath: 'D:/runtime/hook-leases/session_codex_1.json',
        hookSessionId: 'session_codex_1',
        hookProjectId: 'project_codex_1',
        hookProvider: 'codex',
        hookSpawnOwnerInstanceId: 'instance-codex',
        hookSpawnGeneration: 9
      })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_HOOK_LEASE_PATH).toBe('D:/runtime/hook-leases/session_codex_1.json')
      expect(command.env.STOA_HOOK_MANAGED).toBe('1')
      expect(command.env.STOA_HOOK_SESSION_ID).toBe('session_codex_1')
      expect(command.env.STOA_HOOK_PROJECT_ID).toBe('project_codex_1')
      expect(command.env.STOA_HOOK_PROVIDER).toBe('codex')
      expect(command.env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID).toBe('instance-codex')
      expect(command.env.STOA_HOOK_SPAWN_GENERATION).toBe('9')
      expect(command.env.STOA_PROVIDER_PORT).toBe('47771')
      expect(command.env.STOA_SESSION_SECRET).toBeUndefined()
      expect(command.env.STOA_WEBHOOK_PORT).toBeUndefined()
      expect(command.args).toEqual([])
      expect(command.args).toEqual([])
    })

    test('installSidecar writes official Codex config files alongside shared dispatcher assets', async () => {
      const workspaceDir = await createTempDir('stoa-codex-sidecar-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const context = createContext()

      await withTempCodexHome(async (codexHomeDir) => {
        await provider.installSidecar(target, context)

        const manifestPath = join(workspaceDir, '.codex', '.stoa-managed-sidecar.json')
        const dispatcherPath = join(workspaceDir, '.stoa', 'hook-dispatch.mjs')
        const configContent = await readFile(join(workspaceDir, '.codex', 'config.toml'), 'utf8')
        const userConfigContent = await readFile(join(codexHomeDir, 'config.toml'), 'utf8')
        await expect(stat(manifestPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(dispatcherPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(workspaceDir, '.stoa', 'hook-dispatch'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(workspaceDir, '.stoa', 'hook-dispatch.cmd'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(workspaceDir, '.stoa', 'hook-contract.json'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(workspaceDir, '.codex', 'config.toml'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(workspaceDir, '.codex', 'hooks.json'))).rejects.toThrow()
        await expect(stat(join(workspaceDir, '.codex', 'hook-stoa.mjs'))).rejects.toThrow()
        await expect(stat(join(workspaceDir, '.codex', 'notify-stoa.mjs'))).rejects.toThrow()
        expect(configContent).toContain('[[hooks.SessionStart]]')
        expect(configContent).toContain(`command = ${JSON.stringify(expectedCodexHookCommand('SessionStart'))}`)
        expect(configContent).not.toContain('[hooks.state.')
        expect(configContent).not.toContain('trusted_hash = "sha256:')
        expect(userConfigContent).toContain('trust_level = "trusted"')
        expect(userConfigContent).toContain('[hooks.state.')
        expect(userConfigContent).toContain('trusted_hash = "sha256:')
        expect(userConfigContent).toContain('trust_level = "trusted"')
        expect(userConfigContent).toContain('[hooks.state.')
        expect(userConfigContent).toContain('trusted_hash = "sha256:')
      })
    })

    test('installSidecar and uninstallSidecar preserve existing project codex config content', async () => {
      const workspaceDir = await createTempDir('stoa-codex-preserve-project-config-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const context = createContext()

      await mkdir(join(workspaceDir, '.codex'), { recursive: true })
      await writeFile(
        join(workspaceDir, '.codex', 'config.toml'),
        [
          'model = "gpt-5"',
          '',
          '[model_providers.openai]',
          'name = "OpenAI"',
          'base_url = "https://api.openai.com/v1"',
          ''
        ].join('\n'),
        'utf8'
      )

      await withTempCodexHome(async () => {
        await provider.installSidecar(target, context)

        const installedConfig = await readFile(join(workspaceDir, '.codex', 'config.toml'), 'utf8')
        expect(installedConfig).toContain('model = "gpt-5"')
        expect(installedConfig).toContain('[model_providers.openai]')
        expect(installedConfig).toContain('[[hooks.SessionStart]]')

        await provider.uninstallSidecar?.(workspaceDir)

        const uninstalledConfig = await readFile(join(workspaceDir, '.codex', 'config.toml'), 'utf8')
        expect(uninstalledConfig).toContain('model = "gpt-5"')
        expect(uninstalledConfig).toContain('[model_providers.openai]')
        expect(uninstalledConfig).not.toContain('[[hooks.SessionStart]]')
        expect(uninstalledConfig).not.toContain(`command = ${JSON.stringify(expectedCodexHookCommand('SessionStart'))}`)
      })
    })

    test('shared dispatcher artifact avoids provider-private baked session routing', async () => {
      const workspaceDir = await createTempDir('stoa-codex-env-sidecar-')
      const provider = getProvider('codex')
      const target = createTarget({
        path: workspaceDir,
        type: 'codex',
        session_id: 'session_internal_codex',
        project_id: 'project_internal_codex'
      })

      await withTempCodexHome(async () => {
        await provider.installSidecar(target, createContext({ webhookPort: 43127, sessionSecret: 'secret-codex' }))

        const dispatcherContent = await readFile(join(workspaceDir, '.stoa', 'hook-dispatch.mjs'), 'utf8')
        expect(dispatcherContent).toContain('STOA_HOOK_LEASE_PATH')
        expect(dispatcherContent).toContain('/hooks/codex')
        expect(dispatcherContent).not.toContain('../src/extensions/providers/shared-hook-dispatch.ts')
        expect(dispatcherContent).not.toContain('session_internal_codex')
        expect(dispatcherContent).not.toContain('project_internal_codex')
        expect(dispatcherContent).not.toContain('secret-codex')
      })
    })
  })

  describe('Claude Code provider', () => {
    test('buildStartCommand seeds session id through --session-id', async () => {
      const provider = getProvider('claude-code')
      const target = createTarget({
        type: 'claude-code',
        external_session_id: '11111111-1111-1111-1111-111111111111'
      })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.command).toBe('claude')
      expect(command.args).toEqual([
        '--session-id',
        '11111111-1111-1111-1111-111111111111'
      ])
    })

    test('buildStartCommand rejects missing external session ids', async () => {
      const provider = getProvider('claude-code')
      const target = createTarget({ type: 'claude-code' })
      const context = createContext()

      await expect(provider.buildStartCommand(target, context)).rejects.toThrow(
        'claude-code sessions require an external_session_id'
      )
    })

    test('buildResumeCommand resumes by external session id', async () => {
      const provider = getProvider('claude-code')
      const target = createTarget({ type: 'claude-code' })
      const context = createContext()

      const command = await provider.buildResumeCommand(target, '11111111-1111-1111-1111-111111111111', context)

      expect(command.args).toEqual([
        '--resume',
        '11111111-1111-1111-1111-111111111111'
      ])
    })

    test('supportsStructuredEvents() returns true', () => {
      const provider = getProvider('claude-code')
      expect(provider.supportsStructuredEvents()).toBe(true)
    })

    test('buildStartCommand sets lease-driven hook environment variables', async () => {
      const provider = getProvider('claude-code')
      const target = createTarget({
        type: 'claude-code',
        session_id: 'session_claude_telemetry',
        project_id: 'project_claude_telemetry',
        external_session_id: 'external-telemetry'
      })
      const context = createContext({
        sessionSecret: 'claude-secret',
        webhookPort: 48880,
        providerPort: 48881,
        hookLeasePath: 'D:/runtime/hook-leases/session_claude_telemetry.json',
        hookSessionId: 'session_claude_telemetry',
        hookProjectId: 'project_claude_telemetry',
        hookProvider: 'claude-code',
        hookSpawnOwnerInstanceId: 'instance-claude',
        hookSpawnGeneration: 11
      })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_HOOK_LEASE_PATH).toBe('D:/runtime/hook-leases/session_claude_telemetry.json')
      expect(command.env.STOA_HOOK_MANAGED).toBe('1')
      expect(command.env.STOA_HOOK_SESSION_ID).toBe('session_claude_telemetry')
      expect(command.env.STOA_HOOK_PROJECT_ID).toBe('project_claude_telemetry')
      expect(command.env.STOA_HOOK_PROVIDER).toBe('claude-code')
      expect(command.env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID).toBe('instance-claude')
      expect(command.env.STOA_HOOK_SPAWN_GENERATION).toBe('11')
      expect(command.env.STOA_PROVIDER_PORT).toBe('48881')
      expect(command.env.STOA_SESSION_SECRET).toBeUndefined()
      expect(command.env.STOA_WEBHOOK_PORT).toBeUndefined()
    })

    test('installSidecar writes shared Claude hooks config', async () => {
      const workspaceDir = await createTempDir('stoa-claude-sidecar-')
      const provider = getProvider('claude-code')
      const target = createTarget({
        path: workspaceDir,
        type: 'claude-code',
        external_session_id: 'external-telemetry'
      })

      await provider.installSidecar(target, createContext({ webhookPort: 43127, sessionSecret: 'secret-claude' }))

      const content = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      const settings = JSON.parse(content) as { hooks: Record<string, unknown> }
      expect(content).toContain('.stoa/hook-dispatch claude-code SessionStart')
      expect(content).toContain('allowedEnvVars')
      expect(content).toContain('STOA_HOOK_LEASE_PATH')
      expect(content).toContain('STOA_HOOK_MANAGED')
      expect(Object.keys(settings.hooks).sort()).toEqual([
        'PermissionRequest',
        'PostToolUse',
        'SessionStart',
        'Stop',
        'UserPromptSubmit'
      ])
      expect(content).not.toContain('stoa-evolver-hook-bridge')
      await expect(stat(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cjs'))).rejects.toThrow()
      await expect(stat(join(workspaceDir, '.claude', 'hooks', 'stoa-evolver-hook-bridge.cmd'))).rejects.toThrow()
      await expect(stat(join(workspaceDir, '.claude', 'hooks', 'stoa-hook-user-prompt-submit.cjs'))).rejects.toThrow()
      await expect(stat(join(workspaceDir, '.claude', 'hooks', 'evolver-signal-detect.cjs'))).rejects.toThrow()
      await expect(stat(join(workspaceDir, '.claude', 'hooks', 'evolver-session-end.cjs'))).rejects.toThrow()
      await expect(stat(join(workspaceDir, '.claude', '.stoa-managed-sidecar.json'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.stoa', 'hook-dispatch.mjs'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      expect(content).not.toContain('secret-claude')
      expect(content).not.toContain(target.session_id)
      expect(parsedClaudeHttpHook(content, 'UserPromptSubmit')).toMatchObject({
        type: 'command',
        command: '.stoa/hook-dispatch claude-code UserPromptSubmit',
        timeout: 5
      })
    })

    test('installSidecar and uninstallSidecar preserve existing Claude project and local settings', async () => {
      const workspaceDir = await createTempDir('stoa-claude-preserve-settings-')
      const provider = getProvider('claude-code')
      const target = createTarget({
        path: workspaceDir,
        type: 'claude-code',
        external_session_id: 'external-preserve'
      })

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

      await provider.installSidecar(target, createContext({ webhookPort: 43127, sessionSecret: 'secret-claude' }))

      const installedProjectSettings = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      const installedLocalSettings = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
      expect(installedProjectSettings).toContain('"permissions"')
      expect(installedProjectSettings).toContain('Bash(git status)')
      expect(installedProjectSettings).toContain('.stoa/hook-dispatch claude-code SessionStart')
      expect(installedLocalSettings).toContain('"DEBUG": "1"')

      await provider.uninstallSidecar?.(workspaceDir)

      const projectSettingsAfterUninstall = await readFile(join(workspaceDir, '.claude', 'settings.json'), 'utf8')
      const localSettingsAfterUninstall = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
      expect(projectSettingsAfterUninstall).toContain('"permissions"')
      expect(projectSettingsAfterUninstall).toContain('Bash(git status)')
      expect(projectSettingsAfterUninstall).not.toContain('.stoa/hook-dispatch claude-code SessionStart')
      expect(projectSettingsAfterUninstall).not.toContain('.stoa/hook-dispatch claude-code Stop')
      expect(localSettingsAfterUninstall).toContain('"DEBUG": "1"')
    })
  })

  describe('OpenCode sidecar installation (real file system)', () => {
    test('installSidecar creates .opencode/plugins directory', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-dir-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext()

      await provider.installSidecar(target, context)

      const pluginDir = join(workspaceDir, '.opencode', 'plugins')
      const dirStat = await stat(pluginDir)
      expect(dirStat.isDirectory()).toBe(true)
    })

    test('installSidecar writes stoa-status.ts file', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-file-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext()

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const fileStat = await stat(pluginPath)
      expect(fileStat.isFile()).toBe(true)
      await expect(stat(join(workspaceDir, '.opencode', '.stoa-managed-sidecar.json'))).resolves.toMatchObject({
        isFile: expect.any(Function)
      })
    })

    test('sidecar file routes through the shared dispatcher contract', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-url-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext({ webhookPort: 43127 })

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('.stoa/hook-dispatch opencode')
      expect(content).toContain('STOA_HOOK_LEASE_PATH')
      expect(content).toContain('STOA_HOOK_MANAGED')
    })

    test('sidecar file avoids baked secret or direct HTTP headers', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-secret-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext({ sessionSecret: 'my-super-secret-key' })

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).not.toContain('x-stoa-secret')
      expect(content).not.toContain('STOA_SESSION_SECRET')
      expect(content).not.toContain('http://127.0.0.1:')
      expect(content).not.toContain('my-super-secret-key')
    })

    test('shared sidecar plugin keeps provider event projection but delegates routing to dispatcher', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-ids-')
      const provider = getProvider('opencode')
      const target = createTarget({
        path: workspaceDir,
        session_id: 'session_test_s99',
        project_id: 'project_test_p99'
      })
      const context = createContext()

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('process.env.STOA_HOOK_LEASE_PATH')
      expect(content).toContain('dispatchEvent(event.type, body)')
      expect(content).toContain('session_id: event.properties?.sessionID ?? undefined')
      expect(content).not.toContain('http://127.0.0.1:43127/hooks/opencode')
      expect(content).not.toContain('session_test_s99')
      expect(content).not.toContain('project_test_p99')
    })

    test('sidecar plugin delegates hook events through the shared dispatcher payload contract', async () => {
      const workspaceDir = await createTempDir('stoa-sidecar-provider-id-')
      const provider = getProvider('opencode')

      await provider.installSidecar(
        createTarget({
          path: workspaceDir,
          session_id: 'session_internal_1',
          project_id: 'project_internal_1'
        }),
        createContext({ webhookPort: 43127, sessionSecret: 'secret-1' })
      )

      const content = await readFile(join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts'), 'utf8')
      expect(content).toContain('const body = buildEventBody(event)')
      expect(content).toContain('hook_event_name: event.type')
      expect(content).toContain('session_id: event.properties?.sessionID ?? undefined')
      expect(content).toContain('turn_id: event.properties?.messageID ?? undefined')
      expect(content).toContain('tool_name: event.properties?.toolName ?? undefined')
      expect(content).toContain('tool_input: event.properties?.toolInput ?? undefined')
      expect(content).toContain('model: event.properties?.model ?? undefined')
      expect(content).toContain('prompt_text: event.properties?.promptText ?? undefined')
      expect(content).toContain('provider_session_id: event.properties?.sessionID ?? undefined')
      expect(content).toContain('message_id: event.properties?.messageID ?? undefined')
      expect(content).toContain("if (event.type === 'session.idle')")
      expect(content).toContain("if (event.type === 'session.error')")
      expect(content).toContain("if (event.type === 'permission.replied' && event.properties?.error)")
      expect(content).toContain("body.error = toFailureReason(event)")
      expect(content).toContain('await dispatchEvent(event.type, body)')
      expect(content).not.toContain('agentState:')
      expect(content).not.toContain('hasUnseenCompletion:')
      expect(content).not.toContain("status: event.type === 'session.idle' ? 'awaiting_input' : 'running'")
    })

    test('calling installSidecar twice keeps a shared plugin without session-baked values', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-overwrite-')
      const provider = getProvider('opencode')

      const target1 = createTarget({
        path: workspaceDir,
        session_id: 'session_v1',
        project_id: 'project_v1'
      })
      const context1 = createContext({ webhookPort: 11111, sessionSecret: 'secret-v1' })

      await provider.installSidecar(target1, context1)

      const target2 = createTarget({
        path: workspaceDir,
        session_id: 'session_v2',
        project_id: 'project_v2'
      })
      const context2 = createContext({ webhookPort: 22222, sessionSecret: 'secret-v2' })

      await provider.installSidecar(target2, context2)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('process.env.STOA_HOOK_LEASE_PATH')
      expect(content).toContain('.stoa/hook-dispatch opencode')
      expect(content).not.toContain('127.0.0.1:22222')
      expect(content).not.toContain('STOA_SESSION_SECRET')
      expect(content).not.toContain('session_v1')
      expect(content).not.toContain('session_v2')
      expect(content).not.toContain('project_v1')
      expect(content).not.toContain('project_v2')
      expect(content).not.toContain('secret-v1')
      expect(content).not.toContain('secret-v2')
    })
  })

  describe('Provider command environment isolation', () => {
    test('local-shell provider passes process.env', async () => {
      const provider = getProvider('local-shell')
      const target = createTarget({ type: 'shell' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.env).toEqual(process.env as Record<string, string>)
    })

    test('opencode provider extends process.env with lease-driven hook vars', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_HOOK_LEASE_PATH).toBe(context.hookLeasePath)
      expect(command.env.STOA_HOOK_MANAGED).toBe('1')
      expect(command.env.STOA_HOOK_SESSION_ID).toBe(context.hookSessionId)
      expect(command.env.STOA_HOOK_PROJECT_ID).toBe(context.hookProjectId)
      expect(command.env.STOA_HOOK_PROVIDER).toBe(context.hookProvider)
      expect(command.env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID).toBe(context.hookSpawnOwnerInstanceId)
      expect(command.env.STOA_HOOK_SPAWN_GENERATION).toBe(String(context.hookSpawnGeneration))
      expect(command.env.STOA_PROVIDER_PORT).toBe(String(context.providerPort))
      expect(command.env.STOA_SESSION_SECRET).toBeUndefined()
      expect(command.env.STOA_WEBHOOK_PORT).toBeUndefined()

      const processEnvKeys = Object.keys(process.env).filter((key) => !key.startsWith('STOA_'))
      for (const key of processEnvKeys) {
        expect(command.env[key]).toBe((process.env as Record<string, string>)[key])
      }
    })

    test('opencode env vars do not modify original process.env', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const beforeSecret = process.env.STOA_SESSION_SECRET
      const beforePort = process.env.STOA_WEBHOOK_PORT

      await provider.buildStartCommand(target, context)

      expect(process.env.STOA_SESSION_SECRET).toBe(beforeSecret)
      expect(process.env.STOA_WEBHOOK_PORT).toBe(beforePort)
    })

    test('codex provider extends process.env with lease-driven hook vars', async () => {
      const provider = getProvider('codex')
      const target = createTarget({ type: 'codex' })
      const context = createContext({ hookProvider: 'codex' })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_HOOK_LEASE_PATH).toBe(context.hookLeasePath)
      expect(command.env.STOA_HOOK_MANAGED).toBe('1')
      expect(command.env.STOA_HOOK_SESSION_ID).toBe(context.hookSessionId)
      expect(command.env.STOA_HOOK_PROJECT_ID).toBe(context.hookProjectId)
      expect(command.env.STOA_HOOK_PROVIDER).toBe('codex')
      expect(command.env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID).toBe(context.hookSpawnOwnerInstanceId)
      expect(command.env.STOA_HOOK_SPAWN_GENERATION).toBe(String(context.hookSpawnGeneration))
      expect(command.env.STOA_PROVIDER_PORT).toBe(String(context.providerPort))
      expect(command.env.STOA_SESSION_SECRET).toBeUndefined()
      expect(command.env.STOA_WEBHOOK_PORT).toBeUndefined()
    })
  })

  describe('Codex sidecar full data flow', () => {
    const acceptedEvents: CanonicalSessionEvent[] = []
    const webhookServers: Array<ReturnType<typeof createLocalWebhookServer>> = []

    afterEach(async () => {
      acceptedEvents.length = 0
      await Promise.allSettled(webhookServers.splice(0).map(s => s.stop()))
    })

    async function postCodexToServer(
      port: number,
      sessionId: string,
      projectId: string,
      secret: string,
      hookBody: Record<string, unknown>
    ): Promise<{ statusCode: number; body: string }> {
      const payload = JSON.stringify(hookBody)
      return new Promise((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/hooks/codex',
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
              'x-stoa-session-id': sessionId,
              'x-stoa-project-id': projectId,
              'x-stoa-secret': secret
            }
          },
          (res) => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', (chunk: string) => { body += chunk })
            res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
          }
        )
        req.on('error', reject)
        req.write(payload)
        req.end()
      })
    }

    test('installSidecar writes inline config.toml hooks with trusted state for all supported Codex lifecycle hooks', async () => {
      const workspaceDir = await createTempDir('stoa-codex-hooks-json-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const context = createContext()

      await withTempCodexHome(async () => {
        await provider.installSidecar(target, context)

        const configContent = await readFile(join(workspaceDir, '.codex', 'config.toml'), 'utf8')
        expect(configContent).toContain('[[hooks.SessionStart]]')
        expect(configContent).toContain('matcher = "startup|resume|clear"')
        expect(configContent).toContain('[[hooks.PreToolUse]]')
        expect(configContent).toContain('matcher = ".*"')
        expect(configContent).toContain('[[hooks.PostToolUse]]')
        expect(configContent).toContain(`command = ${JSON.stringify(expectedCodexHookCommand('Stop'))}`)
        expect(configContent).not.toContain('[hooks.state.')
        expect(configContent).not.toContain('trusted_hash = "sha256:')
      })
    })

    test('installSidecar writes config.toml with the latest hooks feature flag', async () => {
      const workspaceDir = await createTempDir('stoa-codex-config-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const context = createContext()

      await withTempCodexHome(async () => {
        await provider.installSidecar(target, context)

        const configPath = join(workspaceDir, '.codex', 'config.toml')
        const configContent = await readFile(configPath, 'utf8')

        expect(configContent).toContain('[features]')
        expect(configContent).toContain('hooks = true')
        expect(configContent).toContain('[[hooks.UserPromptSubmit]]')
        expect(configContent).not.toContain('codex_hooks')
      })
    })

    test('real Codex app-server sees project hooks as trusted after sidecar install', async () => {
      const workspaceDir = await createTempDir('stoa-codex-real-hooks-list-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })

      await withRealCodexHome(async (codexHomeDir) => {
        await provider.installSidecar(target, createContext())
        const hooks = await listCodexHooksThroughAppServer(workspaceDir, codexHomeDir)
        const stoaHooks = hooks.filter((hook) => {
          const command = typeof hook.command === 'string' ? hook.command : ''
          const sourcePath = typeof hook.sourcePath === 'string' ? hook.sourcePath : ''
          return command.includes('hook-dispatch') && sourcePath.toLowerCase().includes(workspaceDir.toLowerCase())
        })
        expect(stoaHooks).toHaveLength(5)
        expect(stoaHooks.map((hook) => hook.trustStatus)).toEqual([
          'trusted',
          'trusted',
          'trusted',
          'trusted',
          'trusted'
        ])
      })
    }, 20_000)

    test('installSidecar writes a shared dispatcher artifact for codex hooks', async () => {
      const workspaceDir = await createTempDir('stoa-codex-hook-sidecar-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const context = createContext()

      await withTempCodexHome(async () => {
        await provider.installSidecar(target, context)

        const content = await readFile(join(workspaceDir, '.stoa', 'hook-dispatch.mjs'), 'utf8')

        expect(content).toContain('/hooks/codex')
        expect(content).toContain('STOA_HOOK_LEASE_PATH')
        expect(content).toContain('x-stoa-session-id')
        expect(content).toContain('x-stoa-secret')
      })
    })

    test('full pipeline: webhook server receives and converts Codex PreToolUse hook into a working patch', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_flow_001' ? 'flow-secret' : null
        },
        onEvent(event) {
          acceptedEvents.push(event)
        }
      })
      webhookServers.push(server)
      const port = await server.start()

      const codexHookPayload = {
        hook_event_name: 'PreToolUse',
        session_id: 'codex-thread-abc',
        turn_id: 'turn-001',
        cwd: '/home/user/project',
        model: 'codex-1',
        tool_name: 'Bash',
        tool_use_id: 'tooluse-001'
      }

      const { statusCode, body } = await postCodexToServer(
        port, 'session_flow_001', 'project_flow_001', 'flow-secret', codexHookPayload
      )

      expect(statusCode).toBe(204)
      expect(body).toBe('')

      expect(acceptedEvents).toHaveLength(1)
      const event = acceptedEvents[0]!
      expect(event.event_type).toBe('codex.PreToolUse')
      expect(event.event_id).toEqual(expect.any(String))
      expect(event.session_id).toBe('session_flow_001')
      expect(event.project_id).toBe('project_flow_001')
      expect(event.source).toBe('provider-adapter')
      expect(event.payload.intent).toBe('agent.tool_started')
      expect(event.payload.sourceTurnId).toBe('turn-001')
      expect(event.payload.summary).toBe('PreToolUse')
      expect(event.payload.externalSessionId).toBe('codex-thread-abc')
      expect(event.evidence).toMatchObject({
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'PreToolUse'
        },
        hookEventName: 'PreToolUse',
        providerSessionId: 'codex-thread-abc',
        turnId: 'turn-001',
        cwd: '/home/user/project',
        model: 'codex-1',
        toolName: 'Bash',
        toolUseId: 'tooluse-001'
      })
    })

    test('full pipeline: Stop event produces a completion patch', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_flow_002' ? 'flow-secret-2' : null
        },
        onEvent(event) {
          acceptedEvents.push(event)
        }
      })
      webhookServers.push(server)
      const port = await server.start()

      const { statusCode } = await postCodexToServer(
        port, 'session_flow_002', 'project_flow_002', 'flow-secret-2',
        { hook_event_name: 'Stop', session_id: 'codex-thread-stop', turn_id: 'turn-final' }
      )

      expect(statusCode).toBe(204)
      expect(acceptedEvents).toHaveLength(1)
      expect(acceptedEvents[0]!.payload.intent).toBe('agent.turn_completed')
      expect(acceptedEvents[0]!.payload.sourceTurnId).toBe('turn-final')
      expect(acceptedEvents[0]!.event_type).toBe('codex.Stop')
    })

    test('full pipeline: unsupported hook events return ignored', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_flow_003' ? 'flow-secret-3' : null
        },
        onEvent(event) {
          acceptedEvents.push(event)
        }
      })
      webhookServers.push(server)
      const port = await server.start()

      const { statusCode, body } = await postCodexToServer(
        port, 'session_flow_003', 'project_flow_003', 'flow-secret-3',
        { hook_event_name: 'PostToolResult' }
      )

      expect(statusCode).toBe(204)
      expect(body).toBe('')
      expect(acceptedEvents).toHaveLength(0)
    })

  })

  describe('Codex hook sidecar spawn trigger', () => {
    const triggerEvents: CanonicalSessionEvent[] = []
    const triggerServers: Array<ReturnType<typeof createLocalWebhookServer>> = []

    afterEach(async () => {
      triggerEvents.length = 0
      await Promise.allSettled(triggerServers.splice(0).map(s => s.stop()))
    })

    async function spawnHookSidecar(
      port: number,
      sessionId: string,
      projectId: string,
      secret: string,
      hookEventName: string,
      stdinPayload: Record<string, unknown>
    ): Promise<{ exitCode: number | null; stderr: string }> {
      const workspaceDir = await createTempDir('stoa-trigger-hook-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const leasePath = join(workspaceDir, 'runtime-hook-lease.json')
      const context = createContext({
        webhookPort: port,
        sessionSecret: secret,
        hookLeasePath: leasePath,
        hookSessionId: sessionId,
        hookProjectId: projectId,
        hookProvider: 'codex'
      })
      await withTempCodexHome(async () => {
        await provider.installSidecar(target, context)
      })
      await writeFile(leasePath, `${JSON.stringify({
        version: 1,
        sessionId,
        projectId,
        provider: 'codex',
        leaseState: 'active',
        ownerInstanceId: 'instance-trigger',
        generation: 1,
        webhookBaseUrl: `http://127.0.0.1:${port}`,
        sessionSecret: secret,
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
        heartbeatAt: '2026-05-10T12:00:00.000Z',
        expiresAt: '2099-05-10T12:00:20.000Z',
        commitLockNonce: 'nonce-trigger',
        commitToken: 'token-trigger'
      }, null, 2)}\n`, 'utf8')

      return new Promise((resolve) => {
        const child = spawn('node', [join(workspaceDir, '.stoa', 'hook-dispatch.mjs'), 'codex', hookEventName], {
          env: {
            ...process.env as Record<string, string>,
            STOA_HOOK_LEASE_PATH: leasePath,
            STOA_HOOK_MANAGED: '1',
            STOA_HOOK_SESSION_ID: sessionId,
            STOA_HOOK_PROJECT_ID: projectId,
            STOA_HOOK_PROVIDER: 'codex',
            STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-trigger',
            STOA_HOOK_SPAWN_GENERATION: '1'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        })

        let stderr = ''
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        child.stdin?.write(JSON.stringify(stdinPayload))
        child.stdin?.end()

        child.on('close', (code) => {
          resolve({ exitCode: code, stderr })
        })
      })
    }

    test('spawning shared dispatcher with SessionStart payload delivers event to webhook', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(id) { return id === 'trigger-sess-1' ? 'trigger-secret-1' : null },
        onEvent(event) { triggerEvents.push(event) }
      })
      triggerServers.push(server)
      const port = await server.start()

      const { exitCode, stderr } = await spawnHookSidecar(
        port, 'trigger-sess-1', 'trigger-proj-1', 'trigger-secret-1', 'SessionStart',
        {
          hook_event_name: 'SessionStart',
          session_id: 'codex-uuid-start',
          turn_id: 'turn-start-001',
          cwd: '/home/user/project',
          model: 'o4-mini',
          permission_mode: 'default'
        }
      )

      expect(exitCode).toBe(0)
      expect(stderr).toBe('')
      expect(triggerEvents).toHaveLength(1)
      expect(triggerEvents[0]).toMatchObject({
        event_type: 'codex.SessionStart',
        event_id: expect.any(String),
        session_id: 'trigger-sess-1',
        project_id: 'trigger-proj-1',
        source: 'provider-adapter',
        payload: {
          intent: 'runtime.alive',
          sourceTurnId: 'turn-start-001',
          summary: 'SessionStart',
          externalSessionId: 'codex-uuid-start'
        },
        evidence: {
          rawSource: {
            provider: 'codex',
            channel: 'hook',
            rawEventName: 'SessionStart'
          },
          hookEventName: 'SessionStart',
          providerSessionId: 'codex-uuid-start',
          turnId: 'turn-start-001',
          cwd: '/home/user/project',
          model: 'o4-mini'
        }
      })
    })

    test('codex hook command string is executable through cmd and delivers event on Windows', async () => {
      test.skipIf(process.platform !== 'win32')

      const server = createLocalWebhookServer({
        getSessionSecret(id) { return id === 'trigger-sess-cmd' ? 'trigger-secret-cmd' : null },
        onEvent(event) { triggerEvents.push(event) }
      })
      triggerServers.push(server)
      const port = await server.start()

      const workspaceDir = await createTempDir('stoa-trigger-hook-cmd-')
      const provider = getProvider('codex')
      const leasePath = join(workspaceDir, 'runtime-hook-lease.json')

      await withTempCodexHome(async () => {
        await provider.installSidecar(
          createTarget({ path: workspaceDir, type: 'codex' }),
          createContext({
            webhookPort: port,
            sessionSecret: 'trigger-secret-cmd',
            hookLeasePath: leasePath,
            hookSessionId: 'trigger-sess-cmd',
            hookProjectId: 'trigger-proj-cmd',
            hookProvider: 'codex',
            hookManaged: true,
            hookSpawnOwnerInstanceId: 'instance-trigger-cmd',
            hookSpawnGeneration: 1
          })
        )
      })

      await writeFile(leasePath, `${JSON.stringify({
        version: 1,
        sessionId: 'trigger-sess-cmd',
        projectId: 'trigger-proj-cmd',
        provider: 'codex',
        leaseState: 'active',
        ownerInstanceId: 'instance-trigger-cmd',
        generation: 1,
        webhookBaseUrl: `http://127.0.0.1:${port}`,
        sessionSecret: 'trigger-secret-cmd',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
        heartbeatAt: '2026-05-10T12:00:00.000Z',
        expiresAt: '2099-05-10T12:00:20.000Z',
        commitLockNonce: 'nonce-trigger-cmd',
        commitToken: 'token-trigger-cmd'
      }, null, 2)}\n`, 'utf8')

      const commandString = expectedCodexHookCommand('SessionStart')
      const result = await new Promise<{ exitCode: number | null; stderr: string }>((resolve) => {
        const child = spawn('cmd.exe', ['/c', commandString], {
          cwd: workspaceDir,
          env: {
            ...process.env as Record<string, string>,
            STOA_HOOK_LEASE_PATH: leasePath,
            STOA_HOOK_MANAGED: '1',
            STOA_HOOK_SESSION_ID: 'trigger-sess-cmd',
            STOA_HOOK_PROJECT_ID: 'trigger-proj-cmd',
            STOA_HOOK_PROVIDER: 'codex',
            STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-trigger-cmd',
            STOA_HOOK_SPAWN_GENERATION: '1'
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true
        })

        let stderr = ''
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => { stderr += chunk })
        child.stdin?.write(JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 'codex-hook-session',
          turn_id: 'turn-hook-1',
          cwd: workspaceDir,
          model: 'gpt-5.4-nano'
        }))
        child.stdin?.end()
        child.on('close', (code) => resolve({ exitCode: code, stderr }))
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(triggerEvents).toHaveLength(1)
      expect(triggerEvents[0]).toMatchObject({
        event_type: 'codex.SessionStart',
        session_id: 'trigger-sess-cmd',
        project_id: 'trigger-proj-cmd',
        payload: {
          intent: 'runtime.alive',
          sourceTurnId: 'turn-hook-1'
        }
      })
    })

    test('spawning shared dispatcher with PreToolUse payload delivers tool details', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(id) { return id === 'trigger-sess-2' ? 'trigger-secret-2' : null },
        onEvent(event) { triggerEvents.push(event) }
      })
      triggerServers.push(server)
      const port = await server.start()

      const { exitCode } = await spawnHookSidecar(
        port, 'trigger-sess-2', 'trigger-proj-2', 'trigger-secret-2', 'PreToolUse',
        {
          hook_event_name: 'PreToolUse',
          session_id: 'codex-uuid-tool',
          turn_id: 'turn-tool-001',
          tool_name: 'Bash',
          tool_use_id: 'tooluse-bash-001',
          tool_input: { command: 'cargo build' }
        }
      )

      expect(exitCode).toBe(0)
      expect(triggerEvents).toHaveLength(1)
      expect(triggerEvents[0]).toMatchObject({
        event_type: 'codex.PreToolUse',
        event_id: expect.any(String),
        session_id: 'trigger-sess-2',
        payload: {
          intent: 'agent.tool_started',
          sourceTurnId: 'turn-tool-001',
          summary: 'PreToolUse'
        },
        evidence: {
          rawSource: {
            provider: 'codex',
            channel: 'hook',
            rawEventName: 'PreToolUse'
          },
          hookEventName: 'PreToolUse',
          providerSessionId: 'codex-uuid-tool',
          turnId: 'turn-tool-001',
          toolName: 'Bash',
          toolUseId: 'tooluse-bash-001'
        }
      })
    })

    test('spawning shared dispatcher with Stop payload produces a completion patch', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(id) { return id === 'trigger-sess-3' ? 'trigger-secret-3' : null },
        onEvent(event) { triggerEvents.push(event) }
      })
      triggerServers.push(server)
      const port = await server.start()

      const { exitCode } = await spawnHookSidecar(
        port, 'trigger-sess-3', 'trigger-proj-3', 'trigger-secret-3', 'Stop',
        {
          hook_event_name: 'Stop',
          session_id: 'codex-uuid-stop',
          turn_id: 'turn-stop-001'
        }
      )

      expect(exitCode).toBe(0)
      expect(triggerEvents).toHaveLength(1)
      expect(triggerEvents[0]!.payload.intent).toBe('agent.turn_completed')
      expect(triggerEvents[0]!.payload.sourceTurnId).toBe('turn-stop-001')
      expect(triggerEvents[0]!.event_type).toBe('codex.Stop')
    })

    test('spawning shared dispatcher without env vars exits silently with no events', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret() { return null },
        onEvent(event) { triggerEvents.push(event) }
      })
      triggerServers.push(server)
      const port = await server.start()

      const workspaceDir = await createTempDir('stoa-trigger-noenv-')
      const provider = getProvider('codex')
      await withTempCodexHome(async () => {
        await provider.installSidecar(
          createTarget({ path: workspaceDir, type: 'codex' }),
          createContext({ webhookPort: port, sessionSecret: 'secret' })
        )
      })

      const { exitCode } = await new Promise<{ exitCode: number | null }>((resolve) => {
        const child = spawn('node', [join(workspaceDir, '.stoa', 'hook-dispatch.mjs'), 'codex', 'SessionStart'], {
          env: { ...process.env as Record<string, string> },
          stdio: ['pipe', 'pipe', 'pipe']
        })
        child.stdin?.write(JSON.stringify({ hook_event_name: 'SessionStart' }))
        child.stdin?.end()
        child.on('close', (code) => resolve({ exitCode: code }))
      })

      expect(exitCode).toBe(0)
      expect(triggerEvents).toHaveLength(0)
    })

    test('spawning shared dispatcher with wrong secret produces no events', async () => {
      const server = createLocalWebhookServer({
        getSessionSecret(id) { return id === 'trigger-sess-4' ? 'correct-secret' : null },
        onEvent(event) { triggerEvents.push(event) }
      })
      triggerServers.push(server)
      const port = await server.start()

      const { exitCode } = await spawnHookSidecar(
        port, 'trigger-sess-4', 'trigger-proj-4', 'wrong-secret', 'SessionStart',
        { hook_event_name: 'SessionStart', turn_id: 'turn-1' }
      )

      expect(exitCode).toBe(0)
      expect(triggerEvents).toHaveLength(0)
    })
  })

  describe('Real Codex hook delivery', () => {
    test.skipIf(!SHOULD_RUN_REAL_CODEX_TESTS)(
      'real codex exec delivers hook events to Stoa through project hooks',
      async () => {
        const workspaceDir = await createExternalTempDir('stoa-codex-real-exec-')
        const acceptedEvents: CanonicalSessionEvent[] = []
        const sessionId = 'session_real_codex_exec'
        const projectId = 'project_real_codex_exec'
        const sessionSecret = 'secret-real-codex-exec'

        const server = createLocalWebhookServer({
          getSessionSecret(id) {
            return id === sessionId ? sessionSecret : null
          },
          onEvent(event) {
            acceptedEvents.push(event)
          }
        })
        const port = await server.start()

        try {
          await withRealCodexHome(async (codexHomeDir) => {
            const provider = getProvider('codex')
            const target = createTarget({
              path: workspaceDir,
              type: 'codex',
              session_id: sessionId,
              project_id: projectId,
              title: 'real-codex-session'
            })
            const leasePath = join(workspaceDir, 'runtime-hook-lease.json')
            const context = createContext({
              webhookPort: port,
              sessionSecret,
              hookLeasePath: leasePath,
              hookManaged: true,
              hookSessionId: sessionId,
              hookProjectId: projectId,
              hookProvider: 'codex',
              hookSpawnOwnerInstanceId: 'instance-real-codex',
              hookSpawnGeneration: 1,
              providerPath: resolveCodexCliPath()
            })

            await provider.installSidecar(target, context)
            await writeFile(leasePath, `${JSON.stringify({
              version: 1,
              sessionId,
              projectId,
              provider: 'codex',
              leaseState: 'active',
              ownerInstanceId: 'instance-real-codex',
              generation: 1,
              webhookBaseUrl: `http://127.0.0.1:${port}`,
              sessionSecret,
              createdAt: '2026-05-10T12:00:00.000Z',
              updatedAt: '2026-05-10T12:00:00.000Z',
              heartbeatAt: '2026-05-10T12:00:00.000Z',
              expiresAt: '2099-05-10T12:00:20.000Z',
              commitLockNonce: 'nonce-real-codex',
              commitToken: 'token-real-codex'
            }, null, 2)}\n`, 'utf8')

            const { child, output } = spawnCodexCli([
              'exec',
              '--skip-git-repo-check',
              '--dangerously-bypass-approvals-and-sandbox',
              '--cd',
              workspaceDir,
              '-m',
              'gpt-5.4-nano',
              'Reply with exactly: STOA_REAL_HOOK_OK'
            ], {
              cwd: workspaceDir,
              env: {
                ...process.env as Record<string, string | undefined>,
                CODEX_HOME: codexHomeDir,
                STOA_HOOK_LEASE_PATH: leasePath,
                STOA_HOOK_MANAGED: '1',
                STOA_HOOK_SESSION_ID: sessionId,
                STOA_HOOK_PROJECT_ID: projectId,
                STOA_HOOK_PROVIDER: 'codex',
                STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-real-codex',
                STOA_HOOK_SPAWN_GENERATION: '1'
              }
            })

            try {
              await waitForCondition(
                () => acceptedEvents.some((event) => event.event_type === 'codex.UserPromptSubmit'),
                {
                  timeoutMs: 60_000,
                  timeoutMessage:
                    `Timed out waiting for Codex hook delivery.\nstderr:\n${output.stderr}\nstdout:\n${output.stdout}`
                }
              )
            } finally {
              await terminateChildProcessTree(child)
            }

            await waitForChildClose(child)

            expect(output.stderr).not.toContain('Untrusted')
            expect(acceptedEvents.length).toBeGreaterThan(0)
            expect(acceptedEvents.some((event) => event.event_type === 'codex.SessionStart')).toBe(true)
            expect(acceptedEvents.some((event) => event.event_type === 'codex.UserPromptSubmit')).toBe(true)
          })
        } finally {
          await server.stop()
        }
      },
      180_000
    )
  })

})

function parsedClaudeHttpHook(
  settingsJson: string,
  eventName: string
): Record<string, unknown> {
  const settings = JSON.parse(settingsJson) as {
    hooks?: Record<string, Array<{ hooks?: Array<Record<string, unknown>> }>>
  }
  const hook = settings.hooks?.[eventName]?.[0]?.hooks?.[0]
  if (!hook) {
    throw new Error(`${eventName} hook is missing.`)
  }

  return hook
}
