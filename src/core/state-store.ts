import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

export const DEFAULT_PROJECT_SESSIONS: PersistedProjectSessions = {
  version: 4,
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

export function createAtomicTempFilePath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function backupFile(filePath: string, reason: string): Promise<void> {
  if (!(await fileExists(filePath))) {
    return
  }

  const backupPath = `${filePath}.${reason}.bak`
  await rm(backupPath, { force: true })
  await rename(filePath, backupPath)
}

function isSupportedGlobalState(value: PersistedGlobalStateV3): boolean {
  return value.version === 3 && Array.isArray(value.projects)
}

function isSupportedProjectSessions(value: PersistedProjectSessions): boolean {
  return value.version === 4
    && typeof value.project_id === 'string'
    && Array.isArray(value.sessions)
}

async function readProjectSessionsFile(filePath: string): Promise<PersistedProjectSessions> {
  let raw: string

  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_PROJECT_SESSIONS)
    }

    return structuredClone(DEFAULT_PROJECT_SESSIONS)
  }

  let parsed: PersistedProjectSessions
  try {
    parsed = JSON.parse(raw) as PersistedProjectSessions
  } catch {
    await backupFile(filePath, 'invalid-json')
    return structuredClone(DEFAULT_PROJECT_SESSIONS)
  }

  if (!isSupportedProjectSessions(parsed)) {
    await backupFile(filePath, 'unsupported-version')
    return structuredClone(DEFAULT_PROJECT_SESSIONS)
  }

  return parsed
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFilePath = createAtomicTempFilePath(filePath)
  try {
    await writeFile(tempFilePath, JSON.stringify(payload, null, 2), 'utf-8')
    await rename(tempFilePath, filePath)
  } finally {
    await rm(tempFilePath, { force: true })
  }
}

export async function readPersistedState<TState = PersistedAppStateV2>(filePath = getStateFilePath()): Promise<TState> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedAppStateV2
    if (
      parsed.version !== 2
      || !Array.isArray(parsed.projects)
      || !Array.isArray(parsed.sessions)
    ) {
      return structuredClone(DEFAULT_STATE) as TState
    }

    return parsed as TState
  } catch {
    return structuredClone(DEFAULT_STATE) as TState
  }
}

export async function readGlobalState(filePath = getGlobalStateFilePath()): Promise<PersistedGlobalStateV3> {
  let raw: string

  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    return structuredClone(DEFAULT_GLOBAL_STATE)
  }

  let parsed: PersistedGlobalStateV3
  try {
    parsed = JSON.parse(raw) as PersistedGlobalStateV3
  } catch {
    await backupFile(filePath, 'invalid-json')
    return structuredClone(DEFAULT_GLOBAL_STATE)
  }

  if (!isSupportedGlobalState(parsed)) {
    await backupFile(filePath, 'unsupported-version')
    return structuredClone(DEFAULT_GLOBAL_STATE)
  }

  return parsed
}

export async function readProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
  return readProjectSessionsFile(getProjectSessionsFilePath(projectPath))
}

export async function readAllProjectSessions(projects: PersistedProject[]): Promise<PersistedSession[]> {
  const allSessions: PersistedSession[] = []
  for (const project of projects) {
    const persistedSessions = await readProjectSessionsFile(getProjectSessionsFilePath(project.path))
    allSessions.push(...persistedSessions.sessions)
  }
  return allSessions
}

export async function writePersistedState<TState>(
  state: TState,
  filePath = getStateFilePath()
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
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
    version: 4,
    project_id: data.project_id,
    sessions: data.sessions
  } satisfies PersistedProjectSessions)
}
