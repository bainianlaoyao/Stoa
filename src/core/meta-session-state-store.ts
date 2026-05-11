import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createAtomicTempFilePath } from './state-store'
import type { PersistedMetaSessionStateV1 } from '@shared/meta-session'

const DEFAULT_META_SESSION_BACKEND_SESSION_TYPE = 'claude-code' as const

export const DEFAULT_META_SESSION_STATE: PersistedMetaSessionStateV1 = {
  version: 1,
  active_meta_session_id: null,
  sessions: [],
  proposals: [],
  action_logs: [],
  inspector_target: {
    kind: 'app'
  }
}

export function resolveMetaSessionStateFilePath(globalStatePath?: string): string {
  if (globalStatePath && globalStatePath.trim().length > 0) {
    return join(dirname(globalStatePath), 'meta-session.json')
  }

  return join(homedir(), '.stoa', 'meta-session.json')
}

const pendingFileAccesses = new Map<string, Promise<void>>()

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function withFileAccess<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingFileAccesses.get(filePath) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  let tracked: Promise<void>
  tracked = current.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (pendingFileAccesses.get(filePath) === tracked) {
      pendingFileAccesses.delete(filePath)
    }
  })
  pendingFileAccesses.set(filePath, tracked)
  return current
}

function isValidCapabilityLevel(value: unknown): value is 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3
}

function isValidStatus(value: unknown): value is PersistedMetaSessionStateV1['sessions'][number]['status'] {
  return value === 'created'
    || value === 'starting'
    || value === 'running'
    || value === 'waiting_approval'
    || value === 'idle'
    || value === 'failed'
    || value === 'closed'
}

function isValidBackendSessionType(value: unknown): value is PersistedMetaSessionStateV1['sessions'][number]['backend_session_type'] {
  return value === 'claude-code'
    || value === 'codex'
    || value === 'opencode'
}

function isValidPersistedMetaSession(value: unknown): value is PersistedMetaSessionStateV1['sessions'][number] {
  return typeof value === 'object'
    && value !== null
    && 'session_id' in value
    && typeof value.session_id === 'string'
    && 'title' in value
    && typeof value.title === 'string'
    && 'status' in value
    && isValidStatus(value.status)
    && 'backend_session_type' in value
    && isValidBackendSessionType(value.backend_session_type)
    && 'capability_level' in value
    && isValidCapabilityLevel(value.capability_level)
    && 'pending_proposal_count' in value
    && typeof value.pending_proposal_count === 'number'
    && 'active_target_count' in value
    && typeof value.active_target_count === 'number'
    && 'last_summary' in value
    && typeof value.last_summary === 'string'
    && 'last_risk' in value
    && (value.last_risk === null || typeof value.last_risk === 'string')
    && 'backend_session_id' in value
    && (value.backend_session_id === null || typeof value.backend_session_id === 'string')
    && 'created_at' in value
    && typeof value.created_at === 'string'
    && 'updated_at' in value
    && typeof value.updated_at === 'string'
    && 'last_activated_at' in value
    && (value.last_activated_at === null || typeof value.last_activated_at === 'string')
    && (!('archived' in value) || typeof value.archived === 'boolean')
}

function isValidProposalStatus(value: unknown): value is PersistedMetaSessionStateV1['proposals'][number]['status'] {
  return value === 'pending_approval'
    || value === 'approved'
    || value === 'rejected'
    || value === 'executing'
    || value === 'completed'
    || value === 'failed'
    || value === 'stale'
}

function isValidPersistedProposalSnapshotSession(
  value: unknown
): value is PersistedMetaSessionStateV1['proposals'][number]['snapshot']['sessions'][number] {
  return typeof value === 'object'
    && value !== null
    && 'session_id' in value
    && typeof value.session_id === 'string'
    && 'last_state_sequence' in value
    && typeof value.last_state_sequence === 'number'
    && 'turn_epoch' in value
    && typeof value.turn_epoch === 'number'
    && 'updated_at' in value
    && typeof value.updated_at === 'string'
}

