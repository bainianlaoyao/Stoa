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
      <div v-if="show" class="fixed inset-0 bg-black/45 z-50 flex items-center justify-center" @click.self="onClose">
        <div class="bg-surface-solid border border-line rounded-[18px] shadow-premium max-w-[360px] w-full p-5" role="dialog" aria-modal="true" :aria-labelledby="titleId">
          <div class="flex items-center justify-between mb-4">
            <h3 :id="titleId" class="text-[15px] font-semibold text-text-strong">{{ title }}</h3>
            <button class="bg-transparent text-muted w-6 h-6 rounded-lg border-none cursor-pointer flex items-center justify-center text-base leading-none hover:bg-black-soft hover:text-text-strong" @click="onClose">✕</button>
          </div>
          <div class="grid gap-4">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
