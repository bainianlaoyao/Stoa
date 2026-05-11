import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createCodexProvider } from './codex-provider'

function expectedCodexHookCommand(eventName: string): string {
  return process.platform === 'win32'
    ? `.\\.stoa\\hook-dispatch.cmd codex ${eventName}`
    : `.stoa/hook-dispatch codex ${eventName}`
}

describe('codex provider', () => {
  test('buildStartCommand relies on project-managed hook config files instead of cli overrides', async () => {
    const provider = createCodexProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_demo_001',
      project_id: 'project_demo',
      path: 'D:/workspace/demo',
      title: 'demo',
      type: 'codex'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret-1',
      providerPort: 43128,
      hookLeasePath: 'D:/runtime/hook-leases/session_demo_001.json',
      hookManaged: true,
      hookSessionId: 'session_demo_001',
      hookProjectId: 'project_demo',
      hookProvider: 'codex',
      hookSpawnOwnerInstanceId: 'instance-1',
      hookSpawnGeneration: 7
    })

    expect(command.command).toBe('codex')
    expect(command.cwd).toBe('D:/workspace/demo')
    expect(command.env.STOA_HOOK_LEASE_PATH).toBe('D:/runtime/hook-leases/session_demo_001.json')
    expect(command.args).toEqual([])
  })

  test('buildResumeCommand only adds resume arguments because hooks come from project config', async () => {
    const provider = createCodexProvider()

    const command = await provider.buildResumeCommand({
      session_id: 'session_demo_002',
      project_id: 'project_demo',
      path: 'D:/workspace/demo',
      title: 'demo',
      type: 'codex'
    }, 'codex-external-1', {
      webhookPort: 43127,
      sessionSecret: 'secret-1',
      providerPort: 43128
    })

    expect(command.args).toEqual(['resume', 'codex-external-1'])
  })

  test('installSidecar writes shared dispatcher artifacts and official Codex hook config files', async () => {
    const provider = createCodexProvider()
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-codex-sidecar-'))
    const codexHomeDir = await mkdtemp(join(tmpdir(), 'stoa-codex-home-'))
    const previousCodexHome = process.env.CODEX_HOME

    try {
      process.env.CODEX_HOME = codexHomeDir
      await provider.installSidecar({
        session_id: 'session_demo_003',
        project_id: 'project_demo',
        path: workspaceDir,
        title: 'demo',
        type: 'codex'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-1',
        providerPort: 43128
      })

      await expect(stat(join(workspaceDir, '.stoa', 'hook-dispatch.mjs'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.stoa', 'hook-dispatch'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.stoa', 'hook-dispatch.cmd'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.stoa', 'hook-contract.json'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.codex', '.stoa-managed-sidecar.json'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.codex', 'config.toml'))).resolves.toMatchObject({ isFile: expect.any(Function) })
      await expect(stat(join(workspaceDir, '.codex', 'hooks.json'))).rejects.toThrow()

      const configContent = await readFile(join(workspaceDir, '.codex', 'config.toml'), 'utf8')
      const userConfigContent = await readFile(join(codexHomeDir, 'config.toml'), 'utf8')
      const dispatcherContent = await readFile(join(workspaceDir, '.stoa', 'hook-dispatch.mjs'), 'utf8')

      expect(configContent).toContain('[features]')
      expect(configContent).toContain('hooks = true')
      expect(configContent).toContain('[[hooks.SessionStart]]')
      expect(configContent).toContain(`command = ${JSON.stringify(expectedCodexHookCommand('SessionStart'))}`)
      expect(configContent).toContain(`command = ${JSON.stringify(expectedCodexHookCommand('Stop'))}`)
      expect(configContent).not.toContain('[hooks.state.')
      expect(configContent).not.toContain('trusted_hash = "sha256:')
      expect(configContent).not.toContain('codex_hooks')
      expect(userConfigContent).toContain('trust_level = "trusted"')
      expect(userConfigContent).toContain('[hooks.state.')
      expect(userConfigContent).toContain('trusted_hash = "sha256:')
      expect(userConfigContent.toLowerCase().replaceAll('\\\\', '\\')).toContain(workspaceDir.toLowerCase())
      expect(dispatcherContent).toContain('/hooks/codex')
      expect(dispatcherContent).toContain('STOA_HOOK_LEASE_PATH')
      expect(dispatcherContent).not.toContain('../src/extensions/providers/shared-hook-dispatch.ts')
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME
      } else {
        process.env.CODEX_HOME = previousCodexHome
      }
      await rm(workspaceDir, { recursive: true, force: true })
      await rm(codexHomeDir, { recursive: true, force: true })
    }
  })
})
