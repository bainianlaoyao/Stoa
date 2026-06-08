// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import SettingsSurface from './SettingsSurface.vue'
import type { RendererApi } from '@shared/project-session'
import { createRendererApiMock } from '@shared/test-fixtures'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return Object.assign(createRendererApiMock(), overrides)
}

describe('SettingsSurface', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createStoaMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a settings search field in the sidebar', () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    expect(wrapper.find('[data-settings-search]').exists()).toBe(true)
  })

  it('filters tabs by query and switches to the first matching tab panel', async () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    await wrapper.get('[data-settings-tab="about"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="About"]').exists()).toBe(true)

    const search = wrapper.get('[data-settings-search]')
    await search.setValue('provider')
    await nextTick()

    const visibleTabs = wrapper.findAll('[data-settings-tab]')
    expect(visibleTabs).toHaveLength(1)
    expect(visibleTabs[0]?.attributes('data-settings-tab')).toBe('providers')
    expect(wrapper.find('[aria-label="Provider settings"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="About"]').exists()).toBe(false)
  })
})
