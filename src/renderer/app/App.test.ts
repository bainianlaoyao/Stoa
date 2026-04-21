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
  lastActivatedAt: 'x'
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

function setupVibecoding(overrides?: Partial<typeof window.vibecoding>) {
  window.vibecoding = {
    getBootstrapState: vi.fn().mockResolvedValue({ ...mockBootstrapState, projects: [], sessions: [] }),
    createProject: vi.fn().mockResolvedValue({ ...mockCreatedProject }),
    createSession: vi.fn().mockResolvedValue({ ...mockCreatedSession }),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
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
    setupVibecoding()
  })

  afterEach(async () => {
    if (wrapper) {
      wrapper.unmount()
      wrapper = undefined
    }
    await flush()
  })

  describe('bootstrap', () => {
    it('on mount calls window.vibecoding.getBootstrapState', async () => {
      wrapper = await mountApp(pinia)
      expect(window.vibecoding.getBootstrapState).toHaveBeenCalledOnce()
    })

    it('on mount hydrates store with bootstrap data', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: 's1',
        terminalWebhookPort: 42,
        projects: [{ id: 'p1', name: 'Proj', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'Sess', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't' }]
      }
      setupVibecoding({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.projects).toHaveLength(1)
      expect(store.activeProjectId).toBe('p1')
      expect(store.activeSessionId).toBe('s1')
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

    it('selectProject event calls window.vibecoding.setActiveProject with id', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectProject', 'project_1')
      expect(window.vibecoding.setActiveProject).toHaveBeenCalledWith('project_1')
    })
  })

  describe('session selection', () => {
    it('selectSession event calls workspaceStore.setActiveSession with id', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't' }]
      }
      setupVibecoding({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectSession', 's1')
      await flush()
      expect(useWorkspaceStore(pinia).activeSessionId).toBe('s1')
    })

    it('selectSession event calls window.vibecoding.setActiveSession with id', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'p1', name: 'P', path: '/p', createdAt: 't', updatedAt: 't' }],
        sessions: [{ id: 's1', projectId: 'p1', type: 'shell', status: 'running', title: 'S', summary: '', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: 't', updatedAt: 't', lastActivatedAt: 't' }]
      }
      setupVibecoding({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('selectSession', 's1')
      expect(window.vibecoding.setActiveSession).toHaveBeenCalledWith('s1')
    })
  })

  describe('project creation', () => {
    it('createProject event adds result to store via addProject', async () => {
      const createProjectMock = vi.fn().mockResolvedValue({ ...mockCreatedProject })
      setupVibecoding({ createProject: createProjectMock })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()
      expect(createProjectMock).toHaveBeenCalledOnce()
      expect(useWorkspaceStore(pinia).projects).toHaveLength(1)
      expect(useWorkspaceStore(pinia).projects[0].id).toBe('new_project')
    })

    it('createProject event calls window.vibecoding.createProject with { name, path }', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()
      expect(window.vibecoding.createProject).toHaveBeenCalledWith({ name: 'test', path: '/test' })
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
    it('createSession event calls window.vibecoding.createSession with { projectId, type, title }', async () => {
      wrapper = await mountApp(pinia)
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', { projectId: 'new_project', type: 'shell', title: 'test' })
      expect(window.vibecoding.createSession).toHaveBeenCalledWith({ projectId: 'new_project', type: 'shell', title: 'test' })
    })

    it('createSession event adds result to store via addSession', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'new_project',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ id: 'new_project', name: 'test', path: '/test', createdAt: 't', updatedAt: 't' }],
        sessions: []
      }
      setupVibecoding({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', { projectId: 'new_project', type: 'shell', title: 'test' })
      await flush()
      expect(useWorkspaceStore(pinia).sessions).toHaveLength(1)
      expect(useWorkspaceStore(pinia).sessions[0].id).toBe('new_session')
    })
  })

  describe('project creation error handling', () => {
    it('when createProject rejects with Error → sets store.lastError to error message', async () => {
      setupVibecoding({ createProject: vi.fn().mockRejectedValue(new Error('Project path already exists')) })

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
      setupVibecoding({ createProject: vi.fn().mockRejectedValue('some string error') })

      wrapper = await mountApp(pinia)
      await flush()
      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('some string error')
    })

    it('when createProject returns null → sets store.lastError to null-response message', async () => {
      setupVibecoding({ createProject: vi.fn().mockResolvedValue(null) })

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
      setupVibecoding()

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
      setupVibecoding({
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
      setupVibecoding({
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
