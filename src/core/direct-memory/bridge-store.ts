import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MemoryEvolutionBridgeRef, PublishedContextTarget } from '@shared/direct-memory'

interface PersistedBridgeStore {
  version: 1
  refs: MemoryEvolutionBridgeRef[]
}

export interface DeliveryUpdate {
  projectId: string
  stoaSessionId: string
  entireCheckpointId: string
  target: PublishedContextTarget
  hash: string
  updatedAt: string
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isBridgeRef(value: unknown): value is MemoryEvolutionBridgeRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const ref = value as Record<string, unknown>
  return isString(ref.projectId)
    && isString(ref.stoaSessionId)
    && isString(ref.providerSessionId)
    && (ref.providerType === 'codex' || ref.providerType === 'claude-code' || ref.providerType === 'opencode')
    && isString(ref.repoRoot)
    && isString(ref.entireCheckpointId)
    && isString(ref.entireCheckpointMetadataCommitSha)
    && isNullableString(ref.entireSourceWorktreeCommitSha)
    && isNullableString(ref.evolverRunId)
    && isNullableString(ref.evolverWorktreePath)
    && isNullableString(ref.evolverMemoryDir)
    && isNullableString(ref.evolverEvolutionDir)
    && isNullableString(ref.evolverGepAssetsDir)
    && isNullableString(ref.evolverReviewStateRef)
    && (ref.lastPublishedContextTarget === null || ref.lastPublishedContextTarget === 'codex' || ref.lastPublishedContextTarget === 'claude-code' || ref.lastPublishedContextTarget === 'opencode' || ref.lastPublishedContextTarget === 'generic')
    && isNullableString(ref.lastPublishedContextHash)
    && isString(ref.createdAt)
    && isString(ref.updatedAt)
}

function isStore(value: unknown): value is PersistedBridgeStore {
  return typeof value === 'object'
    && value !== null
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { refs?: unknown }).refs)
    && (value as { refs: unknown[] }).refs.every(isBridgeRef)
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
    await rename(tempPath, filePath)
  } finally {
    await rm(tempPath, { force: true })
  }
}

function bridgeKey(ref: Pick<MemoryEvolutionBridgeRef, 'projectId' | 'stoaSessionId' | 'entireCheckpointId'>): string {
  return `${ref.projectId}\n${ref.stoaSessionId}\n${ref.entireCheckpointId}`
}

export class DirectMemoryBridgeStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<MemoryEvolutionBridgeRef[]> {
    return (await this.read()).refs.map(ref => ({ ...ref }))
  }

  async upsert(ref: MemoryEvolutionBridgeRef): Promise<void> {
    const store = await this.read()
    const nextRefs = store.refs.filter(candidate => bridgeKey(candidate) !== bridgeKey(ref))
    nextRefs.push({ ...ref })
    await writeJsonAtomically(this.filePath, { version: 1, refs: nextRefs } satisfies PersistedBridgeStore)
  }

  async updateDelivery(update: DeliveryUpdate): Promise<void> {
    const store = await this.read()
    const idx = store.refs.findIndex(candidate => bridgeKey(candidate) === bridgeKey(update))
    if (idx === -1) {
      throw new Error('Direct memory bridge ref not found')
    }

    store.refs[idx] = {
      ...store.refs[idx]!,
      lastPublishedContextTarget: update.target,
      lastPublishedContextHash: update.hash,
      updatedAt: update.updatedAt
    }
    await writeJsonAtomically(this.filePath, store)
  }

  private async read(): Promise<PersistedBridgeStore> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!isStore(parsed)) {
        throw new Error('Invalid direct memory bridge store')
      }
      return parsed
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, refs: [] }
      }
      throw error
    }
  }
}
