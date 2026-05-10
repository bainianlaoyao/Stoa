import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export type HookLeaseProvider = 'claude-code' | 'codex' | 'opencode'

export interface SessionHookLease {
  version: 1
  sessionId: string
  projectId: string
  provider: HookLeaseProvider
  leaseState: 'active' | 'released'
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  sessionSecret: string
  commitLockNonce: string
  commitToken: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
  releasedAt?: string
}

interface SessionMutationLockMetadata {
  ownerInstanceId: string
  lockNonce: string
  commitToken: string | null
  createdAt: string
  expiresAt: string
}

interface LeaseCommitContext {
  path: string
  metadataPath: string
  lock: SessionMutationLockMetadata
  setCommitToken: (commitToken: string) => Promise<SessionMutationLockMetadata>
  commitLease: (lease: SessionHookLease) => Promise<void>
}

interface HookLeaseRegistryOptions {
  runtimeRoot: string
  instanceId: string
  nowIso?: () => string
  leaseDurationMs?: number
  lockDurationMs?: number
}

interface LeaseAcquireInput {
  sessionId: string
  projectId: string
  provider: HookLeaseProvider
  webhookBaseUrl: string
}

interface LeaseHeartbeatInput {
  sessionId: string
  ownerInstanceId: string
  generation: number
  nowIso?: string
}

interface LeaseReclaimInput {
  sessionId: string
  webhookBaseUrl: string
  nowIso?: string
}

interface LeaseReleaseInput {
  sessionId: string
  ownerInstanceId: string
  generation: number
  nowIso?: string
}

export interface HookLeaseRegistry {
  runtimeRoot: string
  instanceId: string
  leasePathFor(sessionId: string): string
  read(sessionId: string): Promise<{ path: string; lease: SessionHookLease | null }>
  acquire(input: LeaseAcquireInput): Promise<{ path: string; lease: SessionHookLease }>
  heartbeat(input: LeaseHeartbeatInput): Promise<SessionHookLease | null>
  reclaim(input: LeaseReclaimInput): Promise<SessionHookLease | null>
  release(input: LeaseReleaseInput): Promise<SessionHookLease | null>
  isExpired(lease: SessionHookLease, nowIso?: string): boolean
}

const DEFAULT_LEASE_DURATION_MS = 20_000
const DEFAULT_LOCK_DURATION_MS = 10_000
const LOCK_RETRY_DELAY_MS = 25
const LOCK_RETRY_ATTEMPTS = 80

