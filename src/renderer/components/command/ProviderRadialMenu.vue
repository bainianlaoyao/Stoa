<script setup lang="ts">
import { computed } from 'vue'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'
import LiquidGlassSurface from '@renderer/components/primitives/liquid-glass/LiquidGlassSurface.vue'

const RING_RADIUS = 48
const ITEM_SIZE = 30

const props = defineProps<{
  visible: boolean
  projectId: string
  center: { x: number; y: number }
}>()

const emit = defineEmits<{
  create: [payload: { type: SessionType }]
  close: []
}>()

function snapToPixel(value: number) {
  return Math.round(value)
}

const positionedProviders = computed(() => {
  const count = PROVIDER_ICONS.length

  return PROVIDER_ICONS.map((provider, index) => {
    const angle = (index * 360 / count) - 90
    const radians = angle * Math.PI / 180
    const x = snapToPixel(Math.cos(radians) * RING_RADIUS)
    const y = snapToPixel(Math.sin(radians) * RING_RADIUS)

    return {
      ...provider,
      angle,
      style: {
        left: `${x}px`,
        top: `${y}px`
      }
    }
  })
})

const menuStyle = computed(() => ({
  left: `${snapToPixel(props.center.x)}px`,
  top: `${snapToPixel(props.center.y)}px`
}))

const iconStyle = {
  width: `${ITEM_SIZE}px`,
  height: `${ITEM_SIZE}px`
}

function onItemClick(event: MouseEvent, type: SessionType) {
  // Keyboard activation dispatches click without a preceding mouseup.
  if (event.detail === 0) {
    createSession(type)
  }
}

function onItemMouseUp(event: MouseEvent, type: SessionType) {
  if (event.button !== 0) {
    return
  }

  createSession(type)
}

function createSession(type: SessionType) {
  emit('create', { type })
  emit('close')
}
</script>

<template>
  <Teleport v-if="visible" to="body">
    <div
      class="radial-menu"
      role="group"
      aria-label="Session providers (radial)"
      :style="menuStyle"
    >
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
    </div>
  </Teleport>
</template>

<style scoped>
.radial-menu {
  position: fixed;
  display: block;
  z-index: 40;
}

.radial-menu__glass {
  width: 128px;
  height: 128px;
  translate: -50% -50%;
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
</style>
