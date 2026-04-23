import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PtyHost } from '@core/pty-host'
import { ProjectSessionManager } from '@core/project-session-manager'
import { startSessionRuntime } from '@core/session-runtime'
import type { SessionRuntimeManager } from '@core/session-runtime'
import type { SessionStatus, SessionStatusEvent } from '@shared/project-session'
import type { ProviderCommand } from '@shared/project-session'
import type { ProviderDefinition } from '@extensions/providers'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { createTestWorkspace, createTestGlobalStatePath, readGlobalStateFile } from './helpers'
import { readProjectSessions } from '@core/state-store'

function createEchoProvider(): ProviderDefinition {
  const isWin = process.platform === 'win32'
  return {
    providerId: 'test-echo-sync',
    supportsResume() { return false },
    supportsStructuredEvents() { return false },
    async buildStartCommand(target, _context): Promise<ProviderCommand> {
      if (isWin) {
        return { command: 'cmd.exe', args: ['/c', 'echo', 'sync-e2e'], cwd: target.path, env: process.env as Record<string, string> }
      }
      return { command: 'echo', args: ['sync-e2e'], cwd: target.path, env: process.env as Record<string, string> }
    },
    async buildResumeCommand(target, _externalSessionId, _context): Promise<ProviderCommand> {
      if (isWin) {
        return { command: 'cmd.exe', args: ['/c', 'echo', 'sync-resume'], cwd: target.path, env: process.env as Record<string, string> }
      }
      return { command: 'echo', args: ['sync-resume'], cwd: target.path, env: process.env as Record<string, string> }
    },
    resolveSessionId(event) { return event.session_id ?? null },
    async installSidecar() {}
  }
}

function waitForExit(signal: Promise<void>, timeoutMs = 10_000): Promise<void> {
  return Promise.race([
    signal,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for process exit')), timeoutMs)
    )
  ])
}

interface StoreCapturingManager extends SessionRuntimeManager {
  events: Array<{ sessionId: string; status: SessionStatus; summary: string }>
  terminalData: Array<{ sessionId: string; data: string }>
  exitSignal: Promise<void>
}

function createStoreCapturingManager(delegate: ProjectSessionManager): StoreCapturingManager {
  const events: Array<{ sessionId: string; status: SessionStatus; summary: string }> = []
  const terminalData: Array<{ sessionId: string; data: string }> = []
  let resolveExit: (() => void) | undefined
  const exitSignal = new Promise<void>((resolve) => { resolveExit = resolve })

  return {
    events,
    terminalData,
    exitSignal,
    async markSessionStarting(sessionId: string, summary: string, externalSessionId: string | null) {
      await delegate.markSessionStarting(sessionId, summary, externalSessionId)
      events.push({ sessionId, status: 'starting', summary })
    },
    async markSessionRunning(sessionId: string, externalSessionId: string | null) {
      await delegate.markSessionRunning(sessionId, externalSessionId)
      events.push({ sessionId, status: 'running', summary: '会话运行中' })
    },
    async markSessionExited(sessionId: string, summary: string) {
      await delegate.markSessionExited(sessionId, summary)
      events.push({ sessionId, status: 'exited', summary })
      resolveExit!()
    },
    async appendTerminalData(chunk: { sessionId: string; data: string }) {
      terminalData.push(chunk)
    }
  }
}

function replayEventsToStore(
  store: ReturnType<typeof useWorkspaceStore>,
  events: Array<{ sessionId: string; status: SessionStatus; summary: string }>
): void {
  for (const event of events) {
    store.updateSession(event.sessionId, { status: event.status, summary: event.summary })
  }
}

