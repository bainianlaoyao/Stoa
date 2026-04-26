import { beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import type { RendererApi, SessionSummary, TerminalDataChunk } from '@shared/project-session'
import type { SessionPresenceSnapshot } from '@shared/observability'
import { FakeIpcPushBus } from './helpers'

function createPreloadApi(bus: FakeIpcPushBus): RendererApi {
  return {
    getBootstrapState: () => bus.invoke(IPC_CHANNELS.projectBootstrap),
    createProject: (request) => bus.invoke(IPC_CHANNELS.projectCreate, request),
    createSession: (request) => bus.invoke(IPC_CHANNELS.sessionCreate, request),
    setActiveProject: (projectId) => bus.invoke(IPC_CHANNELS.projectSetActive, projectId),
    setActiveSession: (sessionId) => bus.invoke(IPC_CHANNELS.sessionSetActive, sessionId),
    getTerminalReplay: (sessionId) => bus.invoke(IPC_CHANNELS.sessionTerminalReplay, sessionId),
    sendSessionInput: (sessionId, data) => bus.invoke(IPC_CHANNELS.sessionInput, sessionId, data),
    sendSessionResize: (sessionId, cols, rows) => bus.invoke(IPC_CHANNELS.sessionResize, sessionId, cols, rows),
    onTerminalData(callback) {
      const handler = (_event: undefined, chunk: TerminalDataChunk) => callback(chunk)
      bus.on(IPC_CHANNELS.terminalData, handler)
      return () => bus.removeListener(IPC_CHANNELS.terminalData, handler)
    },
    onSessionPresenceChanged(callback) {
      const handler = (_event: undefined, snapshot: SessionPresenceSnapshot) => callback(snapshot)
      bus.on(IPC_CHANNELS.observabilitySessionPresenceChanged, handler)
      return () => bus.removeListener(IPC_CHANNELS.observabilitySessionPresenceChanged, handler)
    }
  }
}

function createSessionSummary(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_op_1',
    projectId: 'project_alpha',
    type: 'opencode',
    runtimeState: 'created',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 0,
    blockingReason: null,
    title: 'Deploy',
    summary: 'waiting for sidecar',
    recoveryMode: 'resume-external',
    externalSessionId: 'ext-1',
    createdAt: 'a',
    updatedAt: 'a',
    lastActivatedAt: 'a',
    archived: false,
    ...patch
  }
}

describe('E2E: IPC Push Harness', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('delivers terminal:data chunks to active subscribers', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const received: TerminalDataChunk[] = []

    api.onTerminalData((chunk) => {
      received.push(chunk)
    })

    bus.push(IPC_CHANNELS.terminalData, {
      sessionId: 'session_shell_1',
      data: 'pwd\r\n'
    })

    expect(received).toEqual([
      {
        sessionId: 'session_shell_1',
        data: 'pwd\r\n'
      }
    ])
  })

  test('delivers ordered session presence lifecycle payloads for the same session', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const received: SessionPresenceSnapshot[] = []

    api.onSessionPresenceChanged((snapshot) => {
      received.push(snapshot)
    })

    const baseSnapshot: SessionPresenceSnapshot = {
      sessionId: 'session_op_1',
      projectId: 'project_alpha',
      providerId: 'opencode',
      providerLabel: 'OpenCode',
      modelLabel: null,
      phase: 'running',
      runtimeState: 'starting',
      agentState: 'unknown',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      confidence: 'authoritative',
      health: 'healthy',
      blockingReason: null,
      lastAssistantSnippet: null,
      lastEventAt: '2026-01-01T00:00:00.000Z',
      lastEvidenceType: null,
      hasUnreadTurn: false,
      recoveryPointerState: 'trusted',
      evidenceSequence: 1,
      sourceSequence: 1,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      runtimeState: 'starting',
      phase: 'running',
      sourceSequence: 1
    })

    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      runtimeState: 'alive',
      agentState: 'working',
      phase: 'running',
      sourceSequence: 2
    })

    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      runtimeState: 'exited',
      agentState: 'idle',
      runtimeExitCode: 0,
      runtimeExitReason: 'clean',
      phase: 'ready',
      sourceSequence: 3
    })

    expect(received).toHaveLength(3)
    expect(received[0]!.runtimeState).toBe('starting')
    expect(received[1]!.runtimeState).toBe('alive')
    expect(received[2]!.runtimeState).toBe('exited')
  })

  test('unsubscribe stops further push delivery', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const received: SessionPresenceSnapshot[] = []

    const baseSnapshot: SessionPresenceSnapshot = {
      sessionId: 'session_op_1',
      projectId: 'project_alpha',
      providerId: 'opencode',
      providerLabel: 'OpenCode',
      modelLabel: null,
      phase: 'running',
      runtimeState: 'starting',
      agentState: 'unknown',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      confidence: 'authoritative',
      health: 'healthy',
      blockingReason: null,
      lastAssistantSnippet: null,
      lastEventAt: '2026-01-01T00:00:00.000Z',
      lastEvidenceType: null,
      hasUnreadTurn: false,
      recoveryPointerState: 'trusted',
      evidenceSequence: 1,
      sourceSequence: 1,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const unsubscribe = api.onSessionPresenceChanged((snapshot) => {
      received.push(snapshot)
    })

    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      sourceSequence: 1
    })
    unsubscribe()
    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      sourceSequence: 2
    })

    expect(received).toHaveLength(1)
    expect(received[0]!.sourceSequence).toBe(1)
  })

  test('session presence subscription updates workspace store state through push callbacks', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const store = useWorkspaceStore()

    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_op_1',
      terminalWebhookPort: 43127,
      projects: [
        {
          id: 'project_alpha',
          name: 'alpha',
          path: 'D:/alpha',
          createdAt: 'a',
          updatedAt: 'a'
        }
      ],
      sessions: [
        createSessionSummary()
      ]
    })

    const baseSnapshot: SessionPresenceSnapshot = {
      sessionId: 'session_op_1',
      projectId: 'project_alpha',
      providerId: 'opencode',
      providerLabel: 'OpenCode',
      modelLabel: null,
      phase: 'running',
      runtimeState: 'alive',
      agentState: 'working',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      confidence: 'authoritative',
      health: 'healthy',
      blockingReason: null,
      lastAssistantSnippet: null,
      lastEventAt: '2026-01-01T00:00:00.000Z',
      lastEvidenceType: null,
      hasUnreadTurn: false,
      recoveryPointerState: 'trusted',
      evidenceSequence: 1,
      sourceSequence: 1,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    api.onSessionPresenceChanged((snapshot) => {
      store.applySessionPresenceSnapshot(snapshot)
    })

    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      runtimeState: 'alive',
      agentState: 'working',
      sourceSequence: 1
    })

    expect(store.activeSessionPresence?.runtimeState).toBe('alive')
    expect(store.activeSessionPresence?.agentState).toBe('working')

    bus.push(IPC_CHANNELS.observabilitySessionPresenceChanged, {
      ...baseSnapshot,
      runtimeState: 'exited',
      agentState: 'idle',
      runtimeExitCode: 0,
      runtimeExitReason: 'clean',
      sourceSequence: 2
    })

    expect(store.activeSessionPresence?.runtimeState).toBe('exited')
    expect(store.activeSessionPresence?.agentState).toBe('idle')
  })
})
