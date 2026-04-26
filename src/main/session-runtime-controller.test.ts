import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SessionRuntimeController } from './session-runtime-controller'
import { syncObservabilitySessionsFromManager } from './observability-sync'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { InMemoryObservationStore } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import type { SessionStateIntent, SessionStatePatchEvent } from '@shared/project-session'
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
    sent
  }
}

function providerPatch(
  sessionId: string,
  intent: SessionStateIntent,
  sequence: number,
  summary: string,
  overrides: Partial<SessionStatePatchEvent> = {}
): SessionStatePatchEvent {
  return {
    sessionId,
    sequence,
    occurredAt: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    intent,
    source: 'provider',
    summary,
    ...overrides
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

  test('applyProviderStatePatch pushes session events and presence snapshots', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-presence-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude' })
    await manager.markRuntimeAlive(session.id, 'external-1')
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)

    await controller.applyProviderStatePatch(providerPatch(session.id, 'agent.turn_started', 3, 'UserPromptSubmit', {
      sourceEventType: 'claude-code.UserPromptSubmit',
      agentState: 'working'
    }))

    expect(sent.some(event => event.channel === IPC_CHANNELS.observabilitySessionPresenceChanged)).toBe(true)
  })

  test('markRuntimeStarting updates manager and pushes observability snapshots', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markRuntimeStarting(session.id, 'starting shell', null)

    const updated = manager.snapshot().sessions[0]!
    expect(updated.runtimeState).toBe('starting')
    expect(updated.summary).toBe('starting shell')
  })

  test('markRuntimeAlive pushes presence without setting agent working', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-alive-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:02.000Z'
    })
    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)

    await controller.markRuntimeAlive(session.id, 'opencode-real-123')

    const updated = manager.snapshot().sessions[0]!
    expect(updated.runtimeState).toBe('alive')
    expect(updated.agentState).toBe('unknown')
    expect(updated.externalSessionId).toBe('opencode-real-123')
    expect(sent.map((item) => item.channel)).toEqual([
      IPC_CHANNELS.observabilitySessionPresenceChanged,
      IPC_CHANNELS.observabilityProjectChanged,
      IPC_CHANNELS.observabilityAppChanged
    ])
    expect(sent[0]!.data).toMatchObject({
      sessionId: session.id,
      phase: 'ready',
      runtimeState: 'alive',
      agentState: 'unknown',
      hasUnseenCompletion: false
    })
  })

  test('markRuntimeExited clean preserves complete presence when unseen completion exists', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-exit-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'codex', title: 'S1' })
    await manager.markRuntimeAlive(session.id, 'codex-real-123')
    await manager.applySessionStatePatch(providerPatch(session.id, 'agent.turn_completed', 2, 'Turn complete'))
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:03.000Z'
    })
    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)

    await controller.markRuntimeExited(session.id, 0, 'codex exited (0)')

    const updated = manager.snapshot().sessions[0]!
    expect(updated.runtimeState).toBe('exited')
    expect(updated.runtimeExitReason).toBe('clean')
    expect(updated.agentState).toBe('idle')
    expect(updated.hasUnseenCompletion).toBe(true)
    expect(sent.find((item) => item.channel === IPC_CHANNELS.observabilitySessionPresenceChanged)?.data).toMatchObject({
      sessionId: session.id,
      phase: 'complete',
      runtimeState: 'exited',
      agentState: 'idle',
      hasUnseenCompletion: true
    })
  })

  test('applyProviderStatePatch forwards intentful patches and pushes observability snapshots', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-provider-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })
    await manager.markRuntimeAlive(session.id, 'opencode-real-123')
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:04.000Z'
    })
    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)

    await controller.applyProviderStatePatch(
      providerPatch(session.id, 'agent.permission_requested', 2, 'Confirm resume', {
        blockingReason: 'permission',
        externalSessionId: 'opencode-real-456'
      })
    )

    const updated = manager.snapshot().sessions[0]!
    expect(updated.agentState).toBe('blocked')
    expect(updated.blockingReason).toBe('permission')
    expect(updated.externalSessionId).toBe('opencode-real-456')
    expect(sent.map((item) => item.channel)).toEqual([
      IPC_CHANNELS.observabilitySessionPresenceChanged,
      IPC_CHANNELS.observabilityProjectChanged,
      IPC_CHANNELS.observabilityAppChanged
    ])
    expect(sent[0]!.data).toMatchObject({
      sessionId: session.id,
      phase: 'blocked',
      agentState: 'blocked',
      blockingReason: 'permission'
    })
  })

  test('setActiveSession on a complete session pushes a ready presence snapshot after completion_seen', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-active-'), name: 'test' })
    const other = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'Other' })
    const complete = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'Complete' })
    await manager.markRuntimeAlive(complete.id, 'opencode-real-123')
    await manager.applySessionStatePatch(providerPatch(complete.id, 'agent.turn_completed', 2, 'Turn complete'))
    await manager.setActiveSession(other.id)
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:05.000Z'
    })
    const controller = new SessionRuntimeController(manager, () => win, undefined, observability)

    await controller.setActiveSession(complete.id)

    const updated = manager.snapshot().sessions.find((candidate) => candidate.id === complete.id)!
    expect(updated.agentState).toBe('idle')
    expect(updated.hasUnseenCompletion).toBe(false)
    expect(sent.find((item) => item.channel === IPC_CHANNELS.observabilitySessionPresenceChanged)?.data).toMatchObject({
      sessionId: complete.id,
      phase: 'ready',
      agentState: 'idle',
      hasUnseenCompletion: false
    })
  })

  test('manager snapshot sync excludes archived sessions from observability bootstrap aggregates', async () => {
    const activeProject = await manager.createProject({ path: await createTestWorkspace('ctrl-bootstrap-a-'), name: 'Active' })
    const archivedProject = await manager.createProject({ path: await createTestWorkspace('ctrl-bootstrap-b-'), name: 'Archived' })
    const activeSession = await manager.createSession({ projectId: activeProject.id, type: 'opencode', title: 'Active Session' })
    const archivedSession = await manager.createSession({ projectId: archivedProject.id, type: 'opencode', title: 'Archived Session' })
    await manager.markRuntimeAlive(activeSession.id, 'active-ext')
    await manager.markRuntimeAlive(archivedSession.id, 'archived-ext')
    await manager.applySessionStatePatch(providerPatch(archivedSession.id, 'agent.permission_requested', 2, 'Confirm resume', {
      blockingReason: 'resume-confirmation'
    }))
    await manager.archiveSession(archivedSession.id)

    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:02.000Z'
    })

    syncObservabilitySessionsFromManager(manager, observability)

    expect(observability.getSessionPresence(activeSession.id)).toMatchObject({
      sessionId: activeSession.id,
      runtimeState: 'alive'
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
    await manager.markRuntimeAlive(retainedSession.id, 'retained-ext')
    await manager.markRuntimeAlive(archivedSession.id, 'archived-ext')
    await manager.applySessionStatePatch(providerPatch(archivedSession.id, 'agent.permission_requested', 2, 'Confirm resume', {
      blockingReason: 'resume-confirmation'
    }))

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

    await controller.markRuntimeStarting(session.id, 'start', null)
    await controller.markRuntimeAlive(session.id, null)
    await controller.markRuntimeExited(session.id, 0, 'exit')
    await controller.appendTerminalData({ sessionId: session.id, data: 'x' })

    expect(manager.snapshot().sessions[0]!).toMatchObject({
      runtimeState: 'exited',
      runtimeExitReason: 'clean'
    })
  })
})
