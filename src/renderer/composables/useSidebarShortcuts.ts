import { onMounted, onUnmounted } from 'vue'
import { useSidebarStore } from '../stores/sidebar'
import type { SidebarTab } from '@shared/sidebar-types'

/**
 * Keyboard shortcuts for sidebar control.
 *
 * - Ctrl/Cmd+B          — toggle sidebar visibility
 * - Ctrl/Cmd+Shift+E    — open sidebar on Explorer tab
 * - Ctrl/Cmd+Shift+F    — open sidebar on Search tab
 * - Ctrl/Cmd+Shift+G    — open sidebar on Source Control tab
 *
 * Intended to be called once in the root App component setup so the
 * listeners live for the entire renderer lifetime.
 */
export function useSidebarShortcuts(): void {
  const store = useSidebarStore()

  function handleKeydown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return

    // Ctrl/Cmd+B — toggle sidebar
    if (e.key === 'b' && !e.shiftKey) {
      e.preventDefault()
      store.toggle()
      return
    }

    // Shift combos use uppercase key
    if (e.key === 'E' && e.shiftKey) {
      e.preventDefault()
      store.setOpen(true)
      store.setActiveTab('explorer' satisfies SidebarTab)
      return
    }

    if (e.key === 'F' && e.shiftKey) {
      e.preventDefault()
      store.setOpen(true)
      store.setActiveTab('search' satisfies SidebarTab)
      return
    }

    if (e.key === 'G' && e.shiftKey) {
      e.preventDefault()
      store.setOpen(true)
      store.setActiveTab('git' satisfies SidebarTab)
      return
    }
  }

  onMounted(() => document.addEventListener('keydown', handleKeydown))
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
}
