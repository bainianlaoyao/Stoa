import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  RuntimeStateStore,
  getRuntimeStateFilePath
} from './runtime-state-store'
import type {
  MemoryRunRecord,
  MemoryRuntimeSessionProgress,
  PublishedMemoryRecord
} from '@shared/memory-runtime'

const tempDirs: string[] = []

function sessionProgress(overrides: Partial<MemoryRuntimeSessionProgress> = {}): MemoryRuntimeSessionProgress {
  return {
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    lastProcessedEvidenceKey: 'evidence:1',
    updatedAt: '2026-04-28T00:00:00.000Z',
    ...overrides
  }
}

function runRecord(overrides: Partial<MemoryRunRecord> = {}): MemoryRunRecord {
  return {
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    runId: 'run_1',
    worktreePath: 'C:/repo/.stoa/memory/runs/run_1/worktree',
    memoryDir: 'C:/repo/.stoa/memory/runs/run_1/memory',
    evolutionDir: 'C:/repo/.stoa/memory/runs/run_1/memory/evolution',
    gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_1/gep-assets',
    reviewStateRef: null,
    reviewStatus: 'pending',
    lastError: null,
    updatedAt: '2026-04-28T01:00:00.000Z',
    ...overrides
  }
}

function publishedRecord(overrides: Partial<PublishedMemoryRecord> = {}): PublishedMemoryRecord {
  return {
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    consumer: 'claude-code',
    deliveryState: 'pending',
    runId: 'run_1',
    publishedHash: null,
    updatedAt: '2026-04-28T02:00:00.000Z',
    ...overrides
  }
}

