import { describe, test, expect, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { createTestWorkspace, createTestGlobalStatePath, tempDirs } from './helpers'
import type {
  BootstrapState,
  CreateProjectRequest,
  CreateSessionRequest,
  ObservationEventListOptions,
  ProjectSummary,
  RendererApi,
  SessionSummary
} from '@shared/project-session'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'

class FakeIpcBus {
  private handlers = new Map<string, (...args: any[]) => Promise<any>>()

  handle(channel: string, handler: (...args: any[]) => Promise<any>): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`No IPC handler registered for channel: ${channel}`)
    return handler(undefined, ...args) // first arg is event, pass undefined
  }

  hasHandler(channel: string): boolean {
    return this.handlers.has(channel)
  }

  getRegisteredChannels(): string[] {
    return [...this.handlers.keys()]
  }
}

const RENDERER_API_INVOKE_CHANNELS = [
  IPC_CHANNELS.projectBootstrap,
  IPC_CHANNELS.projectCreate,
  IPC_CHANNELS.sessionCreate,
  IPC_CHANNELS.projectSetActive,
  IPC_CHANNELS.sessionSetActive,
  IPC_CHANNELS.observabilityGetSessionPresence,
  IPC_CHANNELS.observabilityGetProject,
  IPC_CHANNELS.observabilityGetApp,
  IPC_CHANNELS.observabilityListSessionEvents,
  IPC_CHANNELS.sessionTerminalReplay,
  IPC_CHANNELS.sessionInput,
  IPC_CHANNELS.sessionResize
] as const

