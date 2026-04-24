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
    <Dialog as="div" class="relative z-50" data-testid="modal-root" @close="onClose">
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

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4" @click.self="onClose">
          <TransitionChild
            as="template"
            enter="transition duration-200 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="transition duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel
              class="w-full max-w-[360px] rounded-[18px] border border-line bg-surface-solid p-5 shadow-premium"
              data-testid="modal-panel"
            >
              <div class="flex items-center justify-between mb-4">
                <DialogTitle as="h3" class="text-[15px] font-semibold text-text-strong" data-testid="modal-title">{{ title }}</DialogTitle>
                <button class="bg-transparent text-muted w-6 h-6 rounded-lg border-none cursor-pointer flex items-center justify-center text-base leading-none hover:bg-black-soft hover:text-text-strong" data-testid="modal-close" @click="onClose">✕</button>
              </div>
              <div class="grid gap-4" data-testid="modal-body">
                <slot />
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
