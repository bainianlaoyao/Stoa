import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DirectMemoryBridgeStore } from './bridge-store'
import type { MemoryEvolutionBridgeRef } from '@shared/direct-memory'

const tempDirs: string[] = []

function ref(overrides: Partial<MemoryEvolutionBridgeRef> = {}): MemoryEvolutionBridgeRef {
  return {
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    providerType: 'codex',
    repoRoot: 'C:/repo',
    entireCheckpointId: 'chk_1',
    entireCheckpointMetadataCommitSha: 'meta-sha',
    entireSourceWorktreeCommitSha: 'source-sha',
    evolverRunId: null,
    evolverWorktreePath: null,
    evolverMemoryDir: null,
    evolverEvolutionDir: null,
    evolverGepAssetsDir: null,
    evolverReviewStateRef: null,
    lastPublishedContextTarget: null,
    lastPublishedContextHash: null,
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides
  }
}

describe('DirectMemoryBridgeStore', () => {
  let storePath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stoa-direct-memory-store-'))
    tempDirs.push(dir)
    storePath = join(dir, 'bridge-refs.json')
  })

  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('returns an empty list when store does not exist', async () => {
    const store = new DirectMemoryBridgeStore(storePath)
    await expect(store.list()).resolves.toEqual([])
  })

  test('upserts refs by project session and checkpoint identity', async () => {
    const store = new DirectMemoryBridgeStore(storePath)
    await store.upsert(ref({ evolverRunId: 'run_1' }))
    await store.upsert(ref({ evolverRunId: 'run_2', updatedAt: '2026-04-26T01:00:00.000Z' }))

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        entireCheckpointId: 'chk_1',
        evolverRunId: 'run_2'
      })
    ])
  })

  test('updates delivery metadata without replacing native refs', async () => {
    const store = new DirectMemoryBridgeStore(storePath)
    await store.upsert(ref({ evolverRunId: 'run_1' }))
    await store.updateDelivery({
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      entireCheckpointId: 'chk_1',
      target: 'codex',
      hash: 'sha256:123',
      updatedAt: '2026-04-26T02:00:00.000Z'
    })

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        evolverRunId: 'run_1',
        lastPublishedContextTarget: 'codex',
        lastPublishedContextHash: 'sha256:123',
        updatedAt: '2026-04-26T02:00:00.000Z'
      })
    ])
  })

  test('rejects malformed persisted store', async () => {
    await writeFile(storePath, JSON.stringify({ version: 1, refs: [{ bad: true }] }), 'utf-8')
    const store = new DirectMemoryBridgeStore(storePath)

    await expect(store.list()).rejects.toThrow('Invalid direct memory bridge store')
  })

  test('writes versioned JSON', async () => {
    const store = new DirectMemoryBridgeStore(storePath)
    await store.upsert(ref())

    await expect(readFile(storePath, 'utf-8').then(JSON.parse)).resolves.toMatchObject({
      version: 1,
      refs: [expect.objectContaining({ entireCheckpointId: 'chk_1' })]
    })
  })
})
