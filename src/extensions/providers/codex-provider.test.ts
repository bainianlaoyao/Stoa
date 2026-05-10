import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createCodexProvider } from './codex-provider'

describe('codex provider', () => {
  test('discovers external session id from current Codex session_meta payload schema', async () => {
    const provider = createCodexProvider()
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-codex-workspace-'))
    const codexHomeDir = await mkdtemp(join(tmpdir(), 'stoa-codex-home-'))
    const originalCodexHome = process.env.CODEX_HOME
    const startedAt = Date.now()

    try {
      process.env.CODEX_HOME = codexHomeDir

      const sessionDir = join(codexHomeDir, 'sessions', '2026', '05', '10')
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, 'rollout-2026-05-10T15-16-41-019e0784-c299-7280-8d85-9bcde6d72ecc.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-05-10T07:16:59.592Z',
          type: 'session_meta',
          payload: {
            id: '019e0784-c299-7280-8d85-9bcde6d72ecc',
            cwd: workspaceDir
          }
        })}\n`,
        'utf8'
      )

      const sessionId = await provider.discoverExternalSessionIdAfterStart?.({
        session_id: 'session_demo_001',
        project_id: 'project_demo',
        path: workspaceDir,
        title: 'demo',
        type: 'codex'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-1',
        providerPort: 43128,
        startedAt
      })

      expect(sessionId).toBe('019e0784-c299-7280-8d85-9bcde6d72ecc')
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME
      } else {
        process.env.CODEX_HOME = originalCodexHome
      }
      await rm(workspaceDir, { recursive: true, force: true })
      await rm(codexHomeDir, { recursive: true, force: true })
    }
  }, 15000)

  test('writes sidecar files using the current Codex hooks contract', async () => {
    const provider = createCodexProvider()
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-codex-sidecar-'))

    try {
      await provider.installSidecar({
        session_id: 'session_demo_002',
        project_id: 'project_demo',
        path: workspaceDir,
        title: 'demo',
        type: 'codex'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-1',
        providerPort: 43128
      })

      const configContent = await readFile(join(workspaceDir, '.codex', 'config.toml'), 'utf8')
      const hooksContent = await readFile(join(workspaceDir, '.codex', 'hooks.json'), 'utf8')

      expect(configContent).toContain('[features]')
      expect(configContent).toContain('codex_hooks = true')
      expect(configContent).not.toContain('\nhooks = true\n')

      const parsed = JSON.parse(hooksContent) as {
        hooks: Record<string, Array<{ hooks: Array<{ timeout?: number; timeout_sec?: number }> }>>
      }
      expect(parsed.hooks.SessionStart[0]?.hooks[0]?.timeout).toBe(5)
      expect(parsed.hooks.SessionStart[0]?.hooks[0]?.timeout_sec).toBeUndefined()
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
