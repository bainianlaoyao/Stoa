import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { PersistedAppStateV2, PersistedGlobalStateV3, PersistedProject, PersistedProjectSessions, PersistedSession } from '@shared/project-session'
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
  return typeof value === 'object'
    && value !== null
    && 'sessions' in value
    && Array.isArray(value.sessions)
}

export async function readPersistedState<TState = PersistedAppStateV2>(filePath = getStateFilePath()): Promise<TState> {
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
}

export async function readGlobalState(filePath = getGlobalStateFilePath()): Promise<PersistedGlobalStateV3> {
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
}

export async function readProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
  const filePath = getProjectSessionsFilePath(projectPath)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedProjectSessions
    if (!isValidProjectSessions(parsed)) {
      throw new StateReadError('Invalid project sessions state', undefined, filePath, false)
    }

    return parsed
  } catch (error) {
    if (error instanceof StateReadError) {
      throw error
    }

    if (getErrorCode(error) === 'ENOENT') {
      return { project_id: '', sessions: [] }
    }

    throw createReadError('Unable to read project sessions', filePath, error)
  }
}

export async function readAllProjectSessions(projects: PersistedProject[]): Promise<PersistedSession[]> {
  const allSessions: PersistedSession[] = []
  for (const project of projects) {
    const persisted = await readProjectSessions(project.path)
    allSessions.push(...persisted.sessions)
  }
  return allSessions
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = join(dirname(filePath), `.tmp-${randomUUID()}`)

  try {
    await writeFile(tempPath, content, 'utf-8')
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export async function writePersistedState<TState>(
  state: TState,
  filePath = getStateFilePath()
): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(state, null, 2))
}

export async function writeGlobalState(
  state: PersistedGlobalStateV3,
  filePath = getGlobalStateFilePath()
): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(state, null, 2))
}

export async function writeProjectSessions(
  projectPath: string,
  data: PersistedProjectSessions
): Promise<void> {
  const filePath = getProjectSessionsFilePath(projectPath)
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2))
}
