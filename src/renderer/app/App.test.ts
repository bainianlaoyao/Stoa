// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useUpdateStore } from '@renderer/stores/update'
import App from './App.vue'
import type { BootstrapState, ProjectSummary, SessionSummary } from '@shared/project-session'
import type { SessionPresenceSnapshot } from '@shared/observability'
import type { UpdateState } from '@shared/update-state'

const mockBootstrapState: BootstrapState = {
  activeProjectId: null,
  activeSessionId: null,
  terminalWebhookPort: 0,
  projects: [],
  sessions: []
}

const mockCreatedProject: ProjectSummary = {
  id: 'new_project',
  name: 'test',
  path: '/test',
  createdAt: 'x',
  updatedAt: 'x'
}

function createSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    projectId: 'p1',
    type: 'shell',
    runtimeState: 'alive',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 0,
    blockingReason: null,
    title: 'S',
    summary: '',
    recoveryMode: 'fresh-shell',
    externalSessionId: null,
    createdAt: 't',
    updatedAt: 't',
    lastActivatedAt: 't',
    archived: false,
    ...overrides
  }
}

const mockCreatedSession: SessionSummary = createSessionSummary({
  id: 'new_session',
  projectId: 'new_project',
  title: 'test',
  createdAt: 'x',
  updatedAt: 'x',
  lastActivatedAt: 'x'
})

function createSessionPresenceSnapshot(
  overrides: Partial<SessionPresenceSnapshot> = {}
): SessionPresenceSnapshot {
  return {
    sessionId: 'session_1',
    projectId: 'project_1',
    providerId: 'claude-code',
    providerLabel: 'Claude Code',
    modelLabel: 'Sonnet',
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
    lastEventAt: '2026-04-24T08:00:00.000Z',
    lastEvidenceType: null,
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    evidenceSequence: 1,
    sourceSequence: 1,
    updatedAt: '2026-04-24T08:00:00.000Z',
    ...overrides
  }
}

function createUpdateState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    phase: 'idle',
    currentVersion: '0.1.0',
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: null,
    requiresSessionWarning: false,
    ...overrides
  }
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

