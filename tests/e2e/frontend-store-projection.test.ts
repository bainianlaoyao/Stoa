import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ProjectSessionManager } from '@core/project-session-manager'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { buildSessionPresenceSnapshot } from '@shared/observability-projection'
import type { BootstrapState, ProjectSummary, RendererApi, SessionSummary } from '@shared/project-session'
import type { SessionPresenceSnapshot } from '@shared/observability'
import type { UpdateState } from '@shared/update-state'
import { createTestWorkspace, createTestGlobalStatePath, tempDirs } from './helpers'

function idleUpdateState(): UpdateState {
  return {
    phase: 'idle',
    currentVersion: '0.0.0-test',
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: null,
    requiresSessionWarning: false
  }
}

function createRendererApiWithPresence(
  state: BootstrapState,
  presenceBySessionId: Record<string, SessionPresenceSnapshot>
): RendererApi {
  const noop = () => {}

  return {
    getBootstrapState: async () => state,
    createProject: async () => { throw new Error('createProject not implemented in this test') },
    createSession: async () => { throw new Error('createSession not implemented in this test') },
    setActiveProject: async () => {},
    setActiveSession: async () => {},
    archiveSession: async () => {},
    getTerminalReplay: async () => '',
    sendSessionInput: async () => {},
    sendSessionResize: async () => {},
    onTerminalData: () => noop,
    onSessionEvent: () => noop,
    getSessionPresence: async (sessionId) => presenceBySessionId[sessionId] ?? null,
    getProjectObservability: async () => null,
    getAppObservability: async () => null,
    listSessionObservationEvents: async () => ({ events: [], nextCursor: null }),
    onSessionPresenceChanged: () => noop,
    onProjectObservabilityChanged: () => noop,
    onAppObservabilityChanged: () => noop,
    getSettings: async () => DEFAULT_SETTINGS,
    setSetting: async () => {},
    pickFolder: async () => null,
    pickFile: async () => null,
    detectShell: async () => null,
    detectProvider: async () => null,
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    closeWindow: async () => {},
    isWindowMaximized: async () => false,
    onWindowMaximizeChange: () => noop,
    restoreSession: async () => {},
    listArchivedSessions: async () => [],
    getUpdateState: async () => idleUpdateState(),
    checkForUpdates: async () => idleUpdateState(),
    downloadUpdate: async () => idleUpdateState(),
    quitAndInstallUpdate: async () => {},
    dismissUpdate: async () => {},
    onUpdateState: () => noop
  }
}

