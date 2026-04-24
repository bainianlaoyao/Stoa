import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  PersistedAppStateV2,
  PersistedGlobalStateV3,
  PersistedProject,
  PersistedProjectSessions,
  PersistedSession,
  SessionAgentState,
  SessionRecoveryMode,
  SessionRuntimeState,
  SessionType
} from '@shared/project-session'
import type { BlockingReason } from '@shared/observability'
import { DEFAULT_SETTINGS } from '@shared/project-session'

export const DEFAULT_STATE: PersistedAppStateV2 = {
  version: 2,
  active_project_id: null,
  active_session_id: null,
  projects: [],
  sessions: [],
  settings: { ...DEFAULT_SETTINGS }
}

export const DEFAULT_GLOBAL_STATE: PersistedGlobalStateV3 = {
  version: 3,
  active_project_id: null,
  active_session_id: null,
  projects: [],
  settings: { ...DEFAULT_SETTINGS }
}

export const DEFAULT_PROJECT_SESSIONS: PersistedProjectSessions = {
  version: 5,
  project_id: '',
  sessions: []
}

export function getStateFilePath(): string {
  return join(homedir(), '.stoa', 'state.json')
}

export function getGlobalStateFilePath(): string {
  return join(homedir(), '.stoa', 'global.json')
}

export function getProjectSessionsFilePath(projectPath: string): string {
  return join(projectPath, '.stoa', 'sessions.json')
}

export class StateReadError extends Error {
  readonly cause: unknown
  readonly filePath: string
  readonly isTransient: boolean

  constructor(message: string, cause: unknown, filePath: string, isTransient: boolean) {
    super(message)
    this.name = 'StateReadError'
    this.cause = cause
    this.filePath = filePath
    this.isTransient = isTransient
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function isTransientError(code: string | undefined): boolean {
  return code === 'EBUSY'
    || code === 'EACCES'
    || code === 'EPERM'
    || code === 'EAGAIN'
    || code === 'EMFILE'
    || code === 'ENFILE'
}

function createReadError(message: string, filePath: string, cause: unknown): StateReadError {
  return new StateReadError(message, cause, filePath, isTransientError(getErrorCode(cause)))
}

function isValidPersistedState(value: unknown): value is PersistedAppStateV2 {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 2
    && 'projects' in value
    && Array.isArray(value.projects)
    && 'sessions' in value
    && Array.isArray(value.sessions)
}

function isValidGlobalState(value: unknown): value is PersistedGlobalStateV3 {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 3
    && 'projects' in value
    && Array.isArray(value.projects)
}

function isValidProjectSessions(value: unknown): value is PersistedProjectSessions {
  if (!(typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 5
    && 'project_id' in value
    && typeof value.project_id === 'string'
    && 'sessions' in value
    && Array.isArray(value.sessions))) {
    return false
  }

  return value.sessions.every(isValidPersistedSession)
}

function isValidPersistedSession(value: unknown): value is PersistedSession {
  return typeof value === 'object'
    && value !== null
    && hasString(value, 'session_id')
    && hasString(value, 'project_id')
    && hasEnumValue<SessionType>(value, 'type', ['shell', 'opencode', 'codex', 'claude-code'])
    && hasString(value, 'title')
    && hasEnumValue<SessionRuntimeState>(value, 'runtime_state', ['created', 'starting', 'alive', 'exited', 'failed_to_start'])
    && hasEnumValue<SessionAgentState>(value, 'agent_state', ['unknown', 'idle', 'working', 'blocked', 'error'])
    && hasBoolean(value, 'has_unseen_completion')
    && hasNullableNumber(value, 'runtime_exit_code')
    && hasNullableEnumValue(value, 'runtime_exit_reason', ['clean', 'failed'])
    && hasNumber(value, 'last_state_sequence')
    && hasNullableEnumValue<BlockingReason>(value, 'blocking_reason', ['permission', 'elicitation', 'resume-confirmation', 'provider-error'])
    && hasString(value, 'last_summary')
    && hasNullableString(value, 'external_session_id')
    && hasString(value, 'created_at')
    && hasString(value, 'updated_at')
    && hasNullableString(value, 'last_activated_at')
    && hasEnumValue<SessionRecoveryMode>(value, 'recovery_mode', ['fresh-shell', 'resume-external'])
    && hasBoolean(value, 'archived')
}

function hasString(value: object, key: string): boolean {
  return key in value && typeof value[key as keyof typeof value] === 'string'
}

function hasNullableString(value: object, key: string): boolean {
  return key in value && (value[key as keyof typeof value] === null || typeof value[key as keyof typeof value] === 'string')
}

function hasNumber(value: object, key: string): boolean {
  return key in value && typeof value[key as keyof typeof value] === 'number'
}

function hasNullableNumber(value: object, key: string): boolean {
  return key in value && (value[key as keyof typeof value] === null || typeof value[key as keyof typeof value] === 'number')
}

function hasBoolean(value: object, key: string): boolean {
  return key in value && typeof value[key as keyof typeof value] === 'boolean'
}

function hasEnumValue<TValue extends string>(value: object, key: string, allowed: readonly TValue[]): boolean {
  const field = value[key as keyof typeof value]
  return key in value && typeof field === 'string' && allowed.includes(field as TValue)
}

function hasNullableEnumValue<TValue extends string>(value: object, key: string, allowed: readonly TValue[]): boolean {
  const field = value[key as keyof typeof value]
  return key in value && (field === null || (typeof field === 'string' && allowed.includes(field as TValue)))
}

function isProjectSessionsWithUnsupportedVersion(value: unknown): value is { version: unknown; project_id?: unknown } {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version !== 5
}

export function createAtomicTempFilePath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
}

const pendingFileAccesses = new Map<string, Promise<void>>()

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
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

export async function readPersistedState<TState = PersistedAppStateV2>(filePath = getStateFilePath()): Promise<TState> {
  return await withFileAccess(filePath, async () => {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedAppStateV2
      if (!isValidPersistedState(parsed)) {
        throw new StateReadError('Invalid persisted app state', undefined, filePath, false)
      }

      return parsed as TState
    } catch (error) {
      if (error instanceof StateReadError) {
        throw error
      }

      if (getErrorCode(error) === 'ENOENT') {
        return structuredClone(DEFAULT_STATE) as TState
      }

      throw createReadError('Unable to read persisted app state', filePath, error)
    }
  })
}

