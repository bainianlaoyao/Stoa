import { computed, defineAsyncComponent, markRaw, type Component } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

export interface SidebarPanelDefinition {
  id: string
  icon: string
  label: string
  component: Component
  gitOnly?: boolean
  sshOnly?: boolean
  shortcut?: string
}

// ── Module-level registry ──

const registry: SidebarPanelDefinition[] = []

// ── Default panel registrations ──

registry.push({
  id: 'explorer',
  icon: 'folder',
  label: 'Explorer',
  shortcut: 'Ctrl+Shift+E',
  component: markRaw(
    defineAsyncComponent(() => import('@renderer/components/right-sidebar/explorer/FileExplorer.vue'))
  ),
})

registry.push({
  id: 'search',
  icon: 'search',
  label: 'Search',
  shortcut: 'Ctrl+Shift+F',
  component: markRaw(
    defineAsyncComponent(() => import('@renderer/components/right-sidebar/search/SearchPanel.vue'))
  ),
})

registry.push({
  id: 'git',
  icon: 'source-control',
  label: 'Git',
  shortcut: 'Ctrl+Shift+G',
  gitOnly: true,
  component: markRaw(
    defineAsyncComponent(() => import('@renderer/components/right-sidebar/git/SourceControlPanel.vue'))
  ),
})

// ── Composable ──

export function useSidebarPanels() {
  function registerPanel(def: SidebarPanelDefinition): void {
    const existing = registry.find((p) => p.id === def.id)
    if (existing) {
      const idx = registry.indexOf(existing)
      registry[idx] = { ...def, component: markRaw(def.component) }
    } else {
      registry.push({ ...def, component: markRaw(def.component) })
    }
  }

  function unregisterPanel(id: string): void {
    const idx = registry.findIndex((p) => p.id === id)
    if (idx !== -1) {
      registry.splice(idx, 1)
    }
  }

  function getPanel(id: string): SidebarPanelDefinition | undefined {
    return registry.find((p) => p.id === id)
  }

  const panels = computed(() => [...registry])

  const visiblePanels = computed(() => {
    const workspaceStore = useWorkspaceStore()
    const hasActiveProject = workspaceStore.activeProject !== null

    return registry.filter((panel) => {
      if (panel.gitOnly && !hasActiveProject) {
        return false
      }
      return true
    })
  })

  return {
    registerPanel,
    unregisterPanel,
    getPanel,
    panels,
    visiblePanels,
  }
}
