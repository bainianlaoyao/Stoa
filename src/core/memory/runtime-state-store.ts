import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writePersistedState } from '@core/state-store'
import type {
  RuntimeJobRecord,
  RuntimeJobState,
  RuntimeState,
  SealedTurnRecord
} from '@shared/memory-runtime'

export interface PersistedRuntimeStateStore extends RuntimeState {
  version: 1
}

const DEFAULT_RUNTIME_STATE_STORE: PersistedRuntimeStateStore = {
  version: 1,
  sealedTurns: [],
  jobs: []
}

const pendingStoreTransactions = new Map<string, Promise<void>>()

export function getRuntimeStateFilePath(repoRoot: string): string {
  return join(repoRoot, '.stoa', 'memory', 'runtime-state.json')
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isJobState(value: unknown): value is RuntimeJobState {
  return value === 'queued' || value === 'running' || value === 'done' || value === 'failed'
}

function isSealedTurnRecord(value: unknown): value is SealedTurnRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return isString(record.sessionKey)
    && isString(record.projectId)
    && isString(record.stoaSessionId)
    && isString(record.turnId)
    && isStringArray(record.evidenceIds)
    && isString(record.sealedAt)
}

function isRuntimeJobRecord(value: unknown): value is RuntimeJobRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return isString(record.jobId)
    && isString(record.sessionKey)
    && isString(record.turnId)
    && isJobState(record.state)
    && (record.error === undefined || isString(record.error))
    && isString(record.updatedAt)
}

function isPersistedRuntimeStateStore(value: unknown): value is PersistedRuntimeStateStore {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return record.version === 1
    && Array.isArray(record.sealedTurns)
    && record.sealedTurns.every(isSealedTurnRecord)
    && Array.isArray(record.jobs)
    && record.jobs.every(isRuntimeJobRecord)
}

function cloneStore(store: PersistedRuntimeStateStore): PersistedRuntimeStateStore {
  return structuredClone(store)
}

function withStoreTransaction<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingStoreTransactions.get(filePath) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)

  let tracked: Promise<void>
  tracked = current.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (pendingStoreTransactions.get(filePath) === tracked) {
      pendingStoreTransactions.delete(filePath)
    }
  })

  pendingStoreTransactions.set(filePath, tracked)
  return current
}

function compareDescending(left: string, right: string): number {
  return right.localeCompare(left)
}

export class RuntimeStateStore {
  readonly filePath: string

  constructor(repoRoot: string) {
    this.filePath = getRuntimeStateFilePath(repoRoot)
  }

  async read(): Promise<PersistedRuntimeStateStore> {
    return await withStoreTransaction(this.filePath, async () => {
      return await this.readStoreFile()
    })
  }

  async recordSealedTurn(record: SealedTurnRecord): Promise<void> {
    await this.updateStore(store => {
      const sealedTurns = store.sealedTurns.filter(candidate =>
        candidate.sessionKey !== record.sessionKey || candidate.turnId !== record.turnId
      )
      sealedTurns.push({ ...record })
      return {
        ...store,
        sealedTurns
      }
    })
  }

  async getSealedTurn(sessionKey: string, turnId: string): Promise<SealedTurnRecord | null> {
    const store = await this.read()
    return store.sealedTurns.find(candidate =>
      candidate.sessionKey === sessionKey && candidate.turnId === turnId
    ) ?? null
  }

  async upsertJob(record: RuntimeJobRecord): Promise<void> {
    await this.updateStore(store => {
      const jobs = store.jobs.filter(candidate => candidate.jobId !== record.jobId)
      jobs.push({ ...record })
      return {
        ...store,
        jobs
      }
    })
  }

  async getJob(jobId: string): Promise<RuntimeJobRecord | null> {
    const store = await this.read()
    return store.jobs.find(candidate => candidate.jobId === jobId) ?? null
  }

  async listJobsForSession(sessionKey: string): Promise<RuntimeJobRecord[]> {
    const store = await this.read()
    return store.jobs
      .filter(candidate => candidate.sessionKey === sessionKey)
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return compareDescending(left.updatedAt, right.updatedAt)
        }
        return compareDescending(left.jobId, right.jobId)
      })
  }

  private async write(store: PersistedRuntimeStateStore): Promise<void> {
    await writePersistedState({
      version: 1,
      sealedTurns: store.sealedTurns,
      jobs: store.jobs
    } satisfies PersistedRuntimeStateStore, this.filePath)
  }

  private async updateStore(
    mutate: (store: PersistedRuntimeStateStore) => PersistedRuntimeStateStore
  ): Promise<void> {
    await withStoreTransaction(this.filePath, async () => {
      const nextStore = mutate(await this.readStoreFile())
      await this.write(nextStore)
    })
  }

  private async readStoreFile(): Promise<PersistedRuntimeStateStore> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!isPersistedRuntimeStateStore(parsed)) {
        throw new Error('Invalid runtime state store')
      }

      return cloneStore(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return cloneStore(DEFAULT_RUNTIME_STATE_STORE)
      }

      throw error
    }
  }
}
