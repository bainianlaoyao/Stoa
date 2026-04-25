import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { SessionRuntimeController } from './session-runtime-controller'
import { syncObservabilitySessionsFromManager } from './observability-sync'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { InMemoryObservationStore } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import { createTestTempDir } from '../../testing/test-temp'

const tempDirs: string[] = []

async function createTestWorkspace(name: string): Promise<string> {
  const dir = await createTestTempDir(name)
  tempDirs.push(dir)
  return dir
}

async function createTestGlobalStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-controller-state-')
  tempDirs.push(dir)
  return join(dir, 'global.json')
}

function createMockWindow() {
  const sent: Array<{ channel: string; data: unknown }> = []
  return {
    window: {
      isDestroyed: () => false,
      webContents: {
        send(channel: string, data: unknown) {
          sent.push({ channel, data })
        }
      }
    },
    sent,
    lastSend() { return sent[sent.length - 1] }
  }
}

describe('SessionRuntimeController', () => {
  let manager: ProjectSessionManager

  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true }))
    )
  })

  beforeEach(async () => {
    const globalStatePath = await createTestGlobalStatePath()
    manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
  })

  test('markSessionStarting updates manager and pushes session event', async () => {
    const { window: win } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionStarting(session.id, 'starting shell', null)

    expect(manager.snapshot().sessions[0]!.status).toBe('starting')
  })

  test('markSessionStarting sends session event via IPC', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionStarting(session.id, 'starting shell', null)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.channel).toBe(IPC_CHANNELS.sessionEvent)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'starting',
      summary: 'starting shell',
      externalSessionId: null
    })
  })

  test('markSessionRunning updates manager and pushes session event', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionRunning(session.id, 'pty-123')

    expect(manager.snapshot().sessions[0]!.status).toBe('running')
    expect(manager.snapshot().sessions[0]!.externalSessionId).toBe('pty-123')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'running',
      summary: 'Session running',
      externalSessionId: 'pty-123'
    })
  })

  test('markSessionExited updates manager and pushes session event', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionExited(session.id, 'shell exited (0)')

    expect(manager.snapshot().sessions[0]!.status).toBe('exited')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'exited',
      summary: 'shell exited (0)',
      externalSessionId: null
    })
  })

  test('applySessionEvent updates manager state and pushes awaiting_input via IPC', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })

    const updated = manager.snapshot().sessions[0]!
    expect(updated.status).toBe('awaiting_input')
    expect(updated.summary).toBe('session.idle')
    expect(updated.externalSessionId).toBe('opencode-real-123')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
  })

  test('applySessionEvent preserves session event push and publishes observability snapshots', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-observe-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:02.000Z'
    })
    observability.syncSessions(manager.snapshot().sessions, manager.snapshot().activeSessionId)

    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)
    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'turn_complete',
      summary: 'Turn complete',
      externalSessionId: 'opencode-real-123'
    })

    expect(sent.map((item) => item.channel)).toEqual([
      IPC_CHANNELS.sessionEvent,
      IPC_CHANNELS.observabilitySessionPresenceChanged,
      IPC_CHANNELS.observabilityProjectChanged,
      IPC_CHANNELS.observabilityAppChanged
    ])
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'turn_complete',
      summary: 'Turn complete',
      externalSessionId: 'opencode-real-123'
    })
    expect(sent[1]!.data).toMatchObject({
      sessionId: session.id,
      canonicalStatus: 'turn_complete',
      confidence: 'authoritative',
      recoveryPointerState: 'trusted'
    })
    expect(sent[2]!.data).toMatchObject({
      projectId: project.id,
      activeSessionCount: 1
    })
    expect(sent[3]!.data).toMatchObject({
      providerHealthSummary: {
        opencode: 'healthy'
      }
    })
  })

  test('observability snapshots follow manager state after canonical lifecycle changes', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-sync-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:02.000Z'
    })
    observability.syncSessions(manager.snapshot().sessions, manager.snapshot().activeSessionId)
    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)

    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    sent.length = 0

    await controller.markSessionRunning(session.id, 'opencode-real-456')

    expect(sent.map((item) => item.channel)).toEqual([
      IPC_CHANNELS.sessionEvent,
      IPC_CHANNELS.observabilitySessionPresenceChanged,
      IPC_CHANNELS.observabilityProjectChanged,
      IPC_CHANNELS.observabilityAppChanged
    ])
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'running',
      summary: 'Session running',
      externalSessionId: 'opencode-real-456'
    })
    expect(sent[1]!.data).toMatchObject({
      sessionId: session.id,
      canonicalStatus: 'running',
      phase: 'working',
      confidence: 'authoritative',
      recoveryPointerState: 'trusted'
    })
  })

  test('manager snapshot sync excludes archived sessions from observability bootstrap aggregates', async () => {
    const activeProject = await manager.createProject({ path: await createTestWorkspace('ctrl-bootstrap-a-'), name: 'Active' })
    const archivedProject = await manager.createProject({ path: await createTestWorkspace('ctrl-bootstrap-b-'), name: 'Archived' })
    const activeSession = await manager.createSession({ projectId: activeProject.id, type: 'opencode', title: 'Active Session' })
    const archivedSession = await manager.createSession({ projectId: archivedProject.id, type: 'opencode', title: 'Archived Session' })
    await manager.applySessionEvent(activeSession.id, 'running', 'Running', 'active-ext')
    await manager.applySessionEvent(archivedSession.id, 'needs_confirmation', 'Confirm resume', 'archived-ext')
    await manager.archiveSession(archivedSession.id)

    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:02.000Z'
    })

    syncObservabilitySessionsFromManager(manager, observability)

    expect(observability.getSessionPresence(activeSession.id)).toMatchObject({
      sessionId: activeSession.id,
      canonicalStatus: 'running'
    })
    expect(observability.getSessionPresence(archivedSession.id)).toBeNull()
    expect(observability.getProjectObservability(activeProject.id)).toMatchObject({
      projectId: activeProject.id,
      activeSessionCount: 1,
      blockedSessionCount: 0
    })
    expect(observability.getProjectObservability(archivedProject.id)).toBeNull()
    expect(observability.getAppObservability()).toMatchObject({
      blockedProjectCount: 0,
      projectsNeedingAttention: []
    })
  })

  test('manager archive sync removes archived sessions from observability aggregates', async () => {
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-archive-sync-'), name: 'Archive Sync' })
    const retainedSession = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'Retained' })
    const archivedSession = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'Archive Me' })
    await manager.applySessionEvent(retainedSession.id, 'running', 'Running', 'retained-ext')
    await manager.applySessionEvent(archivedSession.id, 'needs_confirmation', 'Confirm resume', 'archived-ext')

    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:02.000Z'
    })

    syncObservabilitySessionsFromManager(manager, observability)
    expect(observability.getProjectObservability(project.id)).toMatchObject({
      activeSessionCount: 2,
      blockedSessionCount: 1
    })
    expect(observability.getAppObservability()).toMatchObject({
      blockedProjectCount: 1,
      projectsNeedingAttention: [project.id]
    })

    await manager.archiveSession(archivedSession.id)
    syncObservabilitySessionsFromManager(manager, observability)

    expect(observability.getSessionPresence(archivedSession.id)).toBeNull()
    expect(observability.getProjectObservability(project.id)).toMatchObject({
      activeSessionCount: 1,
      blockedSessionCount: 0
    })
    expect(observability.getAppObservability()).toMatchObject({
      blockedProjectCount: 0,
      projectsNeedingAttention: []
    })
  })

  test('markSessionRunning pushes running when runtime becomes active after ready status', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    sent.length = 0

    await controller.markSessionRunning(session.id, 'opencode-real-456')

    const updated = manager.snapshot().sessions[0]!
    expect(updated.status).toBe('running')
    expect(updated.summary).toBe('Session running')
    expect(updated.externalSessionId).toBe('opencode-real-456')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'running',
      summary: 'Session running',
      externalSessionId: 'opencode-real-456'
    })
  })

  test('markSessionRunning replaces turn_complete sessions when runtime becomes active again', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'codex', title: 'S1' })
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'turn_complete',
      summary: 'Turn complete',
      externalSessionId: 'codex-real-123'
    })
    sent.length = 0

    await controller.markSessionRunning(session.id, 'codex-real-456')

    const updated = manager.snapshot().sessions[0]!
    expect(updated.status).toBe('running')
    expect(updated.summary).toBe('Session running')
    expect(updated.externalSessionId).toBe('codex-real-456')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'running',
      summary: 'Session running',
      externalSessionId: 'codex-real-456'
    })
  })

  test('appendTerminalData pushes terminal data to renderer', async () => {
    const { window: win, sent } = createMockWindow()

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.appendTerminalData({ sessionId: 's1', data: 'hello world' })

    expect(sent).toHaveLength(1)
    expect(sent[0]!.channel).toBe(IPC_CHANNELS.terminalData)
    expect(sent[0]!.data).toEqual({ sessionId: 's1', data: 'hello world' })
  })

  test('getTerminalReplay returns the accumulated backlog for a running session', async () => {
    const { window: win } = createMockWindow()
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.appendTerminalData({ sessionId: 'session-op-1', data: 'hello ' })
    await controller.appendTerminalData({ sessionId: 'session-op-1', data: 'world' })

    expect(controller.getTerminalReplay).toBeTypeOf('function')
    await expect(controller.getTerminalReplay('session-op-1')).resolves.toBe('hello world')
  })

  test('getTerminalReplay keeps session backlogs isolated', async () => {
    const { window: win } = createMockWindow()
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.appendTerminalData({ sessionId: 'session-shell-1', data: 'shell' })
    await controller.appendTerminalData({ sessionId: 'session-op-2', data: 'opencode' })

    expect(controller.getTerminalReplay).toBeTypeOf('function')
    await expect(controller.getTerminalReplay('session-shell-1')).resolves.toBe('shell')
    await expect(controller.getTerminalReplay('session-op-2')).resolves.toBe('opencode')
  })

  test('appendTerminalData is no-op when window is destroyed', async () => {
    const destroyedWin = {
      isDestroyed: () => true,
      webContents: {
        send: () => { throw new Error('should not be called') }
      }
    }

    const controller = new SessionRuntimeController(
      manager,
      () => destroyedWin
    )
    await expect(
      controller.appendTerminalData({ sessionId: 's1', data: 'test' })
    ).resolves.toBeUndefined()
  })

  test('all methods work when window getter returns null', async () => {
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-null-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => null)

    await controller.markSessionStarting(session.id, 'start', null)
    await controller.appendTerminalData({ sessionId: session.id, data: 'x' })

    expect(manager.snapshot().sessions[0]!.status).toBe('starting')
  })
})
