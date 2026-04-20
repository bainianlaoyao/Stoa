import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_STATE, readPersistedState, writePersistedState } from './state-store'
import type { PersistedAppStateV2 } from '@shared/project-session'

const tempDirs: string[] = []

async function createTempStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vibecoding-state-store-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

describe('state-store', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('returns the v2 default project/session state when no file exists', async () => {
    const stateFilePath = await createTempStatePath()

    await expect(readPersistedState(stateFilePath)).resolves.toEqual(DEFAULT_STATE)
    expect(DEFAULT_STATE.version).toBe(2)
    expect(DEFAULT_STATE.projects).toEqual([])
    expect(DEFAULT_STATE.sessions).toEqual([])
  })

  test('writes and re-reads persisted v2 project/session state', async () => {
    const stateFilePath = await createTempStatePath()
    const state: PersistedAppStateV2 = {
      version: 2,
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
      ],
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

    await writePersistedState(state, stateFilePath)

    await expect(readPersistedState(stateFilePath)).resolves.toEqual(state)
    const raw = JSON.parse(await readFile(stateFilePath, 'utf-8')) as PersistedAppStateV2
    expect(raw.active_project_id).toBe('project_alpha')
    expect(raw.sessions[0]?.session_id).toBe('session_shell_1')
  })
})
