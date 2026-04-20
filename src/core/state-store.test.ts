import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { readPersistedState } from './state-store'

const tempDirs: string[] = []

async function createTempStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vibecoding-state-store-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

describe('state store', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('migrates legacy state files that predate the version field', async () => {
    const stateFilePath = await createTempStatePath()
    await writeFile(stateFilePath, JSON.stringify({
      active_workspace_id: 'ws_legacy',
      workspaces: [
        {
          workspace_id: 'ws_legacy',
          path: 'D:/legacy',
          name: 'legacy',
          provider_id: 'local-shell',
          last_cli_session_id: null,
          last_known_status: 'bootstrapping',
          updated_at: '2026-04-18T10:00:00.000Z'
        }
      ]
    }, null, 2), 'utf-8')

    const migrated = await readPersistedState(stateFilePath)

    expect(migrated.version).toBe(1)
    expect(migrated.active_workspace_id).toBe('ws_legacy')
    expect(migrated.workspaces).toHaveLength(1)
  })

  test('preserves invalid raw state as a broken snapshot when json parsing fails', async () => {
    const stateFilePath = await createTempStatePath()
    await writeFile(stateFilePath, '{ invalid json', 'utf-8')

    const state = await readPersistedState(stateFilePath)
    expect(state.workspaces).toHaveLength(0)

    const brokenSnapshotPath = `${stateFilePath}.broken`
    const brokenSnapshot = await readFile(brokenSnapshotPath, 'utf-8')
    expect(brokenSnapshot).toContain('{ invalid json')
  })
})
