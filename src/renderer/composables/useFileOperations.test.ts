// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'

const mockFsCreate = vi.fn()
const mockFsRename = vi.fn()
const mockFsDelete = vi.fn()

function mockWindowStoa(): void {
  ;(window as any).stoa = {
    fsCreate: mockFsCreate,
    fsRename: mockFsRename,
    fsDelete: mockFsDelete,
  }
}

function cleanupWindowStoa(): void {
  Reflect.deleteProperty(window, 'stoa')
}

describe('useFileOperations', () => {
  let useFileOperations: typeof import('@renderer/composables/useFileOperations').useFileOperations

  beforeEach(async () => {
    mockFsCreate.mockReset().mockResolvedValue(undefined)
    mockFsRename.mockReset().mockResolvedValue(undefined)
    mockFsDelete.mockReset().mockResolvedValue(undefined)
    mockWindowStoa()

    const mod = await import('@renderer/composables/useFileOperations')
    useFileOperations = mod.useFileOperations
  })

  afterEach(() => {
    cleanupWindowStoa()
  })

  it('startCreateFile sets inlineInput with type file', () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { inlineInput, startCreateFile } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('/project/src', 1)

    expect(inlineInput.value).toEqual({
      parentPath: '/project/src',
      type: 'file',
      depth: 1,
    })
  })

  it('startCreateFolder sets inlineInput with type folder', () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { inlineInput, startCreateFolder } = useFileOperations(projectPath, invalidatePath)

    startCreateFolder('/project', 0)

    expect(inlineInput.value).toEqual({
      parentPath: '/project',
      type: 'folder',
      depth: 0,
    })
  })

  it('startRename extracts parentPath from existingPath', () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { inlineInput, startRename } = useFileOperations(projectPath, invalidatePath)

    startRename('/project/src/index.ts', 'index.ts', 1)

    expect(inlineInput.value).toEqual({
      parentPath: '/project/src',
      type: 'rename',
      depth: 1,
      existingName: 'index.ts',
      existingPath: '/project/src/index.ts',
    })
  })

  it('cancelInput clears inlineInput', () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { inlineInput, startCreateFile, cancelInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('/project', 0)
    expect(inlineInput.value).not.toBeNull()

    cancelInput()
    expect(inlineInput.value).toBeNull()
  })

  it('commitInput creates a file via fsCreate', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { startCreateFile, commitInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('/project/src', 1)
    await commitInput('new-file.ts')

    expect(mockFsCreate).toHaveBeenCalledWith({
      projectPath: '/project',
      relativePath: 'src/new-file.ts',
      isDirectory: false,
    })
    expect(invalidatePath).toHaveBeenCalledWith('/project/src')
  })

  it('commitInput creates a folder via fsCreate', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { startCreateFolder, commitInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFolder('/project', 0)
    await commitInput('lib')

    expect(mockFsCreate).toHaveBeenCalledWith({
      projectPath: '/project',
      relativePath: 'lib',
      isDirectory: true,
    })
  })

  it('commitInput renames a file via fsRename', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { startRename, commitInput } = useFileOperations(projectPath, invalidatePath)

    startRename('/project/src/index.ts', 'index.ts', 1)
    await commitInput('main.ts')

    expect(mockFsRename).toHaveBeenCalledWith({
      projectPath: '/project',
      oldRelativePath: 'src/index.ts',
      newRelativePath: 'src/main.ts',
    })
    expect(invalidatePath).toHaveBeenCalledWith('/project/src')
  })

  it('commitInput does nothing when projectPath is null', async () => {
    const projectPath = computed(() => null)
    const invalidatePath = vi.fn()
    const { startCreateFile, commitInput, inlineInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('/project', 0)
    await commitInput('test.ts')

    expect(mockFsCreate).not.toHaveBeenCalled()
    expect(inlineInput.value).toBeNull() // cleared
  })

  it('commitInput does nothing when name is empty', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { startCreateFile, commitInput, inlineInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('/project', 0)
    await commitInput('   ')

    expect(mockFsCreate).not.toHaveBeenCalled()
    expect(inlineInput.value).toBeNull()
  })

  it('commitInput does nothing when inlineInput is null', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { commitInput } = useFileOperations(projectPath, invalidatePath)

    await commitInput('test.ts')

    expect(mockFsCreate).not.toHaveBeenCalled()
  })

  it('commitInput handles fsCreate errors gracefully', async () => {
    mockFsCreate.mockRejectedValue(new Error('Disk full'))
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { startCreateFile, commitInput, inlineInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('/project', 0)
    await commitInput('fail.ts')

    // Should not throw, inlineInput should be cleared
    expect(inlineInput.value).toBeNull()
    expect(mockFsCreate).toHaveBeenCalled()
  })

  it('deleteEntry deletes a file via fsDelete', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { deleteEntry } = useFileOperations(projectPath, invalidatePath)

    await deleteEntry('/project/src/old.ts', '/project/src')

    expect(mockFsDelete).toHaveBeenCalledWith({
      projectPath: '/project',
      relativePath: 'src/old.ts',
    })
    expect(invalidatePath).toHaveBeenCalledWith('/project/src')
  })

  it('deleteEntry does nothing when projectPath is null', async () => {
    const projectPath = computed(() => null)
    const invalidatePath = vi.fn()
    const { deleteEntry } = useFileOperations(projectPath, invalidatePath)

    await deleteEntry('/project/file.ts', '/project')

    expect(mockFsDelete).not.toHaveBeenCalled()
  })

  it('deleteEntry handles fsDelete errors gracefully', async () => {
    mockFsDelete.mockRejectedValue(new Error('File in use'))
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { deleteEntry } = useFileOperations(projectPath, invalidatePath)

    // Should not throw
    await deleteEntry('/project/file.ts', '/project')
    expect(mockFsDelete).toHaveBeenCalled()
  })

  it('commitInput creates file at root when parentPath is empty', async () => {
    const projectPath = computed(() => '/project')
    const invalidatePath = vi.fn()
    const { startCreateFile, commitInput } = useFileOperations(projectPath, invalidatePath)

    startCreateFile('', 0)
    await commitInput('root-file.ts')

    expect(mockFsCreate).toHaveBeenCalledWith({
      projectPath: '/project',
      relativePath: 'root-file.ts',
      isDirectory: false,
    })
    expect(invalidatePath).toHaveBeenCalledWith('/project')
  })
})
