<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const sidebarStore = useSidebarStore()
const workspaceStore = useWorkspaceStore()
const { selectedProjectId } = storeToRefs(sidebarStore)
const dropdownOpen = ref(false)

const projects = computed(() => workspaceStore.projects)
const selectedProject = computed(() =>
  selectedProjectId.value
    ? projects.value.find(p => p.id === selectedProjectId.value) ?? null
    : null
)

function select(projectId: string): void {
  sidebarStore.setSelectedProject(projectId)
  dropdownOpen.value = false
}

function toggle(): void {
  dropdownOpen.value = !dropdownOpen.value
}
</script>

<template>
  <div
    class="relative px-3 py-2 border-b border-[var(--color-line)]"
    data-testid="worktree-selector"
  >
    <button
      type="button"
      class="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 hover:bg-[var(--color-black-soft)] transition-colors cursor-pointer"
      @click="toggle"
      data-testid="worktree-selector-button"
    >
      <svg class="w-4 h-4 text-[var(--color-muted)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h3.2l1.6 1.6h6.2a1.75 1.75 0 0 1 1.75 1.75v7.65a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 4.75 16.5V7.25Z" /></svg>
      <div class="flex-1 min-w-0">
        <div class="truncate" style="font-size: var(--text-meta); color: var(--color-text-strong);">
          {{ selectedProject?.name ?? 'Select project...' }}
        </div>
        <div v-if="selectedProject" class="text-[10px] truncate" style="color: var(--color-muted); font-family: var(--font-mono);">
          {{ selectedProject.path }}
        </div>
      </div>
      <svg class="w-3.5 h-3.5 shrink-0 transition-transform" :class="{ 'rotate-180': dropdownOpen }" style="color: var(--color-muted);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>

    <div
      v-if="dropdownOpen"
      class="absolute left-2 right-2 top-full mt-1 max-h-60 overflow-y-auto z-20"
      style="background: var(--color-surface-solid); border: 1px solid var(--color-line); border-radius: var(--radius-sm); box-shadow: var(--shadow-soft);"
      data-testid="worktree-selector-dropdown"
    >
      <button
        v-for="project in projects"
        :key="project.id"
        type="button"
        class="flex flex-col w-full text-left px-3 py-2 hover:bg-[var(--color-black-soft)] transition-colors cursor-pointer"
        :class="{ 'bg-[var(--color-active-fill)]': project.id === selectedProjectId }"
        @click="select(project.id)"
      >
        <span style="font-size: var(--text-meta); color: var(--color-text-strong);">{{ project.name }}</span>
        <span class="text-[10px] truncate" style="color: var(--color-muted); font-family: var(--font-mono);">{{ project.path }}</span>
      </button>
      <div v-if="projects.length === 0" class="px-3 py-3" style="font-size: var(--text-meta); color: var(--color-muted);">
        No projects yet
      </div>
    </div>
  </div>
</template>
