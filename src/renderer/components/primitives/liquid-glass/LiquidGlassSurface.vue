<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import LiquidGlassFilter from './LiquidGlassFilter.vue'
import { createLiquidGlassId, useLiquidGlass } from './useLiquidGlass'
import type { LiquidGlassMode, LiquidGlassPoint, LiquidGlassPositioning } from './types'

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
}>(), {
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
  positioning: 'relative',
  globalMousePos: undefined,
  mouseOffset: undefined,
  mouseContainer: undefined
})

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

const warpStyle = computed(() => {
  const blur = (props.overLight ? 12 : 4) + props.blurAmount * 32
  const backdropFilter = `blur(${blur}px) saturate(${props.saturation}%)`

  return {
    borderRadius: `${props.cornerRadius}px`,
    filter: `url(#${filterId})`,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter
  }
})

const highlightStyle = computed(() => ({
  borderRadius: `${props.cornerRadius}px`,
  background: 'linear-gradient(var(--liquid-glass-highlight-angle), rgba(255,255,255,0) 0%, var(--white-faint) 48%, var(--white-soft) 68%, rgba(255,255,255,0) 100%)'
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
