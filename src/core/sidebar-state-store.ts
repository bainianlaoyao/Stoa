import { readFile, writeFile, mkdir, rename, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { SidebarState } from '@shared/sidebar-types'

export function getSidebarStateFilePath(): string | null {
  const home = homedir()
  if (!home) {
    return null
  }
  return join(home, '.stoa', 'sidebar.json')
}

function resolveFilePaths(): { statePath: string; tmpPath: string; backupPath: string } | null {
  const statePath = getSidebarStateFilePath()
  if (!statePath) {
    return null
  }
  return {
    statePath,
    tmpPath: statePath + '.tmp',
    backupPath: statePath + '.backup',
  }
}

function isValidSidebarState(parsed: unknown): parsed is SidebarState {
  if (typeof parsed !== 'object' || parsed === null) {
    return false
  }
  if (!('open' in parsed) || typeof (parsed as SidebarState).open !== 'boolean') {
    return false
  }
  if (!('activeTab' in parsed) || typeof (parsed as SidebarState).activeTab !== 'string') {
    return false
  }
  if (!('width' in parsed) || typeof (parsed as SidebarState).width !== 'number') {
    return false
  }
  return true
}

function validateSidebarState(parsed: unknown): SidebarState | null {
  if (!isValidSidebarState(parsed)) {
    return null
  }
  const state = parsed as SidebarState
  if (typeof state.sessionListWidth !== 'number') {
    state.sessionListWidth = 240
  }
  return state
}

/** Remove stale .tmp files left by a crashed write from a previous session. */
export async function cleanupSidebarTempFile(): Promise<void> {
  const paths = resolveFilePaths()
  if (!paths) {
    return
  }
  try {
    if (existsSync(paths.tmpPath)) {
      await rm(paths.tmpPath)
    }
  } catch {
    // Best-effort cleanup; don't block startup.
  }
}

export async function readSidebarState(): Promise<SidebarState | null> {
  const paths = resolveFilePaths()
  if (!paths) {
    return null
  }

  // Try reading the primary file first.
  try {
    const raw = await readFile(paths.statePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const state = validateSidebarState(parsed)
    if (state) {
      return state
    }
  } catch {
    // Primary file missing or unreadable — fall through to backup.
  }

  // Primary failed. Try the backup file.
  console.warn('[sidebar-state-store] Primary state file unreadable, trying backup')
  try {
    const raw = await readFile(paths.backupPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const state = validateSidebarState(parsed)
    if (state) {
      console.warn('[sidebar-state-store] Recovered sidebar state from backup file')
      return state
    }
  } catch {
    // Backup also failed — fall through to default.
  }

  return null
}

export async function writeSidebarState(state: SidebarState): Promise<void> {
  const paths = resolveFilePaths()
  if (!paths) {
    return
  }

  const { statePath, tmpPath, backupPath } = paths
  const dir = dirname(statePath)
  await mkdir(dir, { recursive: true })

  // Backup the current state file before overwriting (skip if first run).
  try {
    if (existsSync(statePath)) {
      await copyFile(statePath, backupPath)
    }
  } catch {
    // Non-fatal: backup failure should not block the write.
    console.warn('[sidebar-state-store] Failed to create backup before write')
  }

  // Atomic write: write to temp file first, then rename to final path.
  // rename is atomic on most filesystems, ensuring the state file is never
  // in a partial or corrupt state even if the process crashes mid-write.
  let renamed = false
  try {
    await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    await rename(tmpPath, statePath)
    renamed = true
  } finally {
    if (!renamed) {
      await rm(tmpPath).catch(() => {})
    }
  }
}
