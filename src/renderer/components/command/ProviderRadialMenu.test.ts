// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProviderRadialMenu from './ProviderRadialMenu.vue'

describe('ProviderRadialMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders role="group" with aria-label="Session providers (radial)"', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const group = document.body.querySelector('[role="group"][aria-label="Session providers (radial)"]')

    expect(group).toBeTruthy()
  })

  it('renders 4 buttons with correct aria-labels', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const labels = buttons.map((button) => button.getAttribute('aria-label'))

    expect(buttons).toHaveLength(4)
    expect(labels).toEqual([
      'Create OpenCode session',
      'Create Codex session',
      'Create Claude Code session',
      'Create Shell session'
    ])
  })

  it('clicking Shell button emits create with { type: \'shell\' }', async () => {
    const wrapper = mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const shellButton = document.body.querySelector('button[aria-label="Create Shell session"]')

    expect(shellButton).toBeTruthy()
    shellButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(wrapper.emitted('create')).toEqual([[{ type: 'shell' }]])
  })

  it('clicking Claude Code button emits create with { type: \'claude-code\' }', async () => {
    const wrapper = mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const claudeButton = document.body.querySelector('button[aria-label="Create Claude Code session"]')

    expect(claudeButton).toBeTruthy()
    claudeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(wrapper.emitted('create')).toEqual([[{ type: 'claude-code' }]])
  })

  it('does not render when visible=false', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: false,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    expect(document.body.querySelector('[role="group"][aria-label="Session providers (radial)"]')).toBeFalsy()
  })

  it('renders decorative ring track with class radial-menu__track and aria-hidden="true"', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const track = document.body.querySelector('.radial-menu__track[aria-hidden="true"]')

    expect(track).toBeTruthy()
  })
})
