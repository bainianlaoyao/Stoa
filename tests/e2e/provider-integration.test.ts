import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getProvider, listProviders } from '@extensions/providers'
import type { ProviderCommandContext } from '@shared/project-session'
import type { ProviderRuntimeTarget } from '@extensions/providers'
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
    ...overrides
  }
}

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
        payload: { status: 'running' as const }
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

    test('buildStartCommand sets STOA_* environment variables', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({
        session_id: 'session_s1',
        project_id: 'project_p1',
        type: 'opencode'
      })
      const context = createContext({
        sessionSecret: 'my-secret-123',
        webhookPort: 55555,
        providerPort: 55556
      })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_SESSION_ID).toBe('session_s1')
      expect(command.env.STOA_PROJECT_ID).toBe('project_p1')
      expect(command.env.STOA_SESSION_SECRET).toBe('my-secret-123')
      expect(command.env.STOA_WEBHOOK_PORT).toBe('55555')
      expect(command.env.STOA_PROVIDER_PORT).toBe('55556')
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

    test('buildFallbackResumeCommand falls back to resume --last when external session id is unavailable', async () => {
      const provider = getProvider('codex')
      const target = createTarget({ type: 'codex' })
      const context = createContext()

      const command = await provider.buildFallbackResumeCommand?.(target, context)

      expect(command?.args).toEqual(['resume', '--last'])
    })

    test('supportsStructuredEvents() returns true', () => {
      const provider = getProvider('codex')
      expect(provider.supportsStructuredEvents()).toBe(true)
    })

    test('buildStartCommand sets STOA_* environment variables', async () => {
      const provider = getProvider('codex')
      const target = createTarget({
        session_id: 'session_codex_1',
        project_id: 'project_codex_1',
        type: 'codex'
      })
      const context = createContext({
        sessionSecret: 'codex-secret',
        webhookPort: 47770,
        providerPort: 47771
      })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_SESSION_ID).toBe('session_codex_1')
      expect(command.env.STOA_PROJECT_ID).toBe('project_codex_1')
      expect(command.env.STOA_SESSION_SECRET).toBe('codex-secret')
      expect(command.env.STOA_WEBHOOK_PORT).toBe('47770')
      expect(command.env.STOA_PROVIDER_PORT).toBe('47771')
    })

    test('installSidecar writes shared config.toml and notify script', async () => {
      const workspaceDir = await createTempDir('stoa-codex-sidecar-')
      const provider = getProvider('codex')
      const target = createTarget({ path: workspaceDir, type: 'codex' })
      const context = createContext()

      await provider.installSidecar(target, context)

      const configPath = join(workspaceDir, '.codex', 'config.toml')
      const notifyPath = join(workspaceDir, '.codex', 'notify-stoa.mjs')
      await expect(stat(configPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(notifyPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    })

    test('shared notify script reads session identity from process.env instead of baking session ids', async () => {
      const workspaceDir = await createTempDir('stoa-codex-env-sidecar-')
      const provider = getProvider('codex')
      const target = createTarget({
        path: workspaceDir,
        type: 'codex',
        session_id: 'session_internal_codex',
        project_id: 'project_internal_codex'
      })

      await provider.installSidecar(target, createContext({ webhookPort: 43127, sessionSecret: 'secret-codex' }))

      const content = await readFile(join(workspaceDir, '.codex', 'notify-stoa.mjs'), 'utf8')
      expect(content).toContain('process.env.STOA_SESSION_ID')
      expect(content).toContain('process.env.STOA_PROJECT_ID')
      expect(content).toContain('process.env.STOA_SESSION_SECRET')
      expect(content).toContain('process.env.STOA_WEBHOOK_PORT')
      expect(content).not.toContain('session_internal_codex')
      expect(content).not.toContain('project_internal_codex')
      expect(content).not.toContain('secret-codex')
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

    test('buildStartCommand sets STOA_* environment variables', async () => {
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
        providerPort: 48881
      })

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_SESSION_ID).toBe('session_claude_telemetry')
      expect(command.env.STOA_PROJECT_ID).toBe('project_claude_telemetry')
      expect(command.env.STOA_SESSION_SECRET).toBe('claude-secret')
      expect(command.env.STOA_WEBHOOK_PORT).toBe('48880')
      expect(command.env.STOA_PROVIDER_PORT).toBe('48881')
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

      const content = await readFile(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8')
      const settings = JSON.parse(content) as { hooks: Record<string, unknown> }
      expect(content).toContain('http://127.0.0.1:43127/hooks/claude-code')
      expect(content).toContain('x-stoa-session-id')
      expect(content).toContain('x-stoa-project-id')
      expect(content).toContain('x-stoa-secret')
      expect(content).toContain('allowedEnvVars')
      expect(content).toContain('STOA_SESSION_ID')
      expect(content).toContain('STOA_PROJECT_ID')
      expect(content).toContain('STOA_SESSION_SECRET')
      expect(Object.keys(settings.hooks).sort()).toEqual([
        'PermissionRequest',
        'PreToolUse',
        'Stop',
        'StopFailure',
        'UserPromptSubmit'
      ])
      expect(content).not.toContain('secret-claude')
      expect(content).not.toContain(target.session_id)
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
    })

    test('sidecar file contains webhook URL with correct port', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-url-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext({ webhookPort: 43127 })

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('http://127.0.0.1:43127/events')
    })

    test('sidecar file contains session secret in header', async () => {
      const workspaceDir = await createTempDir('stoa-e2e-sidecar-secret-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext({ sessionSecret: 'my-super-secret-key' })

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('x-stoa-secret')
      expect(content).toContain('process.env.STOA_SESSION_SECRET')
      expect(content).not.toContain('my-super-secret-key')
    })

    test('shared sidecar plugin reads session identity from runtime env instead of baking ids', async () => {
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
      expect(content).toContain('process.env.STOA_SESSION_ID')
      expect(content).toContain('process.env.STOA_PROJECT_ID')
      expect(content).toContain('process.env.STOA_SESSION_SECRET')
      expect(content).toContain('http://127.0.0.1:43127/events')
      expect(content).not.toContain('session_test_s99')
      expect(content).not.toContain('project_test_p99')
    })

    test('sidecar plugin emits only explicit state-changing statuses', async () => {
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
      expect(content).toContain("case 'session.idle'")
      expect(content).toContain("status = 'turn_complete'")
      expect(content).toContain("case 'permission.asked'")
      expect(content).toContain("status = 'needs_confirmation'")
      expect(content).toContain("case 'permission.replied'")
      expect(content).toContain("status = 'running'")
      expect(content).toContain("case 'session.error'")
      expect(content).toContain("status = 'error'")
      expect(content).toContain('externalSessionId: event.properties?.sessionID ?? undefined')
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
      expect(content).toContain('process.env.STOA_SESSION_ID')
      expect(content).toContain('process.env.STOA_PROJECT_ID')
      expect(content).toContain('127.0.0.1:22222')
      expect(content).toContain('process.env.STOA_SESSION_SECRET')
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

    test('opencode provider extends process.env with STOA_ vars', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_SESSION_ID).toBe(target.session_id)
      expect(command.env.STOA_PROJECT_ID).toBe(target.project_id)
      expect(command.env.STOA_SESSION_SECRET).toBe(context.sessionSecret)
      expect(command.env.STOA_WEBHOOK_PORT).toBe(String(context.webhookPort))
      expect(command.env.STOA_PROVIDER_PORT).toBe(String(context.providerPort))

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

    test('codex provider extends process.env with STOA_ vars', async () => {
      const provider = getProvider('codex')
      const target = createTarget({ type: 'codex' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.STOA_SESSION_ID).toBe(target.session_id)
      expect(command.env.STOA_PROJECT_ID).toBe(target.project_id)
      expect(command.env.STOA_SESSION_SECRET).toBe(context.sessionSecret)
      expect(command.env.STOA_WEBHOOK_PORT).toBe(String(context.webhookPort))
      expect(command.env.STOA_PROVIDER_PORT).toBe(String(context.providerPort))
    })
  })
})
