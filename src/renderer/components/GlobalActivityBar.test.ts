// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GlobalActivityBar from './GlobalActivityBar.vue'

function mountBar(props: { activeSurface?: GlobalActivityBar['$props']['activeSurface']; pendingCount?: number } = {}) {
  return mount(GlobalActivityBar, {
    props: {
      activeSurface: props.activeSurface ?? 'command',
      pendingCount: props.pendingCount ?? 0
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

  it('renders 4 activity items with correct data-activity-item values', () => {
    const wrapper = mountBar()
    const items = wrapper.findAll('[data-activity-item]')
    expect(items).toHaveLength(4)
    const ids = items.map((el) => el.attributes('data-activity-item'))
    expect(ids).toEqual(['command', 'queue', 'tree', 'settings'])
  })

  it('active item has .activity-bar__item--active class', () => {
    const wrapper = mountBar({ activeSurface: 'queue' })
    const activeItem = wrapper.find('[data-activity-item="queue"]')
    expect(activeItem.classes()).toContain('activity-bar__item--active')
  })

  it('inactive items do NOT have --active class (when only command is active)', () => {
    const wrapper = mountBar({ activeSurface: 'command' })
    const inactiveIds = ['queue', 'tree', 'settings'] as const
    for (const id of inactiveIds) {
      const el = wrapper.find(`[data-activity-item="${id}"]`)
      expect(el.classes()).not.toContain('activity-bar__item--active')
    }
  })

  it('clicking an item emits select with correct surface id', async () => {
    const wrapper = mountBar({ activeSurface: 'command' })
    const treeBtn = wrapper.find('[data-activity-item="tree"]')
    await treeBtn.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select')![0]).toEqual(['tree'])
  })

  it('renders .activity-bar__dot on queue item when pendingCount > 0', () => {
    const wrapper = mountBar({ pendingCount: 5 })
    const queueItem = wrapper.find('[data-activity-item="queue"]')
    expect(queueItem.find('.activity-bar__dot').exists()).toBe(true)
  })

  it('does NOT render dot when pendingCount === 0', () => {
    const wrapper = mountBar({ pendingCount: 0 })
    expect(wrapper.find('.activity-bar__dot').exists()).toBe(false)
  })

  it('does NOT render dot on non-queue items even with pendingCount > 0', () => {
    const wrapper = mountBar({ pendingCount: 5 })
    const nonQueueIds = ['command', 'tree', 'settings'] as const
    for (const id of nonQueueIds) {
      const el = wrapper.find(`[data-activity-item="${id}"]`)
      expect(el.find('.activity-bar__dot').exists()).toBe(false)
    }
  })

  it('clicking already-active item still emits select', async () => {
    const wrapper = mountBar({ activeSurface: 'settings' })
    const settingsBtn = wrapper.find('[data-activity-item="settings"]')
    await settingsBtn.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select')![0]).toEqual(['settings'])
  })
})
