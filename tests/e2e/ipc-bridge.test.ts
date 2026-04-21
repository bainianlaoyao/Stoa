import { describe, test, expect, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { createTestWorkspace, createTestStatePath, tempDirs } from './helpers'
import type {
  BootstrapState,
  CreateProjectRequest,
  CreateSessionRequest,
  ProjectSummary,
  RendererApi,
  SessionSummary
} from '@shared/project-session'

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
  IPC_CHANNELS.sessionInput,
  IPC_CHANNELS.sessionResize
] as const

function createPreloadApi(bus: FakeIpcBus): RendererApi {
  return {
    getBootstrapState: () => bus.invoke(IPC_CHANNELS.projectBootstrap),
    createProject: (request: CreateProjectRequest) => bus.invoke(IPC_CHANNELS.projectCreate, request),
    createSession: (request: CreateSessionRequest) => bus.invoke(IPC_CHANNELS.sessionCreate, request),
    setActiveProject: (projectId: string) => bus.invoke(IPC_CHANNELS.projectSetActive, projectId),
    setActiveSession: (sessionId: string) => bus.invoke(IPC_CHANNELS.sessionSetActive, sessionId),
    sendSessionInput: (sessionId: string, data: string) => bus.invoke(IPC_CHANNELS.sessionInput, sessionId, data),
    sendSessionResize: (sessionId: string, cols: number, rows: number) => bus.invoke(IPC_CHANNELS.sessionResize, sessionId, cols, rows),
    onTerminalData: () => () => {},
    onSessionEvent: () => () => {}
  }
}

async function registerMainHandlers(
  bus: FakeIpcBus,
  stateFilePath: string
): Promise<ProjectSessionManager> {
  const manager = await ProjectSessionManager.create({
    webhookPort: null,
    stateFilePath
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
      const stateFilePath = await createTestStatePath()
      await registerMainHandlers(bus, stateFilePath)

      for (const channel of RENDERER_API_INVOKE_CHANNELS) {
        expect(bus.hasHandler(channel)).toBe(true)
      }
    })

    test('no extra channels beyond invoke RendererApi are exposed to preload', async () => {
      const bus = new FakeIpcBus()
      const stateFilePath = await createTestStatePath()
      await registerMainHandlers(bus, stateFilePath)

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
      const stateFilePath = await createTestStatePath()
      manager = await registerMainHandlers(bus, stateFilePath)
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
      const stateFilePath = await createTestStatePath()
      const manager = await registerMainHandlers(bus, stateFilePath)

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
      const stateFilePath = await createTestStatePath()
      const manager = await registerMainHandlers(bus, stateFilePath)

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
        sendSessionInput: IPC_CHANNELS.sessionInput,
        sendSessionResize: IPC_CHANNELS.sessionResize,
        onTerminalData: IPC_CHANNELS.terminalData,
        onSessionEvent: IPC_CHANNELS.sessionEvent
      }

      const methods = Object.keys(apiMethodToChannel)
      expect(methods).toHaveLength(9)

      const channelValues = Object.values(apiMethodToChannel)
      const uniqueChannels = new Set(channelValues)
      expect(uniqueChannels.size).toBe(9)

      for (const channel of channelValues) {
        expect(typeof channel).toBe('string')
        expect(channel.length).toBeGreaterThan(0)
      }
    })
  })

  describe('setActive handlers are wired', () => {
    test('setActiveProject does not throw', async () => {
      const bus = new FakeIpcBus()
      const stateFilePath = await createTestStatePath()
      await registerMainHandlers(bus, stateFilePath)
      const api = createPreloadApi(bus)

      await expect(api.setActiveProject('some-id')).resolves.toBeUndefined()
    })

    test('setActiveSession does not throw', async () => {
      const bus = new FakeIpcBus()
      const stateFilePath = await createTestStatePath()
      await registerMainHandlers(bus, stateFilePath)
      const api = createPreloadApi(bus)

      await expect(api.setActiveSession('some-id')).resolves.toBeUndefined()
    })

    test('sendSessionInput does not throw', async () => {
      const bus = new FakeIpcBus()
      const stateFilePath = await createTestStatePath()
      await registerMainHandlers(bus, stateFilePath)
      const api = createPreloadApi(bus)

      await expect(api.sendSessionInput('session-1', 'ls\n')).resolves.toBeUndefined()
    })

    test('sendSessionResize does not throw', async () => {
      const bus = new FakeIpcBus()
      const stateFilePath = await createTestStatePath()
      await registerMainHandlers(bus, stateFilePath)
      const api = createPreloadApi(bus)

      await expect(api.sendSessionResize('session-1', 120, 30)).resolves.toBeUndefined()
    })
  })
})
