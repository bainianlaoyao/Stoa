import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { RuntimeJobRecord, SealedTurnRecord } from '@shared/memory-runtime'
import {
  RuntimeStateStore,
  getRuntimeStateFilePath
} from './runtime-state-store'

const tempDirs: string[] = []

function sealedTurn(overrides: Partial<SealedTurnRecord> = {}): SealedTurnRecord {
  return {
    sessionKey: 'project_1\nsession_1',
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    turnId: 'turn_1',
    evidenceIds: ['event_1', 'event_2'],
    sealedAt: '2026-04-28T10:00:00.000Z',
    ...overrides
  }
}

function jobRecord(overrides: Partial<RuntimeJobRecord> = {}): RuntimeJobRecord {
  return {
    jobId: 'job_1',
    sessionKey: 'project_1\nsession_1',
    turnId: 'turn_1',
    state: 'queued',
    updatedAt: '2026-04-28T10:01:00.000Z',
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
      sealedTurns: [],
      jobs: []
    })
  })

  test('records and replaces a sealed turn by sessionKey + turnId', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.recordSealedTurn(sealedTurn())
    await store.recordSealedTurn(sealedTurn({
      evidenceIds: ['event_3'],
      sealedAt: '2026-04-28T10:02:00.000Z'
    }))

    await expect(store.read()).resolves.toEqual({
      version: 1,
      sealedTurns: [
        sealedTurn({
          evidenceIds: ['event_3'],
          sealedAt: '2026-04-28T10:02:00.000Z'
        })
      ],
      jobs: []
    })
    await expect(store.getSealedTurn('project_1\nsession_1', 'turn_1')).resolves.toEqual(
      sealedTurn({
        evidenceIds: ['event_3'],
        sealedAt: '2026-04-28T10:02:00.000Z'
      })
    )
  })

  test('records and replaces jobs by jobId', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertJob(jobRecord())
    await store.upsertJob(jobRecord({
      state: 'running',
      updatedAt: '2026-04-28T10:03:00.000Z'
    }))

    await expect(store.read()).resolves.toEqual({
      version: 1,
      sealedTurns: [],
      jobs: [
        jobRecord({
          state: 'running',
          updatedAt: '2026-04-28T10:03:00.000Z'
        })
      ]
    })
    await expect(store.getJob('job_1')).resolves.toEqual(
      jobRecord({
        state: 'running',
        updatedAt: '2026-04-28T10:03:00.000Z'
      })
    )
  })

  test('lists jobs for a session key in updatedAt order', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.upsertJob(jobRecord({
      jobId: 'job_older',
      updatedAt: '2026-04-28T10:01:00.000Z'
    }))
    await store.upsertJob(jobRecord({
      jobId: 'job_newer',
      turnId: 'turn_2',
      updatedAt: '2026-04-28T10:04:00.000Z'
    }))
    await store.upsertJob(jobRecord({
      jobId: 'job_other_session',
      sessionKey: 'project_1\nsession_2',
      turnId: 'turn_x',
      updatedAt: '2026-04-28T10:05:00.000Z'
    }))

    await expect(store.listJobsForSession('project_1\nsession_1')).resolves.toEqual([
      jobRecord({
        jobId: 'job_newer',
        turnId: 'turn_2',
        updatedAt: '2026-04-28T10:04:00.000Z'
      }),
      jobRecord({
        jobId: 'job_older',
        updatedAt: '2026-04-28T10:01:00.000Z'
      })
    ])
  })

  test('serializes concurrent writes across turn and job records without losing data', async () => {
    const store = new RuntimeStateStore(repoRoot)

    await Promise.all([
      store.recordSealedTurn(sealedTurn()),
      store.upsertJob(jobRecord({
        state: 'done'
      }))
    ])

    await expect(store.read()).resolves.toEqual({
      version: 1,
      sealedTurns: [sealedTurn()],
      jobs: [jobRecord({ state: 'done' })]
    })
  })

  test('rejects a malformed persisted store', async () => {
    await mkdir(join(repoRoot, '.stoa', 'memory'), { recursive: true })
    await writeFile(getRuntimeStateFilePath(repoRoot), JSON.stringify({
      version: 1,
      sealedTurns: [{ bad: true }],
      jobs: []
    }), 'utf-8')

    const store = new RuntimeStateStore(repoRoot)
    await expect(store.read()).rejects.toThrow('Invalid runtime state store')
  })

  test('writes versioned JSON with the expected shape', async () => {
    const store = new RuntimeStateStore(repoRoot)
    await store.recordSealedTurn(sealedTurn())
    await store.upsertJob(jobRecord({ state: 'done' }))

    await expect(readFile(getRuntimeStateFilePath(repoRoot), 'utf-8').then(JSON.parse)).resolves.toEqual({
      version: 1,
      sealedTurns: [sealedTurn()],
      jobs: [jobRecord({ state: 'done' })]
    })
  })
})
