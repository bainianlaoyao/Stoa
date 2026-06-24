// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createRendererApiMock, createSessionSummaryFixture } from '@shared/test-fixtures'
import MobileSessionTerminal from './MobileSessionTerminal.vue'
import type { ProjectSummary } from '@shared/project-session'

vi.mock('@renderer/components/TerminalViewport.vue', () => ({
  default: defineComponent({
    name: 'TerminalViewport',
    props: {
      showQuickActions: { type: Boolean, default: true },
      fontSizeDelta: { type: Number, default: 0 },
      inputEnabled: { type: Boolean, default: true },
      minViewportWidth: { type: Number, default: null }
    },
    setup(props) {
      return () => h('div', {
        'data-testid': 'terminal-viewport-stub',
        'data-show-quick-actions': String(props.showQuickActions),
        'data-font-size-delta': String(props.fontSizeDelta),
        'data-input-enabled': String(props.inputEnabled),
        'data-min-viewport-width': String(props.minViewportWidth)
      })
    }
  })
}))

const project: ProjectSummary = {
  id: 'project-1',
  name: 'Alpha',
  path: 'D:/alpha',
  createdAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z'
}

const session = createSessionSummaryFixture({
  id: 'session-1',
  projectId: project.id,
  type: 'codex',
  title: 'Mobile terminal',
  summary: 'Ready'
})

describe('MobileSessionTerminal', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.stoa = createRendererApiMock({
      sendSessionInput: vi.fn()
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('pasted text'),
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('mounts xterm through TerminalViewport without desktop quick actions', () => {
    const wrapper = mount(MobileSessionTerminal, {
      props: {
        project,
        session,
        healthStatus: 'connected'
      }
    })

    const terminal = wrapper.get('[data-testid="terminal-viewport-stub"]')
    expect(terminal.attributes('data-show-quick-actions')).toBe('false')
    expect(terminal.attributes('data-input-enabled')).toBe('true')
  })

  it('uses the single fixed wide terminal surface instead of display modes', () => {
    const wrapper = mount(MobileSessionTerminal, {
      props: {
        project,
        session,
        healthStatus: 'connected'
      }
    })

    expect(wrapper.get('[data-testid="terminal-viewport-stub"]').attributes('data-min-viewport-width')).toBe('960')
    expect(wrapper.get('[data-testid="terminal-viewport-stub"]').attributes('data-font-size-delta')).toBe('0')
  })

  it('sends keys in the required rail order without resizing the terminal host', async () => {
    const wrapper = mount(MobileSessionTerminal, {
      props: {
        project,
        session,
        healthStatus: 'connected'
      }
    })

    await wrapper.get('[data-testid="mobile-keys-handle"]').trigger('click')
    const actions = wrapper.findAll('[data-key-action]').map((node) => node.attributes('data-key-action'))

    expect(actions).toEqual(['esc', 'tab', 'up', 'down', 'slash', 'dash', 'copy', 'paste', 'enter'])

    for (const action of ['esc', 'tab', 'up', 'down', 'slash', 'dash', 'enter']) {
      await wrapper.get(`[data-key-action="${action}"]`).trigger('click')
    }

    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '\u001b')
    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '\t')
    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '\u001b[A')
    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '\u001b[B')
    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '/')
    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '-')
    expect(window.stoa.sendSessionInput).toHaveBeenCalledWith('session-1', '\r')
  })

  it('light-dismisses the key rail when the user taps outside it', async () => {
    const wrapper = mount(MobileSessionTerminal, {
      props: {
        project,
        session,
        healthStatus: 'connected'
      }
    })

    await wrapper.get('[data-testid="mobile-keys-handle"]').trigger('click')
    expect(wrapper.find('[data-testid="mobile-keys-rail"]').exists()).toBe(true)

    await wrapper.get('[data-testid="mobile-keys-dismiss"]').trigger('click')
    expect(wrapper.find('[data-testid="mobile-keys-rail"]').exists()).toBe(false)
  })

  it('freezes terminal input when backend health is not connected', () => {
    const wrapper = mount(MobileSessionTerminal, {
      props: {
        project,
        session,
        healthStatus: 'reconnecting'
      }
    })

    const terminal = wrapper.get('[data-testid="terminal-viewport-stub"]')
    expect(terminal.attributes('data-input-enabled')).toBe('false')
  })
})
