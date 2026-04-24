import * as fsPromises from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createAtomicTempFilePath,
  DEFAULT_GLOBAL_STATE,
  getProjectSessionsFilePath,
  readAllProjectSessions,
  readGlobalState,
  readProjectSessions,
  writeGlobalState,
  writeProjectSessions
} from './state-store'
import type { PersistedGlobalStateV3, PersistedProject, PersistedProjectSessions } from '@shared/project-session'
import { createTestTempDir } from '../../testing/test-temp'

const tempDirs: string[] = []

async function createTempGlobalStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-state-store-')
  tempDirs.push(dir)
  return join(dir, 'global.json')
}

async function createTempProjectDir(): Promise<string> {
  const dir = await createTestTempDir('stoa-project-')
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
    const raw = JSON.parse(await fsPromises.readFile(globalStatePath, 'utf-8')) as PersistedGlobalStateV3
    expect(raw.active_project_id).toBe('project_alpha')
    expect(raw.version).toBe(3)
  })

  test('serializes concurrent writes to the same global state file and keeps the last payload', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const first: PersistedGlobalStateV3 = {
      version: 3,
      active_project_id: 'project_alpha',
      active_session_id: null,
      projects: []
    }
    const second: PersistedGlobalStateV3 = {
      version: 3,
      active_project_id: 'project_beta',
      active_session_id: null,
      projects: []
    }

    await expect(Promise.all([
      writeGlobalState(first, globalStatePath),
      writeGlobalState(second, globalStatePath)
    ])).resolves.toEqual([undefined, undefined])

    await expect(readGlobalState(globalStatePath)).resolves.toEqual(second)
  })

  test('uses distinct temp files for concurrent atomic global state writes in the same millisecond', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1713916800000)
    const basePath = 'D:/tmp/global.json'

    expect(createAtomicTempFilePath(basePath)).not.toBe(createAtomicTempFilePath(basePath))
    nowSpy.mockRestore()
  })

  test('reads and writes per-project sessions', async () => {
    const projectDir = await createTempProjectDir()
    const data: PersistedProjectSessions = {
      version: 4,
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
          recovery_mode: 'fresh-shell',
          archived: false
        }
      ]
    }

    await writeProjectSessions(projectDir, data)

    const read = await readProjectSessions(projectDir)
    expect(read.version).toBe(4)
    expect(read.project_id).toBe('project_alpha')
    expect(read.sessions).toHaveLength(1)
    expect(read.sessions[0]!.session_id).toBe('session_shell_1')
    expect(read.sessions[0]!.last_known_status).toBe('running')
  })

  test('overwrites an existing project sessions file on repeated writes', async () => {
    const projectDir = await createTempProjectDir()
    const first: PersistedProjectSessions = {
      version: 4,
      project_id: 'project_alpha',
      sessions: []
    }
    const second: PersistedProjectSessions = {
      version: 4,
      project_id: 'project_beta',
      sessions: []
    }

    await writeProjectSessions(projectDir, first)
    await writeProjectSessions(projectDir, second)

    await expect(readProjectSessions(projectDir)).resolves.toEqual(second)
  })

  test('serializes concurrent writes to the same project sessions file and keeps the last payload', async () => {
    const projectDir = await createTempProjectDir()
    const first: PersistedProjectSessions = {
      version: 4,
      project_id: 'project_alpha',
      sessions: []
    }
    const second: PersistedProjectSessions = {
      version: 4,
      project_id: 'project_beta',
      sessions: []
    }

    await expect(Promise.all([
      writeProjectSessions(projectDir, first),
      writeProjectSessions(projectDir, second)
    ])).resolves.toEqual([undefined, undefined])

    await expect(readProjectSessions(projectDir)).resolves.toEqual(second)
  })

  test('returns versioned empty sessions when project has no sessions file', async () => {
    const projectDir = await createTempProjectDir()

    const read = await readProjectSessions(projectDir)
    expect(read).toEqual({
      version: 4,
      project_id: '',
      sessions: []
    })
  })

  test('throws when global state file contains corrupted JSON', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    await fsPromises.writeFile(globalStatePath, '{not valid json', 'utf-8')

    await expect(readGlobalState(globalStatePath)).rejects.toThrow()
  })

  test('throws when global state file uses an unsupported version', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    await fsPromises.writeFile(globalStatePath, JSON.stringify({
      version: 99,
      active_project_id: null,
      active_session_id: null,
      projects: []
    }), 'utf-8')

    await expect(readGlobalState(globalStatePath)).rejects.toThrow()
  })

  test('throws when project sessions file contains corrupted JSON', async () => {
    const projectDir = await createTempProjectDir()
    const sessionsFilePath = getProjectSessionsFilePath(projectDir)
    await fsPromises.mkdir(join(projectDir, '.stoa'), { recursive: true })
    await fsPromises.writeFile(sessionsFilePath, '{broken sessions', 'utf-8')

    await expect(readProjectSessions(projectDir)).rejects.toThrow()
  })

  test('throws when one project sessions file is unreadable instead of silently dropping it', async () => {
    const projectDir = await createTempProjectDir()
    const sessionsFilePath = getProjectSessionsFilePath(projectDir)
    await fsPromises.mkdir(sessionsFilePath, { recursive: true })

    const projects: PersistedProject[] = [
      {
        project_id: 'project_alpha',
        name: 'alpha',
        path: projectDir,
        default_session_type: 'shell',
        created_at: '2026-04-19T00:00:00.000Z',
        updated_at: '2026-04-19T00:00:00.000Z'
      }
    ]

    await expect(readAllProjectSessions(projects)).rejects.toThrow()
  })
})
