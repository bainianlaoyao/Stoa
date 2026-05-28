import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useSearchStore } from '@renderer/stores/search'
import { useGitStore } from '@renderer/stores/git'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import type { SidebarState, SearchResult, SearchOptions, GitStatusResult, GitBranchInfo, GitLogEntry } from '@shared/sidebar-types'
import { createTestWorkspace, createTestGlobalStatePath } from './helpers'
import { ProjectSessionManager } from '@core/project-session-manager'

function createSidebarState(overrides?: Partial<SidebarState>): SidebarState {
  return {
    open: false,
    activeTab: 'explorer',
    width: 280,
    selectedProjectId: null,
    ...overrides,
  }
}

function mockWindowStoa(overrides: Record<string, any> = {}): void {
  (window as any).stoa = {
    getBootstrapState: async () => ({ activeProjectId: null, activeSessionId: null, terminalWebhookPort: null, projects: [], sessions: [] }),
    getSidebarState: async () => createSidebarState(),
    setSidebarState: async () => {},
    fsReadDir: async () => [],
    fsReadFile: async () => '',
    fsWriteFile: async () => {},
    fsCreate: async () => {},
    fsRename: async () => {},
    fsDelete: async () => {},
    fsSearch: async () => ({ files: [], totalMatches: 0, truncated: false }),
    gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
    gitStage: async () => {},
    gitUnstage: async () => {},
    gitDiscard: async () => {},
    gitCommit: async () => {},
    gitPush: async () => {},
    gitPull: async () => {},
    gitFetch: async () => {},
    gitRebase: async () => '',
    gitMerge: async () => '',
    gitBranches: async () => ({ current: 'main', locals: ['main'], remotes: [] }),
    gitLog: async () => [],
    gitDiff: async () => '',
    gitCheckout: async () => {},
    gitCreateBranch: async () => {},
    ...overrides,
  }
}

function cleanupWindowStoa(): void {
  Reflect.deleteProperty(window, 'stoa')
}

