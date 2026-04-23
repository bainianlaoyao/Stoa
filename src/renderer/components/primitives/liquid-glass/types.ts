export type LiquidGlassMode = 'standard' | 'polar' | 'prominent'

export type LiquidGlassPositioning = 'relative' | 'fixed'

export interface LiquidGlassPoint {
  x: number
  y: number
}

export interface LiquidGlassSize {
  width: number
  height: number
}

export interface LiquidGlassDefaults {
  mode: LiquidGlassMode
  displacementScale: number
  blurAmount: number
  saturation: number
  aberrationIntensity: number
  elasticity: number
  cornerRadius: number
  padding: string
  overLight: boolean
  interactive: boolean
  positioning: LiquidGlassPositioning
}

export const LIQUID_GLASS_DEFAULTS: LiquidGlassDefaults = {
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
}
