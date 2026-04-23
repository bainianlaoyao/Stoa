// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { getLiquidGlassMap } from './displacement-maps'
import { LIQUID_GLASS_DEFAULTS } from './types'
import LiquidGlassFilter from './LiquidGlassFilter.vue'

describe('liquid glass primitives', () => {
  it('selects a data-url displacement map for each supported mode', () => {
    expect(getLiquidGlassMap('standard')).toMatch(/^data:image\//)
    expect(getLiquidGlassMap('polar')).toMatch(/^data:image\//)
    expect(getLiquidGlassMap('prominent')).toMatch(/^data:image\//)
  })

  it('keeps project defaults tuned for reusable glass surfaces', () => {
    expect(LIQUID_GLASS_DEFAULTS).toMatchObject({
      mode: 'standard',
      displacementScale: 48,
      blurAmount: 0.08,
      saturation: 150,
      aberrationIntensity: 2,
      elasticity: 0.18,
      cornerRadius: 999,
      padding: '0',
      overLight: true,
      interactive: false,
      positioning: 'relative'
    })
  })

  it('renders an SVG filter using the selected displacement map', () => {
    const wrapper = mount(LiquidGlassFilter, {
      props: {
        id: 'glass-test',
        mode: 'prominent',
        displacementScale: 56,
        aberrationIntensity: 3,
        width: 128,
        height: 128
      }
    })

    const filter = wrapper.get('filter')
    const image = wrapper.get('feImage')
    const displacement = wrapper.findAll('feDisplacementMap')

    expect(filter.attributes('id')).toBe('glass-test')
    expect(image.attributes('href')).toMatch(/^data:image\//)
    expect(displacement).toHaveLength(3)
    expect(displacement[0]!.attributes('scale')).toBe('-56')
  })
})
