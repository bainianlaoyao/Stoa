import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writePersistedState } from '@core/state-store'
import type {
  MemoryRunRecord,
  MemoryRuntimeConsumer,
  MemoryRuntimeDeliveryState,
  MemoryRuntimeSessionProgress,
  PublishedMemoryRecord
} from '@shared/memory-runtime'

export interface PersistedRuntimeStateStore {
  version: 1
  sessionProgress: MemoryRuntimeSessionProgress[]
  runRecords: MemoryRunRecord[]
  publishedRecords: PublishedMemoryRecord[]
}

const DEFAULT_RUNTIME_STATE_STORE: PersistedRuntimeStateStore = {
  version: 1,
  sessionProgress: [],
  runRecords: [],
  publishedRecords: []
}

const pendingStoreTransactions = new Map<string, Promise<void>>()

export function getRuntimeStateFilePath(repoRoot: string): string {
  return join(repoRoot, '.stoa', 'memory', 'runtime-state.json')
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isConsumer(value: unknown): value is MemoryRuntimeConsumer {
  return value === 'claude-code'
    || value === 'codex'
    || value === 'opencode'
    || value === 'generic'
}

function isDeliveryState(value: unknown): value is MemoryRuntimeDeliveryState {
  return value === 'pending'
    || value === 'published'
    || value === 'failed'
}

function isSessionProgress(value: unknown): value is MemoryRuntimeSessionProgress {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return isString(record.projectId)
    && isString(record.stoaSessionId)
    && isString(record.lastProcessedEvidenceKey)
    && isString(record.updatedAt)
}

function isRunRecord(value: unknown): value is MemoryRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return isString(record.projectId)
    && isString(record.stoaSessionId)
    && isString(record.runId)
    && isString(record.worktreePath)
    && isString(record.memoryDir)
    && isString(record.evolutionDir)
    && isString(record.gepAssetsDir)
    && isNullableString(record.reviewStateRef)
    && isString(record.updatedAt)
}

function isPublishedRecord(value: unknown): value is PublishedMemoryRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return isString(record.projectId)
    && isString(record.stoaSessionId)
    && isConsumer(record.consumer)
    && isDeliveryState(record.deliveryState)
    && isNullableString(record.runId)
    && isNullableString(record.publishedHash)
    && isString(record.updatedAt)
}

function isPersistedRuntimeStateStore(value: unknown): value is PersistedRuntimeStateStore {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const store = value as Record<string, unknown>
  return store.version === 1
    && Array.isArray(store.sessionProgress)
    && store.sessionProgress.every(isSessionProgress)
    && Array.isArray(store.runRecords)
    && store.runRecords.every(isRunRecord)
    && Array.isArray(store.publishedRecords)
    && store.publishedRecords.every(isPublishedRecord)
}

function getSessionKey(record: Pick<MemoryRuntimeSessionProgress, 'projectId' | 'stoaSessionId'>): string {
  return `${record.projectId}\n${record.stoaSessionId}`
}

function getRunKey(record: Pick<MemoryRunRecord, 'projectId' | 'stoaSessionId'>): string {
  return `${record.projectId}\n${record.stoaSessionId}`
}

function getPublishedKey(record: Pick<PublishedMemoryRecord, 'projectId' | 'stoaSessionId' | 'consumer'>): string {
  return `${record.projectId}\n${record.stoaSessionId}\n${record.consumer}`
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

  async upsertSessionProgress(record: MemoryRuntimeSessionProgress): Promise<void> {
    await this.updateStore(store => {
      const sessionProgress = store.sessionProgress.filter(candidate => getSessionKey(candidate) !== getSessionKey(record))
      sessionProgress.push({ ...record })
      return {
        ...store,
        sessionProgress
      }
    })
  }

  async upsertRunRecord(record: MemoryRunRecord): Promise<void> {
    await this.updateStore(store => {
      const runRecords = store.runRecords.filter(candidate => getRunKey(candidate) !== getRunKey(record))
      runRecords.push({ ...record })
      return {
        ...store,
        runRecords
      }
    })
  }

  async upsertPublishedRecord(record: PublishedMemoryRecord): Promise<void> {
    await this.updateStore(store => {
      const publishedRecords = store.publishedRecords.filter(candidate => getPublishedKey(candidate) !== getPublishedKey(record))
      publishedRecords.push({ ...record })
      return {
        ...store,
        publishedRecords
      }
    })
  }

  private async write(store: PersistedRuntimeStateStore): Promise<void> {
    await writePersistedState({
      version: 1,
      sessionProgress: store.sessionProgress,
      runRecords: store.runRecords,
      publishedRecords: store.publishedRecords
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
