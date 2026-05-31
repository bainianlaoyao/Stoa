<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useFileTree } from '@renderer/composables/useFileTree'
import { useFileOperations } from '@renderer/composables/useFileOperations'
import type { TreeNode } from '@renderer/composables/useFileTree'

const workspaceStore = useWorkspaceStore()
const sidebarStore = useSidebarStore()
const selectedProjectPath = computed(() => workspaceStore.activeProject?.path ?? null)

const projectPath = selectedProjectPath
const { flatRows, loading, toggleExpand, collapseAll, invalidatePath, refreshTree, expandedDirs, loadDir } = useFileTree(projectPath)
const { inlineInput, startCreateFile, startCreateFolder, startRename, cancelInput, commitInput, deleteEntry } = useFileOperations(projectPath, invalidatePath)

// ── Context menu state ──
const contextMenu = ref<{
  x: number
  y: number
  target: { path: string; name: string; isDirectory: boolean; parentPath: string; depth: number; relativePath: string }
} | null>(null)

type DisplayRow = { kind: 'node'; node: TreeNode } | { kind: 'input'; parentDepth: number }

const displayRows = computed<DisplayRow[]>(() => {
  const rows: DisplayRow[] = []
  let lastDirPath: string | null = null

  for (const node of flatRows.value) {
    if (inlineInput.value && node.isDirectory && node.path === inlineInput.value.parentPath) {
      rows.push({ kind: 'node', node })
      rows.push({ kind: 'input', parentDepth: node.depth + 1 })
      lastDirPath = node.path
      continue
    }
    rows.push({ kind: 'node', node })
    lastDirPath = null
  }

  if (inlineInput.value && flatRows.value.length === 0 && projectPath.value) {
    rows.push({ kind: 'input', parentDepth: 0 })
  }

  return rows
})

// Visible node rows only (for keyboard navigation)
const visibleNodes = computed<TreeNode[]>(() =>
  displayRows.value
    .filter((r): r is DisplayRow & { kind: 'node' } => r.kind === 'node')
    .map((r) => r.node),
)

// ── 1. Click handling: immediate expand for dirs, dblclick for files ──
const clickTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const lastClickPath = ref<string | null>(null)
const DOUBLE_CLICK_MS = 300

function openFile(node: TreeNode): void {
  if (node.isDirectory || !projectPath.value) return
  void window.stoa.fsOpenFile(node.path)
}

function handleRowClick(node: TreeNode): void {
  focusedPath.value = node.path

  // Directories: expand/collapse immediately on every click
  if (node.isDirectory && projectPath.value) {
    // Cancel any pending file double-click timer
    if (clickTimer.value !== null) {
      clearTimeout(clickTimer.value)
      clickTimer.value = null
    }
    lastClickPath.value = null
    toggleExpand(projectPath.value, node.path)
    return
  }

  // Files: single click selects, double click opens
  if (clickTimer.value !== null && lastClickPath.value === node.path) {
    // Double-click detected on a file
    clearTimeout(clickTimer.value)
    clickTimer.value = null
    lastClickPath.value = null
    openFile(node)
    return
  }

  // Start single-click timer for file selection
  if (clickTimer.value !== null) {
    clearTimeout(clickTimer.value)
  }
  lastClickPath.value = node.path
  clickTimer.value = setTimeout(() => {
    clickTimer.value = null
    lastClickPath.value = null
  }, DOUBLE_CLICK_MS)
}

// ── 2. Keyboard navigation ──
const treeContainerRef = ref<HTMLElement | null>(null)
const focusedPath = ref<string | null>(null)

function handleTreeKeydown(e: KeyboardEvent): void {
  if (inlineInput.value) return
  if (!projectPath.value) return

  const nodes = visibleNodes.value
  if (nodes.length === 0) return

  const currentIdx = focusedPath.value
    ? nodes.findIndex((n) => n.path === focusedPath.value)
    : -1

  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault()
      const nextIdx = currentIdx < nodes.length - 1 ? currentIdx + 1 : currentIdx
      if (nextIdx >= 0) {
        focusedPath.value = nodes[nextIdx].path
        scrollRowIntoView(nodes[nextIdx].path)
      }
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      const prevIdx = currentIdx > 0 ? currentIdx - 1 : 0
      focusedPath.value = nodes[prevIdx].path
      scrollRowIntoView(nodes[prevIdx].path)
      break
    }
    case 'Enter': {
      e.preventDefault()
      const focusedNode = currentIdx >= 0 ? nodes[currentIdx] : null
      if (!focusedNode) break
      if (focusedNode.isDirectory && projectPath.value) {
        toggleExpand(projectPath.value, focusedNode.path)
      } else {
        openFile(focusedNode)
      }
      break
    }
    case 'F2': {
      e.preventDefault()
      const renameNode = currentIdx >= 0 ? nodes[currentIdx] : null
      if (renameNode) {
        startRename(renameNode.path, renameNode.name, renameNode.depth)
      }
      break
    }
    case 'Delete':
    case 'Backspace': {
      // Only act if not in an input element
      if ((e.target as HTMLElement)?.tagName === 'INPUT') break
      e.preventDefault()
      const deleteNode = currentIdx >= 0 ? nodes[currentIdx] : null
      if (deleteNode) {
        const parentPath = deleteNode.path.includes('/')
          ? deleteNode.path.slice(0, deleteNode.path.lastIndexOf('/'))
          : ''
        deleteEntry(deleteNode.path, parentPath)
      }
      break
    }
  }
}

