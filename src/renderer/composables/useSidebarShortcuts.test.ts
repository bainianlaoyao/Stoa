// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRendererApiMock } from '@shared/test-fixtures'

function setupStoa(): void {
  window.stoa = createRendererApiMock()
}

// We need to test the composable inside a component lifecycle (onMounted/onUnmounted).
// We mount a wrapper component that calls useSidebarShortcuts.
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

// Dynamic import so we get the module fresh
let useSidebarShortcuts: typeof import('@renderer/composables/useSidebarShortcuts').useSidebarShortcuts

describe('useSidebarShortcuts', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    setupStoa()
    const mod = await import('@renderer/composables/useSidebarShortcuts')
    useSidebarShortcuts = mod.useSidebarShortcuts
  })

  function mountWithShortcuts() {
    const Wrapper = defineComponent({
      setup() {
        useSidebarShortcuts()
        return () => h('div', { 'data-testid': 'host' })
      },
    })
    return mount(Wrapper)
  }

  function dispatchKey(key: string, opts: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: opts.ctrlKey ?? false,
      metaKey: opts.metaKey ?? false,
      shiftKey: opts.shiftKey ?? false,
    })
    document.dispatchEvent(event)
    return event
  }

  // ── Ctrl+B toggles sidebar ──

  it('Ctrl+B calls toggle on sidebar store', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    expect(store.open).toBe(false)

    mountWithShortcuts()
    dispatchKey('b', { ctrlKey: true })

    expect(store.open).toBe(true)
  })

  it('Ctrl+B toggles back to closed', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    dispatchKey('b', { ctrlKey: true })
    expect(store.open).toBe(true)

    dispatchKey('b', { ctrlKey: true })
    expect(store.open).toBe(false)
  })

  // ── Ctrl+Shift+E opens explorer ──

  it('Ctrl+Shift+E opens sidebar on explorer tab', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    const event = dispatchKey('E', { ctrlKey: true, shiftKey: true })

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('explorer')
    expect(event.defaultPrevented).toBe(true)
  })

  // ── Ctrl+Shift+F opens search ──

  it('Ctrl+Shift+F opens sidebar on search tab', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    const event = dispatchKey('F', { ctrlKey: true, shiftKey: true })

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('search')
    expect(event.defaultPrevented).toBe(true)
  })

  // ── Ctrl+Shift+G opens git ──

  it('Ctrl+Shift+G opens sidebar on git tab', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    const event = dispatchKey('G', { ctrlKey: true, shiftKey: true })

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('git')
    expect(event.defaultPrevented).toBe(true)
  })

  // ── Non-matching keys are ignored ──

  it('does not react to key without modifier', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    dispatchKey('b')

    expect(store.open).toBe(false)
  })

  it('does not react to Ctrl+Shift+B (shift disqualifies)', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    dispatchKey('b', { ctrlKey: true, shiftKey: true })

    expect(store.open).toBe(false)
  })

  it('does not react to Ctrl+E without Shift', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    mountWithShortcuts()
    dispatchKey('e', { ctrlKey: true })

    expect(store.activeTab).toBe('explorer') // unchanged from default
  })

  it('does not react to random key with Ctrl', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()
    store.setActiveTab('search')

    mountWithShortcuts()
    dispatchKey('z', { ctrlKey: true })

    expect(store.activeTab).toBe('search') // unchanged
  })

  // ── Cleanup ──

  it('removes listener on unmount', async () => {
    const { useSidebarStore } = await import('@renderer/stores/sidebar')
    const store = useSidebarStore()

    const wrapper = mountWithShortcuts()
    wrapper.unmount()

    dispatchKey('b', { ctrlKey: true })
    expect(store.open).toBe(false) // should not toggle after unmount
  })
})
