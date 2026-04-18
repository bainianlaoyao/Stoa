import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { PersistedAppState } from '@shared/workspace'

export const DEFAULT_STATE: PersistedAppState = {
  version: 1,
  active_workspace_id: null,
  workspaces: []
}

export function getStateFilePath(): string {
  return join(homedir(), '.vibecoding', 'state.json')
}

export async function readPersistedState(filePath = getStateFilePath()): Promise<PersistedAppState> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedAppState
    if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) {
      return structuredClone(DEFAULT_STATE)
    }

    return parsed
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

export async function writePersistedState(
  state: PersistedAppState,
  filePath = getStateFilePath()
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
}
