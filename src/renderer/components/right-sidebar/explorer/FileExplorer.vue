<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useFileTree } from '@renderer/composables/useFileTree'
import { useFileOperations } from '@renderer/composables/useFileOperations'
import type { TreeNode } from '@renderer/composables/useFileTree'

const sidebarStore = useSidebarStore()
const { selectedProjectPath } = storeToRefs(sidebarStore)

const projectPath = toRef(sidebarStore, 'selectedProjectPath')
const { flatRows, loading, toggleExpand, collapseAll, invalidatePath, refreshTree, expandedDirs } = useFileTree(projectPath)
const { inlineInput, startCreateFile, startCreateFolder, startRename, cancelInput, commitInput, deleteEntry } = useFileOperations(projectPath, invalidatePath)

const contextMenu = ref<{ x: number; y: number; target: { path: string; name: string; isDirectory: boolean; parentPath: string; depth: number } } | null>(null)

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

function handleRowClick(node: TreeNode): void {
  if (node.isDirectory && projectPath.value) {
    toggleExpand(projectPath.value, node.path)
  }
}

function showContextMenu(e: MouseEvent, node: TreeNode): void {
  e.preventDefault()
  e.stopPropagation()
  const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    target: { path: node.path, name: node.name, isDirectory: node.isDirectory, parentPath, depth: node.depth },
  }
}

function showBackgroundMenu(e: MouseEvent): void {
  e.preventDefault()
  if (!projectPath.value) return
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    target: { path: projectPath.value, name: '', isDirectory: true, parentPath: '', depth: -1 },
  }
}

function closeContextMenu(): void {
  contextMenu.value = null
}

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
      Select a project to browse files
    </div>

    <div v-else-if="loading" class="flex items-center justify-center flex-1" style="color: var(--color-muted); font-size: var(--text-body-sm);">
      Loading...
    </div>

    <div v-else class="flex-1 overflow-y-auto min-h-0" style="scrollbar-width: thin;">
      <div v-for="(row, i) in displayRows" :key="i">
        <template v-if="row.kind === 'node'">
          <div
            class="flex items-center gap-1 px-2 cursor-pointer select-none transition-colors"
            style="height: 28px;"
            :style="{ paddingLeft: (row.node.depth * 16 + 8) + 'px' }"
            :data-testid="`file-row-${row.node.relativePath}`"
            @click="handleRowClick(row.node)"
            @contextmenu="showContextMenu($event, row.node)"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <svg
              v-if="row.node.isDirectory"
              class="w-3.5 h-3.5 shrink-0 transition-transform"
              :class="{ 'rotate-90': expandedDirs.has(row.node.path) }"
              style="color: var(--color-subtle);"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            ><path d="m9 18 6-6-6-6" /></svg>
            <span v-else class="inline-block w-3.5 shrink-0" />

            <svg
              v-if="row.node.isDirectory"
              class="w-4 h-4 shrink-0"
              style="color: var(--color-warning);"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h3.2l1.6 1.6h6.2a1.75 1.75 0 0 1 1.75 1.75v7.65a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 4.75 16.5V7.25Z" /></svg>
            <svg
              v-else
              class="w-4 h-4 shrink-0"
              style="color: var(--color-muted);"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M14.5 3.5H6.75A1.75 1.75 0 0 0 5 5.25v13.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 19 18.75V8L14.5 3.5Z" /><path d="M14 3.5v4h4" /></svg>

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

    <Teleport to="body">
      <div v-if="contextMenu" class="fixed inset-0 z-50" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu">
        <div
          class="fixed py-1 min-w-[160px]"
          :style="{
            background: 'var(--color-surface-solid)',
            border: '1px solid var(--color-line)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-soft)',
            left: contextMenu.x + 'px',
            top: contextMenu.y + 'px',
          }"
        >
          <template v-if="contextMenu.target.isDirectory">
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="startCreateFile(contextMenu!.target.path, contextMenu!.target.depth + 1); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >New File</button>
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="startCreateFolder(contextMenu!.target.path, contextMenu!.target.depth + 1); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >New Folder</button>
          </template>
          <template v-if="contextMenu.target.name">
            <div v-if="contextMenu.target.isDirectory" class="my-1" style="border-top: 1px solid var(--color-line);" />
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="startRename(contextMenu!.target.path, contextMenu!.target.name, contextMenu!.target.depth); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Rename</button>
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-error); background: transparent; border: none;"
              @click="deleteEntry(contextMenu!.target.path, contextMenu!.target.parentPath); closeContextMenu()"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Delete</button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>
