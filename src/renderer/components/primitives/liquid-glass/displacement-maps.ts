import type { LiquidGlassMode } from './types'

function svgMap(markup: string): string {
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

export const STANDARD_DISPLACEMENT_MAP = svgMap(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="62%">
      <stop offset="0%" stop-color="rgb(128,128,128)"/>
      <stop offset="72%" stop-color="rgb(128,128,128)"/>
      <stop offset="100%" stop-color="rgb(255,128,0)"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" fill="url(#g)"/>
</svg>`)

export const POLAR_DISPLACEMENT_MAP = svgMap(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="r" cx="50%" cy="50%" r="68%">
      <stop offset="0%" stop-color="rgb(128,128,128)"/>
      <stop offset="55%" stop-color="rgb(150,128,110)"/>
      <stop offset="100%" stop-color="rgb(18,128,238)"/>
    </radialGradient>
    <linearGradient id="x" x1="0%" x2="100%">
      <stop offset="0%" stop-color="rgb(0,128,128)" stop-opacity=".38"/>
      <stop offset="50%" stop-color="rgb(128,128,128)" stop-opacity="0"/>
      <stop offset="100%" stop-color="rgb(255,128,128)" stop-opacity=".38"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#r)"/>
  <rect width="256" height="256" fill="url(#x)"/>
</svg>`)

export const PROMINENT_DISPLACEMENT_MAP = svgMap(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="p" cx="50%" cy="50%" r="72%">
      <stop offset="0%" stop-color="rgb(128,128,128)"/>
      <stop offset="48%" stop-color="rgb(128,128,128)"/>
      <stop offset="76%" stop-color="rgb(235,128,24)"/>
      <stop offset="100%" stop-color="rgb(255,128,0)"/>
    </radialGradient>
    <linearGradient id="s" x1="12%" y1="0%" x2="88%" y2="100%">
      <stop offset="0%" stop-color="rgb(255,128,64)" stop-opacity=".42"/>
      <stop offset="50%" stop-color="rgb(128,128,128)" stop-opacity="0"/>
      <stop offset="100%" stop-color="rgb(0,128,255)" stop-opacity=".42"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#p)"/>
  <rect width="256" height="256" fill="url(#s)"/>
</svg>`)

export function getLiquidGlassMap(mode: LiquidGlassMode): string {
  if (mode === 'polar') {
    return POLAR_DISPLACEMENT_MAP
  }
  if (mode === 'prominent') {
    return PROMINENT_DISPLACEMENT_MAP
  }
  return STANDARD_DISPLACEMENT_MAP
}
