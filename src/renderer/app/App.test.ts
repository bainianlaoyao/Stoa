// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import App from './App.vue'
import type { BootstrapState, ProjectSummary, SessionSummary } from '@shared/project-session'

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

const mockCreatedSession: SessionSummary = {
  id: 'new_session',
  projectId: 'new_project',
  type: 'shell',
  status: 'running',
  title: 'test',
  summary: '',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: 'x',
  updatedAt: 'x',
  lastActivatedAt: 'x',
  archived: false
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
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      providers: {},
      claudeDangerouslySkipPermissions: false
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'Sess', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: false }]
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: false }]
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: false }]
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: false }]
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: false }]
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: true }]
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
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't', archived: true }]
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
})