describe('E2E: Frontend Store Projection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'stoa')
  })

  // ── Phase 1: Hydration from real backend state ─────────────────────

  describe('Phase 1: Hydration from real backend state', () => {
    test('store.projects matches snapshot.projects after hydrate', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p1-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      await manager.createProject({ path: workspaceDir, name: 'test_workspace' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.projects).toHaveLength(snapshot.projects.length)
      expect(store.projects).toEqual(snapshot.projects)
    })

    test('store.sessions matches snapshot.sessions after hydrate', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p1-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.sessions).toHaveLength(snapshot.sessions.length)
      expect(store.sessions).toEqual(snapshot.sessions)
    })

    test('store.activeProjectId matches snapshot.activeProjectId', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p1-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.activeProjectId).toBe(snapshot.activeProjectId)
      expect(store.activeProjectId).toBe(project.id)
    })

    test('store.activeSessionId matches snapshot.activeSessionId', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p1-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.activeSessionId).toBe(snapshot.activeSessionId)
      expect(store.activeSessionId).toBe(session.id)
    })

    test('store.terminalWebhookPort matches snapshot.terminalWebhookPort', async () => {
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: 43127, globalStatePath })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.terminalWebhookPort).toBe(snapshot.terminalWebhookPort)
      expect(store.terminalWebhookPort).toBe(43127)
    })

    test('store.activeProject computed returns correct project object', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p1-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.activeProject).not.toBeNull()
      expect(store.activeProject!.id).toBe(project.id)
      expect(store.activeProject!.name).toBe('test_workspace')
      expect(store.activeProject!.path).toBe(workspaceDir)
    })

    test('store.activeSession computed returns correct session object', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p1-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.activeSession).not.toBeNull()
      expect(store.activeSession!.id).toBe(session.id)
      expect(store.activeSession!.projectId).toBe(project.id)
      expect(store.activeSession!.type).toBe('shell')
      expect(store.activeSession!.title).toBe('Shell 1')
    })
  })

  // ── Phase 2: ProjectHierarchy computed correctness ──────────────────

  describe('Phase 2: ProjectHierarchy computed correctness', () => {
    test('hierarchy has correct number of nodes matching projects count', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p2a-')
      const workspace2 = await createTestWorkspace('stoa-store-p2b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      await manager.createProject({ path: workspace1, name: 'project_alpha' })
      await manager.createProject({ path: workspace2, name: 'project_beta' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.projectHierarchy).toHaveLength(2)
    })

    test('hierarchy groups sessions under correct projects', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p2a-')
      const workspace2 = await createTestWorkspace('stoa-store-p2b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'project_alpha' })
      const project2 = await manager.createProject({ path: workspace2, name: 'project_beta' })

      await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell A1' })
      await manager.createSession({ projectId: project1.id, type: 'opencode', title: 'OpenCode A2' })
      await manager.createSession({ projectId: project2.id, type: 'shell', title: 'Shell B1' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchy = store.projectHierarchy
      expect(hierarchy).toHaveLength(2)

      const alphaNode = hierarchy.find((node) => node.id === project1.id)
      const betaNode = hierarchy.find((node) => node.id === project2.id)

      expect(alphaNode).toBeDefined()
      expect(betaNode).toBeDefined()
      expect(alphaNode!.sessions).toHaveLength(2)
      expect(betaNode!.sessions).toHaveLength(1)
    })

    test('hierarchy active flags match activeProjectId', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p2a-')
      const workspace2 = await createTestWorkspace('stoa-store-p2b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'project_alpha' })
      await manager.createProject({ path: workspace2, name: 'project_beta' })

      await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell A1' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchy = store.projectHierarchy
      const alphaNode = hierarchy.find((node) => node.id === project1.id)
      const betaNode = hierarchy.find((node) => node.id !== project1.id)

      expect(alphaNode!.active).toBe(true)
      expect(betaNode!.active).toBe(false)
    })

    test('hierarchy session active flags match activeSessionId', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p2a-')
      const workspace2 = await createTestWorkspace('stoa-store-p2b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'project_alpha' })
      const project2 = await manager.createProject({ path: workspace2, name: 'project_beta' })

      const session1 = await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell A1' })
      await manager.createSession({ projectId: project2.id, type: 'shell', title: 'Shell B1' })

      const snapshot = manager.snapshot()
      // Last created session is active, so session from project2 is active
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchy = store.projectHierarchy
      for (const node of hierarchy) {
        for (const session of node.sessions) {
          expect(session.active).toBe(session.id === store.activeSessionId)
        }
      }
    })

    test('hierarchy nodes contain full project data (name, path, id, timestamps)', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p2a-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'full_data_project' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const node = store.projectHierarchy[0]
      expect(node).toBeDefined()
      expect(node!.id).toBe(project.id)
      expect(node!.name).toBe('full_data_project')
      expect(node!.path).toBe(workspaceDir)
      expect(node!.createdAt).toBe(project.createdAt)
      expect(node!.updatedAt).toBe(project.updatedAt)
    })

    test('hierarchy sessions contain full data (type, status, title, summary, recoveryMode)', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p2a-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'project_session_data' })
      const shellSession = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell Full' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchySession = store.projectHierarchy[0]!.sessions[0]
      expect(hierarchySession).toBeDefined()
      expect(hierarchySession!.id).toBe(shellSession.id)
      expect(hierarchySession!.type).toBe('shell')
      expect(hierarchySession!.status).toBe('bootstrapping')
      expect(hierarchySession!.title).toBe('Shell Full')
      expect(hierarchySession!.summary).toBe(shellSession.summary)
      expect(hierarchySession!.recoveryMode).toBe('fresh-shell')
    })

    test('hierarchy is stable across multiple accesses', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p2a-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'stability_project' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Stable Shell' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const access1 = store.projectHierarchy
      const access2 = store.projectHierarchy

      expect(access1).toHaveLength(access2.length)
      expect(access1[0]!.id).toBe(access2[0]!.id)
      expect(access1[0]!.sessions).toHaveLength(access2[0]!.sessions.length)
      expect(access1[0]!.sessions[0]!.id).toBe(access2[0]!.sessions[0]!.id)
    })
  })

  // ── Phase 3: Active state cascading ────────────────────────────────

  describe('Phase 3: Active state cascading', () => {
    async function seedTwoProjectsTwoSessions(): Promise<{
      project1: ProjectSummary
      project2: ProjectSummary
      session1a: SessionSummary
      session1b: SessionSummary
      session2a: SessionSummary
      session2b: SessionSummary
      snapshot: BootstrapState
    }> {
      const workspace1 = await createTestWorkspace('stoa-store-p3a-')
      const workspace2 = await createTestWorkspace('stoa-store-p3b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'cascade_p1' })
      const project2 = await manager.createProject({ path: workspace2, name: 'cascade_p2' })

      const session1a = await manager.createSession({ projectId: project1.id, type: 'shell', title: 'P1 Shell' })
      const session1b = await manager.createSession({ projectId: project1.id, type: 'opencode', title: 'P1 OpenCode' })
      const session2a = await manager.createSession({ projectId: project2.id, type: 'shell', title: 'P2 Shell' })
      const session2b = await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'P2 OpenCode' })

      return {
        project1, project2,
        session1a, session1b, session2a, session2b,
        snapshot: manager.snapshot()
      }
    }

    test('setActiveProject switches activeProjectId and auto-selects first session of new project', async () => {
      const { project1, project2, session2a, snapshot } = await seedTwoProjectsTwoSessions()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      // Verify initial state - last created session's project is active
      expect(store.activeProjectId).toBe(project2.id)

      // Switch to project1
      store.setActiveProject(project1.id)

      expect(store.activeProjectId).toBe(project1.id)
      // Should auto-select first session belonging to project1
      const project1Sessions = store.sessions.filter((s) => s.projectId === project1.id)
      expect(store.activeSessionId).toBe(project1Sessions[0]!.id)
      expect(store.activeSession!.id).toBe(project1Sessions[0]!.id)
    })

    test('setActiveProject updates activeProject computed', async () => {
      const { project1, project2, snapshot } = await seedTwoProjectsTwoSessions()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      store.setActiveProject(project1.id)

      expect(store.activeProject).not.toBeNull()
      expect(store.activeProject!.id).toBe(project1.id)
      expect(store.activeProject!.name).toBe('cascade_p1')
    })

    test('setActiveSession updates both activeSessionId and activeProjectId', async () => {
      const { project1, session1b, snapshot } = await seedTwoProjectsTwoSessions()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      // session1b belongs to project1
      store.setActiveSession(session1b.id)

      expect(store.activeSessionId).toBe(session1b.id)
      expect(store.activeProjectId).toBe(project1.id)
    })

    test('setActiveSession updates activeSession computed', async () => {
      const { session1b, snapshot } = await seedTwoProjectsTwoSessions()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      store.setActiveSession(session1b.id)

      expect(store.activeSession).not.toBeNull()
      expect(store.activeSession!.id).toBe(session1b.id)
      expect(store.activeSession!.title).toBe('P1 OpenCode')
    })

    test('setActiveSession updates activeProject computed to match session project', async () => {
      const { project1, session1b, snapshot } = await seedTwoProjectsTwoSessions()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      store.setActiveSession(session1b.id)

      expect(store.activeProject).not.toBeNull()
      expect(store.activeProject!.id).toBe(project1.id)
    })

    test('cross-project selection: switching sessions auto-changes activeProjectId', async () => {
      const { project1, project2, session1a, session2a, snapshot } = await seedTwoProjectsTwoSessions()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      // Select session from project1
      store.setActiveSession(session1a.id)
      expect(store.activeProjectId).toBe(project1.id)
      expect(store.activeSessionId).toBe(session1a.id)

      // Select session from project2
      store.setActiveSession(session2a.id)
      expect(store.activeProjectId).toBe(project2.id)
      expect(store.activeSessionId).toBe(session2a.id)
    })
  })

  // ── Phase 4: Add operations (simulating IPC responses) ─────────────

  describe('Phase 4: Add operations (simulating IPC responses)', () => {
    test('addProject adds single project to empty store', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p4-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'ipc_project' })

      const store = useWorkspaceStore()
      store.addProject({ ...project })

      expect(store.projects).toHaveLength(1)
      expect(store.projects[0]!.id).toBe(project.id)
      expect(store.projects[0]!.name).toBe('ipc_project')
      expect(store.projects[0]!.path).toBe(workspaceDir)
      expect(store.projects[0]!.createdAt).toBe(project.createdAt)
      expect(store.projects[0]!.updatedAt).toBe(project.updatedAt)
    })

    test('addSession adds single session to store', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p4-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'ipc_project' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'IPC Shell' })

      const store = useWorkspaceStore()
      store.addProject({ ...project })
      store.addSession({ ...session })

      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0]!.id).toBe(session.id)
      expect(store.sessions[0]!.projectId).toBe(project.id)
      expect(store.sessions[0]!.type).toBe('shell')
      expect(store.sessions[0]!.title).toBe('IPC Shell')
      expect(store.sessions[0]!.status).toBe('bootstrapping')
      expect(store.sessions[0]!.recoveryMode).toBe('fresh-shell')
    })

    test('addProject and addSession for multiple projects groups correctly in hierarchy', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p4a-')
      const workspace2 = await createTestWorkspace('stoa-store-p4b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'ipc_p1' })
      const project2 = await manager.createProject({ path: workspace2, name: 'ipc_p2' })
      const session1 = await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell P1' })
      const session2 = await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'OpenCode P2' })

      const store = useWorkspaceStore()
      store.addProject({ ...project1 })
      store.addProject({ ...project2 })
      store.addSession({ ...session1 })
      store.addSession({ ...session2 })

      expect(store.projects).toHaveLength(2)
      expect(store.sessions).toHaveLength(2)

      const hierarchy = store.projectHierarchy
      expect(hierarchy).toHaveLength(2)

      const p1Node = hierarchy.find((n) => n.id === project1.id)
      const p2Node = hierarchy.find((n) => n.id === project2.id)

      expect(p1Node).toBeDefined()
      expect(p2Node).toBeDefined()
      expect(p1Node!.sessions).toHaveLength(1)
      expect(p2Node!.sessions).toHaveLength(1)
      expect(p1Node!.sessions[0]!.type).toBe('shell')
      expect(p2Node!.sessions[0]!.type).toBe('opencode')
    })
  })

  // ── Phase 5: Store-backend consistency across full lifecycle ───────

  describe('Phase 5: Store-backend consistency across full lifecycle', () => {
    test('projectHierarchy total session count equals store.sessions.length', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p5a-')
      const workspace2 = await createTestWorkspace('stoa-store-p5b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'lifecycle_p1' })
      const project2 = await manager.createProject({ path: workspace2, name: 'lifecycle_p2' })

      await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell 1' })
      await manager.createSession({ projectId: project1.id, type: 'opencode', title: 'OpenCode 1' })
      await manager.createSession({ projectId: project2.id, type: 'shell', title: 'Shell 2' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchy = store.projectHierarchy
      const totalSessionsInHierarchy = hierarchy.reduce((sum, node) => sum + node.sessions.length, 0)

      expect(totalSessionsInHierarchy).toBe(store.sessions.length)
      expect(totalSessionsInHierarchy).toBe(3)
    })

    test('projectHierarchy covers all projects in store.projects', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p5a-')
      const workspace2 = await createTestWorkspace('stoa-store-p5b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'lifecycle_p1' })
      const project2 = await manager.createProject({ path: workspace2, name: 'lifecycle_p2' })

      await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell 1' })
      await manager.createSession({ projectId: project1.id, type: 'opencode', title: 'OpenCode 1' })
      await manager.createSession({ projectId: project2.id, type: 'shell', title: 'Shell 2' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchyIds = store.projectHierarchy.map((node) => node.id)
      const projectIds = store.projects.map((p) => p.id)

      expect(hierarchyIds.sort()).toEqual(projectIds.sort())
    })

    test('setActiveProject keeps computed values consistent', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p5a-')
      const workspace2 = await createTestWorkspace('stoa-store-p5b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'lifecycle_p1' })
      const project2 = await manager.createProject({ path: workspace2, name: 'lifecycle_p2' })

      await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell P1' })
      await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'OpenCode P2' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      // Switch to project1
      store.setActiveProject(project1.id)

      expect(store.activeProjectId).toBe(project1.id)
      expect(store.activeProject!.id).toBe(project1.id)
      expect(store.activeSession).not.toBeNull()
      expect(store.activeSession!.projectId).toBe(project1.id)

      // Verify hierarchy reflects active state
      const p1Node = store.projectHierarchy.find((n) => n.id === project1.id)
      expect(p1Node!.active).toBe(true)

      const p2Node = store.projectHierarchy.find((n) => n.id === project2.id)
      expect(p2Node!.active).toBe(false)
    })

    test('setActiveSession keeps computed values consistent', async () => {
      const workspace1 = await createTestWorkspace('stoa-store-p5a-')
      const workspace2 = await createTestWorkspace('stoa-store-p5b-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project1 = await manager.createProject({ path: workspace1, name: 'lifecycle_p1' })
      const project2 = await manager.createProject({ path: workspace2, name: 'lifecycle_p2' })

      const session1 = await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell P1' })
      const session2 = await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'OpenCode P2' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      // Select session1 (in project1)
      store.setActiveSession(session1.id)

      expect(store.activeSessionId).toBe(session1.id)
      expect(store.activeProjectId).toBe(project1.id)
      expect(store.activeSession!.id).toBe(session1.id)
      expect(store.activeProject!.id).toBe(project1.id)

      // Select session2 (in project2) - should cascade project change
      store.setActiveSession(session2.id)

      expect(store.activeSessionId).toBe(session2.id)
      expect(store.activeProjectId).toBe(project2.id)
      expect(store.activeSession!.id).toBe(session2.id)
      expect(store.activeProject!.id).toBe(project2.id)
    })

    test('lifecycle: mix of shell and opencode sessions all hydrate correctly', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p5a-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'mixed_types' })
      const shellSession = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell Mix' })
      const opencodeSession = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode Mix' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.sessions).toHaveLength(2)

      const shell = store.sessions.find((s) => s.type === 'shell')
      const opencode = store.sessions.find((s) => s.type === 'opencode')

      expect(shell).toBeDefined()
      expect(shell!.id).toBe(shellSession.id)
      expect(shell!.recoveryMode).toBe('fresh-shell')

      expect(opencode).toBeDefined()
      expect(opencode!.id).toBe(opencodeSession.id)
      expect(opencode!.recoveryMode).toBe('resume-external')
    })
  })

  // ── Phase 6: Edge cases in store projection ────────────────────────

  describe('Phase 6: Edge cases in store projection', () => {
    test('empty state: all arrays empty, all IDs null, computeds return null', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [],
        sessions: []
      })

      expect(store.projects).toHaveLength(0)
      expect(store.sessions).toHaveLength(0)
      expect(store.activeProjectId).toBeNull()
      expect(store.activeSessionId).toBeNull()
      expect(store.terminalWebhookPort).toBeNull()
      expect(store.activeProject).toBeNull()
      expect(store.activeSession).toBeNull()
      expect(store.projectHierarchy).toEqual([])
    })

    test('project with zero sessions: hierarchy node has empty sessions array', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p6-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'empty_project' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      expect(store.projectHierarchy).toHaveLength(1)
      expect(store.projectHierarchy[0]!.id).toBe(project.id)
      expect(store.projectHierarchy[0]!.sessions).toEqual([])
    })

    test('null active IDs: activeProject and activeSession return null', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p6-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'null_active' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell' })

      const snapshot = manager.snapshot()

      // Manually clear active IDs to simulate null state
      const store = useWorkspaceStore()
      store.hydrate({
        ...snapshot,
        activeProjectId: null,
        activeSessionId: null
      })

      expect(store.activeProjectId).toBeNull()
      expect(store.activeSessionId).toBeNull()
      expect(store.activeProject).toBeNull()
      expect(store.activeSession).toBeNull()
    })

    test('null active IDs: projectHierarchy still generates correctly with no active flags', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p6-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'no_active' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate({
        ...snapshot,
        activeProjectId: null,
        activeSessionId: null
      })

      const hierarchy = store.projectHierarchy
      expect(hierarchy).toHaveLength(1)
      expect(hierarchy[0]!.active).toBe(false)
      expect(hierarchy[0]!.sessions).toHaveLength(1)
      expect(hierarchy[0]!.sessions[0]!.active).toBe(false)
    })

    test('setActiveSession with nonexistent ID is no-op', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p6-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'safe_project' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const originalProjectId = store.activeProjectId
      const originalSessionId = store.activeSessionId

      store.setActiveSession('nonexistent-session-id')

      expect(store.activeProjectId).toBe(originalProjectId)
      expect(store.activeSessionId).toBe(originalSessionId)
      expect(store.activeSession!.id).toBe(session.id)
    })

    test('multiple sessions with same status all render correctly in hierarchy', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p6-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'multi_status' })
      const session1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell A' })
      const session2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell B' })
      const session3 = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode C' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      const hierarchy = store.projectHierarchy
      expect(hierarchy).toHaveLength(1)
      expect(hierarchy[0]!.sessions).toHaveLength(3)

      const ids = hierarchy[0]!.sessions.map((s) => s.id)
      expect(ids).toContain(session1.id)
      expect(ids).toContain(session2.id)
      expect(ids).toContain(session3.id)

      // All sessions have bootstrapping status since just created
      for (const s of hierarchy[0]!.sessions) {
        expect(s.status).toBe('bootstrapping')
      }
    })
  })

  // ── Phase 7: Error state handling ──────────────────────────────────

  describe('Phase 7: Error state handling', () => {
    test('initial lastError is null', () => {
      const store = useWorkspaceStore()
      expect(store.lastError).toBeNull()
    })

    test('setting lastError to a string makes it available', () => {
      const store = useWorkspaceStore()
      store.$patch({ lastError: 'Something went wrong' })

      expect(store.lastError).toBe('Something went wrong')
    })

    test('clearError sets lastError back to null', () => {
      const store = useWorkspaceStore()
      store.$patch({ lastError: 'An error occurred' })
      expect(store.lastError).toBe('An error occurred')

      store.clearError()
      expect(store.lastError).toBeNull()
    })

    test('clearError on already-null lastError remains null', () => {
      const store = useWorkspaceStore()
      expect(store.lastError).toBeNull()

      store.clearError()
      expect(store.lastError).toBeNull()
    })

    test('error state does not affect project/session data', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-p7-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const project = await manager.createProject({ path: workspaceDir, name: 'error_test' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell' })

      const snapshot = manager.snapshot()
      const store = useWorkspaceStore()
      store.hydrate(snapshot)

      // Simulate error
      store.$patch({ lastError: 'Connection lost' })

      // Project/session data should remain intact
      expect(store.projects).toHaveLength(1)
      expect(store.sessions).toHaveLength(1)
      expect(store.activeProjectId).toBe(snapshot.activeProjectId)
      expect(store.activeSessionId).toBe(snapshot.activeSessionId)

      // Hierarchy should still work
      expect(store.projectHierarchy).toHaveLength(1)
      expect(store.projectHierarchy[0]!.sessions).toHaveLength(1)
    })
  })

  // ── Phase 8: Authoritative session presence projection ─────────────

  describe('Phase 8: Authoritative session presence projection', () => {
    test('backend presence snapshot keeps Claude runtime alive calm ready in the renderer', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-presence-ready-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'presence_ready' })
      const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude Presence' })
      await manager.markRuntimeAlive(session.id, session.externalSessionId)

      const snapshot = manager.snapshot()
      const readySession = snapshot.sessions.find((candidate) => candidate.id === session.id)!
      const backendPresence = buildSessionPresenceSnapshot(readySession, {
        activeSessionId: snapshot.activeSessionId,
        nowIso: '2026-04-25T00:00:00.000Z',
        sourceSequence: readySession.lastStateSequence
      })

      const store = useWorkspaceStore()
      store.hydrate(snapshot)
      window.stoa = createRendererApiWithPresence(snapshot, { [session.id]: backendPresence })
      await store.hydrateObservability()

      expect(store.activeSessionPresence).toEqual(backendPresence)
      expect(store.activeSessionPresence).toMatchObject({
        phase: 'ready',
        runtimeState: 'alive',
        agentState: 'unknown',
        hasUnseenCompletion: false
      })
    })

    test('visited complete session becomes ready after backend marks completion seen', async () => {
      const workspaceDir = await createTestWorkspace('stoa-store-presence-seen-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'presence_seen' })
      const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude Complete' })
      await manager.markRuntimeAlive(session.id, session.externalSessionId)
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: new Date().toISOString(),
        intent: 'agent.turn_completed',
        source: 'provider',
        sourceEventType: 'claude-code.Stop',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop'
      })

      expect(buildSessionPresenceSnapshot(manager.snapshot().sessions[0]!, {
        activeSessionId: null,
        nowIso: '2026-04-25T00:00:00.000Z'
      }).phase).toBe('complete')

      await manager.setActiveSession(session.id)
      const snapshot = manager.snapshot()
      const seenSession = snapshot.sessions.find((candidate) => candidate.id === session.id)!
      const backendPresence = buildSessionPresenceSnapshot(seenSession, {
        activeSessionId: snapshot.activeSessionId,
        nowIso: '2026-04-25T00:00:00.000Z',
        sourceSequence: seenSession.lastStateSequence
      })

      const store = useWorkspaceStore()
      store.hydrate(snapshot)
      window.stoa = createRendererApiWithPresence(snapshot, { [session.id]: backendPresence })
      await store.hydrateObservability()

      expect(store.activeSessionPresence).toMatchObject({
        phase: 'ready',
        agentState: 'idle',
        hasUnseenCompletion: false
      })
    })
  })
})
