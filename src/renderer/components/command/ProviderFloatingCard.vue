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
      role="group"
      aria-label="Session providers"
      :style="cardStyle"
    >
      <button
        v-for="provider in providerButtons"
        :key="provider.type"
        type="button"
        class="provider-icon-cell"
        :aria-label="`Create ${provider.providerName} session`"
        @click="emitCreate(provider.type)"
      >
        <img
          v-if="provider.kind === 'image'"
          class="provider-icon-cell__image"
          aria-hidden="true"
          alt=""
          :src="provider.src"
        />
        <svg
          v-else
          class="provider-icon-cell__icon"
          :viewBox="provider.viewBox"
          aria-hidden="true"
          focusable="false"
          v-html="provider.svg"
        />
      </button>
    </div>
  </Teleport>
</template>
