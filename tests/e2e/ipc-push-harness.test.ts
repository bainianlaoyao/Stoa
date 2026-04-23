import { beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import type { RendererApi, SessionStatusEvent, TerminalDataChunk } from '@shared/project-session'
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
      const handler = (_event: undefined, event: SessionStatusEvent) => callback(event)
      bus.on(IPC_CHANNELS.sessionEvent, handler)
      return () => bus.removeListener(IPC_CHANNELS.sessionEvent, handler)
    }
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
    const received: SessionStatusEvent[] = []

    api.onSessionEvent((event) => {
      received.push(event)
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'starting',
      summary: 'booting sidecar'
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'running',
      summary: 'attached'
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'exited',
      summary: 'process exited'
    })

    expect(received).toEqual([
      {
        sessionId: 'session_op_1',
        status: 'starting',
        summary: 'booting sidecar'
      },
      {
        sessionId: 'session_op_1',
        status: 'running',
        summary: 'attached'
      },
      {
        sessionId: 'session_op_1',
        status: 'exited',
        summary: 'process exited'
      }
    ])
  })

  test('unsubscribe stops further push delivery', () => {
    const bus = new FakeIpcPushBus()
    const api = createPreloadApi(bus)
    const received: SessionStatusEvent[] = []

    const unsubscribe = api.onSessionEvent((event) => {
      received.push(event)
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'starting',
      summary: 'booting'
    })
    unsubscribe()
    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'running',
      summary: 'ready'
    })

    expect(received).toEqual([
      {
        sessionId: 'session_op_1',
        status: 'starting',
        summary: 'booting'
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
        {
          id: 'session_op_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'bootstrapping',
          title: 'Deploy',
          summary: 'waiting for sidecar',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a'
        }
      ]
    })

    api.onSessionEvent((event) => {
      store.updateSession(event.sessionId, {
        status: event.status,
        summary: event.summary
      })
    })

    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'running',
      summary: 'attached'
    })

    expect(store.sessions[0]?.status).toBe('running')
    expect(store.sessions[0]?.summary).toBe('attached')
    expect(store.activeSession?.status).toBe('running')
    expect(store.activeSession?.summary).toBe('attached')

    bus.push(IPC_CHANNELS.sessionEvent, {
      sessionId: 'session_op_1',
      status: 'exited',
      summary: 'process exited'
    })

    expect(store.sessions[0]?.status).toBe('exited')
    expect(store.sessions[0]?.summary).toBe('process exited')
    expect(store.activeSession?.status).toBe('exited')
    expect(store.activeSession?.summary).toBe('process exited')
  })
})
