// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsTabBar from './SettingsTabBar.vue'

function mountTabBar(activeTab: 'general' | 'providers' | 'about' = 'general') {
  return mount(SettingsTabBar, {
    props: { activeTab }
  })
}

describe('SettingsTabBar', () => {
  it('renders 3 tab buttons with correct data-settings-tab attributes', () => {
    const wrapper = mountTabBar()
    const buttons = wrapper.findAll('[data-settings-tab]')
    expect(buttons).toHaveLength(3)

    const tabIds = buttons.map((btn) => btn.attributes('data-settings-tab'))
    expect(tabIds).toContain('general')
    expect(tabIds).toContain('providers')
    expect(tabIds).toContain('about')
  })

  it('marks the active tab with aria-selected="true" and the CSS class settings-tab-bar__item--active', () => {
    const wrapper = mountTabBar('providers')
    const activeBtn = wrapper.find('[data-settings-tab="providers"]')

    expect(activeBtn.attributes('aria-selected')).toBe('true')
    expect(activeBtn.classes()).toContain('settings-tab-bar__item--active')
  })

  it('clicking a tab emits select with the tab id', async () => {
    const wrapper = mountTabBar('general')
    const aboutBtn = wrapper.find('[data-settings-tab="about"]')
    await aboutBtn.trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select')![0]).toEqual(['about'])
  })

  it('non-active tabs have aria-selected="false"', () => {
    const wrapper = mountTabBar('general')
    const providersBtn = wrapper.find('[data-settings-tab="providers"]')
    const aboutBtn = wrapper.find('[data-settings-tab="about"]')

    expect(providersBtn.attributes('aria-selected')).toBe('false')
    expect(aboutBtn.attributes('aria-selected')).toBe('false')
  })
})
