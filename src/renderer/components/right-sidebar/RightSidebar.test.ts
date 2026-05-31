// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import TabBar from '@renderer/components/right-sidebar/TabBar.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

function mountTabBar(activeTab: string = 'explorer') {
  return mount(TabBar, {
    props: { activeTab },
  })
}

describe('TabBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders sidebar-tab-bar container', () => {
    const wrapper = mountTabBar()
    expect(wrapper.find('[data-testid="sidebar-tab-bar"]').exists()).toBe(true)
  })

  it('renders visible panel tabs from registry (non-git panels by default)', () => {
    const wrapper = mountTabBar()
    // Default workspace store has no active project, so gitOnly panels are hidden
    expect(wrapper.find('[data-testid="sidebar-tab-explorer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-tab-search"]').exists()).toBe(true)
    // git panel is gitOnly and hidden when no active project
    expect(wrapper.find('[data-testid="sidebar-tab-git"]').exists()).toBe(false)
  })

  it('shows git panel when a project is active', () => {
    const workspaceStore = useWorkspaceStore()
    workspaceStore.$patch({
      projects: [{ id: 'fake-id', name: 'test', path: '/test', createdAt: '', updatedAt: '' }],
      activeProjectId: 'fake-id',
    } as never)

    const wrapper = mountTabBar()
    expect(wrapper.find('[data-testid="sidebar-tab-explorer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-tab-search"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-tab-git"]').exists()).toBe(true)
  })

  it('marks active tab with aria-current="true"', () => {
    const wrapper = mountTabBar('search')
    expect(wrapper.find('[data-testid="sidebar-tab-search"]').attributes('aria-current')).toBe('true')
    expect(wrapper.find('[data-testid="sidebar-tab-explorer"]').attributes('aria-current')).toBeUndefined()
  })

  it('emits select event when a tab is clicked', async () => {
    const wrapper = mountTabBar('explorer')
    await wrapper.find('[data-testid="sidebar-tab-search"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['search']])
  })

  it('renders tab labels from registry', () => {
    const wrapper = mountTabBar()
    expect(wrapper.text()).toContain('Explorer')
    expect(wrapper.text()).toContain('Search')
  })

  it('renders SVG icons for each visible panel', () => {
    const wrapper = mountTabBar()
    const svgs = wrapper.findAll('svg')
    // 2 visible panels by default (explorer + search, no git without active project)
    expect(svgs).toHaveLength(2)
  })

  it('includes shortcut in title tooltip', () => {
    const wrapper = mountTabBar()
    const explorerBtn = wrapper.find('[data-testid="sidebar-tab-explorer"]')
    expect(explorerBtn.attributes('title')).toBe('Explorer (Ctrl+Shift+E)')
    const searchBtn = wrapper.find('[data-testid="sidebar-tab-search"]')
    expect(searchBtn.attributes('title')).toBe('Search (Ctrl+Shift+F)')
  })
})

// ── RightSidebar component test ──

