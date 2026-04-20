// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContextTreeSurface from './ContextTreeSurface.vue'

describe('ContextTreeSurface', () => {
  it('renders a tree/detail placeholder shell with file status marks', () => {
    const wrapper = mount(ContextTreeSurface)

    expect(wrapper.find('[data-tree-list]').exists()).toBe(true)
    expect(wrapper.find('[data-tree-detail]').exists()).toBe(true)
    expect(wrapper.text()).toContain('READ')
    expect(wrapper.text()).toContain('MOD')
    expect(wrapper.text()).toContain('NEW')
  })
})
