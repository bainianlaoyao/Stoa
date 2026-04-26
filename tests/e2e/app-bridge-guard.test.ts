// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import App from '@renderer/app/App.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import type { BootstrapState, ProjectSummary, SessionSummary } from '@shared/project-session'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  runtimeState: 'alive',
  agentState: 'unknown',
  hasUnseenCompletion: false,
  runtimeExitCode: null,
  runtimeExitReason: null,
  lastStateSequence: 1,
  blockingReason: null,
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

/** Remove window.stoa to simulate preload not loading. */
function removeStoa(): void {
  Reflect.deleteProperty(window, 'stoa')
}

function createStoaMock(overrides?: Partial<typeof window.stoa>): typeof window.stoa {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({ ...mockBootstrapState }),
    createProject: vi.fn().mockResolvedValue({ ...mockCreatedProject }),
    createSession: vi.fn().mockResolvedValue({ ...mockCreatedSession }),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue({
      blockedProjectCount: 0,
      failedProjectCount: 0,
      totalUnreadTurns: 0,
      projectsNeedingAttention: [],
      providerHealthSummary: {},
      lastGlobalEventAt: null,
      updatedAt: 'x'
    }),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      providers: {},
      workspaceIde: { id: 'vscode', executablePath: '' },
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
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    ...overrides
  }
}

/** Set up a fully functional window.stoa mock. */
function setupStoa(overrides?: Partial<typeof window.stoa>): void {
  window.stoa = createStoaMock(overrides)
}

