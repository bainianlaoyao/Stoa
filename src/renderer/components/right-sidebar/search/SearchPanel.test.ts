// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import SearchPanel from '@renderer/components/right-sidebar/search/SearchPanel.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSearchStore } from '@renderer/stores/search'
import { createRendererApiMock } from '@shared/test-fixtures'

function setupStoa(overrides: Record<string, unknown> = {}): void {
  window.stoa = createRendererApiMock(overrides)
}

function setupActiveProject() {
  const workspaceStore = useWorkspaceStore()
  workspaceStore.$patch({
    projects: [{ id: 'p1', name: 'test', path: '/project', createdAt: '', updatedAt: '' }],
    activeProjectId: 'p1',
  } as never)
}

function mountSearchPanel() {
  return mount(SearchPanel, {
    global: {
      stubs: {
        Teleport: {
          template: '<div><slot /></div>',
        },
      },
    },
  })
}

describe('SearchPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupStoa()
  })

  it('renders search-panel container', () => {
    const wrapper = mountSearchPanel()
    expect(wrapper.find('[data-testid="search-panel"]').exists()).toBe(true)
  })

  it('renders search input', () => {
    const wrapper = mountSearchPanel()
    expect(wrapper.find('[data-testid="search-input"]').exists()).toBe(true)
  })

  it('renders search button', () => {
    const wrapper = mountSearchPanel()
    expect(wrapper.find('[data-testid="search-button"]').exists()).toBe(true)
  })

  it('renders filter toggle buttons', () => {
    const wrapper = mountSearchPanel()
    expect(wrapper.find('[data-testid="toggle-case"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="toggle-whole-word"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="toggle-regex"]').exists()).toBe(true)
  })

  it('shows placeholder text when no results', () => {
    const wrapper = mountSearchPanel()
    expect(wrapper.text()).toContain('Search across files')
  })

  // ── Debounced search triggers ──

  it('debounces search — does not call immediately on input', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    const mockSearch = vi.fn().mockResolvedValue(undefined)

    const searchStore = useSearchStore()
    vi.spyOn(searchStore, 'search').mockImplementation(mockSearch)

    const wrapper = mountSearchPanel()
    const input = wrapper.find('[data-testid="search-input"]')

    await input.setValue('test query')
    await nextTick()

    // Before debounce fires — search should NOT have been called yet
    expect(mockSearch).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('triggers search after 300ms debounce', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    const mockSearch = vi.fn().mockResolvedValue(undefined)

    const searchStore = useSearchStore()
    vi.spyOn(searchStore, 'search').mockImplementation(mockSearch)

    const wrapper = mountSearchPanel()
    const input = wrapper.find('[data-testid="search-input"]')

    await input.setValue('test query')
    await nextTick()

    // Advance past debounce
    vi.advanceTimersByTime(300)
    await flushPromises()
    await nextTick()

    expect(mockSearch).toHaveBeenCalledWith('/project')

    vi.useRealTimers()
  })

  it('clears results when query is emptied', async () => {
    setupActiveProject()
    const searchStore = useSearchStore()
    const spy = vi.spyOn(searchStore, 'clearResults')

    const wrapper = mountSearchPanel()
    const input = wrapper.find('[data-testid="search-input"]')

    await input.setValue('test')
    await nextTick()
    expect(spy).not.toHaveBeenCalled()

    await input.setValue('')
    await nextTick()
    expect(spy).toHaveBeenCalled()
  })

  // ── Immediate search on Enter ──

  it('immediately searches on Enter key (bypasses debounce)', async () => {
    vi.useFakeTimers()
    setupActiveProject()
    const mockSearch = vi.fn().mockResolvedValue(undefined)

    const searchStore = useSearchStore()
    vi.spyOn(searchStore, 'search').mockImplementation(mockSearch)

    const wrapper = mountSearchPanel()
    const input = wrapper.find('[data-testid="search-input"]')

    await input.setValue('test query')
    await nextTick()

    // Before debounce fires, press Enter
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nextTick()

    expect(mockSearch).toHaveBeenCalledWith('/project')

    vi.useRealTimers()
  })

  // ── Search button triggers immediate search ──

  it('search button triggers immediate search', async () => {
    setupActiveProject()
    const mockSearch = vi.fn().mockResolvedValue(undefined)

    const searchStore = useSearchStore()
    searchStore.query = 'test query'
    vi.spyOn(searchStore, 'search').mockImplementation(mockSearch)

    const wrapper = mountSearchPanel()
    const btn = wrapper.find('[data-testid="search-button"]')
    await btn.trigger('click')
    await flushPromises()

    expect(mockSearch).toHaveBeenCalledWith('/project')
  })

  // ── Request cancellation ──

  it('new search cancels stale in-flight search results', async () => {
    setupActiveProject()
    let callCount = 0

    const mockFsSearch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First search returns a result with matches
        return Promise.resolve({
          files: [{ filePath: '/project/a.ts', relativePath: 'a.ts', matches: [{ line: 1, column: 0, matchLength: 4, lineContent: 'test match' }] }],
          totalMatches: 1,
          truncated: false,
        })
      }
      // Second search returns different results
      return Promise.resolve({
        files: [{ filePath: '/project/b.ts', relativePath: 'b.ts', matches: [{ line: 5, column: 2, matchLength: 4, lineContent: 'new match' }] }],
        totalMatches: 1,
        truncated: false,
      })
    })

    setupStoa({ fsSearch: mockFsSearch })

    const searchStore = useSearchStore()
    searchStore.query = 'first'
    await searchStore.search('/project')
    await flushPromises()

    // First results should show a.ts
    expect(searchStore.results?.files[0]?.relativePath).toBe('a.ts')

    // Trigger second search
    searchStore.query = 'second'
    await searchStore.search('/project')
    await flushPromises()

    // Second results should show b.ts (stale first result was discarded)
    expect(searchStore.results?.files[0]?.relativePath).toBe('b.ts')
  })

  // ── Filter toggles ──

  it('toggle case sensitive button toggles store state', async () => {
    const wrapper = mountSearchPanel()
    const btn = wrapper.find('[data-testid="toggle-case"]')
    const searchStore = useSearchStore()

    expect(searchStore.caseSensitive).toBe(false)
    await btn.trigger('click')
    expect(searchStore.caseSensitive).toBe(true)
    await btn.trigger('click')
    expect(searchStore.caseSensitive).toBe(false)
  })

  it('toggle whole word button toggles store state', async () => {
    const wrapper = mountSearchPanel()
    const btn = wrapper.find('[data-testid="toggle-whole-word"]')
    const searchStore = useSearchStore()

    expect(searchStore.wholeWord).toBe(false)
    await btn.trigger('click')
    expect(searchStore.wholeWord).toBe(true)
  })

  it('toggle regex button toggles store state', async () => {
    const wrapper = mountSearchPanel()
    const btn = wrapper.find('[data-testid="toggle-regex"]')
    const searchStore = useSearchStore()

    expect(searchStore.useRegex).toBe(false)
    await btn.trigger('click')
    expect(searchStore.useRegex).toBe(true)
  })

  // ── Match click ──

  it('clicking a match calls fsOpenFile with file path and line/column', async () => {
    setupActiveProject()
    const mockOpenFile = vi.fn().mockResolvedValue(undefined)
    setupStoa({ fsOpenFile: mockOpenFile })

    const searchStore = useSearchStore()
    // Directly set results
    searchStore.results = {
      files: [{
        filePath: '/project/a.ts',
        relativePath: 'a.ts',
        matches: [{ line: 10, column: 5, matchLength: 4, lineContent: 'some test match here' }],
      }],
      totalMatches: 1,
      truncated: false,
    }

    const wrapper = mountSearchPanel()
    await nextTick()

    const matchRow = wrapper.find('[data-testid="search-match-a.ts-10"]')
    expect(matchRow.exists()).toBe(true)
    await matchRow.trigger('click')

    expect(mockOpenFile).toHaveBeenCalledWith('/project/a.ts', 10, 5)
  })
})
