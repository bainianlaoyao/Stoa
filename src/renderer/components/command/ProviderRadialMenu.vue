<script setup lang="ts">
import { computed } from 'vue'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'

const RING_RADIUS = 52
const ITEM_SIZE = 30
const TRACK_SIZE = RING_RADIUS * 2

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

const trackStyle = computed(() => ({
  width: `${TRACK_SIZE}px`,
  height: `${TRACK_SIZE}px`,
  left: `${-TRACK_SIZE / 2}px`,
  top: `${-TRACK_SIZE / 2}px`
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
      <div
        class="radial-menu__track"
        aria-hidden="true"
        :style="trackStyle"
      />
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
    </div>
  </Teleport>
</template>

<style scoped>
.radial-menu {
  position: fixed;
  z-index: 200;
  pointer-events: none;
}

.radial-menu__track {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.30);
  border-radius: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,0.60), rgba(255,255,255,0.42));
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.60);
}

.radial-menu__item {
  position: absolute;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, rgba(255,255,255,0.80), rgba(255,255,255,0.65));
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow:
    0 12px 32px -4px rgba(0, 0, 0, 0.08),
    0 4px 12px rgba(0, 0, 0, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s ease;
  transform: translate(-50%, -50%);
  padding: 0;
  margin: 0;
}

.radial-menu__item:hover {
  background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.80));
  border-color: rgba(0, 0, 0, 0.07);
}

.radial-menu__item-image {
  width: 30px;
  height: 30px;
  display: block;
  object-fit: contain;
}
</style>
