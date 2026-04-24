<script setup lang="ts">
import { computed } from 'vue'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'

const props = defineProps<{
  visible: boolean
  projectId: string
  position: { x: number; y: number; width: number; height: number }
}>()

const emit = defineEmits<{
  create: [payload: { type: SessionType }]
  close: []
}>()

const providerButtons = computed(() => PROVIDER_ICONS.map((provider) => ({
  ...provider,
  providerName: getProviderDescriptorBySessionType(provider.type).displayName
})))

const cardStyle = computed(() => ({
  left: `${props.position.x}px`,
  top: `${props.position.y + props.position.height}px`
}))

function emitCreate(type: SessionType) {
  emit('create', { type })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="provider-floating-card"
      data-testid="provider-card"
      role="group"
      aria-label="Session providers"
      :style="cardStyle"
    >
      <button
        v-for="provider in providerButtons"
        :key="provider.type"
        type="button"
        class="provider-icon-cell"
        data-testid="provider-card.item"
        :data-provider-type="provider.type"
        :aria-label="`Create ${provider.providerName} session`"
        @click="emitCreate(provider.type)"
      >
        <img
          class="provider-icon-cell__image"
          aria-hidden="true"
          alt=""
          :src="provider.src"
        />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.provider-floating-card {
  position: fixed;
  z-index: 100;
  background: var(--color-surface);
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-glass);
  padding: 6px;
  display: flex;
  gap: 4px;
}

.provider-icon-cell {
  display: grid;
  place-items: center;
  gap: 2px;
  width: 52px;
  height: 52px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-ui);
}

.provider-icon-cell:hover {
  background: var(--color-black-soft);
}

.provider-icon-cell:active {
  background: var(--color-black-faint);
}

.provider-icon-cell__image {
  width: 33px;
  height: 33px;
  display: block;
  object-fit: contain;
}
</style>
