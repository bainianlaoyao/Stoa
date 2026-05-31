// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, type Ref } from 'vue'
import FileExplorer from '@renderer/components/right-sidebar/explorer/FileExplorer.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { createRendererApiMock } from '@shared/test-fixtures'
import type { RendererApi } from '@shared/project-session'

// Shared mutable refs that the mock composables return.
// Tests mutate these *before* mounting so the component sees current values.
const flatRowsRef: Ref<Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; depth: number }>> = ref([])
const loadingRef = ref(false)
const expandedDirsRef = ref<Set<string>>(new Set())

const mockToggleExpand = vi.fn()
const mockCollapseAll = vi.fn()
const mockInvalidatePath = vi.fn()
const mockRefreshTree = vi.fn()
const mockLoadDir = vi.fn().mockResolvedValue(undefined)
const mockStartCreateFile = vi.fn()
const mockStartCreateFolder = vi.fn()
const mockStartRename = vi.fn()
const mockCancelInput = vi.fn()
const mockCommitInput = vi.fn()
const mockDeleteEntry = vi.fn()

const inlineInputRef: Ref<{
  parentPath: string
  type: 'file' | 'folder' | 'rename'
  depth: number
  existingName?: string
  existingPath?: string
} | null> = ref(null)

vi.mock('@renderer/composables/useFileTree', () => ({
  useFileTree: () => ({
    flatRows: flatRowsRef,
    loading: loadingRef,
    toggleExpand: mockToggleExpand,
    collapseAll: mockCollapseAll,
    invalidatePath: mockInvalidatePath,
    refreshTree: mockRefreshTree,
    expandedDirs: expandedDirsRef,
    loadDir: mockLoadDir,
  }),
}))

vi.mock('@renderer/composables/useFileOperations', () => ({
  useFileOperations: () => ({
    inlineInput: inlineInputRef,
    startCreateFile: mockStartCreateFile,
    startCreateFolder: mockStartCreateFolder,
    startRename: mockStartRename,
    cancelInput: mockCancelInput,
    commitInput: mockCommitInput,
    deleteEntry: mockDeleteEntry,
  }),
}))

function createTreeNode(name: string, path: string, relativePath: string, isDirectory: boolean, depth: number) {
  return { name, path, relativePath, isDirectory, depth }
}

function setupStoa(overrides: Partial<RendererApi> = {}): void {
  window.stoa = { ...createRendererApiMock(overrides) }
}

function mountExplorer() {
  return mount(FileExplorer, {
    global: {
      stubs: {
        Teleport: {
          template: '<div><slot /></div>',
        },
      },
    },
  })
}

function setupActiveProject() {
  const workspaceStore = useWorkspaceStore()
  workspaceStore.$patch({
    projects: [{ id: 'p1', name: 'test', path: '/project', createdAt: '', updatedAt: '' }],
    activeProjectId: 'p1',
  } as never)
}

