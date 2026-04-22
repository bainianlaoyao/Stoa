// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GlobalActivityBar from './GlobalActivityBar.vue'
import type { AppSurface } from './GlobalActivityBar.vue'

function mountBar(props: { activeSurface?: AppSurface } = {}) {
  return mount(GlobalActivityBar, {
    props: {
      activeSurface: props.activeSurface ?? 'command'
    }
  })
}

describe('GlobalActivityBar', () => {
  it('renders .activity-bar nav element', () => {
    const wrapper = mountBar()
    expect(wrapper.find('nav.activity-bar').exists()).toBe(true)
  })

  it('renders brand "V" in .activity-bar__brand', () => {
    const wrapper = mountBar()
    expect(wrapper.find('.activity-bar__brand').text()).toBe('V')
  })

  it('renders 3 activity items with correct data-activity-item values', () => {
    const wrapper = mountBar()
    const items = wrapper.findAll('[data-activity-item]')
    expect(items).toHaveLength(3)
    const ids = items.map((el) => el.attributes('data-activity-item'))
    expect(ids).toEqual(['command', 'archive', 'settings'])
  })

  it('active item has .activity-bar__item--active class', () => {
    const wrapper = mountBar({ activeSurface: 'settings' })
    const activeItem = wrapper.find('[data-activity-item="settings"]')
    expect(activeItem.classes()).toContain('activity-bar__item--active')
  })

  it('inactive items do NOT have --active class (when command is active)', () => {
    const wrapper = mountBar({ activeSurface: 'command' })
    const settingsItem = wrapper.find('[data-activity-item="settings"]')
    expect(settingsItem.classes()).not.toContain('activity-bar__item--active')
  })

  it('clicking an item emits select with correct surface id', async () => {
    const wrapper = mountBar({ activeSurface: 'command' })
    const settingsBtn = wrapper.find('[data-activity-item="settings"]')
    await settingsBtn.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select')![0]).toEqual(['settings'])
  })

  it('clicking already-active item still emits select', async () => {
    const wrapper = mountBar({ activeSurface: 'command' })
    const commandBtn = wrapper.find('[data-activity-item="command"]')
    await commandBtn.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select')![0]).toEqual(['command'])
  })

  it('renders command in top cluster and archive+settings in bottom cluster', () => {
    const wrapper = mountBar()
    const topCluster = wrapper.find('.activity-bar__cluster--top')
    const bottomCluster = wrapper.find('.activity-bar__cluster--bottom')
    expect(topCluster.find('[data-activity-item="command"]').exists()).toBe(true)
    expect(bottomCluster.find('[data-activity-item="archive"]').exists()).toBe(true)
    expect(bottomCluster.find('[data-activity-item="settings"]').exists()).toBe(true)
  })
})
