// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { getLiquidGlassMap } from './displacement-maps'
import { LIQUID_GLASS_DEFAULTS } from './types'
import LiquidGlassFilter from './LiquidGlassFilter.vue'
import LiquidGlassSurface from './LiquidGlassSurface.vue'

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

  it('renders slotted content inside the liquid glass content layer', () => {
    const wrapper = mount(LiquidGlassSurface, {
      slots: {
        default: '<button class="inside">Create</button>'
      }
    })

    expect(wrapper.get('.liquid-glass-surface').exists()).toBe(true)
    expect(wrapper.get('.liquid-glass-surface__content .inside').text()).toBe('Create')
  })

  it('applies configurable visual props to the glass layers', () => {
    const wrapper = mount(LiquidGlassSurface, {
      props: {
        mode: 'prominent',
        displacementScale: 56,
        blurAmount: 0.08,
        saturation: 160,
        aberrationIntensity: 2,
        cornerRadius: 64,
        padding: '8px',
        overLight: true,
        interactive: true
      },
      slots: {
        default: '<span>Provider</span>'
      }
    })

    const root = wrapper.get('.liquid-glass-surface')
    const glass = wrapper.get('.liquid-glass-surface__glass')
    const warp = wrapper.get('.liquid-glass-surface__warp')

    expect(root.classes()).toContain('liquid-glass-surface--interactive')
    expect(glass.attributes('style')).toContain('border-radius: 64px')
    expect(glass.attributes('style')).toContain('padding: 8px')
    expect(warp.attributes('style')).toContain('saturate(160%)')
    expect(wrapper.get('filter').attributes('id')).toMatch(/^liquid-glass-/)
  })

  it('updates pointer-driven CSS variables when pointer moves', async () => {
    const wrapper = mount(LiquidGlassSurface, {
      props: {
        interactive: true,
        elasticity: 0.25
      },
      attachTo: document.body,
      slots: {
        default: '<span>Move</span>'
      }
    })

    Object.defineProperty(wrapper.element, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        top: 100,
        width: 120,
        height: 80,
        right: 220,
        bottom: 180,
        x: 100,
        y: 100,
        toJSON: () => ({})
      })
    })

    await wrapper.trigger('pointermove', { clientX: 190, clientY: 150 })

    expect((wrapper.element as HTMLElement).style.getPropertyValue('--liquid-glass-highlight-angle')).toContain('deg')
  })
})