function scrollRowIntoView(path: string): void {
  void nextTick(() => {
    const el = treeContainerRef.value?.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

// ── 3. Extended context menu ──
function showContextMenu(e: MouseEvent, node: TreeNode): void {
  e.preventDefault()
  e.stopPropagation()
  const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    target: {
      path: node.path,
      name: node.name,
      isDirectory: node.isDirectory,
      parentPath,
      depth: node.depth,
      relativePath: node.relativePath,
    },
  }
}

function showBackgroundMenu(e: MouseEvent): void {
  e.preventDefault()
  if (!projectPath.value) return
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    target: {
      path: projectPath.value,
      name: '',
      isDirectory: true,
      parentPath: '',
      depth: -1,
      relativePath: '',
    },
  }
}

function closeContextMenu(): void {
  contextMenu.value = null
}

async function copyAbsolutePath(): Promise<void> {
  if (!contextMenu.value) return
  await navigator.clipboard.writeText(contextMenu.value.target.path)
  closeContextMenu()
}

async function copyRelativePath(): Promise<void> {
  if (!contextMenu.value) return
  await navigator.clipboard.writeText(contextMenu.value.target.relativePath)
  closeContextMenu()
}

function revealInSystemExplorer(): void {
  if (!contextMenu.value) return
  void window.stoa.shellShowItemInFolder(contextMenu.value.target.path)
  closeContextMenu()
}

function findInFolder(): void {
  if (!contextMenu.value || !contextMenu.value.target.isDirectory) return
  sidebarStore.setActiveTab('search')
  closeContextMenu()
}

async function duplicateEntry(): Promise<void> {
  if (!contextMenu.value || !projectPath.value) return
  const target = contextMenu.value.target
  closeContextMenu()

  if (target.isDirectory) return

  const name = target.name
  const dotIndex = name.lastIndexOf('.')
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name
  const ext = dotIndex > 0 ? name.slice(dotIndex) : ''

  const parentRel = target.path.slice(projectPath.value.length + 1)
  const parentDir = parentRel.includes('/') ? parentRel.slice(0, parentRel.lastIndexOf('/')) : ''
  const relativePath = parentDir ? `${parentDir}/${stem} copy${ext}` : `${stem} copy${ext}`

  try {
    await window.stoa.fsCreate({ projectPath: projectPath.value, relativePath })
    invalidatePath(target.parentPath || projectPath.value)
  } catch {
    // Error handled silently
  }
}

// ── 4. Drag and drop ──
const dragSourcePath = ref<string | null>(null)
const dropTargetPath = ref<string | null>(null)
const dragExpandTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const DRAG_EXPAND_DELAY = 500
const DRAG_MIME = 'application/x-stoa-file-path'

function handleDragStart(e: DragEvent, node: TreeNode): void {
  dragSourcePath.value = node.path
  if (e.dataTransfer) {
    e.dataTransfer.setData(DRAG_MIME, node.path)
    e.dataTransfer.effectAllowed = 'move'
  }
}

function handleRowDragOver(e: DragEvent, node: TreeNode): void {
  if (!e.dataTransfer?.types.includes(DRAG_MIME)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

function handleRowDragEnter(e: DragEvent, node: TreeNode): void {
  if (!e.dataTransfer?.types.includes(DRAG_MIME)) return
  e.preventDefault()
  e.stopPropagation()
  if (!node.isDirectory) return
  dropTargetPath.value = node.path

  // Auto-expand directory on hover
  if (dragExpandTimer.value !== null) {
    clearTimeout(dragExpandTimer.value)
  }
  if (!expandedDirs.value.has(node.path) && projectPath.value) {
    dragExpandTimer.value = setTimeout(() => {
      dragExpandTimer.value = null
      if (projectPath.value && !expandedDirs.value.has(node.path)) {
        toggleExpand(projectPath.value, node.path)
      }
    }, DRAG_EXPAND_DELAY)
  }
}

function handleRowDragLeave(e: DragEvent): void {
  e.stopPropagation()
  if (dragExpandTimer.value !== null) {
    clearTimeout(dragExpandTimer.value)
    dragExpandTimer.value = null
  }
  dropTargetPath.value = null
}

async function handleRowDrop(e: DragEvent, node: TreeNode): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  if (dragExpandTimer.value !== null) {
    clearTimeout(dragExpandTimer.value)
    dragExpandTimer.value = null
  }
  dropTargetPath.value = null

  const sourcePath = e.dataTransfer?.getData(DRAG_MIME)
  if (!sourcePath || !projectPath.value) return
  if (!node.isDirectory) return

  // Prevent dropping onto self or into own subtree
  if (sourcePath === node.path || node.path.startsWith(sourcePath + '/') || node.path.startsWith(sourcePath + '\\')) return

  const fileName = sourcePath.includes('/') ? sourcePath.slice(sourcePath.lastIndexOf('/') + 1) : sourcePath.slice(sourcePath.lastIndexOf('\\') + 1)
  const newRelativePath = node.relativePath ? `${node.relativePath}/${fileName}` : fileName
  const oldRelativePath = sourcePath.slice(projectPath.value.length + 1)

  if (oldRelativePath === newRelativePath) return

  try {
    await window.stoa.fsRename({
      projectPath: projectPath.value,
      oldRelativePath,
      newRelativePath,
    })
    const sourceParent = sourcePath.includes('/')
      ? sourcePath.slice(0, sourcePath.lastIndexOf('/'))
      : sourcePath.slice(0, sourcePath.lastIndexOf('\\'))
    invalidatePath(sourceParent)
    invalidatePath(node.path)
  } catch {
    // Error handled silently
  }

  dragSourcePath.value = null
}

function handleDragEnd(): void {
  dragSourcePath.value = null
  dropTargetPath.value = null
  if (dragExpandTimer.value !== null) {
    clearTimeout(dragExpandTimer.value)
    dragExpandTimer.value = null
  }
}

// ── 5. File type icons ──
type FileIconKind = 'file-code' | 'file-data' | 'file-text' | 'file-image' | 'file'

function getFileIcon(name: string): FileIconKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, FileIconKind> = {
    ts: 'file-code', tsx: 'file-code', js: 'file-code', jsx: 'file-code',
    vue: 'file-code', css: 'file-code', scss: 'file-code', html: 'file-code',
    json: 'file-data', yaml: 'file-data', yml: 'file-data', toml: 'file-data',
    md: 'file-text', txt: 'file-text',
    png: 'file-image', jpg: 'file-image', svg: 'file-image', gif: 'file-image',
  }
  return map[ext] ?? 'file'
}

// SVG path data for each file icon variant
const FILE_ICON_PATHS: Record<FileIconKind, string> = {
  'file-code': 'M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z M14 3.5v4h4 M8 16l2-2-2-2 M12 14h3',
  'file-data': 'M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z M14 3.5v4h4 M8 10h3 M8 13h5 M8 16h4',
  'file-text': 'M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z M14 3.5v4h4 M8 12h8 M8 15h5',
  'file-image': 'M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z M14 3.5v4h4 M9.5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z M7 17l3-3 2 2 3-4 3 5H7Z',
  'file': 'M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z M14 3.5v4h4',
}

// ── 6. Reveal-in-explorer support ──
const flashingPath = ref<string | null>(null)
let flashTimeout: ReturnType<typeof setTimeout> | null = null

watch(
  () => sidebarStore.pendingRevealPath,
  async (revealPath) => {
    if (!revealPath || !projectPath.value) return

    // Compute ancestor dirs between project root and target
    const relative = revealPath.startsWith(projectPath.value + '/')
      ? revealPath.slice(projectPath.value.length + 1)
      : ''
    if (!relative) return

    const segments = relative.split('/')
    const ancestors: string[] = []
    let current = projectPath.value
    for (let i = 0; i < segments.length - 1; i++) {
      current = current + '/' + segments[i]
      ancestors.push(current)
    }

    // Expand all ancestors (depth-first)
    for (const dirPath of ancestors) {
      if (!expandedDirs.value.has(dirPath)) {
        expandedDirs.value = new Set([...expandedDirs.value, dirPath])
        await loadDir(projectPath.value, dirPath)
      }
    }

    // Wait for tree to update
    await nextTick()

    // Scroll and flash
    focusedPath.value = revealPath
    flashingPath.value = revealPath

    if (flashTimeout !== null) {
      clearTimeout(flashTimeout)
    }
    flashTimeout = setTimeout(() => {
      flashingPath.value = null
      flashTimeout = null
    }, 2000)

    await nextTick()
    scrollRowIntoView(revealPath)

    sidebarStore.clearPendingReveal()
  },
)

onBeforeUnmount(() => {
  if (clickTimer.value !== null) clearTimeout(clickTimer.value)
  if (dragExpandTimer.value !== null) clearTimeout(dragExpandTimer.value)
  if (flashTimeout !== null) clearTimeout(flashTimeout)
})

// ── Inline input helpers ──
function handleInputKeydown(e: KeyboardEvent): void {
  const input = e.target as HTMLInputElement
  if (e.key === 'Enter') {
    void commitInput(input.value)
  } else if (e.key === 'Escape') {
    cancelInput()
  }
}

function handleInputBlur(): void {
  cancelInput()
}
</script>

<template>
  <div class="flex flex-col h-full" data-testid="file-explorer" @contextmenu="showBackgroundMenu">
    <div class="flex items-center gap-0.5 px-2 py-1.5 border-b" style="border-color: var(--color-line);">
      <button
        type="button"
        class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors"
        style="background: transparent; color: var(--color-muted);"
        data-testid="toolbar-new-file"
        title="New File"
        @click="startCreateFile(selectedProjectPath ?? '', 0)"
        @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
        @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z" /><path d="M14 3.5v4h4" /><path d="M12 12v4" /><path d="M10 14h4" /></svg>
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors"
        style="background: transparent; color: var(--color-muted);"
        data-testid="toolbar-new-folder"
        title="New Folder"
        @click="startCreateFolder(selectedProjectPath ?? '', 0)"
        @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
        @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h3.2l1.6 1.6h6.2a1.75 1.75 0 0 1 1.75 1.75v7.65a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 4.75 16.5V7.25Z" /><path d="M12 11v4" /><path d="M10 13h4" /></svg>
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors"
        style="background: transparent; color: var(--color-muted);"
        data-testid="toolbar-collapse"
        title="Collapse All"
        @click="collapseAll"
        @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
        @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5" /><path d="m7 4 5 5 5-5" /></svg>
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors ml-auto"
        style="background: transparent; color: var(--color-muted);"
        data-testid="toolbar-refresh"
        title="Refresh"
        @click="refreshTree"
        @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
        @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
      </button>
    </div>

    <div v-if="!selectedProjectPath" class="flex items-center justify-center flex-1" style="color: var(--color-muted); font-size: var(--text-body-sm);">
      No active project
    </div>

    <div v-else-if="loading" class="flex items-center justify-center flex-1" style="color: var(--color-muted); font-size: var(--text-body-sm);">
      Loading...
    </div>

    <div
      v-else
      ref="treeContainerRef"
      tabindex="0"
      class="flex-1 overflow-y-auto min-h-0 outline-none"
      style="scrollbar-width: thin;"
      data-testid="file-tree-container"
      @keydown="handleTreeKeydown"
    >
      <div v-for="(row, i) in displayRows" :key="i">
        <template v-if="row.kind === 'node'">
          <div
            class="flex items-center gap-1 px-2 cursor-pointer select-none transition-colors"
            :class="{
              'explorer-row-focused': focusedPath === row.node.path,
              'explorer-row-flash': flashingPath === row.node.path,
              'explorer-row-drop-target': dropTargetPath === row.node.path && row.node.isDirectory,
            }"
            style="height: 28px;"
            :style="{ paddingLeft: (row.node.depth * 16 + 8) + 'px' }"
            :data-testid="`file-row-${row.node.relativePath}`"
            :data-path="row.node.path"
            draggable="true"
            @click="handleRowClick(row.node)"
            @contextmenu="showContextMenu($event, row.node)"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = focusedPath === row.node.path ? '' : 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            @dragstart="handleDragStart($event, row.node)"
            @dragover="handleRowDragOver($event, row.node)"
            @dragenter="handleRowDragEnter($event, row.node)"
            @dragleave="handleRowDragLeave($event)"
            @drop="handleRowDrop($event, row.node)"
            @dragend="handleDragEnd"
          >
            <!-- Expansion chevron -->
            <svg
              v-if="row.node.isDirectory"
              class="w-3.5 h-3.5 shrink-0 transition-transform"
              :class="{ 'rotate-90': expandedDirs.has(row.node.path) }"
              style="color: var(--color-subtle);"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            ><path d="m9 18 6-6-6-6" /></svg>
            <span v-else class="inline-block w-3.5 shrink-0" />

            <!-- Folder icon -->
            <svg
              v-if="row.node.isDirectory"
              class="w-4 h-4 shrink-0"
              style="color: var(--color-warning);"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h3.2l1.6 1.6h6.2a1.75 1.75 0 0 1 1.75 1.75v7.65a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 4.75 16.5V7.25Z" /></svg>

            <!-- File type icon -->
            <svg
              v-else
              class="w-4 h-4 shrink-0"
              :style="{ color: getFileIcon(row.node.name) === 'file-code' ? 'var(--color-accent)' : getFileIcon(row.node.name) === 'file-data' ? 'var(--color-success, #22c55e)' : getFileIcon(row.node.name) === 'file-image' ? 'var(--color-warning)' : 'var(--color-muted)' }"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><template v-for="(pathData, idx) in FILE_ICON_PATHS[getFileIcon(row.node.name)].split(' M')" :key="idx"><path :d="idx === 0 ? pathData : 'M' + pathData" /></template></svg>

            <span class="truncate" style="font-size: var(--text-body-sm); color: var(--color-text);">{{ row.node.name }}</span>
          </div>
        </template>

        <div
          v-else
          class="flex items-center px-2"
          style="height: 28px;"
          :style="{ paddingLeft: (row.parentDepth * 16 + 28) + 'px' }"
        >
          <input
            type="text"
            class="flex-1 min-w-0 px-1 border outline-none"
            style="height: 22px; font-size: var(--text-body-sm); font-family: var(--font-ui); border-color: var(--color-accent); border-radius: 2px; background: var(--color-surface-solid); color: var(--color-text-strong);"
            :value="inlineInput?.existingName ?? ''"
            autofocus
            @keydown="handleInputKeydown"
            @blur="handleInputBlur"
          />
        </div>
      </div>

      <div v-if="flatRows.length === 0 && !inlineInput" class="flex items-center justify-center py-8" style="color: var(--color-muted); font-size: var(--text-body-sm);">
        Empty directory
      </div>
    </div>

    <!-- ── Context Menu ── -->
    <Teleport to="body">
      <div v-if="contextMenu" class="fixed inset-0 z-50" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu">
        <div
          class="fixed py-1 min-w-[180px]"
          :style="{
            background: 'var(--color-surface-solid)',
            border: '1px solid var(--color-line)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-soft)',
            left: contextMenu.x + 'px',
            top: contextMenu.y + 'px',
          }"
        >
          <!-- New file / folder (on directories or background) -->
          <template v-if="contextMenu.target.isDirectory">
            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="startCreateFile(contextMenu!.target.path, contextMenu!.target.depth + 1); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >New File</button>
            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="startCreateFolder(contextMenu!.target.path, contextMenu!.target.depth + 1); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >New Folder</button>
          </template>

          <!-- Item-specific actions -->
          <template v-if="contextMenu.target.name">
            <div class="my-1" style="border-top: 1px solid var(--color-line);" />

            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="startRename(contextMenu!.target.path, contextMenu!.target.name, contextMenu!.target.depth); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Rename</button>

            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="duplicateEntry"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Duplicate</button>

            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-error); background: transparent; border: none;"
              @click="deleteEntry(contextMenu!.target.path, contextMenu!.target.parentPath); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Delete</button>

            <div class="my-1" style="border-top: 1px solid var(--color-line);" />

            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="copyAbsolutePath"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Copy Path</button>

            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="copyRelativePath"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Copy Relative Path</button>

            <button
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="revealInSystemExplorer"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Reveal in System Explorer</button>

            <button
              v-if="contextMenu.target.isDirectory"
              type="button"
              class="context-menu-item"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="findInFolder"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Find in Folder</button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.context-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.explorer-row-focused {
  background: var(--color-black-soft) !important;
  outline: 1px solid var(--color-accent);
  outline-offset: -1px;
}

.explorer-row-flash {
  animation: explorer-flash 2s ease-out forwards;
}

@keyframes explorer-flash {
  0% { background: var(--color-accent); }
  100% { background: transparent; }
}

.explorer-row-drop-target {
  background: rgba(59, 130, 246, 0.1) !important;
  outline: 1px dashed var(--color-accent);
  outline-offset: -1px;
}
</style>
