import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SidebarTab, SidebarState } from '@shared/sidebar-types'
import { useWorkspaceStore } from './workspaces'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 220
const MAX_WIDTH = 800

export const useSidebarStore = defineStore('sidebar', () => {
  const workspaceStore = useWorkspaceStore()

  const open = ref(false)
  const activeTab = ref<SidebarTab>('explorer')
  const width = ref(DEFAULT_WIDTH)
  const selectedProjectId = ref<string | null>(null)

  const selectedProject = computed(() => {
    if (!selectedProjectId.value) return null
    return workspaceStore.projects.find(p => p.id === selectedProjectId.value) ?? null
  })

  const selectedProjectPath = computed(() => selectedProject.value?.path ?? null)

  function setOpen(value: boolean): void {
    open.value = value
    void persistState()
  }

  function toggle(): void {
    setOpen(!open.value)
  }

  function setActiveTab(tab: SidebarTab): void {
    activeTab.value = tab
    void persistState()
  }

  function setWidth(newWidth: number): void {
    width.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth))
  }

  function commitWidth(): void {
    void persistState()
  }

  function setSelectedProject(projectId: string | null): void {
    selectedProjectId.value = projectId
    void persistState()
  }

  async function hydrate(): Promise<void> {
    try {
      const state = await window.stoa.getSidebarState()
      if (state) {
        open.value = state.open
        activeTab.value = state.activeTab
        width.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, state.width))
        selectedProjectId.value = state.selectedProjectId
      }
    } catch {
      // Sidebar state is optional — defaults are fine
    }
  }

  async function persistState(): Promise<void> {
    try {
      await window.stoa.setSidebarState({
        open: open.value,
        activeTab: activeTab.value,
        width: width.value,
        selectedProjectId: selectedProjectId.value,
      })
    } catch {
      // Non-critical — sidebar state is ephemeral
    }
  }

  return {
    open,
    activeTab,
    width,
    selectedProjectId,
    selectedProject,
    selectedProjectPath,
    setOpen,
    toggle,
    setActiveTab,
    setWidth,
    commitWidth,
    setSelectedProject,
    hydrate,
  }
})
