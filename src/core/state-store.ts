import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
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

function isPersistedState(value: unknown): value is PersistedAppState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const parsed = value as Record<string, unknown>
  return parsed.version === 1 && Array.isArray(parsed.workspaces)
}

function migrateLegacyState(value: unknown): PersistedAppState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const parsed = value as Record<string, unknown>
  if (!Array.isArray(parsed.workspaces)) {
    return null
  }

  return {
    version: 1,
    active_workspace_id: typeof parsed.active_workspace_id === 'string' || parsed.active_workspace_id === null
      ? parsed.active_workspace_id
      : null,
    workspaces: parsed.workspaces as PersistedAppState['workspaces']
  }
}

export async function readPersistedState(filePath = getStateFilePath()): Promise<PersistedAppState> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (isPersistedState(parsed)) {
      return parsed
    }

    const migrated = migrateLegacyState(parsed)
    if (migrated) {
      return migrated
    }

    return structuredClone(DEFAULT_STATE)
  } catch {
    try {
      await copyFile(filePath, `${filePath}.broken`)
    } catch {
      // ignore broken snapshot failure and fall back to default state
    }
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