function setupStoa(overrides?: Partial<typeof window.stoa>) {
  window.stoa = {
    getBootstrapState: vi.fn().mockResolvedValue({ ...mockBootstrapState, projects: [], sessions: [] }),
    createProject: vi.fn().mockResolvedValue({ ...mockCreatedProject }),
    createSession: vi.fn().mockResolvedValue({ ...mockCreatedSession }),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue({
      blockedProjectCount: 0,
      failedProjectCount: 0,
      totalUnreadTurns: 0,
      projectsNeedingAttention: [],
      providerHealthSummary: {},
      lastGlobalEventAt: null,
      sourceSequence: 0,
      updatedAt: 'x'
    }),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      providers: {},
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
    getUpdateState: vi.fn().mockResolvedValue(createUpdateState()),
    checkForUpdates: vi.fn().mockResolvedValue(createUpdateState({ phase: 'up-to-date', message: 'You are up to date.' })),
    downloadUpdate: vi.fn().mockResolvedValue(createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' })),
    quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    dismissUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

function mountApp(pinia: Pinia) {
  return mount(App, {
    global: {
      plugins: [pinia],
      stubs: { AppShell: false }
    }
  })
}

describe('App (root)', () => {
  let wrapper: VueWrapper | undefined
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    setupStoa()
  })

  afterEach(async () => {
    if (wrapper) {
      wrapper.unmount()
      wrapper = undefined
    }
    await flush()
  })

  describe('bootstrap', () => {
    it('renders a full-height root wrapper so AppShell can inherit window height', async () => {
      wrapper = await mountApp(pinia)
      await flush()

      const root = wrapper.get('.app-root')
      expect(root.classes()).toEqual(expect.arrayContaining(['h-full', 'flex', 'flex-col']))
    })

    it('on mount calls window.stoa.getBootstrapState', async () => {
      wrapper = await mountApp(pinia)
      expect(window.stoa.getBootstrapState).toHaveBeenCalledOnce()
    })

    it('on mount hydrates store with bootstrap data', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: 's1',
        terminalWebhookPort: 42,
        projects: [{ id: 'p1', name: 'Proj', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1', title: 'Sess' })]
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.projects).toHaveLength(1)
      expect(store.activeProjectId).toBe('p1')
      expect(store.activeSessionId).toBe('s1')
    })

    it('does not fetch a separate archived session list on mount', async () => {
      wrapper = await mountApp(pinia)
      await flush()

      expect(window.stoa.listArchivedSessions).not.toHaveBeenCalled()
    })

    it('on mount fetches initial update state', async () => {
      const initialState = createUpdateState({ phase: 'available', availableVersion: '0.2.0' })
      setupStoa({ getUpdateState: vi.fn().mockResolvedValue(initialState) })

      wrapper = await mountApp(pinia)
      await flush()

      expect(window.stoa.getUpdateState).toHaveBeenCalledOnce()
      expect(useUpdateStore(pinia).state.availableVersion).toBe('0.2.0')
    })

    it('on mount subscribes to pushed update state events', async () => {
      const onUpdateState = vi.fn().mockReturnValue(() => {})
      setupStoa({ onUpdateState })

      wrapper = await mountApp(pinia)
      await flush()

      expect(onUpdateState).toHaveBeenCalledOnce()
    })

    it('applies pushed update state from the bridge', async () => {
      let listener: ((state: UpdateState) => void) | undefined
      setupStoa({
        onUpdateState: vi.fn().mockImplementation((callback: (state: UpdateState) => void) => {
          listener = callback
          return () => {}
        })
      })

      wrapper = await mountApp(pinia)
      await flush()
      listener?.(createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' }))
      await flush()

      expect(useUpdateStore(pinia).state.phase).toBe('downloaded')
      expect(useUpdateStore(pinia).state.downloadedVersion).toBe('0.2.0')
    })

    it('reads update state after subscribing so startup sees the latest transition', async () => {
      const getUpdateState = vi
        .fn()
        .mockResolvedValueOnce(createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' }))

      setupStoa({
        getUpdateState,
        onUpdateState: vi.fn().mockReturnValue(() => {})
      })

      wrapper = await mountApp(pinia)
      await flush()

      expect(getUpdateState).toHaveBeenCalledOnce()
      expect(useUpdateStore(pinia).state.phase).toBe('downloaded')
      expect(useUpdateStore(pinia).state.downloadedVersion).toBe('0.2.0')
    })

    it('hydrates observability and applies pushed session presence snapshots on mount', async () => {
      const sessionPresenceListeners: Array<(snapshot: SessionPresenceSnapshot) => void> = []
      const hydratedState: BootstrapState = {
        activeProjectId: 'project_1',
        activeSessionId: 'session_1',
        terminalWebhookPort: 0,
        projects: [{ id: 'project_1', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({
          id: 'session_1',
          projectId: 'project_1',
          type: 'claude-code',
          agentState: 'working',
          title: 'test session',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'claude-session-1'
        })]
      }

      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
        getSessionPresence: vi.fn().mockResolvedValue(createSessionPresenceSnapshot({ sourceSequence: 2 })),
        onSessionPresenceChanged: vi.fn().mockImplementation((listener: (snapshot: SessionPresenceSnapshot) => void) => {
          sessionPresenceListeners.push(listener)
          return () => {}
        })
      })

      wrapper = await mountApp(pinia)
      await flush()

      const store = useWorkspaceStore(pinia)

      expect(window.stoa.getSessionPresence).toHaveBeenCalledWith('session_1')
      expect(window.stoa.onSessionPresenceChanged).toHaveBeenCalledOnce()
      expect(store.activeSessionPresence?.sourceSequence).toBe(2)
      expect(sessionPresenceListeners).toHaveLength(1)

      const sessionPresenceListener = sessionPresenceListeners[0]
      if (!sessionPresenceListener) {
        throw new Error('Expected session presence listener to be registered')
      }

      sessionPresenceListener(createSessionPresenceSnapshot({
        phase: 'blocked',
        blockingReason: 'permission',
        sourceSequence: 3,
        updatedAt: '2026-04-24T08:00:01.000Z'
      }))
      await flush()

      expect(store.activeSessionPresence?.phase).toBe('blocked')
      expect(store.activeSessionPresence?.blockingReason).toBe('permission')
    })
  })

  describe('project selection', () => {
    it('selectProject event calls workspaceStore.setActiveProject with id', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectProject', 'project_1')
      await flush()
      expect(useWorkspaceStore(pinia).activeProjectId).toBe('project_1')
    })

    it('selectProject event calls window.stoa.setActiveProject with id', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectProject', 'project_1')
      expect(window.stoa.setActiveProject).toHaveBeenCalledWith('project_1')
    })
  })

  describe('session selection', () => {
    it('selectSession event calls workspaceStore.setActiveSession with id', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1' })]
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectSession', 's1')
      await flush()
      expect(useWorkspaceStore(pinia).activeSessionId).toBe('s1')
    })

    it('selectSession event calls window.stoa.setActiveSession with id', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1' })]
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectSession', 's1')
      expect(window.stoa.setActiveSession).toHaveBeenCalledWith('s1')
    })
  })

  describe('project creation', () => {
    it('createProject event adds result to store via addProject', async () => {
      const createProjectMock = vi.fn().mockResolvedValue({ ...mockCreatedProject })
      setupStoa({ createProject: createProjectMock })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()
      expect(createProjectMock).toHaveBeenCalledOnce()
      expect(useWorkspaceStore(pinia).projects).toHaveLength(1)
      expect(useWorkspaceStore(pinia).projects[0].id).toBe('new_project')
    })

    it('createProject event calls window.stoa.createProject with { name, path }', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()
      expect(window.stoa.createProject).toHaveBeenCalledWith({ name: 'test', path: '/test' })
    })

    it('createProject event sets created project as active', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()
      expect(useWorkspaceStore(pinia).activeProjectId).toBe('new_project')
    })
  })

  describe('session creation', () => {
    it('createSession event calls window.stoa.createSession with { projectId, type, title }', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', { projectId: 'new_project', type: 'shell', title: 'test' })
      expect(window.stoa.createSession).toHaveBeenCalledWith({ projectId: 'new_project', type: 'shell', title: 'test' })
    })

    it('createSession event adds result to store via addSession', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'new_project',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'new_project', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
        sessions: []
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', { projectId: 'new_project', type: 'shell', title: 'test' })
      await flush()
      expect(useWorkspaceStore(pinia).sessions).toHaveLength(1)
      expect(useWorkspaceStore(pinia).sessions[0].id).toBe('new_session')
    })
  })

  describe('session archiving', () => {
    it('archiveSession event updates store and calls window.stoa.archiveSession', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: 's1',
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1' })]
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('archiveSession', 's1')
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(window.stoa.archiveSession).toHaveBeenCalledWith('s1')
      expect(store.sessions[0].archived).toBe(true)
      expect(store.activeSessionId).toBeNull()
    })

    it('archiveSession failure restores session and records error', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: 's1',
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1' })]
      }
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
        archiveSession: vi.fn().mockRejectedValue(new Error('archive failed'))
      })

      wrapper = await mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('archiveSession', 's1')
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.sessions[0].archived).toBe(false)
      expect(store.lastError).toBe('archive failed')
    })

    it('restoreSession event updates store, re-selects the session, and calls window.stoa.restoreSession', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1', archived: true })]
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('restoreSession', 's1')
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(window.stoa.restoreSession).toHaveBeenCalledWith('s1')
      expect(store.sessions[0].archived).toBe(false)
      expect(store.activeProjectId).toBe('p1')
      expect(store.activeSessionId).toBe('s1')
      expect(store.projectHierarchy[0]!.archivedSessions).toHaveLength(0)
      expect(store.projectHierarchy[0]!.sessions[0]!.id).toBe('s1')
    })

    it('restoreSession failure re-archives session and records error', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [createSessionSummary({ id: 's1', projectId: 'p1', archived: true })]
      }
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
        restoreSession: vi.fn().mockRejectedValue(new Error('restore failed'))
      })

      wrapper = await mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('restoreSession', 's1')
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.sessions[0].archived).toBe(true)
      expect(store.activeSessionId).toBeNull()
      expect(store.lastError).toBe('restore failed')
    })
  })

  describe('project creation error handling', () => {
    it('when createProject rejects with Error → sets store.lastError to error message', async () => {
      setupStoa({ createProject: vi.fn().mockRejectedValue(new Error('Project path already exists')) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('Project path already exists')
      expect(store.projects).toHaveLength(0)
    })

    it('when createProject rejects with string → sets store.lastError to string', async () => {
      setupStoa({ createProject: vi.fn().mockRejectedValue('some string error') })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('some string error')
    })

    it('when createProject returns null → sets store.lastError to null-response message', async () => {
      setupStoa({ createProject: vi.fn().mockResolvedValue(null) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('Failed to create project: no response from main process')
      expect(store.projects).toHaveLength(0)
      expect(store.activeProjectId).toBeNull()
    })

    it('successful createProject clears previous error', async () => {
      setupStoa()

      wrapper = await mountApp(pinia)
      await flush()
      const store = useWorkspaceStore(pinia)
      store.lastError = 'prev error'

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      expect(store.lastError).toBeNull()
      expect(store.projects).toHaveLength(1)
      expect(store.projects[0].id).toBe('new_project')
    })
  })

  describe('session creation error handling', () => {
    it('when createSession rejects → sets store.lastError', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'new_project',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'new_project', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
        sessions: []
      }
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
        createSession: vi.fn().mockRejectedValue(new Error('Session must belong to an existing project'))
      })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', { projectId: 'new_project', type: 'shell', title: 'test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('Session must belong to an existing project')
      expect(store.sessions).toHaveLength(0)
    })

    it('when createSession returns null → sets store.lastError to null-response message', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'new_project',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'new_project', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
        sessions: []
      }
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
        createSession: vi.fn().mockResolvedValue(null)
      })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', { projectId: 'new_project', type: 'shell', title: 'test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('Failed to create session: no response from main process')
    })
  })

  describe('cleanup', () => {
    it('keeps update listeners active after mount until unmount', async () => {
      const unsubscribeUpdate = vi.fn()
      setupStoa({
        onUpdateState: vi.fn().mockReturnValue(unsubscribeUpdate)
      })

      wrapper = await mountApp(pinia)
      await flush()

      expect(unsubscribeUpdate).not.toHaveBeenCalled()
    })

    it('keeps observability listeners active after mount until unmount', async () => {
      const unsubscribeSessionPresence = vi.fn()
      const unsubscribeProjectObservability = vi.fn()
      const unsubscribeAppObservability = vi.fn()
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue({
          activeProjectId: 'project_1',
          activeSessionId: 'session_1',
          terminalWebhookPort: 0,
          projects: [{ id: 'project_1', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
          sessions: [createSessionSummary({
            id: 'session_1',
            projectId: 'project_1',
            type: 'claude-code',
            agentState: 'working',
            title: 'test session',
            summary: 'running',
            recoveryMode: 'resume-external',
            externalSessionId: 'claude-session-1'
          })]
        }),
        onSessionPresenceChanged: vi.fn().mockReturnValue(unsubscribeSessionPresence),
        onProjectObservabilityChanged: vi.fn().mockReturnValue(unsubscribeProjectObservability),
        onAppObservabilityChanged: vi.fn().mockReturnValue(unsubscribeAppObservability)
      })

      wrapper = await mountApp(pinia)
      await flush()

      expect(unsubscribeSessionPresence).not.toHaveBeenCalled()
      expect(unsubscribeProjectObservability).not.toHaveBeenCalled()
      expect(unsubscribeAppObservability).not.toHaveBeenCalled()
    })

    it('unsubscribes update listeners on unmount', async () => {
      const unsubscribeUpdate = vi.fn()
      setupStoa({
        onUpdateState: vi.fn().mockReturnValue(unsubscribeUpdate)
      })

      wrapper = await mountApp(pinia)
      await flush()
      wrapper.unmount()
      wrapper = undefined

      expect(unsubscribeUpdate).toHaveBeenCalledOnce()
    })

    it('unsubscribes observability listeners on unmount', async () => {
      const unsubscribeSessionPresence = vi.fn()
      const unsubscribeProjectObservability = vi.fn()
      const unsubscribeAppObservability = vi.fn()
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue({
          activeProjectId: 'project_1',
          activeSessionId: 'session_1',
          terminalWebhookPort: 0,
          projects: [{ id: 'project_1', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
          sessions: [createSessionSummary({
            id: 'session_1',
            projectId: 'project_1',
            type: 'claude-code',
            agentState: 'working',
            title: 'test session',
            summary: 'running',
            recoveryMode: 'resume-external',
            externalSessionId: 'claude-session-1'
          })]
        }),
        onSessionPresenceChanged: vi.fn().mockReturnValue(unsubscribeSessionPresence),
        onProjectObservabilityChanged: vi.fn().mockReturnValue(unsubscribeProjectObservability),
        onAppObservabilityChanged: vi.fn().mockReturnValue(unsubscribeAppObservability)
      })

      wrapper = await mountApp(pinia)
      await flush()
      wrapper.unmount()
      wrapper = undefined

      expect(unsubscribeSessionPresence).toHaveBeenCalledOnce()
      expect(unsubscribeProjectObservability).toHaveBeenCalledOnce()
      expect(unsubscribeAppObservability).toHaveBeenCalledOnce()
    })
  })
})
