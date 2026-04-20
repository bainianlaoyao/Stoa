// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import InboxQueueSurface from './InboxQueueSurface.vue'

describe('InboxQueueSurface', () => {
  it('renders a queue list/detail placeholder shell', () => {
    const wrapper = mount(InboxQueueSurface)

    expect(wrapper.find('[data-queue-list]').exists()).toBe(true)
    expect(wrapper.find('[data-queue-detail]').exists()).toBe(true)
    expect(wrapper.text()).toContain('placeholder')
  })
})
