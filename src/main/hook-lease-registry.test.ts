import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createHookLeaseRegistry } from './hook-lease-registry'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempRuntimeRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('hook lease registry', () => {
  test('acquire creates an active lease with owner generation and secret', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-root-')
    const registry = createHookLeaseRegistry({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const acquired = await registry.acquire({
      sessionId: 'session-1',
      projectId: 'project-1',
      provider: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    expect(acquired.lease.ownerInstanceId).toBe('instance-a')
    expect(acquired.lease.provider).toBe('codex')
    expect(acquired.lease.leaseState).toBe('active')
    expect(acquired.lease.generation).toBe(1)
    expect(acquired.lease.sessionSecret).toEqual(expect.any(String))
    expect(acquired.path).toBe(join(runtimeRoot, 'hook-leases', 'session-1.json'))

    const persisted = JSON.parse(await readFile(acquired.path, 'utf8')) as {
      sessionId: string
      generation: number
      commitLockNonce: string
      commitToken: string
    }
    expect(persisted.sessionId).toBe('session-1')
    expect(persisted.generation).toBe(1)
    expect(typeof persisted.commitLockNonce).toBe('string')
    expect(persisted.commitLockNonce.length).toBeGreaterThan(0)
    expect(typeof persisted.commitToken).toBe('string')
    expect(persisted.commitToken.length).toBeGreaterThan(0)
  })

  test('heartbeat extends expiry only for the current owner generation', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-heartbeat-')
    const registry = createHookLeaseRegistry({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const acquired = await registry.acquire({
      sessionId: 'session-2',
      projectId: 'project-2',
      provider: 'claude-code',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    const heartbeated = await registry.heartbeat({
      sessionId: 'session-2',
      ownerInstanceId: 'instance-a',
      generation: acquired.lease.generation,
      nowIso: '2026-05-10T12:00:05.000Z'
    })

    expect(heartbeated?.heartbeatAt).toBe('2026-05-10T12:00:05.000Z')

    await expect(registry.heartbeat({
      sessionId: 'session-2',
      ownerInstanceId: 'instance-b',
      generation: acquired.lease.generation,
      nowIso: '2026-05-10T12:00:06.000Z'
    })).resolves.toBeNull()
  })

  test('reclaim rotates the secret and increments generation after expiry', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-reclaim-')
    const instanceA = createHookLeaseRegistry({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })
    const acquired = await instanceA.acquire({
      sessionId: 'session-3',
      projectId: 'project-3',
      provider: 'opencode',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    const instanceB = createHookLeaseRegistry({
      runtimeRoot,
      instanceId: 'instance-b',
      nowIso: () => '2026-05-10T12:00:30.000Z'
    })

    const reclaimed = await instanceB.reclaim({
      sessionId: 'session-3',
      webhookBaseUrl: 'http://127.0.0.1:43199',
      nowIso: '2026-05-10T12:00:30.000Z'
    })

    expect(reclaimed?.ownerInstanceId).toBe('instance-b')
    expect(reclaimed?.generation).toBe(acquired.lease.generation + 1)
    expect(reclaimed?.sessionSecret).not.toBe(acquired.lease.sessionSecret)
    expect(reclaimed?.webhookBaseUrl).toBe('http://127.0.0.1:43199')
  })

  test('release writes a released tombstone instead of deleting the lease', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-release-')
    const registry = createHookLeaseRegistry({
      runtimeRoot,
      instanceId: 'instance-a',
      nowIso: () => '2026-05-10T12:00:00.000Z'
    })

    const acquired = await registry.acquire({
      sessionId: 'session-4',
      projectId: 'project-4',
      provider: 'codex',
      webhookBaseUrl: 'http://127.0.0.1:43127'
    })

    const released = await registry.release({
      sessionId: 'session-4',
      ownerInstanceId: 'instance-a',
      generation: acquired.lease.generation,
      nowIso: '2026-05-10T12:00:10.000Z'
    })

    expect(released?.leaseState).toBe('released')
    expect(released?.releasedAt).toBe('2026-05-10T12:00:10.000Z')
    expect(released?.sessionSecret).not.toBe(acquired.lease.sessionSecret)

    const persisted = JSON.parse(await readFile(join(runtimeRoot, 'hook-leases', 'session-4.json'), 'utf8')) as {
      leaseState: string
      releasedAt: string
      commitLockNonce: string
      commitToken: string
    }
    expect(persisted.leaseState).toBe('released')
    expect(persisted.releasedAt).toBe('2026-05-10T12:00:10.000Z')
    expect(typeof persisted.commitLockNonce).toBe('string')
    expect(persisted.commitLockNonce.length).toBeGreaterThan(0)
    expect(typeof persisted.commitToken).toBe('string')
    expect(persisted.commitToken.length).toBeGreaterThan(0)
  })

  test('reclaim removes a stale metadata-corrupt lock before acquiring ownership', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-lease-corrupt-lock-')
    const registry = createHookLeaseRegistry({
      runtimeRoot,
      instanceId: 'instance-b',
      nowIso: () => '2026-05-10T12:00:30.000Z',
      lockDurationMs: 1_000
    })
    const lockDir = join(runtimeRoot, 'hook-leases', 'session-5.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'lock.json'), '{not-json}\n', 'utf8')

    const staleTime = new Date('2026-05-10T12:00:00.000Z')
    await writeFile(join(runtimeRoot, 'hook-leases', 'session-5.json'), `${JSON.stringify({
      version: 1,
      sessionId: 'session-5',
      projectId: 'project-5',
      provider: 'claude-code',
      leaseState: 'released',
      ownerInstanceId: 'instance-a',
      generation: 2,
      webhookBaseUrl: 'http://127.0.0.1:43127',
      sessionSecret: 'secret-5',
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:01.000Z',
      heartbeatAt: '2026-05-10T12:00:01.000Z',
      expiresAt: '2026-05-10T12:00:01.000Z',
      releasedAt: '2026-05-10T12:00:01.000Z',
      commitLockNonce: 'nonce-5',
      commitToken: 'token-5'
    }, null, 2)}\n`, 'utf8')
    await utimes(lockDir, staleTime, staleTime)

    const reclaimed = await registry.reclaim({
      sessionId: 'session-5',
      webhookBaseUrl: 'http://127.0.0.1:43199',
      nowIso: '2026-05-10T12:00:30.000Z'
    })

    expect(reclaimed).toMatchObject({
      ownerInstanceId: 'instance-b',
      generation: 3,
      webhookBaseUrl: 'http://127.0.0.1:43199'
    })
  })
})
