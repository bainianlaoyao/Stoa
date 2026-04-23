# Liquid Glass Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Vue Liquid Glass primitive adapted from `rdev/liquid-glass-react`, then use it as the session type radial selector disk.

**Architecture:** Add a focused `src/renderer/components/primitives/liquid-glass/` module with typed modes, displacement-map selection, SVG filter rendering, pointer/elastic state, and a public `LiquidGlassSurface.vue`. `ProviderRadialMenu.vue` remains responsible for session provider geometry and events, but delegates all liquid glass visual behavior to the primitive.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vitest, `@vue/test-utils`, SVG filters, existing CSS design tokens.

---

## File Structure

- Create `src/renderer/components/primitives/liquid-glass/types.ts` for public types and defaults.
- Create `src/renderer/components/primitives/liquid-glass/displacement-maps.ts` for data URL constants and `getLiquidGlassMap`.
- Create `src/renderer/components/primitives/liquid-glass/useLiquidGlass.ts` for generated IDs, measured size, mouse offset, elastic transform, and highlight gradient values.
- Create `src/renderer/components/primitives/liquid-glass/LiquidGlassFilter.vue` for SVG filter definitions.
- Create `src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.vue` for the reusable public component.
- Create `src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts` for primitive behavior.
- Modify `src/renderer/components/command/ProviderRadialMenu.vue` to use `LiquidGlassSurface`.
- Modify `src/renderer/components/command/ProviderRadialMenu.test.ts` for the new disk and geometry expectations.

---

### Task 1: Liquid Glass Types And Map Selection

**Files:**
- Create: `src/renderer/components/primitives/liquid-glass/types.ts`
- Create: `src/renderer/components/primitives/liquid-glass/displacement-maps.ts`
- Create: `src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the initial test file:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
```

Expected: FAIL because `./displacement-maps` and `./types` do not exist.

- [ ] **Step 3: Add types and maps**

Create `types.ts`:

```ts
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
```

Create `displacement-maps.ts` with compact project-owned displacement maps. These maps keep the `rdev/liquid-glass-react` filter architecture while avoiding a large copied binary blob in source.

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/primitives/liquid-glass/types.ts src/renderer/components/primitives/liquid-glass/displacement-maps.ts src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
git commit -m "feat: add liquid glass primitive maps"
```

---

### Task 2: SVG Filter Component

**Files:**
- Create: `src/renderer/components/primitives/liquid-glass/LiquidGlassFilter.vue`
- Modify: `src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend the test file:

```ts
import { mount } from '@vue/test-utils'
import LiquidGlassFilter from './LiquidGlassFilter.vue'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
```

Expected: FAIL because `LiquidGlassFilter.vue` does not exist.

- [ ] **Step 3: Add `LiquidGlassFilter.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { getLiquidGlassMap } from './displacement-maps'
import type { LiquidGlassMode } from './types'

const props = defineProps<{
  id: string
  mode: LiquidGlassMode
  displacementScale: number
  aberrationIntensity: number
  width: number
  height: number
}>()

const mapHref = computed(() => getLiquidGlassMap(props.mode))
const greenScale = computed(() => props.displacementScale * (-1 - props.aberrationIntensity * 0.05))
const blueScale = computed(() => props.displacementScale * (-1 - props.aberrationIntensity * 0.1))
const blurDeviation = computed(() => Math.max(0.1, 0.5 - props.aberrationIntensity * 0.1))
const edgeStop = computed(() => `${Math.max(30, 80 - props.aberrationIntensity * 2)}%`)
const edgeAlpha = computed(() => `0 ${props.aberrationIntensity * 0.05} 1`)
</script>

<template>
  <svg class="liquid-glass-filter" :width="width" :height="height" aria-hidden="true">
    <defs>
      <radialGradient :id="`${id}-edge-mask`" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="black" stop-opacity="0" />
        <stop :offset="edgeStop" stop-color="black" stop-opacity="0" />
        <stop offset="100%" stop-color="white" stop-opacity="1" />
      </radialGradient>
      <filter :id="id" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
        <feImage x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" :href="mapHref" preserveAspectRatio="xMidYMid slice" />
        <feColorMatrix
          in="DISPLACEMENT_MAP"
          type="matrix"
          values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
          result="EDGE_INTENSITY"
        />
        <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
          <feFuncA type="discrete" :tableValues="edgeAlpha" />
        </feComponentTransfer>
        <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
        <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" :scale="-displacementScale" xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED" />
        <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />
        <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" :scale="greenScale" xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED" />
        <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />
        <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" :scale="blueScale" xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED" />
        <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />
        <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
        <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
        <feGaussianBlur in="RGB_COMBINED" :stdDeviation="blurDeviation" result="ABERRATED_BLURRED" />
        <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />
        <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
        <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
        <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
      </filter>
    </defs>
  </svg>
</template>

<style scoped>
.liquid-glass-filter {
  position: absolute;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/primitives/liquid-glass/LiquidGlassFilter.vue src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
git commit -m "feat: add liquid glass svg filter"
```

