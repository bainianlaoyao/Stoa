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
const redScale = computed(() => -props.displacementScale)
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
        <feImage
          x="0"
          y="0"
          width="100%"
          height="100%"
          result="DISPLACEMENT_MAP"
          :href="mapHref"
          preserveAspectRatio="xMidYMid slice"
        />
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
        <feDisplacementMap
          in="SourceGraphic"
          in2="DISPLACEMENT_MAP"
          :scale="redScale"
          xChannelSelector="R"
          yChannelSelector="B"
          result="RED_DISPLACED"
        />
        <feColorMatrix
          in="RED_DISPLACED"
          type="matrix"
          values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
          result="RED_CHANNEL"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="DISPLACEMENT_MAP"
          :scale="greenScale"
          xChannelSelector="R"
          yChannelSelector="B"
          result="GREEN_DISPLACED"
        />
        <feColorMatrix
          in="GREEN_DISPLACED"
          type="matrix"
          values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
          result="GREEN_CHANNEL"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="DISPLACEMENT_MAP"
          :scale="blueScale"
          xChannelSelector="R"
          yChannelSelector="B"
          result="BLUE_DISPLACED"
        />
        <feColorMatrix
          in="BLUE_DISPLACED"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
          result="BLUE_CHANNEL"
        />
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