describe('E2E: Right Sidebar', () => {

  describe('Sidebar Store', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('initial state has defaults', () => {
      const store = useSidebarStore()
      expect(store.open).toBe(false)
      expect(store.activeTab).toBe('explorer')
      expect(store.width).toBe(280)
      expect(store.selectedProjectId).toBeNull()
    })

    test('toggle switches open state', () => {
      const store = useSidebarStore()
      expect(store.open).toBe(false)
      store.toggle()
      expect(store.open).toBe(true)
      store.toggle()
      expect(store.open).toBe(false)
    })

    test('setOpen sets explicit value', () => {
      const store = useSidebarStore()
      store.setOpen(true)
      expect(store.open).toBe(true)
      store.setOpen(false)
      expect(store.open).toBe(false)
    })

    test('setActiveTab changes active tab', () => {
      const store = useSidebarStore()
      expect(store.activeTab).toBe('explorer')
      store.setActiveTab('search')
      expect(store.activeTab).toBe('search')
      store.setActiveTab('git')
      expect(store.activeTab).toBe('git')
    })

    test('setWidth clamps between min and max', () => {
      const store = useSidebarStore()
      store.setWidth(100)
      expect(store.width).toBe(220)
      store.setWidth(500)
      expect(store.width).toBe(500)
      store.setWidth(900)
      expect(store.width).toBe(800)
    })

    test('setSelectedProject updates selectedProjectId', () => {
      const store = useSidebarStore()
      store.setSelectedProject('proj-1')
      expect(store.selectedProjectId).toBe('proj-1')
      store.setSelectedProject(null)
      expect(store.selectedProjectId).toBeNull()
    })

    test('hydrate loads state from window.stoa.getSidebarState', async () => {
      const persisted = createSidebarState({ open: true, activeTab: 'git', width: 400, selectedProjectId: 'proj-x' })
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => persisted })

      const store = useSidebarStore()
      await store.hydrate()

      expect(store.open).toBe(true)
      expect(store.activeTab).toBe('git')
      expect(store.width).toBe(400)
      expect(store.selectedProjectId).toBe('proj-x')
    })

    test('hydrate clamps width to valid range', async () => {
      const persisted = createSidebarState({ width: 50 })
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => persisted })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.width).toBe(220)
    })

    test('hydrate handles null response gracefully', async () => {
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => null })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.open).toBe(false)
      expect(store.activeTab).toBe('explorer')
    })

    test('selectedProjectPath returns null when no project selected', () => {
      const store = useSidebarStore()
      expect(store.selectedProjectPath).toBeNull()
    })

    test('selectedProjectPath returns path from workspace store when project is selected', async () => {
      const workspaceDir = await createTestWorkspace('sidebar-proj-path-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'test_project' })

      const workspaceStore = useWorkspaceStore()
      workspaceStore.hydrate(manager.snapshot())

      const sidebarStore = useSidebarStore()
      sidebarStore.setSelectedProject(project.id)

      expect(sidebarStore.selectedProjectPath).toBe(workspaceDir)
    })

    test('selectedProject returns null for nonexistent project ID', () => {
      const store = useSidebarStore()
      store.setSelectedProject('nonexistent-id')
      expect(store.selectedProject).toBeNull()
      expect(store.selectedProjectPath).toBeNull()
    })

    test('persistState calls window.stoa.setSidebarState', async () => {
      const captured: Partial<SidebarState>[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        setSidebarState: async (state: Partial<SidebarState>) => {
          captured.push(state)
        },
      })

      const store = useSidebarStore()
      store.setOpen(true)
      store.setActiveTab('search')

      expect(captured).toHaveLength(2)
      expect(captured[0]).toMatchObject({ open: true })
      expect(captured[1]).toMatchObject({ activeTab: 'search' })
    })
  })

  describe('Search Store', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('initial state has defaults', () => {
      const store = useSearchStore()
      expect(store.query).toBe('')
      expect(store.caseSensitive).toBe(false)
      expect(store.wholeWord).toBe(false)
      expect(store.useRegex).toBe(false)
      expect(store.results).toBeNull()
      expect(store.searching).toBe(false)
      expect(store.error).toBeNull()
    })

    test('hasResults is false when no results', () => {
      const store = useSearchStore()
      expect(store.hasResults).toBe(false)
    })

    test('search calls fsSearch with correct options', async () => {
      const captured: SearchOptions[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        fsSearch: async (options: SearchOptions) => {
          captured.push(options)
          return { files: [], totalMatches: 0, truncated: false }
        },
      })

      const store = useSearchStore()
      store.query = 'TODO'
      store.caseSensitive = true

      await store.search('/project/root')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        query: 'TODO',
        rootPath: '/project/root',
        caseSensitive: true,
        wholeWord: false,
        useRegex: false,
        maxResults: 1000,
      })
    })

    test('search does not execute on empty query', async () => {
      let callCount = 0
      cleanupWindowStoa()
      mockWindowStoa({
        fsSearch: async () => {
          callCount++
          return { files: [], totalMatches: 0, truncated: false }
        },
      })

      const store = useSearchStore()
      store.query = '   '
      await store.search('/project/root')

      expect(callCount).toBe(0)
    })

    test('search sets results on success', async () => {
      const mockResults: SearchResult = {
        files: [{
          filePath: '/project/root/src/index.ts',
          relativePath: 'src/index.ts',
          matches: [{ line: 5, column: 10, matchLength: 4, lineContent: '// TODO: fix this' }],
        }],
        totalMatches: 1,
        truncated: false,
      }
      cleanupWindowStoa()
      mockWindowStoa({ fsSearch: async () => mockResults })

      const store = useSearchStore()
      store.query = 'TODO'
      await store.search('/project/root')

      expect(store.results).toEqual(mockResults)
      expect(store.hasResults).toBe(true)
      expect(store.searching).toBe(false)
      expect(store.error).toBeNull()
    })

    test('search sets error on failure', async () => {
      cleanupWindowStoa()
      mockWindowStoa({
        fsSearch: async () => {
          throw new Error('ripgrep not found')
        },
      })

      const store = useSearchStore()
      store.query = 'test'
      await store.search('/project/root')

      expect(store.error).toBe('ripgrep not found')
      expect(store.results).toBeNull()
      expect(store.searching).toBe(false)
    })

    test('search sets searching flag during operation', async () => {
      let resolveSearch: (value: any) => void
      const searchPromise = new Promise<SearchResult>((resolve) => { resolveSearch = resolve })

      cleanupWindowStoa()
      mockWindowStoa({ fsSearch: async () => searchPromise })

      const store = useSearchStore()
      store.query = 'test'

      const pending = store.search('/project/root')
      expect(store.searching).toBe(true)

      resolveSearch!({ files: [], totalMatches: 0, truncated: false })
      await pending

      expect(store.searching).toBe(false)
    })

    test('clearResults resets results and error', async () => {
      cleanupWindowStoa()
      mockWindowStoa({
        fsSearch: async () => {
          throw new Error('fail')
        },
      })

      const store = useSearchStore()
      store.query = 'test'
      await store.search('/project/root')
      expect(store.error).toBeTruthy()

      store.clearResults()
      expect(store.results).toBeNull()
      expect(store.error).toBeNull()
    })
  })

  describe('Git Store', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('initial state has defaults', () => {
      const store = useGitStore()
      expect(store.status).toBeNull()
      expect(store.branches).toBeNull()
      expect(store.log).toEqual([])
      expect(store.loading).toBe(false)
      expect(store.commitMessage).toBe('')
      expect(store.operationInProgress).toBe(false)
      expect(store.operationError).toBeNull()
    })

    test('computed properties return empty when status is null', () => {
      const store = useGitStore()
      expect(store.staged).toEqual([])
      expect(store.unstaged).toEqual([])
      expect(store.untracked).toEqual([])
      expect(store.hasChanges).toBe(false)
      expect(store.currentBranch).toBe('')
    })

    test('refreshStatus populates status', async () => {
      const mockStatus: GitStatusResult = {
        branch: 'feature-test',
        ahead: 2,
        behind: 0,
        clean: false,
        entries: [
          { path: 'src/app.ts', status: 'modified', staging: 'unstaged' },
          { path: 'src/new.ts', status: 'added', staging: 'staged' },
          { path: 'src/unknown.ts', status: 'untracked', staging: 'untracked' },
        ],
        hasConflicts: false,
      }
      cleanupWindowStoa()
      mockWindowStoa({ gitStatus: async () => mockStatus })

      const store = useGitStore()
      await store.refreshStatus('/project/root')

      expect(store.status).toEqual(mockStatus)
      expect(store.currentBranch).toBe('feature-test')
      expect(store.staged).toHaveLength(1)
      expect(store.staged[0].path).toBe('src/new.ts')
      expect(store.unstaged).toHaveLength(1)
      expect(store.unstaged[0].path).toBe('src/app.ts')
      expect(store.untracked).toHaveLength(1)
      expect(store.untracked[0].path).toBe('src/unknown.ts')
      expect(store.hasChanges).toBe(true)
    })

    test('refreshBranches populates branches', async () => {
      const mockBranches: GitBranchInfo = { current: 'main', locals: ['main', 'dev'], remotes: ['origin/main'] }
      cleanupWindowStoa()
      mockWindowStoa({ gitBranches: async () => mockBranches })

      const store = useGitStore()
      await store.refreshBranches('/project/root')

      expect(store.branches).toEqual(mockBranches)
      expect(store.currentBranch).toBe('main')
    })

    test('refreshLog populates log entries', async () => {
      const mockLog: GitLogEntry[] = [
        { hash: 'abc123', hashAbbrev: 'abc1', message: 'Initial commit', author: 'Test', date: '2026-01-01', refs: 'HEAD -> main' },
      ]
      cleanupWindowStoa()
      mockWindowStoa({ gitLog: async () => mockLog })

      const store = useGitStore()
      await store.refreshLog('/project/root')

      expect(store.log).toEqual(mockLog)
    })

    test('stageFile calls gitStage with projectPath and array of paths', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitStage: async (...args: any[]) => { captured.push(args) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()
      await store.stageFile('/project/root', 'src/app.ts')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toEqual(['/project/root', ['src/app.ts']])
    })

    test('unstageFile calls gitUnstage with correct args', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitUnstage: async (...args: any[]) => { captured.push(args) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()
      await store.unstageFile('/project/root', 'src/app.ts')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toEqual(['/project/root', ['src/app.ts']])
    })

    test('discardFile calls gitDiscard with correct args', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitDiscard: async (...args: any[]) => { captured.push(args) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()
      await store.discardFile('/project/root', 'src/app.ts')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toEqual(['/project/root', ['src/app.ts']])
    })

    test('commit clears commitMessage on success', async () => {
      cleanupWindowStoa()
      mockWindowStoa({
        gitCommit: async () => {},
        gitStatus: async () => ({ branch: 'main', ahead: 1, behind: 0, clean: true, entries: [], hasConflicts: false }),
        gitLog: async () => [],
      })

      const store = useGitStore()
      store.commitMessage = 'Fix bug'
      await store.commit('/project/root', 'Fix bug')

      expect(store.commitMessage).toBe('')
    })

    test('commit sets operationError on failure', async () => {
      cleanupWindowStoa()
      mockWindowStoa({
        gitCommit: async () => { throw new Error('Nothing to commit') },
      })

      const store = useGitStore()
      store.commitMessage = 'Empty msg'
      await store.commit('/project/root', 'Empty msg')

      expect(store.operationError).toBe('Nothing to commit')
    })

    test('push calls gitPush with request object', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitPush: async (req: any) => { captured.push(req) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()
      await store.push('/project/root', true)

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({ projectPath: '/project/root', setUpstream: true })
    })

    test('pull calls gitPull with projectPath', async () => {
      const captured: string[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitPull: async (path: string) => { captured.push(path) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
        gitLog: async () => [],
      })

      const store = useGitStore()
      await store.pull('/project/root')

      expect(captured).toEqual(['/project/root'])
    })

    test('fetch calls gitFetch with projectPath', async () => {
      const captured: string[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitFetch: async (path: string) => { captured.push(path) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()
      await store.fetch('/project/root')

      expect(captured).toEqual(['/project/root'])
    })

    test('checkoutBranch calls gitCheckout with positional args', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitCheckout: async (...args: any[]) => { captured.push(args) },
        gitStatus: async () => ({ branch: 'dev', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
        gitBranches: async () => ({ current: 'dev', locals: ['main', 'dev'], remotes: [] }),
      })

      const store = useGitStore()
      await store.checkoutBranch('/project/root', 'dev')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toEqual(['/project/root', 'dev'])
    })

    test('createBranch calls gitCreateBranch with positional args', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitCreateBranch: async (...args: any[]) => { captured.push(args) },
        gitBranches: async () => ({ current: 'main', locals: ['main', 'feature'], remotes: [] }),
      })

      const store = useGitStore()
      await store.createBranch('/project/root', 'feature')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toEqual(['/project/root', 'feature'])
    })

    test('rebase calls gitRebase with request object', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitRebase: async (req: any) => { captured.push(req) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
        gitLog: async () => [],
      })

      const store = useGitStore()
      await store.rebase('/project/root', 'main')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({ projectPath: '/project/root', onto: 'main' })
    })

    test('merge calls gitMerge with request object', async () => {
      const captured: any[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitMerge: async (req: any) => { captured.push(req) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
        gitLog: async () => [],
      })

      const store = useGitStore()
      await store.merge('/project/root', 'feature')

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({ projectPath: '/project/root', branch: 'feature' })
    })

    test('clearError resets operationError', () => {
      const store = useGitStore()
      store.operationError = 'Something failed'
      store.clearError()
      expect(store.operationError).toBeNull()
    })

    test('refreshAll loads status, branches, and log in parallel', async () => {
      const calls: string[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        gitStatus: async () => { calls.push('status'); return { branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false } },
        gitBranches: async () => { calls.push('branches'); return { current: 'main', locals: ['main'], remotes: [] } },
        gitLog: async () => { calls.push('log'); return [] },
      })

      const store = useGitStore()
      await store.refreshAll('/project/root')

      expect(calls).toEqual(['status', 'branches', 'log'])
      expect(store.status).not.toBeNull()
      expect(store.branches).not.toBeNull()
      expect(store.loading).toBe(false)
    })
  })

  describe('IPC Channel Registration', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('sidebar IPC channels exist in IPC_CHANNELS map', () => {
      const sidebarChannels = [
        IPC_CHANNELS.fsReadDir,
        IPC_CHANNELS.fsReadFile,
        IPC_CHANNELS.fsWriteFile,
        IPC_CHANNELS.fsCreate,
        IPC_CHANNELS.fsRename,
        IPC_CHANNELS.fsDelete,
        IPC_CHANNELS.fsSearch,
        IPC_CHANNELS.gitStatus,
        IPC_CHANNELS.gitStage,
        IPC_CHANNELS.gitUnstage,
        IPC_CHANNELS.gitDiscard,
        IPC_CHANNELS.gitCommit,
        IPC_CHANNELS.gitPush,
        IPC_CHANNELS.gitPull,
        IPC_CHANNELS.gitFetch,
        IPC_CHANNELS.gitRebase,
        IPC_CHANNELS.gitMerge,
        IPC_CHANNELS.gitBranches,
        IPC_CHANNELS.gitLog,
        IPC_CHANNELS.gitDiff,
        IPC_CHANNELS.gitCheckout,
        IPC_CHANNELS.gitCreateBranch,
      ]

      for (const channel of sidebarChannels) {
        expect(channel, `IPC_CHANNELS missing channel`).toBeTruthy()
        expect(typeof channel).toBe('string')
      }
    })

    test('preload bridge methods cover all sidebar IPC channels', () => {
      const requiredMethods = [
        'fsReadDir', 'fsReadFile', 'fsWriteFile', 'fsCreate', 'fsRename', 'fsDelete', 'fsSearch',
        'gitStatus', 'gitStage', 'gitUnstage', 'gitDiscard', 'gitCommit',
        'gitPush', 'gitPull', 'gitFetch', 'gitRebase', 'gitMerge',
        'gitBranches', 'gitLog', 'gitDiff', 'gitCheckout', 'gitCreateBranch',
        'getSidebarState', 'setSidebarState',
      ]

      const stoa = (window as any).stoa
      for (const method of requiredMethods) {
        expect(typeof stoa[method], `window.stoa missing method: ${method}`).toBe('function')
      }
    })

    test('sidebar channel names follow domain:resource-action pattern', () => {
      expect(IPC_CHANNELS.sidebarGetState).toBe('sidebar:get-state')
      expect(IPC_CHANNELS.sidebarSetState).toBe('sidebar:set-state')
      expect(IPC_CHANNELS.fsReadDir).toBe('fs:read-dir')
      expect(IPC_CHANNELS.fsReadFile).toBe('fs:read-file')
      expect(IPC_CHANNELS.fsWriteFile).toBe('fs:write-file')
      expect(IPC_CHANNELS.fsCreate).toBe('fs:create')
      expect(IPC_CHANNELS.fsRename).toBe('fs:rename')
      expect(IPC_CHANNELS.fsDelete).toBe('fs:delete')
      expect(IPC_CHANNELS.fsSearch).toBe('fs:search')
      expect(IPC_CHANNELS.gitStatus).toBe('git:status')
      expect(IPC_CHANNELS.gitStage).toBe('git:stage')
      expect(IPC_CHANNELS.gitUnstage).toBe('git:unstage')
      expect(IPC_CHANNELS.gitDiscard).toBe('git:discard')
      expect(IPC_CHANNELS.gitCommit).toBe('git:commit')
      expect(IPC_CHANNELS.gitPush).toBe('git:push')
      expect(IPC_CHANNELS.gitPull).toBe('git:pull')
      expect(IPC_CHANNELS.gitFetch).toBe('git:fetch')
      expect(IPC_CHANNELS.gitRebase).toBe('git:rebase')
      expect(IPC_CHANNELS.gitMerge).toBe('git:merge')
      expect(IPC_CHANNELS.gitBranches).toBe('git:branches')
      expect(IPC_CHANNELS.gitLog).toBe('git:log')
      expect(IPC_CHANNELS.gitDiff).toBe('git:diff')
      expect(IPC_CHANNELS.gitCheckout).toBe('git:checkout')
      expect(IPC_CHANNELS.gitCreateBranch).toBe('git:create-branch')
    })
  })

  describe('Git Store with Simulated Status Transitions', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('full lifecycle: status → stage → commit → push', async () => {
      const callLog: string[] = []

      cleanupWindowStoa()
      mockWindowStoa({
        gitStatus: async () => {
          callLog.push('status')
          if (callLog.filter((c) => c === 'status').length <= 2) {
            return { branch: 'main', ahead: 0, behind: 0, clean: false, entries: [{ path: 'src/app.ts', status: 'modified', staging: 'unstaged' }], hasConflicts: false }
          }
          return { branch: 'main', ahead: 1, behind: 0, clean: true, entries: [], hasConflicts: false }
        },
        gitStage: async () => { callLog.push('stage') },
        gitCommit: async () => { callLog.push('commit') },
        gitPush: async () => { callLog.push('push') },
        gitLog: async () => { callLog.push('log'); return [{ hash: 'abc123', hashAbbrev: 'abc1', message: 'Fix bug', author: 'Dev', date: '2026-01-01', refs: '' }] },
      })

      const store = useGitStore()
      const projectPath = '/project/root'

      await store.refreshStatus(projectPath)
      expect(store.hasChanges).toBe(true)
      expect(store.unstaged).toHaveLength(1)

      await store.stageFile(projectPath, 'src/app.ts')
      expect(callLog).toContain('stage')

      store.commitMessage = 'Fix bug'
      await store.commit(projectPath, 'Fix bug')
      expect(callLog).toContain('commit')
      expect(store.commitMessage).toBe('')

      await store.push(projectPath)
      expect(callLog).toContain('push')
    })

    test('branch operations: create → checkout → verify', async () => {
      const branchesState = { current: 'main', locals: ['main'], remotes: [] }

      cleanupWindowStoa()
      mockWindowStoa({
        gitCreateBranch: async () => {
          branchesState.locals.push('feature')
          branchesState.current = 'feature'
        },
        gitCheckout: async (_path: string, branch: string) => {
          branchesState.current = branch
        },
        gitBranches: async () => ({ ...branchesState }),
        gitStatus: async () => ({ branch: branchesState.current, ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()
      const projectPath = '/project/root'

      await store.createBranch(projectPath, 'feature')
      expect(store.branches?.current).toBe('feature')
      expect(store.branches?.locals).toContain('feature')

      await store.checkoutBranch(projectPath, 'main')
      expect(store.branches?.current).toBe('main')
    })

    test('rebase and merge operations pass correct request objects', async () => {
      const capturedOps: any[] = []

      cleanupWindowStoa()
      mockWindowStoa({
        gitRebase: async (req: any) => { capturedOps.push({ op: 'rebase', ...req }) },
        gitMerge: async (req: any) => { capturedOps.push({ op: 'merge', ...req }) },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
        gitLog: async () => [],
      })

      const store = useGitStore()
      const projectPath = '/project/root'

      await store.rebase(projectPath, 'main')
      await store.merge(projectPath, 'feature')

      expect(capturedOps).toHaveLength(2)
      expect(capturedOps[0]).toMatchObject({ op: 'rebase', projectPath, onto: 'main' })
      expect(capturedOps[1]).toMatchObject({ op: 'merge', projectPath, branch: 'feature' })
    })

    test('error recovery: operation clears error on next success', async () => {
      let failNext = true

      cleanupWindowStoa()
      mockWindowStoa({
        gitStage: async () => {
          if (failNext) {
            failNext = false
            throw new Error('Network error')
          }
        },
        gitStatus: async () => ({ branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }),
      })

      const store = useGitStore()

      await store.stageFile('/project/root', 'src/app.ts')
      expect(store.operationError).toBe('Network error')

      await store.stageFile('/project/root', 'src/app.ts')
      expect(store.operationError).toBeNull()
    })
  })

  describe('Sidebar Store Hydration with Workspace Integration', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('sidebar selectedProjectPath resolves through workspace store', async () => {
      const workspaceDir = await createTestWorkspace('sidebar-integration-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'integration_project' })

      const workspaceStore = useWorkspaceStore()
      workspaceStore.hydrate(manager.snapshot())

      const sidebarStore = useSidebarStore()
      sidebarStore.setSelectedProject(project.id)

      expect(sidebarStore.selectedProjectPath).toBe(workspaceDir)
      expect(sidebarStore.selectedProject?.name).toBe('integration_project')
    })

    test('sidebar persists selected project and restores on hydrate', async () => {
      const workspaceDir = await createTestWorkspace('sidebar-restore-')
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'restore_project' })

      let savedState: SidebarState | null = null

      cleanupWindowStoa()
      mockWindowStoa({
        getSidebarState: async () => savedState,
        setSidebarState: async (state: Partial<SidebarState>) => {
          savedState = state as SidebarState
        },
      })

      const workspaceStore = useWorkspaceStore()
      workspaceStore.hydrate(manager.snapshot())

      const sidebarStore = useSidebarStore()
      sidebarStore.setOpen(true)
      sidebarStore.setActiveTab('git')
      sidebarStore.setSelectedProject(project.id)

      const freshPinia = createPinia()
      setActivePinia(freshPinia)

      const workspaceStore2 = useWorkspaceStore()
      workspaceStore2.hydrate(manager.snapshot())

      const sidebarStore2 = useSidebarStore()
      await sidebarStore2.hydrate()

      expect(sidebarStore2.open).toBe(true)
      expect(sidebarStore2.activeTab).toBe('git')
      expect(sidebarStore2.selectedProjectId).toBe(project.id)
      expect(sidebarStore2.selectedProjectPath).toBe(workspaceDir)
    })
  })
})
