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
    <Dialog class="base-modal" data-testid="modal-root" @close="onClose">
      <div class="base-modal__container" data-testid="modal-overlay" @click.self="onClose">
        <TransitionChild
          enter="transition duration-200 ease-out"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="transition duration-150 ease-in"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel class="base-modal__panel" data-testid="modal-panel">
            <div class="base-modal__header">
              <DialogTitle as="h3" class="base-modal__title" data-testid="modal-title">{{ title }}</DialogTitle>
              <button class="base-modal__close" data-testid="modal-close" @click="onClose">✕</button>
            </div>
            <div class="base-modal__body" data-testid="modal-body">
              <slot />
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<style scoped>
.base-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.45);
}

.base-modal__container {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.base-modal__panel {
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-premium);
  max-width: 360px;
  width: 100%;
  padding: 20px;
}

.base-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.base-modal__title {
  margin: 0;
  font-size: var(--text-title-sm);
  font-weight: 600;
  color: var(--color-text-strong);
}

.base-modal__close {
  background: transparent;
  color: var(--color-muted);
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}

.base-modal__close:hover {
  background: var(--color-black-soft);
  color: var(--color-text-strong);
}

.base-modal__body {
  display: grid;
  gap: 16px;
}
</style>
