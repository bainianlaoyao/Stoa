<script setup lang="ts">
import { useId, onUnmounted, watch } from 'vue'

const props = defineProps<{
  show: boolean
  title: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const titleId = `modal-title-${useId()}`

function onClose() {
  emit('update:show', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onClose()
}

watch(() => props.show, (visible) => {
  if (visible) {
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="onClose">
        <div class="modal-panel" role="dialog" aria-modal="true" :aria-labelledby="titleId">
          <div class="modal-panel__header">
            <h3 :id="titleId" class="modal-panel__title">{{ title }}</h3>
            <button class="modal-panel__close" @click="onClose">✕</button>
          </div>
          <div class="modal-panel__body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
