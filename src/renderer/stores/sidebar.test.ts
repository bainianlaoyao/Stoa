// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRendererApiMock } from '@shared/test-fixtures'
import { useWorkspaceStore } from './workspaces'
import { useSidebarStore } from './sidebar'

function setupStoa(overrides: Record<string, unknown> = {}): void {
  window.stoa = {
    ...createRendererApiMock(overrides),
  }
}

function activateProject(store: ReturnType<typeof useWorkspaceStore>, path: string): void {
  store.$patch({
    projects: [{ id: 'p1', name: 'test', path, createdAt: '', updatedAt: '' }],
    activeProjectId: 'p1',
  } as never)
}

describe('useSidebarStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupStoa()
  })

  // ── Basic state ──

  it('has correct defaults', () => {
    const store = useSidebarStore()
    expect(store.open).toBe(false)
    expect(store.activeTab).toBe('explorer')
    expect(store.width).toBe(280)
    expect(store.sessionListWidth).toBe(240)
  })

  it('setOpen updates open state', () => {
    const store = useSidebarStore()
    store.setOpen(true)
    expect(store.open).toBe(true)
    store.setOpen(false)
    expect(store.open).toBe(false)
  })

  it('toggle flips open state', () => {
    const store = useSidebarStore()
    expect(store.open).toBe(false)
    store.toggle()
    expect(store.open).toBe(true)
    store.toggle()
    expect(store.open).toBe(false)
  })

  it('setActiveTab updates activeTab', () => {
    const store = useSidebarStore()
    store.setActiveTab('search')
    expect(store.activeTab).toBe('search')
    store.setActiveTab('git')
    expect(store.activeTab).toBe('git')
  })

  it('setWidth clamps between min and max', () => {
    const store = useSidebarStore()
    store.setWidth(100)
    expect(store.width).toBe(220)
    store.setWidth(900)
    expect(store.width).toBe(800)
    store.setWidth(300)
    expect(store.width).toBe(300)
  })

  it('setSessionListWidth clamps between min and max', () => {
    const store = useSidebarStore()
    store.setSessionListWidth(100)
    expect(store.sessionListWidth).toBe(160)
    store.setSessionListWidth(600)
    expect(store.sessionListWidth).toBe(480)
    store.setSessionListWidth(250)
    expect(store.sessionListWidth).toBe(250)
  })

  // ── activeTabByProject ──

  it('setActiveTab records tab in activeTabByProject when project is active', () => {
    const workspaceStore = useWorkspaceStore()
    activateProject(workspaceStore, '/project-alpha')

    const store = useSidebarStore()
    store.setActiveTab('search')

    expect(store.activeTabByProject).toEqual({ '/project-alpha': 'search' })
  })

  it('setActiveTab does not record when no project is active', () => {
    const store = useSidebarStore()
    store.setActiveTab('search')
    expect(store.activeTabByProject).toEqual({})
  })

  it('setActiveTab records per-project tabs independently', () => {
    const workspaceStore = useWorkspaceStore()

    // First project
    activateProject(workspaceStore, '/project-alpha')
    const store = useSidebarStore()
    store.setActiveTab('search')
    expect(store.activeTabByProject).toEqual({ '/project-alpha': 'search' })

    // Switch to second project
    workspaceStore.$patch({
      projects: [
        { id: 'p1', name: 'alpha', path: '/project-alpha', createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'beta', path: '/project-beta', createdAt: '', updatedAt: '' },
      ],
      activeProjectId: 'p2',
    } as never)

    store.setActiveTab('git')
    expect(store.activeTabByProject).toEqual({
      '/project-alpha': 'search',
      '/project-beta': 'git',
    })
  })

  // ── revealInExplorer ──

  it('revealInExplorer opens sidebar and sets tab to explorer', () => {
    const store = useSidebarStore()
    store.setOpen(false)
    store.setActiveTab('search')

    store.revealInExplorer('/project/src/index.ts')

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('explorer')
  })

  it('revealInExplorer sets pendingRevealPath', () => {
    const store = useSidebarStore()
    store.revealInExplorer('/project/src/index.ts')
    expect(store.pendingRevealPath).toBe('/project/src/index.ts')
  })

  // ── clearPendingReveal ──

  it('clearPendingReveal clears pendingRevealPath', () => {
    const store = useSidebarStore()
    store.revealInExplorer('/project/src/index.ts')
    expect(store.pendingRevealPath).toBe('/project/src/index.ts')

    store.clearPendingReveal()
    expect(store.pendingRevealPath).toBeNull()
  })

  // ── restoreProjectTab ──

  it('restoreProjectTab restores remembered tab for a project', () => {
    const workspaceStore = useWorkspaceStore()
    activateProject(workspaceStore, '/project-alpha')

    const store = useSidebarStore()
    // Record 'search' for project-alpha via setActiveTab
    store.setActiveTab('search')
    expect(store.activeTabByProject['/project-alpha']).toBe('search')

    // Simulate tab changed without going through setActiveTab
    // (e.g. user navigated away, or revealInExplorer set it to 'explorer')
    store.activeTabByProject = { ...store.activeTabByProject, '/project-alpha': 'search' }
    store.activeTab = 'explorer'
    expect(store.activeTab).toBe('explorer')

    // Restore from memory
    store.restoreProjectTab('/project-alpha')
    expect(store.activeTab).toBe('search')
  })

  it('restoreProjectTab does nothing when no remembered tab exists', () => {
    const store = useSidebarStore()
    store.setActiveTab('explorer')
    store.restoreProjectTab('/unknown-project')
    expect(store.activeTab).toBe('explorer')
  })

  // ── Project switch watcher ──

  it('restores remembered tab when active project changes via restoreProjectTab', () => {
    const workspaceStore = useWorkspaceStore()

    // Setup two projects
    workspaceStore.$patch({
      projects: [
        { id: 'p1', name: 'alpha', path: '/project-alpha', createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'beta', path: '/project-beta', createdAt: '', updatedAt: '' },
      ],
      activeProjectId: 'p1',
    } as never)

    const store = useSidebarStore()
    // Remember 'search' for project-alpha
    store.setActiveTab('search')
    expect(store.activeTab).toBe('search')
    expect(store.activeTabByProject['/project-alpha']).toBe('search')

    // Switch to project-beta
    workspaceStore.$patch({ activeProjectId: 'p2' } as never)
    // Record 'git' for project-beta
    store.setActiveTab('git')
    expect(store.activeTab).toBe('git')
    expect(store.activeTabByProject['/project-beta']).toBe('git')

    // Manually simulate what the watcher does: restore tab for project-alpha
    store.restoreProjectTab('/project-alpha')
    expect(store.activeTab).toBe('search')
  })

  // ── Hydration ──

  it('hydrate loads state from IPC', async () => {
    setupStoa({
      getSidebarState: vi.fn().mockResolvedValue({
        open: true,
        activeTab: 'git',
        width: 400,
        sessionListWidth: 300,
      }),
    })

    const store = useSidebarStore()
    await store.hydrate()

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('git')
    expect(store.width).toBe(400)
    expect(store.sessionListWidth).toBe(300)
  })

  it('hydrate clamps out-of-range width values', async () => {
    setupStoa({
      getSidebarState: vi.fn().mockResolvedValue({
        open: true,
        activeTab: 'explorer',
        width: 9999,
        sessionListWidth: 9999,
      }),
    })

    const store = useSidebarStore()
    await store.hydrate()

    expect(store.width).toBe(800)
    expect(store.sessionListWidth).toBe(480)
  })

  it('hydrate handles null gracefully', async () => {
    setupStoa({
      getSidebarState: vi.fn().mockResolvedValue(null),
    })

    const store = useSidebarStore()
    await store.hydrate()

    expect(store.open).toBe(false)
    expect(store.activeTab).toBe('explorer')
  })

  it('hydrate handles IPC error gracefully', async () => {
    setupStoa({
      getSidebarState: vi.fn().mockRejectedValue(new Error('IPC failure')),
    })

    const store = useSidebarStore()
    await store.hydrate()

    // Defaults remain
    expect(store.open).toBe(false)
    expect(store.activeTab).toBe('explorer')
  })

  // ── Persistence ──

  it('setOpen triggers persistence via setSidebarState', async () => {
    const mockSet = vi.fn().mockResolvedValue(undefined)
    setupStoa({ setSidebarState: mockSet })

    const store = useSidebarStore()
    store.setOpen(true)

    // Allow the void persistState() to flush
    await vi.waitFor(() => {
      expect(mockSet).toHaveBeenCalled()
    })

    const persisted = mockSet.mock.calls[0][0]
    expect(persisted.open).toBe(true)
  })
})
