import { beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import type { RendererApi, SessionSummary, SessionSummaryEvent, TerminalDataChunk } from '@shared/project-session'
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
    onSessionEvent(callback) {
      const handler = (_event: undefined, event: SessionSummaryEvent) => callback(event)
      bus.on(IPC_CHANNELS.sessionEvent, handler)
      return () => bus.removeListener(IPC_CHANNELS.sessionEvent, handler)
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

  test('delivers ordered session:event lifecycle payloads for the same session', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const received: SessionSummaryEvent[] = []

    api.onSessionEvent((event) => {
      received.push(event)
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'booting sidecar',
        runtimeState: 'starting',
        lastStateSequence: 1
      })
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'attached',
        runtimeState: 'alive',
        agentState: 'working',
        lastStateSequence: 2
      })
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'process exited',
        runtimeState: 'exited',
        agentState: 'idle',
        runtimeExitCode: 0,
        runtimeExitReason: 'clean',
        lastStateSequence: 3
      })
    })

    expect(received).toEqual([
      {
        session: createSessionSummary({
          summary: 'booting sidecar',
          runtimeState: 'starting',
          lastStateSequence: 1
        })
      },
      {
        session: createSessionSummary({
          summary: 'attached',
          runtimeState: 'alive',
          agentState: 'working',
          lastStateSequence: 2
        })
      },
      {
        session: createSessionSummary({
          summary: 'process exited',
          runtimeState: 'exited',
          agentState: 'idle',
          runtimeExitCode: 0,
          runtimeExitReason: 'clean',
          lastStateSequence: 3
        })
      }
    ])
  })

  test('unsubscribe stops further push delivery', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const received: SessionSummaryEvent[] = []

    const unsubscribe = api.onSessionEvent((event) => {
      received.push(event)
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'booting',
        runtimeState: 'starting',
        lastStateSequence: 1
      })
    })
    unsubscribe()
    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'ready',
        runtimeState: 'alive',
        agentState: 'working',
        lastStateSequence: 2
      })
    })

    expect(received).toEqual([
      {
        session: createSessionSummary({
          summary: 'booting',
          runtimeState: 'starting',
          lastStateSequence: 1
        })
      }
    ])
  })

  test('session:event subscription updates workspace store state through push callbacks', () => {
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

    api.onSessionEvent((event) => {
      store.updateSession(event.session.id, event.session)
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'attached',
        runtimeState: 'alive',
        agentState: 'working',
        lastStateSequence: 1
      })
    })

    expect(store.sessions[0]?.runtimeState).toBe('alive')
    expect(store.sessions[0]?.agentState).toBe('working')
    expect(store.sessions[0]?.summary).toBe('attached')
    expect(store.activeSession?.runtimeState).toBe('alive')
    expect(store.activeSession?.agentState).toBe('working')
    expect(store.activeSession?.summary).toBe('attached')

    bus.push(IPC_CHANNELS.sessionEvent, {
      session: createSessionSummary({
        summary: 'process exited',
        runtimeState: 'exited',
        agentState: 'idle',
        runtimeExitCode: 0,
        runtimeExitReason: 'clean',
        lastStateSequence: 2
      })
    })

    expect(store.sessions[0]?.runtimeState).toBe('exited')
    expect(store.sessions[0]?.agentState).toBe('idle')
    expect(store.sessions[0]?.summary).toBe('process exited')
    expect(store.activeSession?.runtimeState).toBe('exited')
    expect(store.activeSession?.agentState).toBe('idle')
    expect(store.activeSession?.summary).toBe('process exited')
  })
})
