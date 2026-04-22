import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import { readGlobalState } from '@core/state-store'
import type { ProviderCommand } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from '@extensions/providers'
import type { PersistedGlobalStateV3 } from '@shared/project-session'

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

export async function createTestGlobalStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stoa-e2e-state-'))
  tempDirs.push(dir)
  return join(dir, 'global.json')
}

export async function readGlobalStateFile(path: string): Promise<PersistedGlobalStateV3> {
  return await readGlobalState(path)
}

export async function cleanupTempDirs(dirs: string[]): Promise<void> {
  await Promise.allSettled(
    dirs.map(async (dir) => rm(dir, { recursive: true, force: true }))
  )
}

interface SeedOptions {
  globalStatePath: string
  webhookPort?: number | null
  projects?: Array<{ ref?: string; path: string; name: string }>
  sessions?: Array<{ projectRef?: string; projectId?: string; type: 'shell' | 'opencode'; title: string; externalSessionId?: string | null }>
}

export async function createSeededManager(options: SeedOptions): Promise<ProjectSessionManager> {
  const manager = await ProjectSessionManager.create({
    webhookPort: options.webhookPort ?? null,
    globalStatePath: options.globalStatePath
  })

  const refToId = new Map<string, string>()
  for (const project of options.projects ?? []) {
    const created = await manager.createProject({
      path: project.path,
      name: project.name
    })
    if (project.ref) {
      refToId.set(project.ref, created.id)
    }
  }

  for (const session of options.sessions ?? []) {
    const projectId = session.projectRef
      ? refToId.get(session.projectRef) ?? session.projectId!
      : session.projectId!
    await manager.createSession({
      projectId,
      type: session.type,
      title: session.title,
      externalSessionId: session.externalSessionId ?? undefined
    })
  }

  return manager
}

export function createMockWindow(): {
  window: {
    webContents: { send: (channel: string, data: unknown) => void }
    isDestroyed: () => boolean
  }
  sent: Array<{ channel: string; data: unknown }>
} {
  const sent: Array<{ channel: string; data: unknown }> = []
  const window = {
    webContents: {
      send(channel: string, data: unknown) {
        sent.push({ channel, data })
      }
    },
    isDestroyed() {
      return false
    }
  }
  return { window, sent }
}

export class FakeIpcPushBus {
  private listeners = new Map<string, Set<(...args: any[]) => void>>()

  on(channel: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    this.listeners.get(channel)!.add(handler)
  }

  removeListener(channel: string, handler: (...args: any[]) => void): void {
    this.listeners.get(channel)?.delete(handler)
  }

  push(channel: string, data: unknown): void {
    const handlers = this.listeners.get(channel)
    if (handlers) {
      for (const handler of handlers) {
        handler(undefined, data)
      }
    }
  }
}

export function createTestProvider(outputText: string): ProviderDefinition {
  return {
    providerId: 'test-provider',
    supportsResume() { return false },
    supportsStructuredEvents() { return false },
    async buildStartCommand(target: ProviderRuntimeTarget) {
      return {
        command: process.platform === 'win32' ? 'cmd.exe' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', outputText] : [outputText],
        cwd: target.path,
        env: { ...process.env as Record<string, string> }
      } satisfies ProviderCommand
    },
    async buildResumeCommand(target: ProviderRuntimeTarget) {
      return {
        command: process.platform === 'win32' ? 'cmd.exe' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', outputText] : [outputText],
        cwd: target.path,
        env: { ...process.env as Record<string, string> }
      } satisfies ProviderCommand
    },
    resolveSessionId() { return null },
    async installSidecar() {}
  }
}
