// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AboutSettings from './AboutSettings.vue'

describe('AboutSettings', () => {
  it('renders app name "Vibecoding Panel"', () => {
    const wrapper = mount(AboutSettings)
    expect(wrapper.find('.settings-about__name').text()).toBe('Vibecoding Panel')
  })

  it('renders version "v0.1.0"', () => {
    const wrapper = mount(AboutSettings)
    expect(wrapper.find('.settings-about__version').text()).toBe('v0.1.0')
  })

  it('renders tech stack text', () => {
    const wrapper = mount(AboutSettings)
    expect(wrapper.find('.settings-about__stack').text()).toBe('Electron · Vue 3 · node-pty')
  })

  it('renders 3 links with target="_blank"', () => {
    const wrapper = mount(AboutSettings)
    const links = wrapper.findAll('.settings-about__link')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank')
    }
  })
})
