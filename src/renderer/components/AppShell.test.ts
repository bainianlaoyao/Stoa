// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AppShell from './AppShell.vue'

describe('AppShell', () => {
  beforeEach(() => {
    window.vibecoding = {
      getBootstrapState: vi.fn(),
      createWorkspace: vi.fn(),
      onWorkspaceEvent: vi.fn(() => vi.fn()),
      onTerminalData: vi.fn(() => vi.fn()),
      writeTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      setActiveWorkspace: vi.fn()
    }
  })

  it('shows all top-level activity items and defaults to command view', () => {
    const wrapper = mount(AppShell, {
      props: {
        workspaces: [],
        hierarchy: [],
        activeWorkspaceId: null,
        activeWorkspace: null,
        name: '',
        path: '',
        providerId: 'local-shell',
        errorMessage: ''
      }
    })

    const labels = wrapper.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))

    expect(labels).toEqual(['command', 'queue', 'tree', 'settings'])
    expect(wrapper.find('[data-surface="command"]').exists()).toBe(true)
    expect(wrapper.find('[data-surface="queue"]').exists()).toBe(false)
  })
})
