import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import { readPersistedState } from '@core/state-store'
import type { PersistedAppStateV2 } from '@shared/project-session'

export const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true }))
  )
})

export async function createTestWorkspace(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), name))
  tempDirs.push(dir)
  return dir
}

export async function createTestStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vibecoding-e2e-state-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

export async function readStateFile(path: string): Promise<PersistedAppStateV2> {
  return await readPersistedState(path)
}

export async function cleanupTempDirs(dirs: string[]): Promise<void> {
  await Promise.allSettled(
    dirs.map(async (dir) => rm(dir, { recursive: true, force: true }))
  )
}

interface SeedOptions {
  stateFilePath: string
  webhookPort?: number | null
  projects?: Array<{ path: string; name: string }>
  sessions?: Array<{ projectId: string; type: 'shell' | 'opencode'; title: string; externalSessionId?: string | null }>
}

export async function createSeededManager(options: SeedOptions): Promise<ProjectSessionManager> {
  const manager = await ProjectSessionManager.create({
    webhookPort: options.webhookPort ?? null,
    stateFilePath: options.stateFilePath
  })

  const projectIds: string[] = []
  for (const project of options.projects ?? []) {
    const created = await manager.createProject({
      path: project.path,
      name: project.name
    })
    projectIds.push(created.id)
  }

  for (const session of options.sessions ?? []) {
    await manager.createSession({
      projectId: session.projectId,
      type: session.type,
      title: session.title,
      externalSessionId: session.externalSessionId ?? undefined
    })
  }

  return manager
}
