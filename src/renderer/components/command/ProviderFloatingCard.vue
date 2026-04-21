<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { SessionType } from '@shared/project-session'
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
  providerName: provider.type === 'opencode' ? 'OpenCode' : 'Shell'
})))

const cardStyle = computed(() => ({
  position: 'fixed',
  left: `${props.position.x}px`,
  top: `${props.position.y + props.position.height}px`
}))

function emitCreate(type: SessionType) {
  emit('create', { type })
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.visible) return
  if (event.key !== 'Escape') return
  emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      :data-project-id="projectId"
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
        <svg
          class="provider-icon-cell__icon"
          :viewBox="provider.viewBox"
          aria-hidden="true"
          focusable="false"
          v-html="provider.svg"
        />
        <span class="provider-icon-cell__label">{{ provider.providerName }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.provider-floating-card {
  display: flex;
  gap: 4px;
  padding: 6px;
}

.provider-icon-cell {
  display: grid;
  place-items: center;
  gap: 2px;
  width: 52px;
  height: 52px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text-strong);
  font: inherit;
}

.provider-icon-cell__icon {
  width: 20px;
  height: 20px;
}

.provider-icon-cell__label {
  font-family: var(--font-ui);
  font-size: 11px;
  line-height: 1;
}
</style>
