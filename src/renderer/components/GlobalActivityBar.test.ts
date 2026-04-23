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
  it('renders activity-bar nav element', () => {
    const wrapper = mountBar()
    expect(wrapper.find('nav[data-testid="activity-bar"]').exists()).toBe(true)
  })

  it('renders 3 activity items with correct data-activity-item values', () => {
    const wrapper = mountBar()
    const items = wrapper.findAll('[data-activity-item]')
    expect(items).toHaveLength(3)
    const ids = items.map((el) => el.attributes('data-activity-item'))
    expect(ids).toEqual(['command', 'archive', 'settings'])
  })

  it('renders one stable svg icon for each activity item', () => {
    const wrapper = mountBar()

    expect(wrapper.findAll('[data-activity-icon]')).toHaveLength(3)
    expect(wrapper.get('[data-activity-item="command"]').find('[data-activity-icon]').exists()).toBe(true)
    expect(wrapper.get('[data-activity-item="archive"]').find('[data-activity-icon]').exists()).toBe(true)
    expect(wrapper.get('[data-activity-item="settings"]').find('[data-activity-icon]').exists()).toBe(true)
  })

  it('active item has data-active="true"', () => {
    const wrapper = mountBar({ activeSurface: 'settings' })
    const activeItem = wrapper.find('[data-activity-item="settings"]')
    expect(activeItem.attributes('data-active')).toBe('true')
  })

  it('inactive items do NOT have data-active="true" (when command is active)', () => {
    const wrapper = mountBar({ activeSurface: 'command' })
    const settingsItem = wrapper.find('[data-activity-item="settings"]')
    expect(settingsItem.attributes('data-active')).toBe('false')
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

  it('renders command in top cluster and archive above settings in bottom cluster', () => {
    const wrapper = mountBar()
    const topCluster = wrapper.find('[data-testid="activity-cluster-top"]')
    const bottomCluster = wrapper.find('[data-testid="activity-cluster-bottom"]')
    expect(topCluster.find('[data-activity-item="command"]').exists()).toBe(true)
    expect(bottomCluster.find('[data-activity-item="archive"]').exists()).toBe(true)
    expect(bottomCluster.find('[data-activity-item="settings"]').exists()).toBe(true)
    expect(bottomCluster.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))).toEqual(['archive', 'settings'])
  })
})
