import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createHookLeaseManager } from './hook-lease-manager'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempRuntimeRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('hook lease manager', () => {
  test('authorizeHookRequest accepts lease-authoritative session, project, provider, and secret', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-manager-auth-')
    const manager = createHookLeaseManager({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const binding = await manager.ensureLease({
      sessionId: 'session-1',
      projectId: 'project-1',
      sessionType: 'claude-code',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    expect(binding).not.toBeNull()

    const accepted = await manager.authorizeHookRequest({
      sessionId: 'session-1',
      projectId: 'project-1',
      provider: 'claude-code',
      secret: binding!.lease.sessionSecret
    })

    expect(accepted).toMatchObject({
      ok: true,
      lease: {
        sessionId: 'session-1',
        projectId: 'project-1',
        provider: 'claude-code'
      }
    })
  })

  test('authorizeHookRequest rejects mismatched provider or secret', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-manager-auth-reject-')
    const manager = createHookLeaseManager({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const binding = await manager.ensureLease({
      sessionId: 'session-2',
      projectId: 'project-2',
      sessionType: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    expect(binding).not.toBeNull()

    await expect(manager.authorizeHookRequest({
      sessionId: 'session-2',
      projectId: 'project-2',
      provider: 'claude-code',
      secret: binding!.lease.sessionSecret
    })).resolves.toEqual({
      ok: false,
      reason: 'invalid_secret'
    })

    await expect(manager.authorizeHookRequest({
      sessionId: 'session-2',
      projectId: 'project-2',
      provider: 'codex',
      secret: 'wrong-secret'
    })).resolves.toEqual({
      ok: false,
      reason: 'invalid_secret'
    })
  })

  test('releaseLease writes a released tombstone and clears tracked state', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-manager-release-')
    const manager = createHookLeaseManager({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const binding = await manager.ensureLease({
      sessionId: 'session-3',
      projectId: 'project-3',
      sessionType: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    expect(binding).not.toBeNull()
    await manager.releaseLease('session-3')

    expect(manager.getTrackedLease('session-3')).toBeNull()
    await expect(manager.authorizeHookRequest({
      sessionId: 'session-3',
      projectId: 'project-3',
      provider: 'codex',
      secret: binding!.lease.sessionSecret
    })).resolves.toEqual({
      ok: false,
      reason: 'invalid_secret'
    })
  })

  test('ensureLease takes over an active foreign lease only when recovery takeover is enabled', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-manager-takeover-')
    const owner = createHookLeaseManager({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const acquired = await owner.ensureLease({
      sessionId: 'session-foreign',
      projectId: 'project-foreign',
      sessionType: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    expect(acquired).not.toBeNull()

    const recovery = createHookLeaseManager({
      runtimeRoot,
      instanceId: 'instance-b',
      nowIso: () => '2026-05-10T12:00:05.000Z'
    })

    await expect(recovery.ensureLease({
      sessionId: 'session-foreign',
      projectId: 'project-foreign',
      sessionType: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43199'
    })).rejects.toThrow('Session session-foreign is owned by another STOA instance')

    const takenOver = await recovery.ensureLease({
      sessionId: 'session-foreign',
      projectId: 'project-foreign',
      sessionType: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43199',
      allowRecoveryTakeover: true
    })

    expect(takenOver).not.toBeNull()
    expect(takenOver?.lease.ownerInstanceId).toBe('instance-b')
    expect(takenOver?.lease.generation).toBe(acquired!.lease.generation + 1)
  })
})