export function createHookLeaseRegistry(options: HookLeaseRegistryOptions): HookLeaseRegistry {
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS
  const lockDurationMs = options.lockDurationMs ?? DEFAULT_LOCK_DURATION_MS

  const leasesDir = join(options.runtimeRoot, 'hook-leases')

  function currentNowIso(override?: string): string {
    return override ?? options.nowIso?.() ?? new Date().toISOString()
  }

  function leasePathFor(sessionId: string): string {
    return join(leasesDir, `${sessionId}.json`)
  }

  function lockDirFor(sessionId: string): string {
    return join(leasesDir, `${sessionId}.lock`)
  }

  function lockMetadataPathFor(sessionId: string): string {
    return join(lockDirFor(sessionId), 'lock.json')
  }

  async function ensureLeasesDir(): Promise<void> {
    await mkdir(leasesDir, { recursive: true })
  }

  async function read(sessionId: string): Promise<{ path: string; lease: SessionHookLease | null }> {
    const path = leasePathFor(sessionId)
    return {
      path,
      lease: await readLease(path)
    }
  }

  async function acquire(input: LeaseAcquireInput): Promise<{ path: string; lease: SessionHookLease }> {
    const path = leasePathFor(input.sessionId)
    const lease = await withSessionMutationLock(input.sessionId, async (commit) => {
      const existing = await readLease(path)
      if (existing) {
        throw new Error(`Lease already exists for session ${input.sessionId}; acquire requires a missing lease path`)
      }

      const nowIso = currentNowIso()
      const lock = await commit.setCommitToken(randomUUID())
      const created = createActiveLease({
        sessionId: input.sessionId,
        projectId: input.projectId,
        provider: input.provider,
        ownerInstanceId: options.instanceId,
        generation: 1,
        webhookBaseUrl: input.webhookBaseUrl,
        commitLockNonce: lock.lockNonce,
        commitToken: lock.commitToken ?? failMissingCommitToken(),
        createdAt: nowIso,
        updatedAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt: addMsToIso(nowIso, leaseDurationMs)
      })

      await commit.commitLease(created)
      return created
    })

    return { path, lease }
  }

  async function heartbeat(input: LeaseHeartbeatInput): Promise<SessionHookLease | null> {
    const path = leasePathFor(input.sessionId)

    return await withSessionMutationLock(input.sessionId, async (commit) => {
      const existing = await readLease(path)
      if (!existing || existing.leaseState !== 'active') {
        return null
      }

      if (existing.ownerInstanceId !== input.ownerInstanceId || existing.generation !== input.generation) {
        return null
      }

      if (isExpired(existing, input.nowIso)) {
        return null
      }

      const nowIso = currentNowIso(input.nowIso)
      const lock = await commit.setCommitToken(randomUUID())
      const nextLease: SessionHookLease = {
        ...existing,
        commitLockNonce: lock.lockNonce,
        commitToken: lock.commitToken ?? failMissingCommitToken(),
        updatedAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt: addMsToIso(nowIso, leaseDurationMs)
      }

      await commit.commitLease(nextLease)
      return nextLease
    })
  }

  async function reclaim(input: LeaseReclaimInput): Promise<SessionHookLease | null> {
    const path = leasePathFor(input.sessionId)

    return await withSessionMutationLock(input.sessionId, async (commit) => {
      const existing = await readLease(path)
      if (!existing) {
        return null
      }

      if (existing.leaseState !== 'released' && !isExpired(existing, input.nowIso)) {
        return null
      }

      const nowIso = currentNowIso(input.nowIso)
      const lock = await commit.setCommitToken(randomUUID())
      const reclaimed = createActiveLease({
        sessionId: existing.sessionId,
        projectId: existing.projectId,
        provider: existing.provider,
        ownerInstanceId: options.instanceId,
        generation: existing.generation + 1,
        webhookBaseUrl: input.webhookBaseUrl,
        commitLockNonce: lock.lockNonce,
        commitToken: lock.commitToken ?? failMissingCommitToken(),
        createdAt: existing.createdAt,
        updatedAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt: addMsToIso(nowIso, leaseDurationMs)
      })

      await commit.commitLease(reclaimed)
      return reclaimed
    })
  }

  async function release(input: LeaseReleaseInput): Promise<SessionHookLease | null> {
    const path = leasePathFor(input.sessionId)

    return await withSessionMutationLock(input.sessionId, async (commit) => {
      const existing = await readLease(path)
      if (!existing) {
        return null
      }

      if (existing.ownerInstanceId !== input.ownerInstanceId || existing.generation !== input.generation) {
        return null
      }

      const nowIso = currentNowIso(input.nowIso)
      const lock = await commit.setCommitToken(randomUUID())
      const released: SessionHookLease = {
        ...existing,
        leaseState: 'released',
        sessionSecret: createSessionSecret(),
        commitLockNonce: lock.lockNonce,
        commitToken: lock.commitToken ?? failMissingCommitToken(),
        updatedAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt: nowIso,
        releasedAt: nowIso
      }

      await commit.commitLease(released)
      return released
    })
  }

  function isExpired(lease: SessionHookLease, nowIso?: string): boolean {
    return toMillis(lease.expiresAt) < toMillis(currentNowIso(nowIso))
  }

  async function withSessionMutationLock<T>(
    sessionId: string,
    operation: (commit: LeaseCommitContext) => Promise<T>
  ): Promise<T> {
    await ensureLeasesDir()

    const lockDir = lockDirFor(sessionId)
    const metadataPath = lockMetadataPathFor(sessionId)
    const lockNonce = randomUUID()
    const acquiredAt = currentNowIso()
    const lockMetadata: SessionMutationLockMetadata = {
      ownerInstanceId: options.instanceId,
      lockNonce,
      commitToken: null,
      createdAt: acquiredAt,
      expiresAt: addMsToIso(acquiredAt, lockDurationMs)
    }

    await acquireLockDirectory(lockDir, metadataPath, lockMetadata)

    try {
      const commit: LeaseCommitContext = {
        path: leasePathFor(sessionId),
        metadataPath,
        lock: lockMetadata,
        setCommitToken: async (commitToken) => {
          const refreshed = {
            ...lockMetadata,
            commitToken
          }
          await writeLockMetadata(metadataPath, refreshed)
          lockMetadata.commitToken = commitToken
          return refreshed
        },
        commitLease: async (lease) => {
          const beforeCommit = await readLockMetadata(metadataPath)
          if (
            !beforeCommit
            || beforeCommit.ownerInstanceId !== lockMetadata.ownerInstanceId
            || beforeCommit.lockNonce !== lockMetadata.lockNonce
            || beforeCommit.commitToken !== lockMetadata.commitToken
          ) {
            throw new Error(`Lost mutation lock ownership before committing lease for session ${sessionId}`)
          }

          const candidatePath = join(lockDir, `${basename(commit.path)}.candidate.json`)
          await writeLease(candidatePath, lease)
          await rename(candidatePath, commit.path)

          const afterCommit = await readLockMetadata(metadataPath)
          if (
            !afterCommit
            || afterCommit.ownerInstanceId !== lockMetadata.ownerInstanceId
            || afterCommit.lockNonce !== lockMetadata.lockNonce
            || afterCommit.commitToken !== lockMetadata.commitToken
          ) {
            throw new Error(`Lost mutation lock ownership after committing lease for session ${sessionId}`)
          }
        }
      }

      const result = await operation(commit)
      const currentMetadata = await readLockMetadata(metadataPath)
      if (
        !currentMetadata
        || currentMetadata.ownerInstanceId !== lockMetadata.ownerInstanceId
        || currentMetadata.lockNonce !== lockMetadata.lockNonce
        || currentMetadata.commitToken !== lockMetadata.commitToken
      ) {
        throw new Error(`Lost mutation lock ownership for session ${sessionId}`)
      }

      return result
    } finally {
      await rm(lockDir, { recursive: true, force: true })
    }
  }

  async function acquireLockDirectory(
    lockDir: string,
    metadataPath: string,
    lockMetadata: SessionMutationLockMetadata
  ): Promise<void> {
    for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await mkdir(lockDir)
        await writeFile(metadataPath, `${JSON.stringify(lockMetadata, null, 2)}\n`, 'utf8')
        return
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error
        }

        const stale = await isStaleLock(lockDir, metadataPath)
        if (stale) {
          const metadata = await readLockMetadata(metadataPath)
          if (metadata) {
            if (!isExpiredLockMetadata(metadata)) {
              await sleep(LOCK_RETRY_DELAY_MS)
              continue
            }

            const latest = await readLockMetadata(metadataPath)
            if (
              !latest
              || latest.ownerInstanceId !== metadata.ownerInstanceId
              || latest.lockNonce !== metadata.lockNonce
              || latest.expiresAt !== metadata.expiresAt
            ) {
              await sleep(LOCK_RETRY_DELAY_MS)
              continue
            }
          }

          await rm(lockDir, { recursive: true, force: true })
          continue
        }

        await sleep(LOCK_RETRY_DELAY_MS)
      }
    }

    throw new Error(`Timed out acquiring mutation lock for ${lockDir}`)
  }

  async function isStaleLock(lockDir: string, metadataPath: string): Promise<boolean> {
    const metadata = await readLockMetadata(metadataPath)
    const now = toMillis(currentNowIso())

    if (metadata) {
      return toMillis(metadata.expiresAt) < now
    }

    try {
      const lockStat = await stat(lockDir)
      return lockStat.mtimeMs < now - lockDurationMs
    } catch {
      return true
    }
  }

  return {
    runtimeRoot: options.runtimeRoot,
    instanceId: options.instanceId,
    leasePathFor,
    read,
    acquire,
    heartbeat,
    reclaim,
    release,
    isExpired
  }
}