function mountApp(pinia: Pinia) {
  return mount(App, {
    global: {
      plugins: [pinia],
      stubs: { AppShell: false }
    }
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: App.vue Bridge Guard (window.stoa undefined)', () => {
  let wrapper: VueWrapper | undefined
  let pinia: Pinia
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let rejectionHandler: (reason: unknown) => void

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    removeStoa()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rejectionHandler = vi.fn()
    process.on('unhandledRejection', rejectionHandler)
  })

  afterEach(async () => {
    process.off('unhandledRejection', rejectionHandler)
    consoleErrorSpy.mockRestore()
    if (wrapper) {
      wrapper.unmount()
      wrapper = undefined
    }
    await flush()
  })

  // -------------------------------------------------------------------------
  describe('when window.stoa is undefined (preload failed to load)', () => {
    // -----------------------------------------------------------------------
    it('mounting App does not throw unhandled synchronous exception', async () => {
      let syncError: Error | undefined
      try {
        wrapper = mountApp(pinia)
      } catch (err) {
        syncError = err instanceof Error ? err : new Error(String(err))
      }

      expect(syncError).toBeUndefined()
      await flush()
    })

    // -----------------------------------------------------------------------
    it('onMounted call to getBootstrapState results in an unhandled rejection (detected via unhydrated store)', async () => {
      // Because onMounted is `async () => { ... }`, the TypeError
      // ("Cannot read properties of undefined (reading 'getBootstrapState')")
      // becomes an unhandled rejection. After flush, the store should remain
      // in its initial (empty) state since hydrate was never called.
      wrapper = mountApp(pinia)
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.projects).toHaveLength(0)
      expect(store.sessions).toHaveLength(0)
      expect(store.activeProjectId).toBeNull()
      expect(store.activeSessionId).toBeNull()
    })

    // -----------------------------------------------------------------------
    it('handleProjectCreate catches TypeError and sets store.lastError', async () => {
      // Bootstrap with a working bridge first, then kill it before emit.
      setupStoa()
      wrapper = mountApp(pinia)
      await flush()

      // Now remove stoa to simulate it becoming unavailable.
      removeStoa()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      // handleProjectCreate has try/catch — the TypeError is caught.
      expect(store.lastError).toBeTruthy()
      expect(store.projects).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    it('handleSessionCreate catches TypeError and sets store.lastError', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'new_project',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ ...mockCreatedProject }],
        sessions: []
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })
      wrapper = mountApp(pinia)
      await flush()

      removeStoa()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', {
        projectId: 'new_project',
        type: 'shell',
        title: 'test'
      })
      await flush()

      const store = useWorkspaceStore(pinia)
      // handleSessionCreate has try/catch — the TypeError is caught.
      expect(store.lastError).toBeTruthy()
      expect(store.sessions).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    it('handleProjectSelect throws because void expression is not guarded', async () => {
      setupStoa()
      wrapper = mountApp(pinia)
      await flush()

      removeStoa()

      const appShell = wrapper.findComponent({ name: 'AppShell' })

      // handleProjectSelect uses `void window.stoa.setActiveProject(...)`.
      // When stoa is undefined, accessing .setActiveProject throws
      // TypeError synchronously — the emit propagates it.
      expect(() => {
        appShell.vm.$emit('selectProject', 'project_1')
      }).toThrow(TypeError)
    })

    // -----------------------------------------------------------------------
    it('handleSessionSelect throws because void expression is not guarded', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'p1',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ ...mockCreatedProject, id: 'p1' }],
        sessions: [{
          ...mockCreatedSession,
          id: 's1',
          projectId: 'p1'
        }]
      }
      setupStoa({ getBootstrapState: vi.fn().mockResolvedValue(hydratedState) })
      wrapper = mountApp(pinia)
      await flush()

      removeStoa()

      const appShell = wrapper.findComponent({ name: 'AppShell' })

      // handleSessionSelect uses `void window.stoa.setActiveSession(...)`.
      expect(() => {
        appShell.vm.$emit('selectSession', 's1')
      }).toThrow(TypeError)
    })
  })

  // -------------------------------------------------------------------------
  describe('when window.stoa is partially defined', () => {
    // -----------------------------------------------------------------------
    it('missing createProject method — emit still rejects into lastError', async () => {
      // Provide getBootstrapState but omit createProject.
      window.stoa = createStoaMock({
        createProject: undefined,
        getBootstrapState: vi.fn().mockResolvedValue({ ...mockBootstrapState })
      })

      wrapper = mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      // Calling undefined as a function throws TypeError, caught by try/catch.
      expect(store.lastError).toBeTruthy()
      expect(store.projects).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    it('missing getBootstrapState method — hydrate never runs', async () => {
      // Provide createProject but omit getBootstrapState.
      window.stoa = createStoaMock({
        getBootstrapState: undefined,
        createProject: vi.fn().mockResolvedValue({ ...mockCreatedProject })
      })

      wrapper = mountApp(pinia)
      await flush()

      const store = useWorkspaceStore(pinia)
      // onMounted calls getBootstrapState which is undefined → TypeError.
      // hydrate never called, store stays empty.
      expect(store.projects).toHaveLength(0)
      expect(store.sessions).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('stoa API returns null responses', () => {
    // -----------------------------------------------------------------------
    it('getBootstrapState returns null — hydrate(null) throws and store stays empty', async () => {
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(null)
      })

      wrapper = mountApp(pinia)
      await flush()

      const store = useWorkspaceStore(pinia)
      // hydrate(null) tries to destructure null → TypeError caught in async.
      // Store stays at initial state.
      expect(store.projects).toHaveLength(0)
      expect(store.sessions).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    it('createProject returns null — sets lastError with "no response from main process"', async () => {
      setupStoa({
        createProject: vi.fn().mockResolvedValue(null)
      })

      wrapper = mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createProject', { name: 'test', path: '/test' })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('Failed to create project: no response from main process')
      expect(store.projects).toHaveLength(0)
      expect(store.activeProjectId).toBeNull()
    })

    // -----------------------------------------------------------------------
    it('createSession returns null — sets lastError with "no response from main process"', async () => {
      const hydratedState: BootstrapState = {
        activeProjectId: 'new_project',
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [{ ...mockCreatedProject }],
        sessions: []
      }
      setupStoa({
        getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
        createSession: vi.fn().mockResolvedValue(null)
      })

      wrapper = mountApp(pinia)
      await flush()

      const appShell = wrapper.findComponent({ name: 'AppShell' })
      await appShell.vm.$emit('createSession', {
        projectId: 'new_project',
        type: 'shell',
        title: 'test'
      })
      await flush()

      const store = useWorkspaceStore(pinia)
      expect(store.lastError).toBe('Failed to create session: no response from main process')
      expect(store.sessions).toHaveLength(0)
    })
  })
})
