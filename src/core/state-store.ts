import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { PersistedAppStateV2 } from '@shared/project-session'

export const DEFAULT_STATE: PersistedAppStateV2 = {
  version: 2,
  active_project_id: null,
  active_session_id: null,
  projects: [],
  sessions: []
}

export function getStateFilePath(): string {
  return join(homedir(), '.vibecoding', 'state.json')
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

export async function writePersistedState<TState>(
  state: TState,
  filePath = getStateFilePath()
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
}
