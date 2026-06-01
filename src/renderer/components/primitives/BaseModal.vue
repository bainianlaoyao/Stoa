<script setup lang="ts">
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'

defineProps<{
  show: boolean
  title: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

function onClose() {
  emit('update:show', false)
}
</script>

<template>
  <TransitionRoot :show="show" as="template">
    <Dialog as="div" class="fixed inset-0 z-50 overflow-y-auto" data-testid="modal-root" @close="onClose">
      <TransitionChild
        as="template"
        enter="transition-opacity duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-overlay-scrim" data-testid="modal-overlay" aria-hidden="true" @click="onClose" />
      </TransitionChild>

      <div class="relative z-10 flex min-h-full items-center justify-center p-4" @click.self="onClose">
          <TransitionChild
            as="template"
            enter="transition duration-350 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            enter-from="opacity-0 scale-90 translate-y-4"
            enter-to="opacity-100 scale-100 translate-y-0"
            leave="transition duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-90"
          >
            <DialogPanel
              class="w-full max-w-[360px] rounded-lg border border-line bg-surface-solid p-5 shadow-premium"
              data-testid="modal-panel"
            >
              <div class="flex items-center justify-between mb-4">
                <DialogTitle as="h3" class="text-[length:var(--text-title-sm)] font-semibold text-text-strong" data-testid="modal-title">{{ title }}</DialogTitle>
                <button class="bg-transparent text-muted w-6 h-6 rounded-sm border-none cursor-pointer flex items-center justify-center text-base leading-none hover:bg-black-soft hover:text-text-strong transition-transform duration-200 hover:scale-110 active:scale-90" data-testid="modal-close" @click="onClose">✕</button>
              </div>
              <div class="grid gap-4" data-testid="modal-body">
                <slot />
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
    </Dialog>
  </TransitionRoot>
</template>
