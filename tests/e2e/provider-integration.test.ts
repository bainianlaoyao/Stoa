import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getProvider, listProviders } from '@extensions/providers'
import type { ProviderCommandContext } from '@shared/project-session'
import type { ProviderRuntimeTarget } from '@extensions/providers'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  )
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
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
    test('listProviders returns both local-shell and opencode providers', () => {
      const providers = listProviders()
      const ids = providers.map(p => p.providerId)
      expect(ids).toContain('local-shell')
      expect(ids).toContain('opencode')
      expect(providers).toHaveLength(2)
    })

    test('getProvider returns local shell provider', () => {
      const provider = getProvider('local-shell')
      expect(provider.providerId).toBe('local-shell')
    })

    test('getProvider returns opencode provider', () => {
      const provider = getProvider('opencode')
      expect(provider.providerId).toBe('opencode')
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
      const workspaceDir = await createTempDir('vibecoding-e2e-nosidecar-')
      const target = createTarget({ path: workspaceDir, type: 'shell' })
      const context = createContext()

      await provider.installSidecar(target, context)

      const sidecarPath = join(workspaceDir, '.opencode', 'plugins', 'vibecoding-status.ts')
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
    test('buildStartCommand includes --port flag with correct port', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext({ providerPort: 44000 })

      const command = await provider.buildStartCommand(target, context)

      expect(command.args).toContain('--port')
      const portIndex = command.args.indexOf('--port')
      expect(command.args[portIndex + 1]).toBe('44000')
    })

    test('buildStartCommand sets VIBECODING_* environment variables', async () => {
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

      expect(command.env.VIBECODING_SESSION_ID).toBe('session_s1')
      expect(command.env.VIBECODING_PROJECT_ID).toBe('project_p1')
      expect(command.env.VIBECODING_SESSION_SECRET).toBe('my-secret-123')
      expect(command.env.VIBECODING_WEBHOOK_PORT).toBe('55555')
      expect(command.env.VIBECODING_PROVIDER_PORT).toBe('55556')
    })

    test('buildResumeCommand includes --session flag with external ID', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const command = await provider.buildResumeCommand(target, 'ext-session-42', context)

      expect(command.args).toContain('--session')
      expect(command.args).toContain('ext-session-42')
    })

    test('buildResumeCommand includes --port flag', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext({ providerPort: 44000 })

      const command = await provider.buildResumeCommand(target, 'ext-1', context)

      expect(command.args).toContain('--port')
      const portIndex = command.args.indexOf('--port')
      expect(command.args[portIndex + 1]).toBe('44000')
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

  describe('OpenCode sidecar installation (real file system)', () => {
    test('installSidecar creates .opencode/plugins directory', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-sidecar-dir-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext()

      await provider.installSidecar(target, context)

      const pluginDir = join(workspaceDir, '.opencode', 'plugins')
      const dirStat = await stat(pluginDir)
      expect(dirStat.isDirectory()).toBe(true)
    })

    test('installSidecar writes vibecoding-status.ts file', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-sidecar-file-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext()

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'vibecoding-status.ts')
      const fileStat = await stat(pluginPath)
      expect(fileStat.isFile()).toBe(true)
    })

    test('sidecar file contains webhook URL with correct port', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-sidecar-url-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext({ webhookPort: 43127 })

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'vibecoding-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('http://127.0.0.1:43127/events')
    })

    test('sidecar file contains session secret in header', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-sidecar-secret-')
      const provider = getProvider('opencode')
      const target = createTarget({ path: workspaceDir })
      const context = createContext({ sessionSecret: 'my-super-secret-key' })

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'vibecoding-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('x-vibecoding-secret')
      expect(content).toContain('my-super-secret-key')
    })

    test('sidecar file references correct session_id and project_id', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-sidecar-ids-')
      const provider = getProvider('opencode')
      const target = createTarget({
        path: workspaceDir,
        session_id: 'session_test_s99',
        project_id: 'project_test_p99'
      })
      const context = createContext()

      await provider.installSidecar(target, context)

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'vibecoding-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('session_test_s99')
      expect(content).toContain('project_test_p99')
    })

    test('calling installSidecar twice overwrites the file', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-sidecar-overwrite-')
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

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'vibecoding-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('session_v2')
      expect(content).toContain('project_v2')
      expect(content).toContain('127.0.0.1:22222')
      expect(content).toContain('secret-v2')
      expect(content).not.toContain('session_v1')
      expect(content).not.toContain('secret-v1')
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

    test('opencode provider extends process.env with VIBECODING_ vars', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const command = await provider.buildStartCommand(target, context)

      expect(command.env.VIBECODING_SESSION_ID).toBe(target.session_id)
      expect(command.env.VIBECODING_PROJECT_ID).toBe(target.project_id)
      expect(command.env.VIBECODING_SESSION_SECRET).toBe(context.sessionSecret)
      expect(command.env.VIBECODING_WEBHOOK_PORT).toBe(String(context.webhookPort))
      expect(command.env.VIBECODING_PROVIDER_PORT).toBe(String(context.providerPort))

      const processEnvKeys = Object.keys(process.env)
      for (const key of processEnvKeys) {
        expect(command.env[key]).toBe((process.env as Record<string, string>)[key])
      }
    })

    test('opencode env vars do not modify original process.env', async () => {
      const provider = getProvider('opencode')
      const target = createTarget({ type: 'opencode' })
      const context = createContext()

      const beforeSecret = process.env.VIBECODING_SESSION_SECRET
      const beforePort = process.env.VIBECODING_WEBHOOK_PORT

      await provider.buildStartCommand(target, context)

      expect(process.env.VIBECODING_SESSION_SECRET).toBe(beforeSecret)
      expect(process.env.VIBECODING_WEBHOOK_PORT).toBe(beforePort)
    })
  })
})