---

### Task 3: Composable And Public Surface Component

**Files:**
- Create: `src/renderer/components/primitives/liquid-glass/useLiquidGlass.ts`
- Create: `src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.vue`
- Modify: `src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend the test file:

```ts
import LiquidGlassSurface from './LiquidGlassSurface.vue'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
```

Expected: FAIL because `useLiquidGlass.ts` and `LiquidGlassSurface.vue` do not exist.

- [ ] **Step 3: Add `useLiquidGlass.ts`**

```ts
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect, type Ref } from 'vue'
import type { LiquidGlassPoint, LiquidGlassSize } from './types'

const DEFAULT_SIZE: LiquidGlassSize = { width: 128, height: 128 }
let nextFilterId = 0

export function createLiquidGlassId(): string {
  nextFilterId += 1
  return `liquid-glass-${nextFilterId}`
}

export function useLiquidGlass(options: {
  root: Ref<HTMLElement | null>
  elasticity: Ref<number>
  globalMousePos: Ref<LiquidGlassPoint | undefined>
  mouseOffset: Ref<LiquidGlassPoint | undefined>
  mouseContainer: Ref<HTMLElement | null | undefined>
}) {
  const size = ref<LiquidGlassSize>({ ...DEFAULT_SIZE })
  const internalMouse = ref<LiquidGlassPoint>({ x: 0, y: 0 })
  const internalOffset = ref<LiquidGlassPoint>({ x: 0, y: 0 })

  const effectiveMouse = computed(() => options.globalMousePos.value ?? internalMouse.value)
  const effectiveOffset = computed(() => options.mouseOffset.value ?? internalOffset.value)

  function measure(): void {
    const element = options.root.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      size.value = { width: Math.round(rect.width), height: Math.round(rect.height) }
    }
  }

  function handlePointerMove(event: PointerEvent | MouseEvent): void {
    const container = options.mouseContainer.value ?? options.root.value
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    internalMouse.value = { x: event.clientX, y: event.clientY }
    internalOffset.value = {
      x: ((event.clientX - centerX) / rect.width) * 100,
      y: ((event.clientY - centerY) / rect.height) * 100
    }
  }

  function distanceFromEdge(mouse: LiquidGlassPoint): number {
    const element = options.root.value
    if (!element || mouse.x === 0 || mouse.y === 0) return 300
    const rect = element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const edgeDistanceX = Math.max(0, Math.abs(mouse.x - centerX) - size.value.width / 2)
    const edgeDistanceY = Math.max(0, Math.abs(mouse.y - centerY) - size.value.height / 2)
    return Math.sqrt(edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY)
  }

  const fade = computed(() => {
    const activationZone = 200
    const distance = distanceFromEdge(effectiveMouse.value)
    return distance > activationZone ? 0 : 1 - distance / activationZone
  })

  const transform = computed(() => {
    const element = options.root.value
    const mouse = effectiveMouse.value
    if (!element || mouse.x === 0 || mouse.y === 0) {
      return 'translate(0px, 0px) scale(1)'
    }
    const rect = element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = mouse.x - centerX
    const deltaY = mouse.y - centerY
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    if (distance === 0) {
      return 'translate(0px, 0px) scale(1)'
    }
    const normalizedX = deltaX / distance
    const normalizedY = deltaY / distance
    const stretchIntensity = Math.min(distance / 300, 1) * options.elasticity.value * fade.value
    const translateX = deltaX * options.elasticity.value * 0.1 * fade.value
    const translateY = deltaY * options.elasticity.value * 0.1 * fade.value
    const scaleX = 1 + Math.abs(normalizedX) * stretchIntensity * 0.3 - Math.abs(normalizedY) * stretchIntensity * 0.15
    const scaleY = 1 + Math.abs(normalizedY) * stretchIntensity * 0.3 - Math.abs(normalizedX) * stretchIntensity * 0.15
    return `translate(${translateX}px, ${translateY}px) scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`
  })

  const highlightAngle = computed(() => `${135 + effectiveOffset.value.x * 1.2}deg`)

  onMounted(() => {
    void nextTick(measure)
    window.addEventListener('resize', measure)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', measure)
  })

  watchEffect(() => {
    const element = options.root.value
    if (!element) return
    element.style.setProperty('--liquid-glass-transform', transform.value)
    element.style.setProperty('--liquid-glass-highlight-angle', highlightAngle.value)
  })

  return {
    size,
    effectiveOffset,
    handlePointerMove,
    measure
  }
}
```

- [ ] **Step 4: Add `LiquidGlassSurface.vue`**

```vue
<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import LiquidGlassFilter from './LiquidGlassFilter.vue'
import { createLiquidGlassId, useLiquidGlass } from './useLiquidGlass'
import { LIQUID_GLASS_DEFAULTS, type LiquidGlassMode, type LiquidGlassPoint, type LiquidGlassPositioning } from './types'

