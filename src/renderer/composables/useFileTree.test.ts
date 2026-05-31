// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'
import type { DirEntry } from '@shared/sidebar-types'

// Mock window.stoa before importing composable
const mockFsReadDir = vi.fn<Promise<DirEntry[]>, [string, string | undefined]>()

function mockWindowStoa(): void {
  ;(window as any).stoa = {
    fsReadDir: mockFsReadDir,
  }
}

function cleanupWindowStoa(): void {
  Reflect.deleteProperty(window, 'stoa')
}

// Must import after mock setup — but since we need to import at module level,
// we use dynamic re-import to get a fresh module each time.
// Instead, we import the functions and reset module-level state via the composable's return.

describe('useFileTree', () => {
  // We import inline to ensure window.stoa is mocked first
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let useFileTree: typeof import('@renderer/composables/useFileTree').useFileTree

  beforeEach(async () => {
    mockFsReadDir.mockReset()
    mockFsReadDir.mockResolvedValue([])
    mockWindowStoa()

    // Dynamic import to get fresh module
    const mod = await import('@renderer/composables/useFileTree')
    useFileTree = mod.useFileTree
  })

  afterEach(() => {
    cleanupWindowStoa()
  })

  const dirEntry = (overrides: Partial<DirEntry> = {}): DirEntry => ({
    name: 'file.ts',
    path: '/project/file.ts',
    relativePath: 'file.ts',
    isDirectory: false,
    isSymlink: false,
    size: 100,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })

  it('returns empty flatRows when projectPath is null', async () => {
    const projectPath = computed(() => null)
    const { flatRows, loading } = useFileTree(projectPath)
    await nextTick()

    expect(flatRows.value).toEqual([])
    expect(loading.value).toBe(false)
  })

  it('loads root directory on init when projectPath is set', async () => {
    const entries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
      dirEntry({ name: 'index.ts', path: '/project/index.ts', relativePath: 'index.ts' }),
    ]
    mockFsReadDir.mockResolvedValue(entries)

    const projectPath = computed(() => '/project')
    const { flatRows, loading } = useFileTree(projectPath)
    await nextTick()
    // Wait for the async refreshTree to complete
    await vi.waitFor(() => expect(loading.value).toBe(false))

    expect(mockFsReadDir).toHaveBeenCalledWith('/project', undefined)
    expect(flatRows.value).toHaveLength(2)
    expect(flatRows.value[0].name).toBe('src')
    expect(flatRows.value[0].isDirectory).toBe(true)
    expect(flatRows.value[1].name).toBe('index.ts')
  })

  it('flatRows returns empty when dirCache is not yet populated', async () => {
    // fsReadDir returns slowly — flatRows should be empty before it resolves
    let resolveRead: (value: DirEntry[]) => void
    mockFsReadDir.mockReturnValue(new Promise<DirEntry[]>((resolve) => { resolveRead = resolve }))

    const projectPath = computed(() => '/project')
    const { flatRows } = useFileTree(projectPath)
    await nextTick()

    // Before resolve, flatRows is empty (cache not yet populated)
    expect(flatRows.value).toEqual([])

    // Now resolve
    resolveRead!([dirEntry({ name: 'hello.ts', path: '/project/hello.ts', relativePath: 'hello.ts' })])
    await nextTick()
    await nextTick()

    expect(flatRows.value).toHaveLength(1)
    expect(flatRows.value[0].name).toBe('hello.ts')
  })

  it('toggleExpand loads child directory and adds to flatRows', async () => {
    const rootEntries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
    ]
    const srcEntries = [
      dirEntry({ name: 'index.ts', path: '/project/src/index.ts', relativePath: 'src/index.ts' }),
    ]

    mockFsReadDir
      .mockResolvedValueOnce(rootEntries)   // initial load
      .mockResolvedValueOnce(srcEntries)     // expand src

    const projectPath = computed(() => '/project')
    const { flatRows, toggleExpand, expandedDirs } = useFileTree(projectPath)
    await vi.waitFor(() => expect(flatRows.value.length).toBe(1))

    // Expand src directory
    toggleExpand('/project', '/project/src')
    await vi.waitFor(() => expect(flatRows.value.length).toBe(2))

    expect(expandedDirs.value.has('/project/src')).toBe(true)
    expect(flatRows.value[1].name).toBe('index.ts')
    expect(flatRows.value[1].depth).toBe(1)
    expect(mockFsReadDir).toHaveBeenCalledWith('/project', 'src')
  })

  it('toggleExpand collapses an already expanded directory', async () => {
    const rootEntries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
    ]
    mockFsReadDir.mockResolvedValue(rootEntries)

    const projectPath = computed(() => '/project')
    const { flatRows, toggleExpand, expandedDirs } = useFileTree(projectPath)
    await vi.waitFor(() => expect(flatRows.value.length).toBe(1))

    // Expand
    toggleExpand('/project', '/project/src')
    await nextTick()
    expect(expandedDirs.value.has('/project/src')).toBe(true)

    // Collapse
    toggleExpand('/project', '/project/src')
    await nextTick()
    expect(expandedDirs.value.has('/project/src')).toBe(false)
  })

  it('collapseAll removes all expanded directories', async () => {
    const rootEntries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
      dirEntry({ name: 'lib', path: '/project/lib', relativePath: 'lib', isDirectory: true }),
    ]
    mockFsReadDir.mockResolvedValue(rootEntries)

    const projectPath = computed(() => '/project')
    const { toggleExpand, collapseAll, expandedDirs } = useFileTree(projectPath)
    await vi.waitFor(() => expect(mockFsReadDir).toHaveBeenCalled())

    toggleExpand('/project', '/project/src')
    toggleExpand('/project', '/project/lib')
    await nextTick()
    expect(expandedDirs.value.size).toBe(2)

    collapseAll()
    expect(expandedDirs.value.size).toBe(0)
  })

  it('invalidatePath removes cache entry for a directory', async () => {
    const rootEntries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
    ]
    mockFsReadDir.mockResolvedValue(rootEntries)

    const projectPath = computed(() => '/project')
    const { dirCache, invalidatePath, refreshTree } = useFileTree(projectPath)
    await vi.waitFor(() => expect(mockFsReadDir).toHaveBeenCalled())

    expect(dirCache.value['/project']).toBeDefined()

    invalidatePath('/project')
    expect(dirCache.value['/project']).toBeUndefined()
  })

  it('invalidatePath removes nested cache entries', async () => {
    const rootEntries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
    ]
    mockFsReadDir.mockResolvedValue(rootEntries)

    const projectPath = computed(() => '/project')
    const { dirCache, invalidatePath } = useFileTree(projectPath)
    await vi.waitFor(() => expect(dirCache.value['/project']).toBeDefined())

    // Manually add nested cache entries to simulate expanded subdirectories
    dirCache.value = {
      ...dirCache.value,
      '/project/src': { children: [], loading: false },
      '/project/src/components': { children: [], loading: false },
      '/project/tests': { children: [], loading: false },
    }

    invalidatePath('/project/src')

    expect(dirCache.value['/project/src']).toBeUndefined()
    expect(dirCache.value['/project/src/components']).toBeUndefined()
    expect(dirCache.value['/project/tests']).toBeDefined()
  })

  it('refreshTree clears cache and reloads root', async () => {
    const entries = [dirEntry({ name: 'a.ts', path: '/project/a.ts', relativePath: 'a.ts' })]
    mockFsReadDir.mockResolvedValue(entries)

    const projectPath = computed(() => '/project')
    const { refreshTree, loading, dirCache } = useFileTree(projectPath)
    await vi.waitFor(() => expect(mockFsReadDir).toHaveBeenCalled())

    // Clear mock count to track refresh calls
    mockFsReadDir.mockClear()
    mockFsReadDir.mockResolvedValue([
      dirEntry({ name: 'b.ts', path: '/project/b.ts', relativePath: 'b.ts' }),
    ])

    await refreshTree()
    expect(loading.value).toBe(false)
    expect(mockFsReadDir).toHaveBeenCalledWith('/project', undefined)
  })

  it('refreshTree does nothing when projectPath is null', async () => {
    const projectPath = computed(() => null)
    const { refreshTree, loading } = useFileTree(projectPath)
    await nextTick()

    await refreshTree()
    expect(loading.value).toBe(false)
    expect(mockFsReadDir).not.toHaveBeenCalled()
  })

  it('handles fsReadDir errors gracefully', async () => {
    mockFsReadDir.mockRejectedValue(new Error('Permission denied'))

    const projectPath = computed(() => '/project')
    const { flatRows, loading } = useFileTree(projectPath)
    await vi.waitFor(() => expect(loading.value).toBe(false))

    // Should not throw, flatRows should be empty
    expect(flatRows.value).toEqual([])
  })

  it('deeply nested directories render at correct depth', async () => {
    const rootEntries = [
      dirEntry({ name: 'src', path: '/project/src', relativePath: 'src', isDirectory: true }),
    ]
    const srcEntries = [
      dirEntry({ name: 'deep', path: '/project/src/deep', relativePath: 'src/deep', isDirectory: true }),
    ]
    const deepEntries = [
      dirEntry({ name: 'file.ts', path: '/project/src/deep/file.ts', relativePath: 'src/deep/file.ts' }),
    ]

    mockFsReadDir
      .mockResolvedValueOnce(rootEntries)
      .mockResolvedValueOnce(srcEntries)
      .mockResolvedValueOnce(deepEntries)

    const projectPath = computed(() => '/project')
    const { flatRows, toggleExpand } = useFileTree(projectPath)
    await vi.waitFor(() => expect(flatRows.value.length).toBe(1))

    toggleExpand('/project', '/project/src')
    await vi.waitFor(() => expect(flatRows.value.length).toBe(2))

    toggleExpand('/project', '/project/src/deep')
    await vi.waitFor(() => expect(flatRows.value.length).toBe(3))

    expect(flatRows.value[2].name).toBe('file.ts')
    expect(flatRows.value[2].depth).toBe(2)
  })
})