function isValidPersistedMetaSessionProposal(value: unknown): value is PersistedMetaSessionStateV1['proposals'][number] {
  return typeof value === 'object'
    && value !== null
    && 'proposal_id' in value
    && typeof value.proposal_id === 'string'
    && 'meta_session_id' in value
    && typeof value.meta_session_id === 'string'
    && 'kind' in value
    && value.kind === 'prompt'
    && 'target_session_ids' in value
    && Array.isArray(value.target_session_ids)
    && value.target_session_ids.every((item) => typeof item === 'string')
    && 'risk_level' in value
    && isValidCapabilityLevel(value.risk_level)
    && 'status' in value
    && isValidProposalStatus(value.status)
    && 'summary' in value
    && typeof value.summary === 'string'
    && 'reason' in value
    && typeof value.reason === 'string'
    && 'prompt_text' in value
    && (value.prompt_text === null || typeof value.prompt_text === 'string')
    && 'preset_name' in value
    && (value.preset_name === null || typeof value.preset_name === 'string')
    && 'snapshot' in value
    && typeof value.snapshot === 'object'
    && value.snapshot !== null
    && 'sessions' in value.snapshot
    && Array.isArray(value.snapshot.sessions)
    && value.snapshot.sessions.every(isValidPersistedProposalSnapshotSession)
    && 'created_at' in value
    && typeof value.created_at === 'string'
    && 'updated_at' in value
    && typeof value.updated_at === 'string'
    && 'approved_at' in value
    && (value.approved_at === null || typeof value.approved_at === 'string')
    && 'rejected_at' in value
    && (value.rejected_at === null || typeof value.rejected_at === 'string')
    && 'executed_at' in value
    && (value.executed_at === null || typeof value.executed_at === 'string')
    && 'execution_result' in value
    && (value.execution_result === null || typeof value.execution_result === 'string')
}

function isValidPersistedMetaSessionActionLog(value: unknown): value is PersistedMetaSessionStateV1['action_logs'][number] {
  return typeof value === 'object'
    && value !== null
    && 'action_id' in value
    && typeof value.action_id === 'string'
    && 'meta_session_id' in value
    && typeof value.meta_session_id === 'string'
    && 'proposal_id' in value
    && (value.proposal_id === null || typeof value.proposal_id === 'string')
    && 'action' in value
    && typeof value.action === 'string'
    && 'detail' in value
    && typeof value.detail === 'string'
    && 'created_at' in value
    && typeof value.created_at === 'string'
}

