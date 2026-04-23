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

  it('renders provider image assets for every session type', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    expect(document.body.querySelector('button[aria-label="Create OpenCode session"] img')).toBeTruthy()
    expect(document.body.querySelector('button[aria-label="Create Codex session"] img')).toBeTruthy()
    expect(document.body.querySelector('button[aria-label="Create Claude Code session"] img')).toBeTruthy()
    expect(document.body.querySelector('button[aria-label="Create Shell session"] img')).toBeTruthy()
    expect(document.body.querySelector('button svg')).toBeFalsy()
  })

  it('dragging onto Shell and releasing primary button emits create with { type: \'shell\' }', async () => {
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
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    shellButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))

    expect(wrapper.emitted('create')).toEqual([[{ type: 'shell' }]])
  })

  it('keyboard click on Claude Code emits create with { type: \'claude-code\' }', async () => {
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

  it('renders a Liquid Glass disk for provider selection', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const disk = document.body.querySelector('.radial-menu__glass')

    expect(disk).toBeTruthy()
    expect(document.body.querySelector('.radial-menu__track')).toBeFalsy()
  })

  it('renders the provider buttons inside the liquid glass disk', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const disk = document.body.querySelector('.radial-menu__glass')
    const buttons = disk?.querySelectorAll('button')

    expect(disk).toBeTruthy()
    expect(buttons).toHaveLength(4)
  })

  it('ignores non-primary mouseup on provider buttons', () => {
    const wrapper = mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120, y: 160 }
      },
      attachTo: document.body
    })

    const codexButton = document.body.querySelector('button[aria-label="Create Codex session"]')

    expect(codexButton).toBeTruthy()
    codexButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 1 }))
    codexButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 }))

    expect(wrapper.emitted('create')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('snaps menu and item positions to whole pixels to keep icons crisp', () => {
    mount(ProviderRadialMenu, {
      props: {
        visible: true,
        projectId: 'project_alpha',
        center: { x: 120.5, y: 160.5 }
      },
      attachTo: document.body
    })

    const group = document.body.querySelector('[role="group"][aria-label="Session providers (radial)"]') as HTMLElement | null
    expect(group).toBeTruthy()
    expect(group?.style.left).toBe('121px')
    expect(group?.style.top).toBe('161px')

    const openCodeButton = document.body.querySelector('button[aria-label="Create OpenCode session"]') as HTMLElement | null
    const codexButton = document.body.querySelector('button[aria-label="Create Codex session"]') as HTMLElement | null
    const claudeButton = document.body.querySelector('button[aria-label="Create Claude Code session"]') as HTMLElement | null
    const shellButton = document.body.querySelector('button[aria-label="Create Shell session"]') as HTMLElement | null

    expect(openCodeButton?.style.left).toBe('0px')
    expect(openCodeButton?.style.top).toBe('-48px')
    expect(codexButton?.style.left).toBe('48px')
    expect(codexButton?.style.top).toBe('0px')
    expect(claudeButton?.style.left).toBe('0px')
    expect(claudeButton?.style.top).toBe('48px')
    expect(shellButton?.style.left).toBe('-48px')
    expect(shellButton?.style.top).toBe('0px')
  })
})
