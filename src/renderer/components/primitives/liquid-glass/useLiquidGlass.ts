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