describe('E2E: Store Lifecycle Synchronization', () => {
  const activeHosts: PtyHost[] = []

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    for (const host of activeHosts.splice(0)) {
      host.dispose()
    }
  })

  describe('Single session: full lifecycle through store', () => {
    test('store tracks session through bootstrapping → starting → running → exited', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-lifecycle-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'sync-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Sync Shell' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0]!.status).toBe('bootstrapping')
      expect(store.activeSession!.status).toBe('bootstrapping')

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      replayEventsToStore(store, capturing.events)

      const storeSession = store.sessions.find(s => s.id === session.id)!
      expect(storeSession.status).toBe('running')
      expect(storeSession.summary).toContain('会话运行中')
      expect(store.activeSession!.status).toBe('running')

      await waitForExit(capturing.exitSignal)

      replayEventsToStore(store, capturing.events)

      expect(store.sessions.find(s => s.id === session.id)!.status).toBe('exited')
      expect(store.activeSession!.status).toBe('exited')
    })

    test('projectHierarchy reflects status changes through lifecycle', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-hierarchy-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'hierarchy-sync' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Hierarchy Shell' })

      const store = useWorkspaceStore()
      store.hydrate(manager.snapshot())

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      replayEventsToStore(store, capturing.events)

      const node = store.projectHierarchy.find(n => n.id === project.id)!
      expect(node.sessions).toHaveLength(1)
      expect(node.sessions[0]!.status).toBe('running')

      await waitForExit(capturing.exitSignal)
      replayEventsToStore(store, capturing.events)

      expect(store.projectHierarchy[0]!.sessions[0]!.status).toBe('exited')
    })

    test('state on disk matches store state at each lifecycle stage', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-disk-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'disk-sync' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Disk Shell' })

      const store = useWorkspaceStore()
      store.hydrate(manager.snapshot())

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      replayEventsToStore(store, capturing.events)

      const diskRunning = await readProjectSessions(workspaceDir)
      expect(diskRunning.sessions[0]!.last_known_status).toBe('running')
      expect(store.sessions[0]!.status).toBe('running')
      expect(diskRunning.sessions[0]!.last_known_status).toBe(store.sessions[0]!.status)

      await waitForExit(capturing.exitSignal)
      replayEventsToStore(store, capturing.events)

      const diskExited = await readProjectSessions(workspaceDir)
      expect(diskExited.sessions[0]!.last_known_status).toBe('exited')
      expect(store.sessions[0]!.status).toBe('exited')
    })

    test('externalSessionId propagates to store after running', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-extid-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'extid-sync' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'ExtID Shell' })

      const store = useWorkspaceStore()
      store.hydrate(manager.snapshot())

      expect(store.sessions[0]!.externalSessionId).toBeNull()

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      const backendSnapshot = manager.snapshot()
      const externalId = backendSnapshot.sessions.find(s => s.id === session.id)!.externalSessionId
      store.updateSession(session.id, { externalSessionId: externalId })

      expect(store.sessions[0]!.externalSessionId).toBeNull()
      expect(store.activeSession!.externalSessionId).toBeNull()
    })
  })

  describe('Event sequence validation', () => {
    test('events arrive in correct order: starting → running → exited', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-order-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'order-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Order Shell' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)

      expect(capturing.events).toHaveLength(3)
      expect(capturing.events[0]!.status).toBe('starting')
      expect(capturing.events[1]!.status).toBe('running')
      expect(capturing.events[2]!.status).toBe('exited')
    })

    test('replaying events to store produces same state as backend snapshot', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-replay-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'replay-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Replay Shell' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)

      const backendSession = manager.snapshot().sessions.find(s => s.id === session.id)!
      const store = useWorkspaceStore()
      store.hydrate(manager.snapshot())

      expect(store.sessions[0]!.status).toBe(backendSession.status)
      expect(store.sessions[0]!.summary).toBe(backendSession.summary)
      expect(store.sessions[0]!.externalSessionId).toBe(backendSession.externalSessionId)
    })

    test('terminal data captured alongside lifecycle events', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-termdata-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'termdata-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'TermData Shell' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)

      expect(capturing.events).toHaveLength(3)
      expect(capturing.events[0]!.status).toBe('starting')
      expect(capturing.terminalData.length).toBeGreaterThan(0)
      expect(capturing.terminalData.every(c => c.sessionId === session.id)).toBe(true)
      expect(capturing.terminalData.map(c => c.data).join('')).toContain('sync-e2e')
    })
  })

  describe('Multi-session store sync', () => {
    test('two sessions: store tracks both through concurrent lifecycle', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-multi-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'multi-sync' })
      const session1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Multi 1' })
      const session2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Multi 2' })

      const store = useWorkspaceStore()
      store.hydrate(manager.snapshot())

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const provider = createEchoProvider()
      const capturing1 = createStoreCapturingManager(manager)
      const capturing2 = createStoreCapturingManager(manager)

      await Promise.all([
        startSessionRuntime({
          session: {
            id: session1.id, projectId: session1.projectId, path: workspaceDir,
            title: session1.title, type: session1.type, status: session1.status,
            externalSessionId: session1.externalSessionId
          },
          webhookPort: 43127, provider, ptyHost, manager: capturing1
        }),
        startSessionRuntime({
          session: {
            id: session2.id, projectId: session2.projectId, path: workspaceDir,
            title: session2.title, type: session2.type, status: session2.status,
            externalSessionId: session2.externalSessionId
          },
          webhookPort: 43127, provider, ptyHost, manager: capturing2
        })
      ])

      replayEventsToStore(store, capturing1.events)
      replayEventsToStore(store, capturing2.events)

      expect(store.sessions.find(s => s.id === session1.id)!.status).toBe('running')
      expect(store.sessions.find(s => s.id === session2.id)!.status).toBe('running')

      const hierarchyNode = store.projectHierarchy.find(n => n.id === project.id)!
      expect(hierarchyNode.sessions).toHaveLength(2)
      expect(hierarchyNode.sessions.every(s => s.status === 'running')).toBe(true)

      await Promise.all([
        waitForExit(capturing1.exitSignal),
        waitForExit(capturing2.exitSignal)
      ])

      replayEventsToStore(store, capturing1.events)
      replayEventsToStore(store, capturing2.events)

      expect(store.sessions.find(s => s.id === session1.id)!.status).toBe('exited')
      expect(store.sessions.find(s => s.id === session2.id)!.status).toBe('exited')
    })

    test('active session switches correctly during concurrent lifecycles', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-active-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'active-sync' })
      const session1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Active 1' })
      const session2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Active 2' })

      const store = useWorkspaceStore()
      store.hydrate(manager.snapshot())

      store.setActiveSession(session1.id)
      expect(store.activeSessionId).toBe(session1.id)
      expect(store.activeSession!.status).toBe('bootstrapping')

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const provider = createEchoProvider()
      const capturing1 = createStoreCapturingManager(manager)
      const capturing2 = createStoreCapturingManager(manager)

      await Promise.all([
        startSessionRuntime({
          session: {
            id: session1.id, projectId: session1.projectId, path: workspaceDir,
            title: session1.title, type: session1.type, status: session1.status,
            externalSessionId: session1.externalSessionId
          },
          webhookPort: 43127, provider, ptyHost, manager: capturing1
        }),
        startSessionRuntime({
          session: {
            id: session2.id, projectId: session2.projectId, path: workspaceDir,
            title: session2.title, type: session2.type, status: session2.status,
            externalSessionId: session2.externalSessionId
          },
          webhookPort: 43127, provider, ptyHost, manager: capturing2
        })
      ])

      replayEventsToStore(store, capturing1.events)
      replayEventsToStore(store, capturing2.events)

      expect(store.activeSessionId).toBe(session1.id)
      expect(store.activeSession!.status).toBe('running')

      store.setActiveSession(session2.id)
      expect(store.activeSessionId).toBe(session2.id)
      expect(store.activeSession!.status).toBe('running')

      await Promise.all([
        waitForExit(capturing1.exitSignal),
        waitForExit(capturing2.exitSignal)
      ])

      replayEventsToStore(store, capturing1.events)
      replayEventsToStore(store, capturing2.events)

      expect(store.activeSessionId).toBe(session2.id)
      expect(store.activeSession!.status).toBe('exited')

      store.setActiveSession(session1.id)
      expect(store.activeSession!.status).toBe('exited')
    })
  })

  describe('Store-backend consistency after restart', () => {
    test('hydrating a fresh store from restarted manager matches original store state', async () => {
      const workspaceDir = await createTestWorkspace('stoa-sync-restart-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'restart-sync' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Restart Shell' })

      const store1 = useWorkspaceStore()
      store1.hydrate(manager.snapshot())

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createStoreCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)
      replayEventsToStore(store1, capturing.events)

      const finalSnapshot = manager.snapshot()
      store1.hydrate(finalSnapshot)

      const restarted = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const restartedSnapshot = restarted.snapshot()

      setActivePinia(createPinia())
      const store2 = useWorkspaceStore()
      store2.hydrate(restartedSnapshot)

      expect(store2.sessions).toHaveLength(1)
      expect(store2.sessions[0]!.status).toBe('exited')
      expect(store2.sessions[0]!.status).toBe(store1.sessions[0]!.status)
      expect(store2.sessions[0]!.externalSessionId).toBe(store1.sessions[0]!.externalSessionId)
      expect(store2.projectHierarchy[0]!.sessions[0]!.status).toBe('exited')
    })
  })
})
