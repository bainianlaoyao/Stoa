import { ref, computed, watch } from 'vue'
import type { DirEntry } from '@shared/sidebar-types'

export interface TreeNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  depth: number
}

const dirCache = ref<Record<string, { children: DirEntry[]; loading: boolean }>>({})
const expandedDirs = ref<Set<string>>(new Set())

async function loadDir(projectPath: string, dirPath?: string): Promise<void> {
  const key = dirPath ?? projectPath
  if (dirCache.value[key]?.loading) return

  dirCache.value = { ...dirCache.value, [key]: { children: [], loading: true } }

  try {
    const children = await window.stoa.fsReadDir(projectPath, dirPath ? dirPath.slice(projectPath.length + 1) : undefined)
    dirCache.value = { ...dirCache.value, [key]: { children, loading: false } }
  } catch {
    dirCache.value = { ...dirCache.value, [key]: { children: [], loading: false } }
  }
}

function toggleExpand(projectPath: string, dirPath: string): void {
  const next = new Set(expandedDirs.value)
  if (next.has(dirPath)) {
    next.delete(dirPath)
  } else {
    next.add(dirPath)
    void loadDir(projectPath, dirPath)
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
    if (key.startsWith(dirPath + '/') || key.startsWith(dirPath + '\\')) {
      delete cache[key]
    }
  }
  dirCache.value = cache
}

export function useFileTree(projectPath: ref<string | null>) {
  const loading = ref(false)

  const flatRows = computed<TreeNode[]>(() => {
    const root = projectPath.value
    if (!root) return []

    const rows: TreeNode[] = []
    const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]

    while (queue.length > 0) {
      const { path: dirPath, depth } = queue.shift()!
      const cached = dirCache.value[dirPath]
      if (!cached) continue

      for (const child of cached.children) {
        const node: TreeNode = {
          name: child.name,
          path: child.path,
          relativePath: child.relativePath,
          isDirectory: child.isDirectory,
          depth,
        }
        rows.push(node)

        if (child.isDirectory && expandedDirs.value.has(child.path)) {
          queue.push({ path: child.path, depth: depth + 1 })
        }
      }
    }

    return rows
  })

  async function refreshTree(): Promise<void> {
    if (!projectPath.value) return
    const root = projectPath.value
    loading.value = true

    dirCache.value = {}
    expandedDirs.value = new Set()

    await loadDir(root)
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
