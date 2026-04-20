// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AppShell from './AppShell.vue'

describe('AppShell', () => {
  beforeEach(() => {
    window.vibecoding = {
      getBootstrapState: vi.fn(),
      createProject: vi.fn(),
      createSession: vi.fn(),
      setActiveProject: vi.fn(),
      setActiveSession: vi.fn()
    }
  })

  it('shows all top-level activity items and defaults to command view', () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null,

      }
    })

    const labels = wrapper.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))

    expect(labels).toEqual(['command', 'queue', 'tree', 'settings'])
    expect(wrapper.find('[data-surface="command"]').exists()).toBe(true)
    expect(wrapper.find('[data-surface="queue"]').exists()).toBe(false)
  })
})
