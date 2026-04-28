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
    runId: 'run_1',
    worktreePath: 'C:/repo/.stoa/memory/runs/run_1/worktree',
    memoryDir: 'C:/repo/.stoa/memory/runs/run_1/memory',
    evolutionDir: 'C:/repo/.stoa/memory/runs/run_1/memory/evolution',
    gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_1/gep-assets',
    reviewStateRef: null,
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
    await expect(store.listSessionProgress()).resolves.toEqual([])
    await expect(store.listRunRecords()).resolves.toEqual([])
    await expect(store.listPublishedRecords()).resolves.toEqual([])
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

    await expect(store.listSessionProgress()).resolves.toEqual([
      {
        projectId: 'project_1',
        stoaSessionId: 'session_1',
        lastProcessedEvidenceKey: 'evidence:2',
        updatedAt: '2026-04-28T00:05:00.000Z'
      }
    ])
  })

  test('upsertRunRecord replaces by project and session key without Entire identity', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertRunRecord(runRecord())
    await store.upsertRunRecord(runRecord({
      runId: 'run_2',
      worktreePath: 'C:/repo/.stoa/memory/runs/run_2/worktree',
      memoryDir: 'C:/repo/.stoa/memory/runs/run_2/memory',
      evolutionDir: 'C:/repo/.stoa/memory/runs/run_2/memory/evolution',
      gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_2/gep-assets',
      reviewStateRef: 'memory/evolution/evolution_solidify_state.json',
      updatedAt: '2026-04-28T01:05:00.000Z'
    }))

    await expect(store.read()).resolves.toMatchObject({
      runRecords: [
        {
          projectId: 'project_1',
          stoaSessionId: 'session_1',
          runId: 'run_2',
          worktreePath: 'C:/repo/.stoa/memory/runs/run_2/worktree',
          memoryDir: 'C:/repo/.stoa/memory/runs/run_2/memory',
          evolutionDir: 'C:/repo/.stoa/memory/runs/run_2/memory/evolution',
          gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_2/gep-assets',
          reviewStateRef: 'memory/evolution/evolution_solidify_state.json',
          updatedAt: '2026-04-28T01:05:00.000Z'
        }
      ]
    })

    await expect(store.listRunRecords()).resolves.toEqual([
      {
        projectId: 'project_1',
        stoaSessionId: 'session_1',
        runId: 'run_2',
        worktreePath: 'C:/repo/.stoa/memory/runs/run_2/worktree',
        memoryDir: 'C:/repo/.stoa/memory/runs/run_2/memory',
        evolutionDir: 'C:/repo/.stoa/memory/runs/run_2/memory/evolution',
        gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_2/gep-assets',
        reviewStateRef: 'memory/evolution/evolution_solidify_state.json',
        updatedAt: '2026-04-28T01:05:00.000Z'
      }
    ])

    await expect(readFile(getRuntimeStateFilePath(repoRoot), 'utf-8')).resolves.not.toContain('entireCheckpointId')
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

    await expect(store.listPublishedRecords()).resolves.toEqual([
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
    ])
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