const props = withDefaults(defineProps<{
  mode?: LiquidGlassMode
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  cornerRadius?: number
  padding?: string
  overLight?: boolean
  interactive?: boolean
  positioning?: LiquidGlassPositioning
  globalMousePos?: LiquidGlassPoint
  mouseOffset?: LiquidGlassPoint
  mouseContainer?: HTMLElement | null
}>(), LIQUID_GLASS_DEFAULTS)

const root = ref<HTMLElement | null>(null)
const filterId = createLiquidGlassId()

const glass = useLiquidGlass({
  root,
  elasticity: toRef(props, 'elasticity'),
  globalMousePos: toRef(props, 'globalMousePos'),
  mouseOffset: toRef(props, 'mouseOffset'),
  mouseContainer: toRef(props, 'mouseContainer')
})

const rootClasses = computed(() => ({
  'liquid-glass-surface--interactive': props.interactive,
  'liquid-glass-surface--over-light': props.overLight,
  'liquid-glass-surface--fixed': props.positioning === 'fixed'
}))

const glassStyle = computed(() => ({
  borderRadius: `${props.cornerRadius}px`,
  padding: props.padding
}))

const warpStyle = computed(() => ({
  borderRadius: `${props.cornerRadius}px`,
  filter: `url(#${filterId})`,
  backdropFilter: `blur(${(props.overLight ? 12 : 4) + props.blurAmount * 32}px) saturate(${props.saturation}%)`,
  WebkitBackdropFilter: `blur(${(props.overLight ? 12 : 4) + props.blurAmount * 32}px) saturate(${props.saturation}%)`
}))

const highlightStyle = computed(() => ({
  borderRadius: `${props.cornerRadius}px`,
  background: `linear-gradient(var(--liquid-glass-highlight-angle), rgba(255,255,255,0) 0%, var(--white-faint) 48%, var(--white-soft) 68%, rgba(255,255,255,0) 100%)`
}))
</script>

<template>
  <div
    ref="root"
    class="liquid-glass-surface"
    :class="rootClasses"
    @pointermove="glass.handlePointerMove"
  >
    <span class="liquid-glass-surface__shadow" :style="{ borderRadius: `${cornerRadius}px` }" aria-hidden="true" />
    <LiquidGlassFilter
      :id="filterId"
      :mode="mode"
      :displacement-scale="displacementScale"
      :aberration-intensity="aberrationIntensity"
      :width="glass.size.value.width"
      :height="glass.size.value.height"
    />
    <div class="liquid-glass-surface__glass" :style="glassStyle">
      <span class="liquid-glass-surface__warp" :style="warpStyle" aria-hidden="true" />
      <div class="liquid-glass-surface__content">
        <slot />
      </div>
    </div>
    <span class="liquid-glass-surface__highlight" :style="highlightStyle" aria-hidden="true" />
  </div>
</template>

<style scoped>
.liquid-glass-surface {
  --liquid-glass-transform: translate(0px, 0px) scale(1);
  --liquid-glass-highlight-angle: 135deg;
  position: relative;
  display: inline-grid;
  transform: var(--liquid-glass-transform);
  transition: all 0.2s ease;
}

.liquid-glass-surface--fixed {
  position: fixed;
}

.liquid-glass-surface--interactive {
  cursor: pointer;
}

.liquid-glass-surface__shadow,
.liquid-glass-surface__highlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.liquid-glass-surface__shadow {
  background: var(--black-faint);
  box-shadow: var(--shadow-card);
}

