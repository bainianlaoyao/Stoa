// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createRendererApiMock } from '@shared/test-fixtures'

function setupStoa(overrides: Record<string, unknown> = {}): void {
  window.stoa = createRendererApiMock(overrides)
}

// Dynamic import to ensure git store gets a fresh module
let useGitStatusPolling: typeof import('@renderer/composables/useGitStatusPolling').useGitStatusPolling

describe('useGitStatusPolling', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    setupStoa()
    const mod = await import('@renderer/composables/useGitStatusPolling')
    useGitStatusPolling = mod.useGitStatusPolling
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function mountWithPolling(projectPathRef: Ref<string | null | undefined>) {
    const Wrapper = defineComponent({
      setup() {
        const result = useGitStatusPolling(projectPathRef)
        return () => h('div', { 'data-testid': 'host' })
      },
    })
    return mount(Wrapper)
  }

  // ── Initial fetch on mount ──

  it('triggers initial fetch on mount when projectPath is non-empty', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('/project-alpha')
    mountWithPolling(projectPath)

    // Flush microtasks from onMounted
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    expect(spy).toHaveBeenCalledWith('/project-alpha')
  })

  it('does not fetch when projectPath is empty on mount', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('')
    mountWithPolling(projectPath)

    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    // refreshAll is called by startPolling -> refresh(), but refresh() returns early
    // when projectPath is empty. So refreshAll should NOT be called.
    expect(spy).not.toHaveBeenCalled()
  })

  // ── Polling interval ──

  it('polls at the configured interval (30s)', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('/project-alpha')
    mountWithPolling(projectPath)

    // Flush onMounted microtasks without advancing timers
    await nextTick()
    await nextTick()

    // Initial call from startPolling -> void refresh()
    expect(spy).toHaveBeenCalledTimes(1)

    // Advance by 30s for the next poll
    vi.advanceTimersByTime(30_000)
    await nextTick()

    expect(spy).toHaveBeenCalledTimes(2)

    // Advance another 30s
    vi.advanceTimersByTime(30_000)
    await nextTick()

    expect(spy).toHaveBeenCalledTimes(3)
  })

  // ── Project path change triggers refresh ──

  it('re-fetches immediately when projectPath changes', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('/project-alpha')
    mountWithPolling(projectPath)

    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    expect(spy).toHaveBeenCalledWith('/project-alpha')

    // Change project path
    projectPath.value = '/project-beta'
    await nextTick()
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    expect(spy).toHaveBeenCalledWith('/project-beta')
  })

  // ── Visibility change pauses/resumes ──

  it('stops polling when document becomes hidden', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('/project-alpha')
    mountWithPolling(projectPath)

    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    const initialCalls = spy.mock.calls.length

    // Simulate document becoming hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    // Advance timers — should NOT trigger additional fetches while hidden
    vi.advanceTimersByTime(60_000)
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    expect(spy.mock.calls.length).toBe(initialCalls)

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('resumes polling when document becomes visible', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('/project-alpha')
    mountWithPolling(projectPath)

    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    // Hide
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    vi.advanceTimersByTime(60_000)
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    const callsWhileHidden = spy.mock.calls.length

    // Become visible again
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    // Should have triggered a fresh fetch on becoming visible
    expect(spy.mock.calls.length).toBeGreaterThan(callsWhileHidden)
  })

  // ── Cleanup on unmount ──

  it('stops polling on unmount', async () => {
    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    const spy = vi.spyOn(gitStore, 'refreshAll').mockResolvedValue(undefined)

    const projectPath = ref('/project-alpha')
    const wrapper = mountWithPolling(projectPath)

    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    const callsBeforeUnmount = spy.mock.calls.length

    wrapper.unmount()

    vi.advanceTimersByTime(60_000)
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    // No additional calls after unmount
    expect(spy.mock.calls.length).toBe(callsBeforeUnmount)
  })

  // ── Refreshing state ──

  it('exposes refreshing ref that is true during fetch', async () => {
    let resolveRefresh!: () => void
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })

    const { useGitStore } = await import('@renderer/stores/git')
    const gitStore = useGitStore()
    vi.spyOn(gitStore, 'refreshAll').mockImplementation(() => refreshPromise)

    const projectPath = ref('/project-alpha')

    let refreshingRef: ReturnType<typeof useGitStatusPolling>['refreshing']

    const Wrapper = defineComponent({
      setup() {
        const result = useGitStatusPolling(projectPath)
        refreshingRef = result.refreshing
        return () => h('div')
      },
    })

    mount(Wrapper)
    await nextTick()

    // Wait for the refresh to actually start
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    // refreshing should be true while the promise is pending
    expect(refreshingRef!.value).toBe(true)

    resolveRefresh()
    await nextTick()

    expect(refreshingRef!.value).toBe(false)
  })
})