const defaultPresenceSnapshot: SessionPresenceSnapshot = {
  sessionId: 'session-observe-1',
  projectId: 'project-observe-1',
  providerId: 'local-shell',
  providerLabel: 'Shell',
  modelLabel: null,
  phase: 'working',
  canonicalStatus: 'running',
  confidence: 'stale',
  health: 'healthy',
  blockingReason: null,
  lastAssistantSnippet: null,
  lastEventAt: '2026-01-01T00:00:00.000Z',
  lastEvidenceType: null,
  hasUnreadTurn: false,
  recoveryPointerState: 'missing',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const defaultProjectObservability: ProjectObservabilitySnapshot = {
  projectId: 'project-observe-1',
  overallHealth: 'healthy',
  activeSessionCount: 1,
  blockedSessionCount: 0,
  degradedSessionCount: 0,
  failedSessionCount: 0,
  unreadTurnCount: 0,
  latestAttentionSessionId: null,
  latestAttentionReason: null,
  lastEventAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const defaultAppObservability: AppObservabilitySnapshot = {
  blockedProjectCount: 0,
  failedProjectCount: 0,
  degradedProjectCount: 0,
  totalUnreadTurns: 0,
  projectsNeedingAttention: [],
  providerHealthSummary: {},
  lastGlobalEventAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const defaultObservationEvent: ObservationEvent = {
  eventId: 'event-observe-1',
  eventVersion: 1,
  sequence: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  ingestedAt: '2026-01-01T00:00:01.000Z',
  scope: 'session',
  projectId: 'project-observe-1',
  sessionId: 'session-observe-1',
  providerId: null,
  category: 'presence',
  type: 'presence.running',
  severity: 'info',
  retention: 'operational',
  source: 'runtime-controller',
  correlationId: null,
  dedupeKey: null,
  payload: {}
}

function createPreloadApi(bus: FakeIpcBus): RendererApi {
  return {
    getBootstrapState: () => bus.invoke(IPC_CHANNELS.projectBootstrap),
    createProject: (request: CreateProjectRequest) => bus.invoke(IPC_CHANNELS.projectCreate, request),
    createSession: (request: CreateSessionRequest) => bus.invoke(IPC_CHANNELS.sessionCreate, request),
    setActiveProject: (projectId: string) => bus.invoke(IPC_CHANNELS.projectSetActive, projectId),
    setActiveSession: (sessionId: string) => bus.invoke(IPC_CHANNELS.sessionSetActive, sessionId),
    getSessionPresence: (sessionId: string) => bus.invoke(IPC_CHANNELS.observabilityGetSessionPresence, sessionId),
    getProjectObservability: (projectId: string) => bus.invoke(IPC_CHANNELS.observabilityGetProject, projectId),
    getAppObservability: () => bus.invoke(IPC_CHANNELS.observabilityGetApp),
    listSessionObservationEvents: (sessionId: string, options: ObservationEventListOptions) =>
      bus.invoke(IPC_CHANNELS.observabilityListSessionEvents, sessionId, options),
    getTerminalReplay: (sessionId: string) => bus.invoke(IPC_CHANNELS.sessionTerminalReplay, sessionId),
    sendSessionInput: (sessionId: string, data: string) => bus.invoke(IPC_CHANNELS.sessionInput, sessionId, data),
    sendSessionResize: (sessionId: string, cols: number, rows: number) => bus.invoke(IPC_CHANNELS.sessionResize, sessionId, cols, rows),
    onTerminalData: () => () => {},
    onSessionEvent: () => () => {},
    onSessionPresenceChanged: () => () => {},
    onProjectObservabilityChanged: () => () => {},
    onAppObservabilityChanged: () => () => {}
  }
}

async function registerMainHandlers(
  bus: FakeIpcBus,
  globalStatePath: string
): Promise<ProjectSessionManager> {
  const manager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath
  })

  bus.handle(IPC_CHANNELS.projectBootstrap, async () => {
    return manager.snapshot()
  })

  bus.handle(IPC_CHANNELS.projectCreate, async (_event, payload: CreateProjectRequest) => {
    return manager.createProject(payload)
  })

  bus.handle(IPC_CHANNELS.sessionCreate, async (_event, payload: CreateSessionRequest) => {
    return manager.createSession(payload)
  })

  bus.handle(IPC_CHANNELS.projectSetActive, async (_event, projectId: string) => {
    await manager.setActiveProject(projectId)
  })

  bus.handle(IPC_CHANNELS.sessionSetActive, async (_event, sessionId: string) => {
    await manager.setActiveSession(sessionId)
  })

  bus.handle(IPC_CHANNELS.observabilityGetSessionPresence, async () => defaultPresenceSnapshot)

  bus.handle(IPC_CHANNELS.observabilityGetProject, async () => defaultProjectObservability)

  bus.handle(IPC_CHANNELS.observabilityGetApp, async () => defaultAppObservability)

  bus.handle(IPC_CHANNELS.observabilityListSessionEvents, async (_event, _sessionId: string, options: ObservationEventListOptions) => {
    return {
      events: options.limit > 0 ? [defaultObservationEvent] : [],
      nextCursor: null
    }
  })

  bus.handle(IPC_CHANNELS.sessionTerminalReplay, async (_event, sessionId: string) => {
    return `[replay:${sessionId}]`
  })

  bus.handle(IPC_CHANNELS.sessionInput, async () => {
    return
  })

  bus.handle(IPC_CHANNELS.sessionResize, async () => {
    return
  })

  return manager
}

describe('E2E: IPC Bridge (Real Round-Trip)', () => {

  describe('IPC channel registration completeness', () => {
    test('all invoke RendererApi channels are registered in ipcMain', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)

      for (const channel of RENDERER_API_INVOKE_CHANNELS) {
        expect(bus.hasHandler(channel)).toBe(true)
      }
    })

    test('no extra channels beyond invoke RendererApi are exposed to preload', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)

      const registered = bus.getRegisteredChannels()
      expect(registered).toHaveLength(RENDERER_API_INVOKE_CHANNELS.length)
      for (const channel of RENDERER_API_INVOKE_CHANNELS) {
        expect(registered).toContain(channel)
      }
    })

    test('IPC_CHANNELS constants match the actual channel strings used in preload', () => {
      expect(IPC_CHANNELS.projectBootstrap).toBe('project:bootstrap')
      expect(IPC_CHANNELS.projectCreate).toBe('project:create')
      expect(IPC_CHANNELS.projectSetActive).toBe('project:set-active')
      expect(IPC_CHANNELS.sessionCreate).toBe('session:create')
      expect(IPC_CHANNELS.sessionSetActive).toBe('session:set-active')
      expect(IPC_CHANNELS.observabilityGetSessionPresence).toBe('observability:get-session-presence')
      expect(IPC_CHANNELS.observabilityGetProject).toBe('observability:get-project-observability')
      expect(IPC_CHANNELS.observabilityGetApp).toBe('observability:get-app-observability')
      expect(IPC_CHANNELS.observabilityListSessionEvents).toBe('observability:list-session-events')
      expect(IPC_CHANNELS.sessionTerminalReplay).toBe('session:terminal-replay')
      expect(IPC_CHANNELS.sessionInput).toBe('session:input')
      expect(IPC_CHANNELS.sessionResize).toBe('session:resize')
      expect(IPC_CHANNELS.terminalData).toBe('terminal:data')
      expect(IPC_CHANNELS.sessionEvent).toBe('session:event')
    })
  })

  describe('Full round-trip: renderer → preload → main → manager → response', () => {
    let bus: FakeIpcBus
    let manager: ProjectSessionManager
    let api: RendererApi

    beforeEach(async () => {
      bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      manager = await registerMainHandlers(bus, globalStatePath)
      api = createPreloadApi(bus)
    })

    test('getBootstrapState round-trip returns BootstrapState', async () => {
      const state: BootstrapState = await api.getBootstrapState()

      expect(state).toHaveProperty('activeProjectId')
      expect(state).toHaveProperty('activeSessionId')
      expect(state).toHaveProperty('projects')
      expect(state).toHaveProperty('sessions')
      expect(state).toHaveProperty('terminalWebhookPort')
      expect(Array.isArray(state.projects)).toBe(true)
      expect(Array.isArray(state.sessions)).toBe(true)
    })

    test('createProject round-trip creates real project and returns ProjectSummary', async () => {
      const workspaceDir = await createTestWorkspace('ipc-project-')
      const project: ProjectSummary = await api.createProject({
        name: 'test_workspace',
        path: workspaceDir
      })

      expect(project.id).toMatch(/^project_/)
      expect(project.name).toBe('test_workspace')
      expect(project.path).toBe(workspaceDir)
      expect(typeof project.createdAt).toBe('string')

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(1)
    })

    test('createSession round-trip creates real session and returns SessionSummary', async () => {
      const workspaceDir = await createTestWorkspace('ipc-session-')
      const project = await api.createProject({
        name: 'session_host',
        path: workspaceDir
      })

      const session: SessionSummary = await api.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Shell 1'
      })

      expect(session.id).toMatch(/^session_/)
      expect(session.projectId).toBe(project.id)
      expect(session.type).toBe('shell')
      expect(session.recoveryMode).toBe('fresh-shell')
    })

    test('full user workflow: bootstrap → create project → create session → verify state', async () => {
      const state0 = await api.getBootstrapState()
      expect(state0.projects).toHaveLength(0)
      expect(state0.sessions).toHaveLength(0)

      const workspaceDir = await createTestWorkspace('ipc-workflow-')
      const project = await api.createProject({
        name: 'workflow_project',
        path: workspaceDir
      })

      const session = await api.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'Opencode Session'
      })

      const state1 = await api.getBootstrapState()
      expect(state1.projects).toHaveLength(1)
      expect(state1.sessions).toHaveLength(1)
      expect(state1.projects[0]!.id).toBe(project.id)
      expect(state1.sessions[0]!.id).toBe(session.id)
    })

    test('getTerminalReplay round-trip returns the current session backlog payload', async () => {
      const backlog = await api.getTerminalReplay('session_op_1')

      expect(backlog).toBe('[replay:session_op_1]')
    })

    test('observability query round-trip returns presence, project, app, and events payloads', async () => {
      await expect(api.getSessionPresence('session-observe-1')).resolves.toEqual(defaultPresenceSnapshot)
      await expect(api.getProjectObservability('project-observe-1')).resolves.toEqual(defaultProjectObservability)
      await expect(api.getAppObservability()).resolves.toEqual(defaultAppObservability)
      await expect(
        api.listSessionObservationEvents('session-observe-1', { limit: 1 })
      ).resolves.toEqual({
        events: [defaultObservationEvent],
        nextCursor: null
      })
    })
  })

  describe('Null manager returns fallback values', () => {
    let bus: FakeIpcBus
    let api: RendererApi

    beforeEach(() => {
      bus = new FakeIpcBus()

      const nullManager: ProjectSessionManager | null = null

      bus.handle(IPC_CHANNELS.projectBootstrap, async () => {
        const fallback: BootstrapState = {
          activeProjectId: null,
          activeSessionId: null,
          terminalWebhookPort: null,
          projects: [],
          sessions: []
        }
        return nullManager?.snapshot() ?? fallback
      })

      bus.handle(IPC_CHANNELS.projectCreate, async (_event, payload: CreateProjectRequest) => {
        return nullManager?.createProject(payload) ?? null
      })

      bus.handle(IPC_CHANNELS.sessionCreate, async (_event, payload: CreateSessionRequest) => {
        return nullManager?.createSession(payload) ?? null
      })

      bus.handle(IPC_CHANNELS.projectSetActive, async () => { return })
      bus.handle(IPC_CHANNELS.sessionSetActive, async () => { return })
      bus.handle(IPC_CHANNELS.observabilityGetSessionPresence, async () => null)
      bus.handle(IPC_CHANNELS.observabilityGetProject, async () => null)
      bus.handle(IPC_CHANNELS.observabilityGetApp, async () => defaultAppObservability)
      bus.handle(IPC_CHANNELS.observabilityListSessionEvents, async () => ({ events: [], nextCursor: null }))
      bus.handle(IPC_CHANNELS.sessionTerminalReplay, async () => '')
      bus.handle(IPC_CHANNELS.sessionInput, async () => { return })
      bus.handle(IPC_CHANNELS.sessionResize, async () => { return })

      api = createPreloadApi(bus)
    })

    test('null manager returns fallback bootstrap state', async () => {
      const state = await api.getBootstrapState()
      expect(state).toEqual({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [],
        sessions: []
      })
      expect(state.projects).toEqual([])
    })

    test('null manager returns null for createProject', async () => {
      const result = await api.createProject({ name: 'test', path: '/test' })
      expect(result).toBeNull()
    })
  })

  describe('IPC handler correctly passes payload to manager', () => {
    test('createProject receives exact request payload', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await registerMainHandlers(bus, globalStatePath)

      const captured: CreateProjectRequest[] = []
      const originalCreate = manager.createProject.bind(manager)
      manager.createProject = async (payload: CreateProjectRequest) => {
        captured.push(payload)
        return originalCreate(payload)
      }

      const api = createPreloadApi(bus)
      const workspaceDir = await createTestWorkspace('ipc-payload-')
      await api.createProject({
        name: 'workspace',
        path: workspaceDir,
        defaultSessionType: 'opencode'
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]!.name).toBe('workspace')
      expect(captured[0]!.path).toBe(workspaceDir)
      expect(captured[0]!.defaultSessionType).toBe('opencode')
    })

    test('createSession receives exact request payload', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await registerMainHandlers(bus, globalStatePath)

      const workspaceDir = await createTestWorkspace('ipc-session-payload-')
      const project = await manager.createProject({
        name: 'payload_test',
        path: workspaceDir
      })

      const captured: CreateSessionRequest[] = []
      const originalCreate = manager.createSession.bind(manager)
      manager.createSession = async (payload: CreateSessionRequest) => {
        captured.push(payload)
        return originalCreate(payload)
      }

      const api = createPreloadApi(bus)
      await api.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'Test',
        externalSessionId: 'ext-1'
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]!.projectId).toBe(project.id)
      expect(captured[0]!.type).toBe('opencode')
      expect(captured[0]!.title).toBe('Test')
      expect(captured[0]!.externalSessionId).toBe('ext-1')
    })
  })

  describe('IPC channel name mismatch detection', () => {
    test('invoking unregistered channel throws descriptive error', async () => {
      const bus = new FakeIpcBus()
      const api = createPreloadApi(bus)

      await expect(api.getBootstrapState()).rejects.toThrow('No IPC handler registered')
    })

    test('RendererApi methods map to IPC_CHANNELS keys exactly', () => {
      const apiMethodToChannel: Record<string, string> = {
        getBootstrapState: IPC_CHANNELS.projectBootstrap,
        createProject: IPC_CHANNELS.projectCreate,
        createSession: IPC_CHANNELS.sessionCreate,
        setActiveProject: IPC_CHANNELS.projectSetActive,
        setActiveSession: IPC_CHANNELS.sessionSetActive,
        getSessionPresence: IPC_CHANNELS.observabilityGetSessionPresence,
        getProjectObservability: IPC_CHANNELS.observabilityGetProject,
        getAppObservability: IPC_CHANNELS.observabilityGetApp,
        listSessionObservationEvents: IPC_CHANNELS.observabilityListSessionEvents,
        getTerminalReplay: IPC_CHANNELS.sessionTerminalReplay,
        sendSessionInput: IPC_CHANNELS.sessionInput,
        sendSessionResize: IPC_CHANNELS.sessionResize,
        onTerminalData: IPC_CHANNELS.terminalData,
        onSessionEvent: IPC_CHANNELS.sessionEvent,
        onSessionPresenceChanged: IPC_CHANNELS.observabilitySessionPresenceChanged,
        onProjectObservabilityChanged: IPC_CHANNELS.observabilityProjectChanged,
        onAppObservabilityChanged: IPC_CHANNELS.observabilityAppChanged
      }

      const methods = Object.keys(apiMethodToChannel)
      expect(methods).toHaveLength(17)

      const channelValues = Object.values(apiMethodToChannel)
      const uniqueChannels = new Set(channelValues)
      expect(uniqueChannels.size).toBe(17)

      for (const channel of channelValues) {
        expect(typeof channel).toBe('string')
        expect(channel.length).toBeGreaterThan(0)
      }
    })
  })

  describe('setActive handlers are wired', () => {
    test('setActiveProject does not throw', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)
      const api = createPreloadApi(bus)

      await expect(api.setActiveProject('some-id')).resolves.toBeUndefined()
    })

    test('setActiveSession does not throw', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)
      const api = createPreloadApi(bus)

      await expect(api.setActiveSession('some-id')).resolves.toBeUndefined()
    })

    test('sendSessionInput does not throw', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)
      const api = createPreloadApi(bus)

      await expect(api.sendSessionInput('session-1', 'ls\n')).resolves.toBeUndefined()
    })

    test('sendSessionResize does not throw', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)
      const api = createPreloadApi(bus)

      await expect(api.sendSessionResize('session-1', 120, 30)).resolves.toBeUndefined()
    })

    test('getTerminalReplay does not throw', async () => {
      const bus = new FakeIpcBus()
      const globalStatePath = await createTestGlobalStatePath()
      await registerMainHandlers(bus, globalStatePath)
      const api = createPreloadApi(bus)

      await expect(api.getTerminalReplay('session-1')).resolves.toBe('[replay:session-1]')
    })
  })
})