describe('RuntimeStateStore', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'stoa-runtime-state-store-'))
    tempDirs.push(repoRoot)
  })

  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('returns an empty default store when the file does not exist', async () => {
    const store = new RuntimeStateStore(repoRoot)

    expect(getRuntimeStateFilePath(repoRoot)).toBe(join(repoRoot, '.stoa', 'memory', 'runtime-state.json'))
    await expect(store.read()).resolves.toEqual({
      version: 1,
      sessionProgress: [],
      runRecords: [],
      publishedRecords: []
    })
  })

  test('upsertSessionProgress replaces by project and session key', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertSessionProgress(sessionProgress())
    await store.upsertSessionProgress(sessionProgress({
      lastProcessedEvidenceKey: 'evidence:2',
      updatedAt: '2026-04-28T00:05:00.000Z'
    }))

    await expect(store.read()).resolves.toMatchObject({
      sessionProgress: [
        {
          projectId: 'project_1',
          stoaSessionId: 'session_1',
          lastProcessedEvidenceKey: 'evidence:2',
          updatedAt: '2026-04-28T00:05:00.000Z'
        }
      ]
    })
    await expect(store.getSessionProgress('project_1', 'session_1')).resolves.toEqual(
      sessionProgress({
        lastProcessedEvidenceKey: 'evidence:2',
        updatedAt: '2026-04-28T00:05:00.000Z'
      })
    )

  })

  test('upsertRunRecord replaces by project and session key without Entire identity', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertRunRecord(runRecord())
    await store.upsertRunRecord(runRecord({
      runId: 'run_2',
      providerSessionId: 'provider-session-2',
      worktreePath: 'C:/repo/.stoa/memory/runs/run_2/worktree',
      memoryDir: 'C:/repo/.stoa/memory/runs/run_2/memory',
      evolutionDir: 'C:/repo/.stoa/memory/runs/run_2/memory/evolution',
      gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_2/gep-assets',
      reviewStateRef: 'memory/evolution/evolution_solidify_state.json',
      reviewStatus: 'approved',
      lastError: null,
      updatedAt: '2026-04-28T01:05:00.000Z'
    }))

    await expect(store.read()).resolves.toMatchObject({
      runRecords: [
        {
          projectId: 'project_1',
          stoaSessionId: 'session_1',
          providerSessionId: 'provider-session-2',
          runId: 'run_2',
          worktreePath: 'C:/repo/.stoa/memory/runs/run_2/worktree',
          memoryDir: 'C:/repo/.stoa/memory/runs/run_2/memory',
          evolutionDir: 'C:/repo/.stoa/memory/runs/run_2/memory/evolution',
          gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_2/gep-assets',
          reviewStateRef: 'memory/evolution/evolution_solidify_state.json',
          reviewStatus: 'approved',
          lastError: null,
          updatedAt: '2026-04-28T01:05:00.000Z'
        }
      ]
    })
    await expect(store.getRunRecord('project_1', 'session_1')).resolves.toEqual(
      runRecord({
        runId: 'run_2',
        providerSessionId: 'provider-session-2',
        worktreePath: 'C:/repo/.stoa/memory/runs/run_2/worktree',
        memoryDir: 'C:/repo/.stoa/memory/runs/run_2/memory',
        evolutionDir: 'C:/repo/.stoa/memory/runs/run_2/memory/evolution',
        gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_2/gep-assets',
        reviewStateRef: 'memory/evolution/evolution_solidify_state.json',
        reviewStatus: 'approved',
        lastError: null,
        updatedAt: '2026-04-28T01:05:00.000Z'
      })
    )

    await expect(readFile(getRuntimeStateFilePath(repoRoot), 'utf-8')).resolves.not.toContain('entireCheckpointId')
  })

  test('findLatestApprovedRun returns the newest approved run in the project', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertRunRecord(runRecord({
      stoaSessionId: 'session_older',
      runId: 'run_older',
      reviewStatus: 'approved',
      updatedAt: '2026-04-28T01:00:00.000Z'
    }))
    await store.upsertRunRecord(runRecord({
      stoaSessionId: 'session_pending',
      runId: 'run_pending',
      reviewStatus: 'pending',
      updatedAt: '2026-04-28T03:00:00.000Z'
    }))
    await store.upsertRunRecord(runRecord({
      stoaSessionId: 'session_newer',
      runId: 'run_newer',
      reviewStatus: 'approved',
      updatedAt: '2026-04-28T02:00:00.000Z'
    }))

    await expect(store.findLatestApprovedRun('project_1')).resolves.toEqual(
      runRecord({
        stoaSessionId: 'session_newer',
        runId: 'run_newer',
        reviewStatus: 'approved',
        updatedAt: '2026-04-28T02:00:00.000Z'
      })
    )
    await expect(store.findLatestApprovedRun('project_missing')).resolves.toBeNull()
  })

  test('findLatestPublishableRun accepts reviewStatus none as publishable only when the run has no error', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertRunRecord(runRecord({
      stoaSessionId: 'session_none',
      runId: 'run_none',
      reviewStatus: 'none',
      updatedAt: '2026-04-28T02:00:00.000Z'
    }))
    await store.upsertRunRecord(runRecord({
      stoaSessionId: 'session_broken',
      runId: 'run_broken',
      reviewStatus: 'approved',
      lastError: 'distillation failed',
      updatedAt: '2026-04-28T04:00:00.000Z'
    }))
    await store.upsertRunRecord(runRecord({
      stoaSessionId: 'session_failed',
      runId: 'run_failed',
      reviewStatus: 'failed',
      updatedAt: '2026-04-28T03:00:00.000Z'
    }))

    await expect(store.findLatestPublishableRun('project_1')).resolves.toEqual(
      runRecord({
        stoaSessionId: 'session_none',
        runId: 'run_none',
        reviewStatus: 'none',
        updatedAt: '2026-04-28T02:00:00.000Z'
      })
    )
  })

  test('upsertPublishedRecord replaces by project session and consumer key', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertPublishedRecord(publishedRecord())
    await store.upsertPublishedRecord(publishedRecord({
      deliveryState: 'published',
      publishedHash: 'sha256:abc',
      updatedAt: '2026-04-28T02:05:00.000Z'
    }))
    await store.upsertPublishedRecord(publishedRecord({
      consumer: 'generic',
      deliveryState: 'failed',
      runId: 'run_2',
      publishedHash: null,
      updatedAt: '2026-04-28T02:06:00.000Z'
    }))

    await expect(store.read()).resolves.toMatchObject({
      publishedRecords: [
        {
          projectId: 'project_1',
          stoaSessionId: 'session_1',
          consumer: 'claude-code',
          deliveryState: 'published',
          runId: 'run_1',
          publishedHash: 'sha256:abc',
          updatedAt: '2026-04-28T02:05:00.000Z'
        },
        {
          projectId: 'project_1',
          stoaSessionId: 'session_1',
          consumer: 'generic',
          deliveryState: 'failed',
          runId: 'run_2',
          publishedHash: null,
          updatedAt: '2026-04-28T02:06:00.000Z'
        }
      ]
    })
    await expect(store.getPublishedRecord('project_1', 'session_1', 'claude-code')).resolves.toEqual(
      publishedRecord({
        deliveryState: 'published',
        publishedHash: 'sha256:abc',
        updatedAt: '2026-04-28T02:05:00.000Z'
      })
    )

  })

  test('serializes concurrent upserts across categories without losing data', async () => {
    const store = new RuntimeStateStore(repoRoot)

    await Promise.all([
      store.upsertSessionProgress(sessionProgress()),
      store.upsertRunRecord(runRecord()),
      store.upsertPublishedRecord(publishedRecord({
        deliveryState: 'published',
        publishedHash: 'sha256:abc'
      }))
    ])

    await expect(store.read()).resolves.toEqual({
      version: 1,
      sessionProgress: [sessionProgress()],
      runRecords: [runRecord()],
      publishedRecords: [publishedRecord({
        deliveryState: 'published',
        publishedHash: 'sha256:abc'
      })]
    })
  })

  test('rejects a malformed persisted store', async () => {
    await mkdir(join(repoRoot, '.stoa', 'memory'), { recursive: true })
    await writeFile(getRuntimeStateFilePath(repoRoot), JSON.stringify({
      version: 1,
      sessionProgress: [{ bad: true }],
      runRecords: [],
      publishedRecords: []
    }), 'utf-8')

    const store = new RuntimeStateStore(repoRoot)
    await expect(store.read()).rejects.toThrow('Invalid runtime state store')
  })

  test('writes versioned JSON with the expected shape', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertSessionProgress(sessionProgress())
    await store.upsertRunRecord(runRecord())
    await store.upsertPublishedRecord(publishedRecord({
      deliveryState: 'published',
      publishedHash: 'sha256:abc'
    }))

    await expect(readFile(getRuntimeStateFilePath(repoRoot), 'utf-8').then(JSON.parse)).resolves.toEqual({
      version: 1,
      sessionProgress: [sessionProgress()],
      runRecords: [runRecord()],
      publishedRecords: [publishedRecord({
        deliveryState: 'published',
        publishedHash: 'sha256:abc'
      })]
    })
  })
})