.liquid-glass-surface__glass {
  position: relative;
  display: inline-grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.liquid-glass-surface__warp {
  position: absolute;
  inset: 0;
  background: var(--surface-soft);
}

.liquid-glass-surface__content {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 0;
}

.liquid-glass-surface__highlight {
  opacity: 0.42;
  mix-blend-mode: screen;
  padding: 1px;
  box-shadow: inset 0 0 0 1px var(--line), inset 0 1px 0 var(--white-soft);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/primitives/liquid-glass/useLiquidGlass.ts src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.vue src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts
git commit -m "feat: add reusable liquid glass surface"
```

---

### Task 4: Radial Menu Integration

**Files:**
- Modify: `src/renderer/components/command/ProviderRadialMenu.vue`
- Modify: `src/renderer/components/command/ProviderRadialMenu.test.ts`

- [ ] **Step 1: Write the failing tests**

Update `ProviderRadialMenu.test.ts`:

```ts
it('renders a Liquid Glass disk for provider selection', () => {
  mount(ProviderRadialMenu, {
    props: {
      visible: true,
      projectId: 'project_alpha',
      center: { x: 120, y: 160 }
    },
    attachTo: document.body
  })

  const disk = document.body.querySelector('.radial-menu__glass')

  expect(disk).toBeTruthy()
  expect(document.body.querySelector('.radial-menu__track')).toBeFalsy()
})
```

Update the geometry test expectations:

```ts
expect(openCodeButton?.style.left).toBe('0px')
expect(openCodeButton?.style.top).toBe('-48px')
expect(codexButton?.style.left).toBe('48px')
expect(codexButton?.style.top).toBe('0px')
expect(claudeButton?.style.left).toBe('0px')
expect(claudeButton?.style.top).toBe('48px')
expect(shellButton?.style.left).toBe('-48px')
expect(shellButton?.style.top).toBe('0px')
```

Replace the old decorative ring test with:

```ts
it('renders the provider buttons inside the liquid glass disk', () => {
  mount(ProviderRadialMenu, {
    props: {
      visible: true,
      projectId: 'project_alpha',
      center: { x: 120, y: 160 }
    },
    attachTo: document.body
  })

  const disk = document.body.querySelector('.radial-menu__glass')
  const buttons = disk?.querySelectorAll('button')

  expect(disk).toBeTruthy()
  expect(buttons).toHaveLength(4)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/renderer/components/command/ProviderRadialMenu.test.ts
```

Expected: FAIL because the component still renders `.radial-menu__track` and uses 52px radius.

- [ ] **Step 3: Update `ProviderRadialMenu.vue`**

Use the new primitive:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'
import LiquidGlassSurface from '@renderer/components/primitives/liquid-glass/LiquidGlassSurface.vue'

const RING_RADIUS = 48
const ITEM_SIZE = 30
const DISK_SIZE = 128

// keep existing props, emits, positionedProviders, menuStyle, and event handlers
</script>
```

Change the template body inside `.radial-menu`:

```vue
<LiquidGlassSurface
  class="radial-menu__glass"
  mode="prominent"
  :corner-radius="999"
  :displacement-scale="56"
  :blur-amount="0.08"
  :saturation="160"
  :aberration-intensity="2"
  :elasticity="0.22"
  :over-light="true"
  interactive
>
  <div class="radial-menu__disk" aria-hidden="true" />
  <button
    v-for="provider in positionedProviders"
    :key="provider.type"
    type="button"
    class="radial-menu__item"
    :aria-label="`Create ${getProviderDescriptorBySessionType(provider.type).displayName} session`"
    :style="provider.style"
    @mouseup="onItemMouseUp($event, provider.type)"
    @click="onItemClick($event, provider.type)"
  >
    <img
      class="radial-menu__item-image"
      aria-hidden="true"
      :style="iconStyle"
      alt=""
      :src="provider.src"
    />
  </button>
</LiquidGlassSurface>
```

Update scoped CSS:

```css
.radial-menu {
  position: fixed;
  display: block;
  z-index: 40;
}

.radial-menu__glass {
  width: 128px;
  height: 128px;
  transform: translate(-50%, -50%);
}

.radial-menu__disk {
  width: 128px;
  height: 128px;
}

.radial-menu__item {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-strong);
  transform: translate(calc(64px - 50%), calc(64px - 50%));
  cursor: pointer;
  transition: all 0.2s ease;
}

.radial-menu__item:hover,
.radial-menu__item:focus-visible {
  background: var(--white-faint);
  border-color: var(--line);
  outline: none;
}

.radial-menu__item-image {
  display: block;
  object-fit: contain;
}
```

Keep the absolute `left/top` values from `positionedProviders`; the CSS transform centers them in the 128px disk.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/renderer/components/command/ProviderRadialMenu.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/command/ProviderRadialMenu.vue src/renderer/components/command/ProviderRadialMenu.test.ts
git commit -m "feat: use liquid glass radial selector"
```

---

### Task 5: Integration Verification

**Files:**
- No new files unless tests reveal a real code defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/renderer/components/primitives/liquid-glass/LiquidGlassSurface.test.ts src/renderer/components/command/ProviderRadialMenu.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full suite**

Run:

```bash
npx vitest run
```

Expected: PASS, except the known intentional `tests/e2e/main-config-guard.test.ts` sandbox false guard failure if it still exists.

- [ ] **Step 3: Fix code for unexpected failures**

If any unexpected test fails, write or adjust the smallest failing test that captures the behavior, then fix production code. Do not delete or skip tests.

- [ ] **Step 4: Final commit if verification required fixes**

If Task 5 changed code:

```bash
git add <changed-files>
git commit -m "fix: stabilize liquid glass integration"
```

If Task 5 did not change code, do not create an empty commit.
