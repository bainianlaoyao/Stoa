// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GlobalActivityBar from './GlobalActivityBar.vue'

type AppSurface = 'command' | 'archive' | 'settings'
const globalActivityBarPath = resolve(dirname(fileURLToPath(import.meta.url)), 'GlobalActivityBar.vue')

function mountBar(props: { activeSurface?: AppSurface } = {}) {
  return mount(GlobalActivityBar, {
    props: {
      activeSurface: props.activeSurface ?? 'command'
    }
  })
}

describe('GlobalActivityBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders activity-bar nav element', () => {
    const wrapper = mountBar()
    expect(wrapper.find('nav[data-testid="activity-bar"]').exists()).toBe(true)
  })

  it('renders 3 elements with data-activity-item: command, archive, settings', () => {
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

  it('uses semantic sidebar icons for command and settings', () => {
    const wrapper = mountBar()

    expect(wrapper.get('[data-activity-item="command"]').find('[data-icon-kind="terminal-command"]').exists()).toBe(true)
    expect(wrapper.get('[data-activity-item="settings"]').find('[data-icon-kind="settings-sliders"]').exists()).toBe(true)
    expect(wrapper.find('[data-activity-item="meta-session"]').exists()).toBe(false)
    expect(wrapper.get('[data-activity-item="settings"]').findAll('circle')).toHaveLength(0)
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
    expect(topCluster.find('[data-activity-item="archive"]').exists()).toBe(false)
    expect(topCluster.find('[data-activity-item="meta-session"]').exists()).toBe(false)
    expect(bottomCluster.find('[data-activity-item="archive"]').exists()).toBe(true)
    expect(bottomCluster.find('[data-activity-item="settings"]').exists()).toBe(true)
    expect(bottomCluster.find('[data-activity-item="sidebar-toggle"]').exists()).toBe(false)
    expect(bottomCluster.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))).toEqual(['archive', 'settings'])
  })

  it('keeps Fluent tokenized rail styling with a stable active indicator', () => {
    const source = readFileSync(globalActivityBarPath, 'utf8')

    expect(source).toContain('class="activity-bar"')
    expect(source).toContain('class="activity-item__indicator"')
    expect(source).toContain('.activity-item--active .activity-item__indicator')
    expect(source).toContain('width: 56px;')
    expect(source).toContain('background: var(--mica-alt);')
    expect(source).toContain('background: var(--active-fill);')
    expect(source).toContain('background: var(--accent);')
    expect(source).toContain('box-shadow: var(--shadow-focus-ring);')
    expect(source).toContain('var(--duration-rest) var(--curve-standard)')
    expect(source).not.toContain('bg-black-soft')
    expect(source).not.toContain('duration-200')
  })
})