function createActiveLease(input: {
  sessionId: string
  projectId: string
  provider: HookLeaseProvider
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  commitLockNonce: string
  commitToken: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
}): SessionHookLease {
  return {
    version: 1,
    sessionId: input.sessionId,
    projectId: input.projectId,
    provider: input.provider,
    leaseState: 'active',
    ownerInstanceId: input.ownerInstanceId,
    generation: input.generation,
    webhookBaseUrl: input.webhookBaseUrl,
    sessionSecret: createSessionSecret(),
    commitLockNonce: input.commitLockNonce,
    commitToken: input.commitToken,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    heartbeatAt: input.heartbeatAt,
    expiresAt: input.expiresAt
  }
}

async function writeLease(path: string, lease: SessionHookLease): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(lease, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}

async function writeLockMetadata(path: string, metadata: SessionMutationLockMetadata): Promise<void> {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

async function readLease(path: string): Promise<SessionHookLease | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isSessionHookLease(parsed)) {
      throw new Error(`Invalid session hook lease at ${path}`)
    }

    return parsed
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

async function readLockMetadata(path: string): Promise<SessionMutationLockMetadata | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isLockMetadata(parsed)) {
      return null
    }

    return parsed
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
}

function isSessionHookLease(value: unknown): value is SessionHookLease {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1
    && typeof candidate.sessionId === 'string'
    && typeof candidate.projectId === 'string'
    && isHookLeaseProvider(candidate.provider)
    && (candidate.leaseState === 'active' || candidate.leaseState === 'released')
    && typeof candidate.ownerInstanceId === 'string'
    && typeof candidate.generation === 'number'
    && typeof candidate.webhookBaseUrl === 'string'
    && typeof candidate.sessionSecret === 'string'
    && typeof candidate.commitLockNonce === 'string'
    && typeof candidate.commitToken === 'string'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.heartbeatAt === 'string'
    && typeof candidate.expiresAt === 'string'
    && (candidate.releasedAt === undefined || typeof candidate.releasedAt === 'string')
  )
}

function isLockMetadata(value: unknown): value is SessionMutationLockMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.ownerInstanceId === 'string'
    && typeof candidate.lockNonce === 'string'
    && (candidate.commitToken === null || typeof candidate.commitToken === 'string')
    && typeof candidate.createdAt === 'string'
    && typeof candidate.expiresAt === 'string'
  )
}

function isExpiredLockMetadata(metadata: SessionMutationLockMetadata): boolean {
  return toMillis(metadata.expiresAt) < Date.now()
}

function isHookLeaseProvider(value: unknown): value is HookLeaseProvider {
  return value === 'claude-code' || value === 'codex' || value === 'opencode'
}

function createSessionSecret(): string {
  return `stoa-${randomUUID()}`
}

function addMsToIso(nowIso: string, deltaMs: number): string {
  return new Date(toMillis(nowIso) + deltaMs).toISOString()
}

function toMillis(value: string): number {
  return new Date(value).getTime()
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function failMissingCommitToken(): never {
  throw new Error('Missing commit token for lease write')
}
