import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_GLOBAL_STATE,
  readGlobalState,
  writeGlobalState,
  readProjectSessions,
  writeProjectSessions
} from './state-store'
import type { PersistedGlobalStateV3, PersistedProjectSessions } from '@shared/project-session'

const tempDirs: string[] = []

async function createTempGlobalStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stoa-state-store-'))
  tempDirs.push(dir)
  return join(dir, 'global.json')
}

async function createTempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stoa-project-'))
  tempDirs.push(dir)
  return dir
}

describe('state-store', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('returns the v3 default global state when no file exists', async () => {
    const globalStatePath = await createTempGlobalStatePath()

    await expect(readGlobalState(globalStatePath)).resolves.toEqual(DEFAULT_GLOBAL_STATE)
    expect(DEFAULT_GLOBAL_STATE.version).toBe(3)
    expect(DEFAULT_GLOBAL_STATE.projects).toEqual([])
  })

  test('writes and re-reads persisted v3 global state', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const state: PersistedGlobalStateV3 = {
      version: 3,
      active_project_id: 'project_alpha',
      active_session_id: 'session_shell_1',
      projects: [
        {
          project_id: 'project_alpha',
          name: 'alpha',
          path: 'D:/alpha',
          default_session_type: 'shell',
          created_at: '2026-04-19T00:00:00.000Z',
          updated_at: '2026-04-19T00:00:00.000Z'
        }
      ]
    }

    await writeGlobalState(state, globalStatePath)

    await expect(readGlobalState(globalStatePath)).resolves.toEqual(state)
    const raw = JSON.parse(await readFile(globalStatePath, 'utf-8')) as PersistedGlobalStateV3
    expect(raw.active_project_id).toBe('project_alpha')
    expect(raw.version).toBe(3)
  })

  test('reads and writes per-project sessions', async () => {
    const projectDir = await createTempProjectDir()
    const data: PersistedProjectSessions = {
      project_id: 'project_alpha',
      sessions: [
        {
          session_id: 'session_shell_1',
          project_id: 'project_alpha',
          type: 'shell',
          title: 'Local shell',
          last_known_status: 'running',
          last_summary: 'attached',
          external_session_id: null,
          created_at: '2026-04-19T00:00:00.000Z',
          updated_at: '2026-04-19T00:00:00.000Z',
          last_activated_at: '2026-04-19T00:00:00.000Z',
          recovery_mode: 'fresh-shell'
        }
      ]
    }

    await writeProjectSessions(projectDir, data)

    const read = await readProjectSessions(projectDir)
    expect(read.sessions).toHaveLength(1)
    expect(read.sessions[0]!.session_id).toBe('session_shell_1')
    expect(read.sessions[0]!.last_known_status).toBe('running')
  })

  test('returns empty sessions when project has no sessions file', async () => {
    const projectDir = await createTempProjectDir()

    const read = await readProjectSessions(projectDir)
    expect(read.sessions).toEqual([])
  })
})