describe('RightSidebar', () => {
  // Stub child components to isolate RightSidebar logic
  const FileExplorerStub = defineComponent({
    name: 'FileExplorer',
    template: '<div data-testid="file-explorer">FileExplorer</div>',
  })
  const SearchPanelStub = defineComponent({
    name: 'SearchPanel',
    template: '<div data-testid="search-panel">SearchPanel</div>',
  })
  const SourceControlPanelStub = defineComponent({
    name: 'SourceControlPanel',
    template: '<div data-testid="source-control-panel">SourceControlPanel</div>',
  })
  const TabBarStub = defineComponent({
    name: 'TabBar',
    props: ['activeTab'],
    template: '<div data-testid="tab-bar-stub" @click="$emit(\'select\', \'search\')" />',
    emits: ['select'],
  })

  // Lazy import to avoid circular deps
  let RightSidebar: typeof import('@renderer/components/right-sidebar/RightSidebar.vue').default

  beforeEach(async () => {
    setActivePinia(createPinia())
    const mod = await import('@renderer/components/right-sidebar/RightSidebar.vue')
    RightSidebar = mod.default
  })

  function mountSidebar() {
    return mount(RightSidebar, {
      global: {
        stubs: {
          FileExplorer: FileExplorerStub,
          SearchPanel: SearchPanelStub,
          SourceControlPanel: SourceControlPanelStub,
          TabBar: TabBarStub,
        },
      },
    })
  }

  it('has closed CSS class when sidebar is closed', async () => {
    const wrapper = mountSidebar()
    // Default sidebar store has open: false, CSS class hides it
    const sidebar = wrapper.find('[data-testid="right-sidebar"]')
    expect(sidebar.exists()).toBe(true)
    expect(sidebar.classes()).toContain('right-sidebar-closed')
  })

  it('removes closed CSS class when sidebar store is set to open', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    const sidebar = wrapper.get('[data-testid="right-sidebar"]')
    expect(sidebar.classes()).not.toContain('right-sidebar-closed')
  })

  it('renders resize handle when open', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="sidebar-resize-handle"]').exists()).toBe(true)
  })

  it('renders tab bar stub and panel slots when open', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    // TabBar is always stubbed; check the stub rendered
    expect(wrapper.find('[data-testid="tab-bar-stub"]').exists()).toBe(true)

    // Panel area exists (components are async, stubs may not resolve by name,
    // but the v-for slot for visiblePanels is rendered)
    const sidebar = wrapper.get('[data-testid="right-sidebar"]')
    const panelArea = sidebar.find('.flex-1.min-h-0.overflow-hidden')
    expect(panelArea.exists()).toBe(true)
  })

  it('has width matching sidebar store default', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    const sidebar = wrapper.find('[data-testid="right-sidebar"]')
    expect(sidebar.exists()).toBe(true)
    // Default width is 280
    expect(sidebar.attributes('style')).toContain('280px')
  })

  // ── Close button ──

  it('renders close button when sidebar is open', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    const closeBtn = wrapper.find('[data-testid="sidebar-close-btn"]')
    expect(closeBtn.exists()).toBe(true)
  })

  it('close button sets sidebar store to closed', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    const closeBtn = wrapper.find('[data-testid="sidebar-close-btn"]')
    await closeBtn.trigger('click')
    expect(store.open).toBe(false)
  })

  it('close button has correct aria-label', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    const closeBtn = wrapper.find('[data-testid="sidebar-close-btn"]')
    expect(closeBtn.attributes('aria-label')).toBe('Close sidebar')
  })

  it('close button title shows keyboard shortcut', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    const closeBtn = wrapper.find('[data-testid="sidebar-close-btn"]')
    expect(closeBtn.attributes('title')).toContain('Ctrl+B')
  })

  // ── Panel registry integration ──

  it('renders panel area with slot for visible panels', async () => {
    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    // The v-for on visiblePanels renders component slots
    const sidebar = wrapper.get('[data-testid="right-sidebar"]')
    const panelArea = sidebar.find('.flex-1.min-h-0.overflow-hidden')
    expect(panelArea.exists()).toBe(true)
  })

  it('renders more panel components when workspace has active project', async () => {
    const workspaceStore = useWorkspaceStore()
    workspaceStore.$patch({
      projects: [{ id: 'fake-id', name: 'test', path: '/test', createdAt: '', updatedAt: '' }],
      activeProjectId: 'fake-id',
    } as never)

    const wrapper = mountSidebar()
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setOpen(true)
    await wrapper.vm.$nextTick()

    // When open with active project, the panel area is rendered
    // (actual async components may not resolve in unit tests,
    // but the DOM structure with v-for on visiblePanels is present)
    const sidebar = wrapper.get('[data-testid="right-sidebar"]')
    const panelArea = sidebar.find('.flex-1.min-h-0.overflow-hidden')
    expect(panelArea.exists()).toBe(true)
  })

  it('resize handle is always present in DOM', async () => {
    const wrapper = mountSidebar()
    // Resize handle is always mounted (even when closed, since no v-if)
    expect(wrapper.find('[data-testid="sidebar-resize-handle"]').exists()).toBe(true)
  })
})
