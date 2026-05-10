import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../testing/test-temp'
import { MetaSessionManager } from './meta-session-manager'

const tempDirs: string[] = []

async function createTempMetaSessionStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-meta-session-manager-')
  tempDirs.push(dir)
  return join(dir, 'meta-session.json')
}

describe('MetaSessionManager', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) =>
        import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
      )
    )
  })

  test('creates a meta session and persists it separately from project sessions', async () => {
    const manager = await MetaSessionManager.create({
      statePath: await createTempMetaSessionStatePath()
    })

    const created = await manager.createSession({
      title: 'global-triage',
      backendSessionType: 'claude-code',
      capabilityLevel: 2
    })

    expect(created.title).toBe('global-triage')
    expect(created.status).toBe('created')
    expect(created.backendSessionType).toBe('claude-code')
    expect(created.backendSessionId).toBeNull()
    expect((await manager.listSessions())).toHaveLength(1)
  })

  test('tracks active meta session independently from work-session state', async () => {
    const manager = await MetaSessionManager.create({
      statePath: await createTempMetaSessionStatePath()
    })
    const first = await manager.createSession({ title: 'triage-a', backendSessionType: 'claude-code', capabilityLevel: 1 })
    const second = await manager.createSession({ title: 'triage-b', backendSessionType: 'codex', capabilityLevel: 3 })

    await manager.setActiveSession(second.id)

    const snapshot = manager.snapshot()
    expect(snapshot.activeMetaSessionId).toBe(second.id)
    expect(snapshot.sessions.find((session) => session.id === second.id)?.backendSessionType).toBe('codex')
    expect(snapshot.sessions.map((session) => session.id)).toEqual([first.id, second.id])
  })

  test('closes a meta session and excludes it from the bootstrap recovery plan', async () => {
    const manager = await MetaSessionManager.create({
      statePath: await createTempMetaSessionStatePath()
    })
    const first = await manager.createSession({ title: 'triage-a', backendSessionType: 'claude-code', capabilityLevel: 1 })
    const second = await manager.createSession({ title: 'triage-b', backendSessionType: 'codex', capabilityLevel: 3 })
    await manager.updateSession(second.id, {
      backendSessionId: 'codex-external-2'
    })

    await manager.closeSession(first.id)

    const snapshot = manager.snapshot()
    expect(snapshot.sessions.find((session) => session.id === first.id)?.status).toBe('closed')
    expect(manager.buildBootstrapRecoveryPlan()).toEqual([
      expect.objectContaining({
        sessionId: second.id,
        backendSessionId: 'codex-external-2'
      })
    ])
  })
})
