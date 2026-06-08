// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TerminalSettings from './TerminalSettings.vue'
import type { RendererApi } from '@shared/project-session'
import { createRendererApiMock } from '@shared/test-fixtures'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return Object.assign(createRendererApiMock(), overrides)
}

describe('TerminalSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createStoaMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps dense sections collapsed by default', () => {
    const wrapper = mount(TerminalSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    expect(wrapper.find('[data-settings-field="terminalFontSize"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="terminalCursorBlink"]').exists()).toBe(false)
    expect(wrapper.find('[data-settings-field="terminalScrollback"]').exists()).toBe(false)
    expect(wrapper.find('[data-settings-field="terminalCopyOnSelection"]').exists()).toBe(false)
  })

  it('expands a collapsed section when its header toggle is clicked', async () => {
    const wrapper = mount(TerminalSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    const toggle = wrapper.get('[data-settings-section-toggle="cursor"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-settings-field="terminalCursorBlink"]').exists()).toBe(true)
  })

  it('shows and expands only matching dense sections during search', () => {
    const wrapper = mount(TerminalSettings, {
      props: {
        searchQuery: 'cursor'
      },
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    expect(wrapper.find('[data-settings-section-toggle="cursor"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-settings-field="terminalCursorBlink"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="terminalScrollback"]').exists()).toBe(false)
    expect(wrapper.find('[data-settings-field="terminalCopyOnSelection"]').exists()).toBe(false)
  })
})
