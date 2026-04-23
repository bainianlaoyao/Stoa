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

const positionedProviders = computed(() => {
  const count = PROVIDER_ICONS.length

  return PROVIDER_ICONS.map((provider, index) => {
    const angle = (index * 360 / count) - 90
    const radians = angle * Math.PI / 180
    const x = Math.cos(radians) * RING_RADIUS
    const y = Math.sin(radians) * RING_RADIUS

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
  left: `${props.center.x}px`,
  top: `${props.center.y}px`
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
        @click="createSession(provider.type)"
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
  display: block;
}

.radial-menu__track {
  position: absolute;
  border-radius: 999px;
}

.radial-menu__item {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
}
</style>
