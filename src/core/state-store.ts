import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  return join(homedir(), '.vibecoding', 'state.json')
}

export function getGlobalStateFilePath(): string {
  return join(homedir(), '.vibecoding', 'global.json')
}

export function getProjectSessionsFilePath(projectPath: string): string {
  return join(projectPath, '.vibecoding', 'sessions.json')
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
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedGlobalStateV3
    if (
      parsed.version !== 3
      || !Array.isArray(parsed.projects)
    ) {
      return structuredClone(DEFAULT_GLOBAL_STATE)
    }

    return parsed
  } catch {
    return structuredClone(DEFAULT_GLOBAL_STATE)
  }
}

export async function readProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
  try {
    const filePath = getProjectSessionsFilePath(projectPath)
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedProjectSessions
    if (!Array.isArray(parsed.sessions)) {
      return { project_id: '', sessions: [] }
    }

    return parsed
  } catch {
    return { project_id: '', sessions: [] }
  }
}

export async function readAllProjectSessions(projects: PersistedProject[]): Promise<PersistedSession[]> {
  const allSessions: PersistedSession[] = []
  for (const project of projects) {
    try {
      const filePath = getProjectSessionsFilePath(project.path)
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedProjectSessions
      if (Array.isArray(parsed.sessions)) {
        allSessions.push(...parsed.sessions)
      }
    } catch {
    }
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
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

export async function writeProjectSessions(
  projectPath: string,
  data: PersistedProjectSessions
): Promise<void> {
  const filePath = getProjectSessionsFilePath(projectPath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