function isValidInspectorTarget(value: unknown): boolean {
  if (value === null) {
    return true
  }

  if (typeof value !== 'object') {
    return false
  }

  if (!('kind' in value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'app') {
    return true
  }

  if (value.kind === 'work-session') {
    return 'sessionId' in value && typeof value.sessionId === 'string'
  }

  if (value.kind === 'proposal') {
    return 'proposalId' in value && typeof value.proposalId === 'string'
  }

  return false
}

function isValidMetaSessionState(value: unknown): value is PersistedMetaSessionStateV1 {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 1
    && 'active_meta_session_id' in value
    && (value.active_meta_session_id === null || typeof value.active_meta_session_id === 'string')
    && 'sessions' in value
    && Array.isArray(value.sessions)
    && value.sessions.every(isValidPersistedMetaSession)
    && 'proposals' in value
    && Array.isArray(value.proposals)
    && value.proposals.every(isValidPersistedMetaSessionProposal)
    && 'action_logs' in value
    && Array.isArray(value.action_logs)
    && value.action_logs.every(isValidPersistedMetaSessionActionLog)
    && 'inspector_target' in value
    && isValidInspectorTarget(value.inspector_target)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function replaceFileAtomically(tempFilePath: string, filePath: string): Promise<void> {
  try {
    await rename(tempFilePath, filePath)
    return
  } catch (error) {
    const code = getErrorCode(error)
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error
    }
  }

  const backupPath = `${filePath}.replace.bak`
  await rm(backupPath, { force: true })

  if (await fileExists(filePath)) {
    await rename(filePath, backupPath)
  }

  try {
    await rename(tempFilePath, filePath)
    await rm(backupPath, { force: true })
  } catch (error) {
    if (!(await fileExists(filePath)) && await fileExists(backupPath)) {
      await rename(backupPath, filePath)
    }
    throw error
  }
}

async function writeJsonAtomicallyUnlocked(filePath: string, payload: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFilePath = createAtomicTempFilePath(filePath)

  try {
    await writeFile(tempFilePath, JSON.stringify(payload, null, 2), 'utf-8')
    await replaceFileAtomically(tempFilePath, filePath)
  } finally {
    await rm(tempFilePath, { force: true })
  }
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await withFileAccess(filePath, async () => {
    await writeJsonAtomicallyUnlocked(filePath, payload)
  })
}

function toNormalizedMetaSessionState(value: unknown): PersistedMetaSessionStateV1 | null {
  if (isValidMetaSessionState(value)) {
    return value
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  if (!('version' in value) || value.version !== 1) {
    return null
  }

  if (!('active_meta_session_id' in value) || (value.active_meta_session_id !== null && typeof value.active_meta_session_id !== 'string')) {
    return null
  }

  if (!('sessions' in value) || !Array.isArray(value.sessions) || !value.sessions.every(isValidPersistedMetaSession)) {
    return null
  }

  const inspectorTarget = 'inspector_target' in value && isValidInspectorTarget(value.inspector_target)
    ? value.inspector_target as PersistedMetaSessionStateV1['inspector_target']
    : structuredClone(DEFAULT_META_SESSION_STATE.inspector_target)

  return {
    version: 1,
    active_meta_session_id: value.active_meta_session_id,
    sessions: value.sessions.map((session) => ({
      ...session,
      archived: (session as Record<string, unknown>).archived === true,
      backend_session_type: isValidBackendSessionType((session as Partial<typeof session>).backend_session_type)
        ? (session as typeof session).backend_session_type
        : DEFAULT_META_SESSION_BACKEND_SESSION_TYPE
    })),
    proposals: 'proposals' in value && Array.isArray(value.proposals) && value.proposals.every(isValidPersistedMetaSessionProposal)
      ? value.proposals
      : [],
    action_logs: 'action_logs' in value && Array.isArray(value.action_logs) && value.action_logs.every(isValidPersistedMetaSessionActionLog)
      ? value.action_logs
      : [],
    inspector_target: inspectorTarget
  }
}

async function backupInvalidMetaSessionState(filePath: string): Promise<void> {
  const backupPath = `${filePath}.invalid.${Date.now()}.bak`
  await copyFile(filePath, backupPath)
}

async function resetInvalidMetaSessionState(filePath: string): Promise<PersistedMetaSessionStateV1> {
  await backupInvalidMetaSessionState(filePath)
  const fallback = structuredClone(DEFAULT_META_SESSION_STATE)
  await writeJsonAtomicallyUnlocked(filePath, fallback)
  return fallback
}

async function readMetaSessionStateUnlocked(filePath: string): Promise<PersistedMetaSessionStateV1> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    let parsed: unknown

    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return await resetInvalidMetaSessionState(filePath)
    }

    const normalized = toNormalizedMetaSessionState(parsed)
    if (normalized) {
      if (!isValidMetaSessionState(parsed)) {
        await backupInvalidMetaSessionState(filePath)
        await writeJsonAtomicallyUnlocked(filePath, normalized)
      }
      return normalized
    }

    return await resetInvalidMetaSessionState(filePath)
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return structuredClone(DEFAULT_META_SESSION_STATE)
    }

    throw error
  }
}

export async function readMetaSessionState(filePath = resolveMetaSessionStateFilePath()): Promise<PersistedMetaSessionStateV1> {
  return await withFileAccess(filePath, async () => {
    return await readMetaSessionStateUnlocked(filePath)
  })
}

export async function writeMetaSessionState(
  state: PersistedMetaSessionStateV1,
  filePath = resolveMetaSessionStateFilePath()
): Promise<void> {
  await writeJsonAtomically(filePath, state)
}

export async function updateMetaSessionState(
  updater: (state: PersistedMetaSessionStateV1) => PersistedMetaSessionStateV1 | Promise<PersistedMetaSessionStateV1>,
  filePath = resolveMetaSessionStateFilePath()
): Promise<PersistedMetaSessionStateV1> {
  return await withFileAccess(filePath, async () => {
    const current = await readMetaSessionStateUnlocked(filePath)
    const next = await updater(current)
    await mkdir(dirname(filePath), { recursive: true })
    const tempFilePath = createAtomicTempFilePath(filePath)

    try {
      await writeFile(tempFilePath, JSON.stringify(next, null, 2), 'utf-8')
      await replaceFileAtomically(tempFilePath, filePath)
    } finally {
      await rm(tempFilePath, { force: true })
    }

    return next
  })
}
