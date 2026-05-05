import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import { syncManagedSidecars } from './managed-sidecar-maintenance'

describe('managed-sidecar-maintenance', () => {
  test('refreshes legacy Claude artifacts into managed HTTP hooks during main boot maintenance', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'stoa-managed-sidecar-main-'))
    try {
      await mkdir(join(projectDir, '.claude', 'hooks'), { recursive: true })
      await writeFile(join(projectDir, '.claude', 'hooks', 'evolver-session-end.cjs'), 'legacy\n', 'utf8')

      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({
        name: 'novel_writer',
        path: projectDir,
        defaultSessionType: 'claude-code'
      })

      await syncManagedSidecars({
        snapshotSource: manager,
        webhookPort: 43127,
        logger: console
      })

      const settings = JSON.parse(await readFile(join(project.path, '.claude', 'settings.json'), 'utf8')) as {
        hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; url?: string }> }>>
      }
      const sessionStartHook = settings.hooks?.SessionStart?.[0]?.hooks?.[0]
      expect(sessionStartHook).toMatchObject({
        type: 'http',
        url: 'http://127.0.0.1:43127/hooks/claude-code'
      })
      await expect(readFile(join(projectDir, '.claude', 'hooks', 'evolver-session-end.cjs'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test('refreshes codex managed sidecar during main boot maintenance when marker artifacts already exist', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'stoa-managed-codex-main-'))
    try {
      await mkdir(join(projectDir, '.codex'), { recursive: true })
      await writeFile(join(projectDir, '.codex', 'hook-stoa.mjs'), 'legacy\n', 'utf8')

      const manager = ProjectSessionManager.createForTest()
      await manager.createProject({
        name: 'codex-project',
        path: projectDir,
        defaultSessionType: 'shell'
      })

      await syncManagedSidecars({
        snapshotSource: manager,
        webhookPort: 43127,
        logger: console
      })

      const hooks = JSON.parse(await readFile(join(projectDir, '.codex', 'hooks.json'), 'utf8')) as {
        hooks?: Record<string, unknown>
      }
      expect(Object.keys(hooks.hooks ?? {}).sort()).toEqual([
        'PostToolUse',
        'SessionStart',
        'Stop',
        'UserPromptSubmit'
      ])
      expect(await readFile(join(projectDir, '.codex', 'hook-stoa.mjs'), 'utf8')).toContain('/hooks/codex')
      expect(await readFile(join(projectDir, '.codex', 'config.toml'), 'utf8')).toContain('codex_hooks = true')
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test('refreshes opencode managed sidecar during main boot maintenance when marker artifacts already exist', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'stoa-managed-opencode-main-'))
    try {
      await mkdir(join(projectDir, '.opencode', 'plugins'), { recursive: true })
      await writeFile(join(projectDir, '.opencode', 'plugins', 'stoa-status.ts'), 'legacy\n', 'utf8')

      const manager = ProjectSessionManager.createForTest()
      await manager.createProject({
        name: 'opencode-project',
        path: projectDir,
        defaultSessionType: 'shell'
      })

      await syncManagedSidecars({
        snapshotSource: manager,
        webhookPort: 43127,
        logger: console
      })

      const plugin = await readFile(join(projectDir, '.opencode', 'plugins', 'stoa-status.ts'), 'utf8')
      expect(plugin).toContain('http://127.0.0.1:43127/events')
      expect(plugin).toContain("intent: 'agent.turn_completed'")
      expect(plugin).toContain("'x-stoa-secret': sessionSecret")
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })
})
