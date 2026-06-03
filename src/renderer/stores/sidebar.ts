import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { SidebarTab, SidebarState } from '@shared/sidebar-types'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 220
const MAX_WIDTH = 800

const DEFAULT_SESSION_LIST_WIDTH = 240
const SESSION_LIST_MIN_WIDTH = 160
const SESSION_LIST_MAX_WIDTH = 480

export const useSidebarStore = defineStore('sidebar', () => {
  const open = ref(false)
  const activeTab = ref<SidebarTab>('explorer')
  const width = ref(DEFAULT_WIDTH)
  const sessionListWidth = ref(DEFAULT_SESSION_LIST_WIDTH)

  // ── Per-project tab memory & reveal support ──
  const activeTabByProject = ref<Record<string, string>>({})
  const pendingRevealPath = ref<string | null>(null)

  function setOpen(value: boolean): void {
    open.value = value
    void persistState()
  }

  function toggle(): void {
    setOpen(!open.value)
  }

  function setActiveTab(tab: SidebarTab): void {
    activeTab.value = tab

    // Record the tab for the current project so we can restore on project switch
    const workspaceStore = useWorkspaceStore()
    const projectPath = workspaceStore.activeProject?.path
    if (projectPath) {
      activeTabByProject.value = {
        ...activeTabByProject.value,
        [projectPath]: tab,
      }
    }

    void persistState()
  }

  function setWidth(newWidth: number): void {
    width.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth))
  }

  function commitWidth(): void {
    void persistState()
  }

  function setSessionListWidth(newWidth: number): void {
    sessionListWidth.value = Math.max(SESSION_LIST_MIN_WIDTH, Math.min(SESSION_LIST_MAX_WIDTH, newWidth))
  }

  function commitSessionListWidth(): void {
    void persistState()
  }

  // ── Reveal-in-explorer support ──

  function revealInExplorer(path: string): void {
    open.value = true
    activeTab.value = 'explorer'
    pendingRevealPath.value = path
  }

  function clearPendingReveal(): void {
    pendingRevealPath.value = null
  }

  // ── Per-project tab restore ──

  function restoreProjectTab(projectPath: string): void {
    const remembered = activeTabByProject.value[projectPath]
    if (remembered) {
      activeTab.value = remembered as SidebarTab
    }
  }

  // Watch for active project changes and restore the remembered tab
  const workspaceStore = useWorkspaceStore()
  watch(
    () => workspaceStore.activeProject?.path ?? null,
    (newPath, oldPath) => {
      if (newPath != null && newPath !== oldPath) {
        restoreProjectTab(newPath)
      }
    },
  )

  async function hydrate(): Promise<void> {
    try {
      const state = await window.stoa.getSidebarState()
      if (state) {
        open.value = state.open
        activeTab.value = state.activeTab
        width.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, state.width))
        if (typeof state.sessionListWidth === 'number') {
          sessionListWidth.value = Math.max(SESSION_LIST_MIN_WIDTH, Math.min(SESSION_LIST_MAX_WIDTH, state.sessionListWidth))
        }
        if (state.activeTabByProject && typeof state.activeTabByProject === 'object') {
          activeTabByProject.value = { ...state.activeTabByProject }
        }
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
        sessionListWidth: sessionListWidth.value,
        activeTabByProject: activeTabByProject.value,
      })
    } catch {
      // Non-critical — sidebar state is ephemeral
    }
  }

  return {
    open,
    activeTab,
    width,
    sessionListWidth,
    activeTabByProject,
    pendingRevealPath,
    setOpen,
    toggle,
    setActiveTab,
    setWidth,
    commitWidth,
    setSessionListWidth,
    commitSessionListWidth,
    revealInExplorer,
    clearPendingReveal,
    restoreProjectTab,
    hydrate,
  }
})
