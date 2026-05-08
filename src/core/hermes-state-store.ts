import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createAtomicTempFilePath } from './state-store'
import type { PersistedHermesStateV1 } from '@shared/hermes'

export const DEFAULT_HERMES_STATE: PersistedHermesStateV1 = {
  version: 1,
  active_hermes_session_id: null,
  sessions: [],
  proposals: [],
  action_logs: [],
  inspector_target: {
    kind: 'app'
  }
}

export function resolveHermesStateFilePath(globalStatePath?: string): string {
  if (globalStatePath && globalStatePath.trim().length > 0) {
    return join(dirname(globalStatePath), 'hermes.json')
  }

  return join(homedir(), '.stoa', 'hermes.json')
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

function isValidStatus(value: unknown): value is PersistedHermesStateV1['sessions'][number]['status'] {
  return value === 'created'
    || value === 'starting'
    || value === 'running'
    || value === 'waiting_approval'
    || value === 'idle'
    || value === 'failed'
    || value === 'closed'
}

function isValidPersistedHermesSession(value: unknown): value is PersistedHermesStateV1['sessions'][number] {
  return typeof value === 'object'
    && value !== null
    && 'session_id' in value
    && typeof value.session_id === 'string'
    && 'title' in value
    && typeof value.title === 'string'
    && 'status' in value
    && isValidStatus(value.status)
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
    && 'resume_session_id' in value
    && (value.resume_session_id === null || typeof value.resume_session_id === 'string')
    && 'created_at' in value
    && typeof value.created_at === 'string'
    && 'updated_at' in value
    && typeof value.updated_at === 'string'
    && 'last_activated_at' in value
    && (value.last_activated_at === null || typeof value.last_activated_at === 'string')
}

function isValidProposalStatus(value: unknown): value is PersistedHermesStateV1['proposals'][number]['status'] {
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
): value is PersistedHermesStateV1['proposals'][number]['snapshot']['sessions'][number] {
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

function isValidPersistedHermesProposal(value: unknown): value is PersistedHermesStateV1['proposals'][number] {
  return typeof value === 'object'
    && value !== null
    && 'proposal_id' in value
    && typeof value.proposal_id === 'string'
    && 'hermes_session_id' in value
    && typeof value.hermes_session_id === 'string'
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

function isValidPersistedHermesActionLog(value: unknown): value is PersistedHermesStateV1['action_logs'][number] {
  return typeof value === 'object'
    && value !== null
    && 'action_id' in value
    && typeof value.action_id === 'string'
    && 'hermes_session_id' in value
    && typeof value.hermes_session_id === 'string'
    && 'proposal_id' in value
    && (value.proposal_id === null || typeof value.proposal_id === 'string')
    && 'action' in value
    && typeof value.action === 'string'
    && 'detail' in value
    && typeof value.detail === 'string'
    && 'created_at' in value
    && typeof value.created_at === 'string'
}

function isValidHermesState(value: unknown): value is PersistedHermesStateV1 {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 1
    && 'active_hermes_session_id' in value
    && (value.active_hermes_session_id === null || typeof value.active_hermes_session_id === 'string')
    && 'sessions' in value
    && Array.isArray(value.sessions)
    && value.sessions.every(isValidPersistedHermesSession)
    && 'proposals' in value
    && Array.isArray(value.proposals)
    && value.proposals.every(isValidPersistedHermesProposal)
    && 'action_logs' in value
    && Array.isArray(value.action_logs)
    && value.action_logs.every(isValidPersistedHermesActionLog)
    && 'inspector_target' in value
    && isValidInspectorTarget(value.inspector_target)
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

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await withFileAccess(filePath, async () => {
    await mkdir(dirname(filePath), { recursive: true })
    const tempFilePath = createAtomicTempFilePath(filePath)

    try {
      await writeFile(tempFilePath, JSON.stringify(payload, null, 2), 'utf-8')
      await replaceFileAtomically(tempFilePath, filePath)
    } finally {
      await rm(tempFilePath, { force: true })
    }
  })
}

async function readHermesStateUnlocked(filePath: string): Promise<PersistedHermesStateV1> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!isValidHermesState(parsed)) {
      throw new Error('Invalid Hermes state')
    }
    return parsed
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return structuredClone(DEFAULT_HERMES_STATE)
    }

    if (error instanceof Error && error.message === 'Invalid Hermes state') {
      throw error
    }

    throw error
  }
}

export async function readHermesState(filePath = resolveHermesStateFilePath()): Promise<PersistedHermesStateV1> {
  return await withFileAccess(filePath, async () => {
    return await readHermesStateUnlocked(filePath)
  })
}

export async function writeHermesState(
  state: PersistedHermesStateV1,
  filePath = resolveHermesStateFilePath()
): Promise<void> {
  await writeJsonAtomically(filePath, state)
}

export async function updateHermesState(
  updater: (state: PersistedHermesStateV1) => PersistedHermesStateV1 | Promise<PersistedHermesStateV1>,
  filePath = resolveHermesStateFilePath()
): Promise<PersistedHermesStateV1> {
  return await withFileAccess(filePath, async () => {
    const current = await readHermesStateUnlocked(filePath)
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
