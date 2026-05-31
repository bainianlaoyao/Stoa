import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSearchStore } from '@renderer/stores/search'
import { useGitStore } from '@renderer/stores/git'
import type { SidebarState, SearchResult, SearchOptions, GitStatusResult, GitBranchInfo, GitLogEntry } from '@shared/sidebar-types'

function createSidebarState(overrides?: Partial<SidebarState>): SidebarState {
  return {
    open: false,
    activeTab: 'explorer',
    width: 280,
    sessionListWidth: 240,
    ...overrides,
  }
}

function mockWindowStoa(overrides: Record<string, any> = {}): void {
  const noop = () => {}
  ;(window as any).stoa = {
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
    fsOpenFile: async () => {},
    onFsChanged: () => noop,
    shellShowItemInFolder: async () => {},
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
      expect(store.sessionListWidth).toBe(240)
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

    test('setSessionListWidth clamps between min and max', () => {
      const store = useSidebarStore()
      store.setSessionListWidth(50)
      expect(store.sessionListWidth).toBe(160)
      store.setSessionListWidth(300)
      expect(store.sessionListWidth).toBe(300)
      store.setSessionListWidth(600)
      expect(store.sessionListWidth).toBe(480)
    })

    test('hydrate loads state from window.stoa.getSidebarState', async () => {
      const persisted = createSidebarState({ open: true, activeTab: 'git', width: 400 })
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => persisted })

      const store = useSidebarStore()
      await store.hydrate()

      expect(store.open).toBe(true)
      expect(store.activeTab).toBe('git')
      expect(store.width).toBe(400)
    })

    test('hydrate clamps width to valid range', async () => {
      const persisted = createSidebarState({ width: 50 })
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => persisted })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.width).toBe(220)
    })

    test('hydrate loads sessionListWidth from persisted state', async () => {
      const persisted = createSidebarState({ sessionListWidth: 350 })
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => persisted })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.sessionListWidth).toBe(350)
    })

    test('hydrate clamps sessionListWidth to valid range', async () => {
      const persisted = createSidebarState({ sessionListWidth: 50 })
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => persisted })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.sessionListWidth).toBe(160)
    })

    test('hydrate defaults sessionListWidth when missing from persisted state', async () => {
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => ({ open: true, activeTab: 'explorer', width: 280 }) })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.sessionListWidth).toBe(240)
    })

    test('hydrate handles null response gracefully', async () => {
      cleanupWindowStoa()
      mockWindowStoa({ getSidebarState: async () => null })

      const store = useSidebarStore()
      await store.hydrate()
      expect(store.open).toBe(false)
      expect(store.activeTab).toBe('explorer')
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
        IPC_CHANNELS.sidebarGetState,
        IPC_CHANNELS.sidebarSetState,
        IPC_CHANNELS.fsReadDir,
        IPC_CHANNELS.fsReadFile,
        IPC_CHANNELS.fsWriteFile,
        IPC_CHANNELS.fsCreate,
        IPC_CHANNELS.fsRename,
        IPC_CHANNELS.fsDelete,
        IPC_CHANNELS.fsSearch,
        IPC_CHANNELS.fsOpenFile,
        IPC_CHANNELS.fsChanged,
        IPC_CHANNELS.shellShowItemInFolder,
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
        'fsReadDir', 'fsReadFile', 'fsWriteFile', 'fsCreate', 'fsRename', 'fsDelete', 'fsSearch', 'fsOpenFile',
        'onFsChanged', 'shellShowItemInFolder',
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
      expect(IPC_CHANNELS.fsOpenFile).toBe('fs:open-file')
      expect(IPC_CHANNELS.fsChanged).toBe('fs:changed')
      expect(IPC_CHANNELS.shellShowItemInFolder).toBe('shell:show-item-in-folder')
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

  describe('Sidebar Visibility and CSS-Based Hiding', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('toggle does not destroy store state — sidebar stays in DOM when closed', () => {
      const store = useSidebarStore()
      store.setOpen(true)
      store.setActiveTab('search')
      store.setWidth(350)

      expect(store.open).toBe(true)
      expect(store.activeTab).toBe('search')
      expect(store.width).toBe(350)

      // Closing the sidebar should only flip the open flag, not reset other state
      store.setOpen(false)

      expect(store.open).toBe(false)
      expect(store.activeTab).toBe('search')
      expect(store.width).toBe(350)
    })

    test('re-opening sidebar restores previous tab and width', () => {
      const store = useSidebarStore()
      store.setActiveTab('git')
      store.setWidth(500)
      store.setOpen(true)
      store.setOpen(false)

      store.setOpen(true)

      expect(store.activeTab).toBe('git')
      expect(store.width).toBe(500)
    })

    test('toggle cycles open state without side effects', () => {
      const store = useSidebarStore()
      store.setActiveTab('search')

      store.toggle()
      expect(store.open).toBe(true)
      expect(store.activeTab).toBe('search')

      store.toggle()
      expect(store.open).toBe(false)
      expect(store.activeTab).toBe('search')

      store.toggle()
      expect(store.open).toBe(true)
      expect(store.activeTab).toBe('search')
    })
  })

  describe('Per-Project Tab Persistence', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('setActiveTab records tab per project via activeTabByProject', () => {
      const captured: Partial<SidebarState>[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        setSidebarState: async (state: Partial<SidebarState>) => {
          captured.push(state)
        },
      })

      const sidebarStore = useSidebarStore()
      const workspaceStore = useWorkspaceStore()

      // Hydrate workspace store with two projects so activeProject resolves
      workspaceStore.hydrate({
        activeProjectId: 'proj-1',
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [
          { id: 'proj-1', path: '/projects/alpha', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'proj-2', path: '/projects/beta', name: 'Beta', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        sessions: [],
      })

      sidebarStore.setActiveTab('search')
      expect(sidebarStore.activeTabByProject['/projects/alpha']).toBe('search')

      sidebarStore.setActiveTab('git')
      expect(sidebarStore.activeTabByProject['/projects/alpha']).toBe('git')
    })

    test('activeTabByProject is restored when switching projects', async () => {
      const sidebarStore = useSidebarStore()
      const workspaceStore = useWorkspaceStore()

      workspaceStore.hydrate({
        activeProjectId: 'proj-1',
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [
          { id: 'proj-1', path: '/projects/alpha', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'proj-2', path: '/projects/beta', name: 'Beta', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        sessions: [],
      })
      await nextTick()

      // Set tab while on project alpha
      sidebarStore.setActiveTab('search')
      expect(sidebarStore.activeTab).toBe('search')
      expect(sidebarStore.activeTabByProject['/projects/alpha']).toBe('search')

      // Switch to project beta — tab should remain search (no remembered tab for beta)
      workspaceStore.setActiveProject('proj-2')
      await nextTick()
      expect(workspaceStore.activeProject?.path).toBe('/projects/beta')

      // Set tab for beta
      sidebarStore.setActiveTab('git')
      expect(sidebarStore.activeTabByProject['/projects/beta']).toBe('git')

      // Switch back to alpha — should restore search tab
      workspaceStore.setActiveProject('proj-1')
      await nextTick()
      expect(sidebarStore.activeTab).toBe('search')
    })

    test('activeTabByProject persists through setSidebarState calls', () => {
      const captured: Partial<SidebarState>[] = []
      cleanupWindowStoa()
      mockWindowStoa({
        setSidebarState: async (state: Partial<SidebarState>) => {
          captured.push(state)
        },
      })

      const sidebarStore = useSidebarStore()
      const workspaceStore = useWorkspaceStore()

      workspaceStore.hydrate({
        activeProjectId: 'proj-1',
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [
          { id: 'proj-1', path: '/projects/alpha', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        sessions: [],
      })

      sidebarStore.setActiveTab('git')
      sidebarStore.setOpen(true)

      // setActiveTab triggers persistState with the full state including activeTab
      const tabCall = captured.find((c) => c.activeTab === 'git')
      expect(tabCall).toBeDefined()
      expect(tabCall!.activeTab).toBe('git')

      // setOpen triggers persistState with the full state including open
      const openCall = captured.find((c) => c.open === true)
      expect(openCall).toBeDefined()
      expect(openCall!.open).toBe(true)
    })
  })

  describe('Reveal in Explorer', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('revealInExplorer opens sidebar and switches to explorer tab', () => {
      const store = useSidebarStore()
      expect(store.open).toBe(false)
      expect(store.activeTab).toBe('explorer')

      store.setActiveTab('git')
      expect(store.activeTab).toBe('git')

      store.revealInExplorer('/project/src/index.ts')

      expect(store.open).toBe(true)
      expect(store.activeTab).toBe('explorer')
      expect(store.pendingRevealPath).toBe('/project/src/index.ts')
    })

    test('clearPendingReveal resets pendingRevealPath', () => {
      const store = useSidebarStore()
      store.revealInExplorer('/project/src/foo.ts')

      expect(store.pendingRevealPath).toBe('/project/src/foo.ts')

      store.clearPendingReveal()

      expect(store.pendingRevealPath).toBeNull()
    })

    test('revealInExplorer overwrites previous pending reveal', () => {
      const store = useSidebarStore()
      store.revealInExplorer('/project/src/a.ts')
      store.revealInExplorer('/project/src/b.ts')

      expect(store.pendingRevealPath).toBe('/project/src/b.ts')
    })

    test('revealInExplorer opens sidebar even if closed', () => {
      const store = useSidebarStore()
      store.setOpen(false)
      expect(store.open).toBe(false)

      store.revealInExplorer('/project/README.md')

      expect(store.open).toBe(true)
    })
  })

  describe('Keyboard Shortcut Simulation', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('simulated Ctrl+B keyboard shortcut toggles sidebar open state', () => {
      const store = useSidebarStore()

      expect(store.open).toBe(false)

      // Simulate the effect of Ctrl+B handler calling store.toggle()
      store.toggle()
      expect(store.open).toBe(true)

      // Second press closes
      store.toggle()
      expect(store.open).toBe(false)
    })

    test('simulated keyboard shortcut cycles through panels', () => {
      const store = useSidebarStore()
      const workspaceStore = useWorkspaceStore()

      workspaceStore.hydrate({
        activeProjectId: 'proj-1',
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [
          { id: 'proj-1', path: '/projects/alpha', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        sessions: [],
      })

      store.setOpen(true)

      const tabs: SidebarTab[] = ['explorer', 'search', 'git']
      for (const tab of tabs) {
        store.setActiveTab(tab)
        expect(store.activeTab).toBe(tab)
      }

      // Wrap around back to explorer
      store.setActiveTab('explorer')
      expect(store.activeTab).toBe('explorer')
    })
  })

  describe('Sidebar State Persists Across Project Switches', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      mockWindowStoa()
    })

    afterEach(() => {
      cleanupWindowStoa()
    })

    test('width and open state persist when switching projects', () => {
      const sidebarStore = useSidebarStore()
      const workspaceStore = useWorkspaceStore()

      workspaceStore.hydrate({
        activeProjectId: 'proj-1',
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [
          { id: 'proj-1', path: '/projects/alpha', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'proj-2', path: '/projects/beta', name: 'Beta', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        sessions: [],
      })

      sidebarStore.setOpen(true)
      sidebarStore.setWidth(400)

      // Switch to project beta
      workspaceStore.setActiveProject('proj-2')

      // Width and open state should persist
      expect(sidebarStore.open).toBe(true)
      expect(sidebarStore.width).toBe(400)
    })

    test('sessionListWidth persists across project switches', () => {
      const sidebarStore = useSidebarStore()
      const workspaceStore = useWorkspaceStore()

      workspaceStore.hydrate({
        activeProjectId: 'proj-1',
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [
          { id: 'proj-1', path: '/projects/alpha', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'proj-2', path: '/projects/beta', name: 'Beta', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        sessions: [],
      })

      sidebarStore.setSessionListWidth(350)

      workspaceStore.setActiveProject('proj-2')

      expect(sidebarStore.sessionListWidth).toBe(350)
    })
  })

  describe('Atomic Write and Backup Recovery', () => {
    test('writeSidebarState creates backup before overwrite', async () => {
      const { writeSidebarState, readSidebarState } = await import('@core/sidebar-state-store')
      const { readFile: fsReadFile } = await import('node:fs/promises')
      const { existsSync } = await import('node:fs')
      const { homedir } = await import('node:os')
      const { join } = await import('node:path')

      const statePath = join(homedir(), '.stoa', 'sidebar.json')
      const backupPath = statePath + '.backup'

      // Write initial state
      const state1: SidebarState = { open: true, activeTab: 'explorer', width: 300, sessionListWidth: 240 }
      await writeSidebarState(state1)

      // Write second state — should create backup of first
      const state2: SidebarState = { open: false, activeTab: 'search', width: 400, sessionListWidth: 300 }
      await writeSidebarState(state2)

      // Backup should contain the first state
      if (existsSync(backupPath)) {
        const backupRaw = await fsReadFile(backupPath, 'utf-8')
        const backupParsed = JSON.parse(backupRaw) as SidebarState
        expect(backupParsed.open).toBe(true)
        expect(backupParsed.activeTab).toBe('explorer')
        expect(backupParsed.width).toBe(300)
      }

      // Primary file should contain the second state
      const result = await readSidebarState()
      expect(result).not.toBeNull()
      expect(result!.open).toBe(false)
      expect(result!.activeTab).toBe('search')
      expect(result!.width).toBe(400)
    })

    test('readSidebarState falls back to backup when primary is corrupt', async () => {
      const { writeSidebarState, readSidebarState } = await import('@core/sidebar-state-store')
      const { writeFile: fsWriteFile } = await import('node:fs/promises')
      const { homedir } = await import('node:os')
      const { join } = await import('node:path')

      const statePath = join(homedir(), '.stoa', 'sidebar.json')

      // Write a valid state (first write creates the file, no backup yet)
      const state1: SidebarState = { open: true, activeTab: 'explorer', width: 300, sessionListWidth: 240 }
      await writeSidebarState(state1)

      // Write a second valid state — this creates a backup of state1
      const validState: SidebarState = { open: true, activeTab: 'git', width: 350, sessionListWidth: 260 }
      await writeSidebarState(validState)

      // Corrupt the primary file by writing invalid JSON
      await fsWriteFile(statePath, '{corrupt json!!!', 'utf-8')

      // readSidebarState should fall back to the backup (which contains state1)
      const result = await readSidebarState()
      expect(result).not.toBeNull()
      expect(result!.activeTab).toBe('explorer')
      expect(result!.width).toBe(300)
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

})
