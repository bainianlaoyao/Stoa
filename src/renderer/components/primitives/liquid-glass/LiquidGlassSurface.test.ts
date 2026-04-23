// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getLiquidGlassMap } from './displacement-maps'
import { LIQUID_GLASS_DEFAULTS } from './types'

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
})
