// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

// Dynamic import to get a fresh composable per test (module-level registry)
let useSidebarPanels: typeof import('@renderer/composables/useSidebarPanels').useSidebarPanels

describe('useSidebarPanels', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const mod = await import('@renderer/composables/useSidebarPanels')
    useSidebarPanels = mod.useSidebarPanels
  })

  // ── Default panel registration ──

  it('registers 3 default panels (explorer, search, git)', () => {
    const { panels } = useSidebarPanels()
    const ids = panels.value.map((p) => p.id)
    expect(ids).toContain('explorer')
    expect(ids).toContain('search')
    expect(ids).toContain('git')
    expect(ids).toHaveLength(3)
  })

  it('default panels have correct metadata', () => {
    const { getPanel } = useSidebarPanels()

    const explorer = getPanel('explorer')
    expect(explorer).toBeDefined()
    expect(explorer!.icon).toBe('folder')
    expect(explorer!.label).toBe('Explorer')
    expect(explorer!.shortcut).toBe('Ctrl+Shift+E')
    expect(explorer!.gitOnly).toBeUndefined()

    const search = getPanel('search')
    expect(search).toBeDefined()
    expect(search!.icon).toBe('search')
    expect(search!.label).toBe('Search')
    expect(search!.shortcut).toBe('Ctrl+Shift+F')
    expect(search!.gitOnly).toBeUndefined()

    const git = getPanel('git')
    expect(git).toBeDefined()
    expect(git!.icon).toBe('source-control')
    expect(git!.label).toBe('Git')
    expect(git!.shortcut).toBe('Ctrl+Shift+G')
    expect(git!.gitOnly).toBe(true)
  })

  // ── getPanel ──

  it('getPanel returns undefined for unknown id', () => {
    const { getPanel } = useSidebarPanels()
    expect(getPanel('nonexistent')).toBeUndefined()
  })

  it('getPanel returns correct panel by id', () => {
    const { getPanel } = useSidebarPanels()
    const panel = getPanel('explorer')
    expect(panel?.id).toBe('explorer')
  })

  // ── visiblePanels filtering ──

  it('visiblePanels hides gitOnly panels when no active project', () => {
    const { visiblePanels } = useSidebarPanels()
    const ids = visiblePanels.value.map((p) => p.id)
    expect(ids).toContain('explorer')
    expect(ids).toContain('search')
    expect(ids).not.toContain('git')
    expect(ids).toHaveLength(2)
  })

  it('visiblePanels shows all panels when active project exists', () => {
    const workspaceStore = useWorkspaceStore()
    workspaceStore.$patch({
      projects: [{ id: 'p1', name: 'test', path: '/test', createdAt: '', updatedAt: '' }],
      activeProjectId: 'p1',
    } as never)

    const { visiblePanels } = useSidebarPanels()
    const ids = visiblePanels.value.map((p) => p.id)
    expect(ids).toContain('explorer')
    expect(ids).toContain('search')
    expect(ids).toContain('git')
    expect(ids).toHaveLength(3)
  })

  // ── registerPanel / unregisterPanel ──

  it('registerPanel adds a new panel to the registry', () => {
    const { registerPanel, panels } = useSidebarPanels()
    const Dummy = defineComponent({ render: () => h('div') })

    registerPanel({
      id: 'custom',
      icon: 'test',
      label: 'Custom',
      component: Dummy,
    })

    const ids = panels.value.map((p) => p.id)
    expect(ids).toContain('custom')
  })

  it('registerPanel replaces existing panel with same id', () => {
    const { registerPanel, getPanel } = useSidebarPanels()
    const Dummy = defineComponent({ render: () => h('div') })

    registerPanel({
      id: 'explorer',
      icon: 'new-icon',
      label: 'New Explorer',
      component: Dummy,
    })

    const panel = getPanel('explorer')
    expect(panel?.label).toBe('New Explorer')
    expect(panel?.icon).toBe('new-icon')
  })

  it('unregisterPanel removes panel from registry', () => {
    const { unregisterPanel, panels } = useSidebarPanels()
    unregisterPanel('git')

    const ids = panels.value.map((p) => p.id)
    expect(ids).not.toContain('git')
  })

  it('unregisterPanel does nothing for unknown id', () => {
    const { unregisterPanel, panels } = useSidebarPanels()
    const beforeCount = panels.value.length
    unregisterPanel('nonexistent')
    expect(panels.value).toHaveLength(beforeCount)
  })
})
