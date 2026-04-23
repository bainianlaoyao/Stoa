// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProviderFloatingCard from './ProviderFloatingCard.vue'

function mountCard(visible = true) {
  return mount(ProviderFloatingCard, {
    props: {
      visible,
      projectId: 'project_alpha',
      position: {
        x: 120,
        y: 64,
        width: 52,
        height: 52
      }
    },
    attachTo: document.body
  })
}

describe('ProviderFloatingCard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders role="group" with aria-label="Session providers"', () => {
    mountCard()

    const group = document.body.querySelector('[role="group"][aria-label="Session providers"]')
    expect(group).toBeTruthy()
  })

  it('renders 4 buttons with correct aria-labels', () => {
    mountCard()

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const labels = buttons.map(button => button.getAttribute('aria-label'))

    expect(buttons).toHaveLength(4)
    expect(labels).toEqual([
      'Create OpenCode session',
      'Create Codex session',
      'Create Claude Code session',
      'Create Shell session'
    ])
  })

  it('clicking Shell button emits create with { type: "shell" }', async () => {
    const wrapper = mountCard()

    const button = document.body.querySelector('button[aria-label="Create Shell session"]')
    expect(button).toBeTruthy()

    ;(button as HTMLButtonElement).click()

    expect(wrapper.emitted('create')).toEqual([[{ type: 'shell' }]])
  })

  it('clicking OpenCode button emits create with { type: "opencode" }', async () => {
    const wrapper = mountCard()

    const button = document.body.querySelector('button[aria-label="Create OpenCode session"]')
    expect(button).toBeTruthy()

    ;(button as HTMLButtonElement).click()

    expect(wrapper.emitted('create')).toEqual([[{ type: 'opencode' }]])
  })

  it('clicking Codex button emits create with { type: "codex" }', async () => {
    const wrapper = mountCard()

    const button = document.body.querySelector('button[aria-label="Create Codex session"]')
    expect(button).toBeTruthy()

    ;(button as HTMLButtonElement).click()

    expect(wrapper.emitted('create')).toEqual([[{ type: 'codex' }]])
  })

  it('does not render when visible=false', () => {
    mountCard(false)

    const group = document.body.querySelector('[role="group"][aria-label="Session providers"]')
    expect(group).toBeFalsy()
  })

  it('does not render any dedicated close button', () => {
    mountCard()

    const closeButton = document.body.querySelector('button[aria-label*="close" i], button[title*="close" i]')
    expect(closeButton).toBeFalsy()
  })
})
