import { ref, computed, watch } from 'vue'
import type { DirEntry } from '@shared/sidebar-types'

export interface TreeNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  depth: number
}

export type DirCache = {
  children: TreeNode[]
  loading: boolean
}

const dirCache = ref<Record<string, DirCache>>({})
const expandedDirs = ref<Set<string>>(new Set())

/**
 * Convert absolute dirPath into a relative path for the IPC call.
 * Handles both forward-slash and backslash separators.
 */
function toRelative(dirPath: string, projectPath: string): string | undefined {
  if (!dirPath.startsWith(projectPath)) return undefined
  const rel = dirPath.slice(projectPath.length)
  if (!rel || rel === '/' || rel === '\\') return undefined
  // Strip leading separator
  return rel.startsWith('/') || rel.startsWith('\\') ? rel.slice(1) : rel
}

/**
 * Load directory contents via IPC. Skips if already cached with children.
 * Preserves existing children during reload for smooth UX.
 */
async function loadDir(projectPath: string, dirPath?: string): Promise<void> {
  const key = dirPath ?? projectPath
  const existing = dirCache.value[key]

  // Already cached with children — skip
  if (existing && existing.children.length > 0 && !existing.loading) return

  // Set loading state while preserving any previous children
  dirCache.value = {
    ...dirCache.value,
    [key]: { children: existing?.children ?? [], loading: true },
  }

  try {
    const relativePath = dirPath ? toRelative(dirPath, projectPath) : undefined
    const entries: DirEntry[] = await window.stoa.fsReadDir(projectPath, relativePath)

    // Map DirEntry → TreeNode
    const depth = dirPath
      ? (dirPath.slice(projectPath.length).split(/[\\/]/).length - 1)
      : 0
    const children: TreeNode[] = entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
      isDirectory: entry.isDirectory,
      depth,
    }))

    dirCache.value = { ...dirCache.value, [key]: { children, loading: false } }
  } catch (error) {
    console.error('[useFileTree] loadDir failed for', key, error)
    dirCache.value = { ...dirCache.value, [key]: { children: [], loading: false } }
  }
}

function toggleExpand(projectPath: string, dirPath: string): void {
  const next = new Set(expandedDirs.value)
  if (next.has(dirPath)) {
    next.delete(dirPath)
  } else {
    next.add(dirPath)
    // Load children if not cached
    const cached = dirCache.value[dirPath]
    if (!cached || cached.children.length === 0) {
      void loadDir(projectPath, dirPath)
    }
  }
  expandedDirs.value = next
}

function collapseAll(): void {
  expandedDirs.value = new Set()
}

function invalidatePath(dirPath: string): void {
  const cache = { ...dirCache.value }
  delete cache[dirPath]
  for (const key of Object.keys(cache)) {
    if (key === dirPath || key.startsWith(dirPath + '/') || key.startsWith(dirPath + '\\')) {
      delete cache[key]
    }
  }
  dirCache.value = cache
}

export function useFileTree(projectPath: ref<string | null>) {
  const loading = ref(false)

  /**
   * Flatten the directory tree into a renderable list using depth-first traversal.
   * Pattern matches Orca's useFileExplorerTree.flatRows.
   */
  const flatRows = computed<TreeNode[]>(() => {
    const root = projectPath.value
    if (!root) return []

    const result: TreeNode[] = []
    const expanded = expandedDirs.value
    const cache = dirCache.value

    function addChildren(parentPath: string): void {
      const cached = cache[parentPath]
      if (!cached?.children.length) return

      for (const child of cached.children) {
        result.push(child)
        if (child.isDirectory && expanded.has(child.path)) {
          addChildren(child.path)
        }
      }
    }

    addChildren(root)
    return result
  })

  async function refreshTree(): Promise<void> {
    if (!projectPath.value) return
    loading.value = true
    dirCache.value = {}
    expandedDirs.value = new Set()
    await loadDir(projectPath.value)
    loading.value = false
  }

  watch(projectPath, (newPath) => {
    if (newPath) {
      void refreshTree()
    } else {
      dirCache.value = {}
      expandedDirs.value = new Set()
    }
  }, { immediate: true })

  return {
    dirCache,
    expandedDirs,
    flatRows,
    loading,
    loadDir,
    toggleExpand,
    collapseAll,
    invalidatePath,
    refreshTree,
  }
}