describe('FileExplorer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    flatRowsRef.value = []
    loadingRef.value = false
    expandedDirsRef.value = new Set()
    inlineInputRef.value = null
    setupStoa()
  })

  it('renders file-explorer container', () => {
    const wrapper = mountExplorer()
    expect(wrapper.find('[data-testid="file-explorer"]').exists()).toBe(true)
  })

  it('shows "No active project" when no project is selected', () => {
    const wrapper = mountExplorer()
    expect(wrapper.text()).toContain('No active project')
  })

  it('renders toolbar buttons', () => {
    const wrapper = mountExplorer()
    expect(wrapper.find('[data-testid="toolbar-new-file"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="toolbar-new-folder"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="toolbar-collapse"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="toolbar-refresh"]').exists()).toBe(true)
  })

  it('renders file rows when project is active', async () => {
    setupActiveProject()
    flatRowsRef.value = [
      createTreeNode('src', '/project/src', 'src', true, 0),
      createTreeNode('index.ts', '/project/src/index.ts', 'src/index.ts', false, 1),
      createTreeNode('readme.md', '/project/readme.md', 'readme.md', false, 0),
    ]
    loadingRef.value = false

    const wrapper = mountExplorer()
    await nextTick()

    expect(wrapper.find('[data-testid="file-tree-container"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-src"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-src/index.ts"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-readme.md"]').exists()).toBe(true)
  })

  it('shows empty directory when no rows and no inline input', async () => {
    setupActiveProject()
    flatRowsRef.value = []
    loadingRef.value = false

    const wrapper = mountExplorer()
    await nextTick()

    expect(wrapper.text()).toContain('Empty directory')
  })

  // ── 1. Double-click to open ──

  it('opens file via double-click by calling fsOpenFile', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const fileNode = createTreeNode('index.ts', '/project/index.ts', 'index.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-index.ts"]')
    expect(row.exists()).toBe(true)

    // Simulate double-click: two rapid clicks within 300ms
    await row.trigger('click')
    vi.advanceTimersByTime(50)
    await nextTick()
    await row.trigger('click')
    await nextTick()

    expect(window.stoa.fsOpenFile).toHaveBeenCalledWith('/project/index.ts')

    vi.useRealTimers()
  })

  it('toggles directory expansion on single click (not double)', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const dirNode = createTreeNode('src', '/project/src', 'src', true, 0)
    flatRowsRef.value = [dirNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-src"]')
    await row.trigger('click')

    // Advance past the double-click detection window
    vi.advanceTimersByTime(350)
    await nextTick()

    expect(mockToggleExpand).toHaveBeenCalledWith('/project', '/project/src')
    expect(window.stoa.fsOpenFile).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  // ── 2. Keyboard navigation ──

  it('tree container is focusable with tabindex=0', async () => {
    setupActiveProject()
    flatRowsRef.value = []

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')
    expect(container.exists()).toBe(true)
    expect(container.attributes('tabindex')).toBe('0')
  })

  it('ArrowDown moves focused row to next visible node', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const nodes = [
      createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0),
      createTreeNode('b.ts', '/project/b.ts', 'b.ts', false, 0),
    ]
    flatRowsRef.value = nodes

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')

    // Click first row to set focusedPath, then advance timer for single-click
    const firstRow = wrapper.find('[data-testid="file-row-a.ts"]')
    await firstRow.trigger('click')
    vi.advanceTimersByTime(350)
    await nextTick()

    await container.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()

    // Second row should have focused class
    const secondRow = wrapper.find('[data-testid="file-row-b.ts"]')
    expect(secondRow.classes()).toContain('explorer-row-focused')

    vi.useRealTimers()
  })

  it('ArrowUp moves focused row to previous visible node', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const nodes = [
      createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0),
      createTreeNode('b.ts', '/project/b.ts', 'b.ts', false, 0),
    ]
    flatRowsRef.value = nodes

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')

    // Click second row to focus it
    const secondRow = wrapper.find('[data-testid="file-row-b.ts"]')
    await secondRow.trigger('click')
    vi.advanceTimersByTime(350)
    await nextTick()

    await container.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()

    const firstRow = wrapper.find('[data-testid="file-row-a.ts"]')
    expect(firstRow.classes()).toContain('explorer-row-focused')

    vi.useRealTimers()
  })

  it('Enter on file opens it via fsOpenFile', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')

    // Focus the row first
    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('click')
    vi.advanceTimersByTime(350)
    await nextTick()

    await container.trigger('keydown', { key: 'Enter' })
    expect(window.stoa.fsOpenFile).toHaveBeenCalledWith('/project/a.ts')

    vi.useRealTimers()
  })

  it('Enter on directory toggles expansion', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const dirNode = createTreeNode('src', '/project/src', 'src', true, 0)
    flatRowsRef.value = [dirNode]

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')

    const row = wrapper.find('[data-testid="file-row-src"]')
    await row.trigger('click')
    vi.advanceTimersByTime(350)
    await nextTick()

    await container.trigger('keydown', { key: 'Enter' })
    // Toggle was already called on click; Enter should call it again
    expect(mockToggleExpand).toHaveBeenCalledWith('/project', '/project/src')

    vi.useRealTimers()
  })

  it('F2 starts rename on focused item', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('click')
    vi.advanceTimersByTime(350)
    await nextTick()

    await container.trigger('keydown', { key: 'F2' })
    expect(mockStartRename).toHaveBeenCalledWith('/project/a.ts', 'a.ts', 0)

    vi.useRealTimers()
  })

  it('Delete key deletes focused item', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    setupStoa()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const container = wrapper.find('[data-testid="file-tree-container"]')

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('click')
    vi.advanceTimersByTime(350)
    await nextTick()

    await container.trigger('keydown', { key: 'Delete' })
    // parentPath is computed from last '/' in path: '/project/a.ts' -> '/project'
    expect(mockDeleteEntry).toHaveBeenCalledWith('/project/a.ts', '/project')

    vi.useRealTimers()
  })

  // ── 3. Extended context menu ──

  it('shows context menu on right-click', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    expect(wrapper.text()).toContain('Rename')
    expect(wrapper.text()).toContain('Delete')
  })

  it('context menu includes Copy Path and Copy Relative Path', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    expect(wrapper.text()).toContain('Copy Path')
    expect(wrapper.text()).toContain('Copy Relative Path')
  })

  it('context menu includes Reveal in System Explorer', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    expect(wrapper.text()).toContain('Reveal in System Explorer')
  })

  it('context menu includes Duplicate for files', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    expect(wrapper.text()).toContain('Duplicate')
  })

  it('context menu includes Find in Folder for directories', async () => {
    setupActiveProject()

    const dirNode = createTreeNode('src', '/project/src', 'src', true, 0)
    flatRowsRef.value = [dirNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-src"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    expect(wrapper.text()).toContain('Find in Folder')
  })

  it('copyAbsolutePath writes to clipboard', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined)
    const origClipboard = navigator.clipboard
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: mockWriteText } },
      writable: true,
      configurable: true,
    })

    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    // Find and click the "Copy Path" button
    const buttons = wrapper.findAll('button')
    const copyPathBtn = buttons.find((b) => b.text() === 'Copy Path')
    expect(copyPathBtn).toBeDefined()
    await copyPathBtn!.trigger('click')
    await nextTick()

    expect(mockWriteText).toHaveBeenCalledWith('/project/a.ts')

    // Restore
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: origClipboard },
      writable: true,
      configurable: true,
    })
  })

  it('revealInSystemExplorer calls shellShowItemInFolder', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()

    const buttons = wrapper.findAll('button')
    const revealBtn = buttons.find((b) => b.text() === 'Reveal in System Explorer')
    expect(revealBtn).toBeDefined()
    await revealBtn!.trigger('click')

    expect(window.stoa.shellShowItemInFolder).toHaveBeenCalledWith('/project/a.ts')
  })

  // ── 4. Drag and drop ──

  it('file rows are draggable', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    expect(row.attributes('draggable')).toBe('true')
  })

  it('dragstart sets drag data', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }
    await row.trigger('dragstart', { dataTransfer })

    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-stoa-file-path', '/project/a.ts')
  })

  it('drop on directory calls fsRename to move file', async () => {
    setupActiveProject()

    const dirNode = createTreeNode('dest', '/project/dest', 'dest', true, 0)
    flatRowsRef.value = [dirNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-dest"]')

    const dataTransfer = {
      getData: vi.fn().mockReturnValue('/project/src/a.ts'),
      types: ['application/x-stoa-file-path'],
    }
    await row.trigger('drop', { dataTransfer, preventDefault: vi.fn(), stopPropagation: vi.fn() })

    expect(window.stoa.fsRename).toHaveBeenCalledWith({
      projectPath: '/project',
      oldRelativePath: 'src/a.ts',
      newRelativePath: 'dest/a.ts',
    })
  })

  // ── 5. File type icons ──

  it('renders rows for multiple file types', async () => {
    setupActiveProject()

    flatRowsRef.value = [
      createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0),
      createTreeNode('b.md', '/project/b.md', 'b.md', false, 0),
      createTreeNode('c.json', '/project/c.json', 'c.json', false, 0),
      createTreeNode('d.png', '/project/d.png', 'd.png', false, 0),
      createTreeNode('e.txt', '/project/e.txt', 'e.txt', false, 0),
      createTreeNode('f.xyz', '/project/f.xyz', 'f.xyz', false, 0),
    ]

    const wrapper = mountExplorer()
    await nextTick()

    expect(wrapper.find('[data-testid="file-row-a.ts"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-b.md"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-c.json"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-d.png"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-e.txt"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-row-f.xyz"]').exists()).toBe(true)
  })

  // ── 6. Reveal-in-explorer support ──

  it('watches pendingRevealPath and clears it', async () => {
    setupActiveProject()

    flatRowsRef.value = [
      createTreeNode('src', '/project/src', 'src', true, 0),
      createTreeNode('a.ts', '/project/src/a.ts', 'src/a.ts', false, 1),
    ]
    expandedDirsRef.value = new Set(['/project/src'])

    const wrapper = mountExplorer()
    await flushPromises()

    const sidebarStore = useSidebarStore()

    // Trigger reveal
    sidebarStore.revealInExplorer('/project/src/a.ts')
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(sidebarStore.pendingRevealPath).toBeNull()
  })

  // ── Context menu close behavior ──

  it('closes context menu when clicking overlay', async () => {
    setupActiveProject()

    const fileNode = createTreeNode('a.ts', '/project/a.ts', 'a.ts', false, 0)
    flatRowsRef.value = [fileNode]

    const wrapper = mountExplorer()
    await nextTick()

    const row = wrapper.find('[data-testid="file-row-a.ts"]')
    await row.trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()
    expect(wrapper.text()).toContain('Rename')

    // Click overlay to close
    const overlay = wrapper.find('.fixed.inset-0')
    await overlay.trigger('click')
    await nextTick()

    // Context menu should be gone
    expect(wrapper.text()).not.toContain('Rename')
  })

  // ── Toolbar actions ──

  it('toolbar new-file button starts file creation', async () => {
    setupActiveProject()
    flatRowsRef.value = []

    const wrapper = mountExplorer()
    await nextTick()

    await wrapper.find('[data-testid="toolbar-new-file"]').trigger('click')
    expect(mockStartCreateFile).toHaveBeenCalledWith('/project', 0)
  })

  it('toolbar collapse button calls collapseAll', async () => {
    setupActiveProject()
    flatRowsRef.value = []

    const wrapper = mountExplorer()
    await nextTick()

    await wrapper.find('[data-testid="toolbar-collapse"]').trigger('click')
    expect(mockCollapseAll).toHaveBeenCalled()
  })

  it('toolbar refresh button calls refreshTree', async () => {
    setupActiveProject()
    flatRowsRef.value = []

    const wrapper = mountExplorer()
    await nextTick()

    await wrapper.find('[data-testid="toolbar-refresh"]').trigger('click')
    expect(mockRefreshTree).toHaveBeenCalled()
  })
})