export async function readGlobalState(filePath = getGlobalStateFilePath()): Promise<PersistedGlobalStateV3> {
  return await withFileAccess(filePath, async () => {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedGlobalStateV3
      if (!isValidGlobalState(parsed)) {
        throw new StateReadError('Invalid global state', undefined, filePath, false)
      }

      return parsed
    } catch (error) {
      if (error instanceof StateReadError) {
        throw error
      }

      if (getErrorCode(error) === 'ENOENT') {
        return structuredClone(DEFAULT_GLOBAL_STATE)
      }

      throw createReadError('Unable to read global state', filePath, error)
    }
  })
}

export async function readProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
  const filePath = getProjectSessionsFilePath(projectPath)

  return await withFileAccess(filePath, async () => {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (isProjectSessionsWithUnsupportedVersion(parsed)) {
        return {
          version: 5,
          project_id: typeof parsed.project_id === 'string' ? parsed.project_id : '',
          sessions: []
        }
      }

      if (!isValidProjectSessions(parsed)) {
        if (isVersionFiveProjectSessionsWrapper(parsed)) {
          return {
            version: 5,
            project_id: parsed.project_id,
            sessions: []
          }
        }

        throw new StateReadError('Invalid project sessions state', undefined, filePath, false)
      }

      return parsed
    } catch (error) {
      if (error instanceof StateReadError) {
        throw error
      }

      if (getErrorCode(error) === 'ENOENT') {
        return structuredClone(DEFAULT_PROJECT_SESSIONS)
      }

      throw createReadError('Unable to read project sessions', filePath, error)
    }
  })
}

function isVersionFiveProjectSessionsWrapper(value: unknown): value is { version: 5; project_id: string; sessions: unknown[] } {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 5
    && 'project_id' in value
    && typeof value.project_id === 'string'
    && 'sessions' in value
    && Array.isArray(value.sessions)
}

export async function readAllProjectSessions(projects: PersistedProject[]): Promise<PersistedSession[]> {
  const allSessions: PersistedSession[] = []

  for (const project of projects) {
    const persisted = await readProjectSessions(project.path)
    allSessions.push(...persisted.sessions)
  }

  return allSessions
}

export async function writePersistedState<TState>(
  state: TState,
  filePath = getStateFilePath()
): Promise<void> {
  await writeJsonAtomically(filePath, state)
}

export async function writeGlobalState(
  state: PersistedGlobalStateV3,
  filePath = getGlobalStateFilePath()
): Promise<void> {
  await writeJsonAtomically(filePath, state)
}

export async function writeProjectSessions(
  projectPath: string,
  data: PersistedProjectSessions
): Promise<void> {
  const filePath = getProjectSessionsFilePath(projectPath)

  await writeJsonAtomically(filePath, {
    version: 5,
    project_id: data.project_id,
    sessions: data.sessions
  } satisfies PersistedProjectSessions)
}
