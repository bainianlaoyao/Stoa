<script setup lang="ts">
import type { MemoryNotificationEvent } from '@shared/project-session'

defineProps<{
  notifications: MemoryNotificationEvent[]
}>()
</script>

<template>
  <div
    v-if="notifications.length > 0"
    class="memory-toast-host"
    data-testid="memory-toast-host"
    aria-live="polite"
    aria-atomic="true"
  >
    <TransitionGroup name="memory-toast" tag="div" class="memory-toast-host__list">
      <article
        v-for="notification in notifications"
        :key="notification.id"
        class="memory-toast"
        :data-kind="notification.kind"
        :data-status="notification.status"
        data-testid="memory-toast"
      >
        <p class="memory-toast__title">{{ notification.title }}</p>
        <p class="memory-toast__message">{{ notification.message }}</p>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.memory-toast-host {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 120;
  pointer-events: none;
}

.memory-toast-host__list {
  display: grid;
  gap: 10px;
}

.memory-toast {
  width: min(320px, calc(100vw - 36px));
  padding: 12px 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  backdrop-filter: blur(40px);
  box-shadow: var(--shadow-glass);
  color: var(--color-text);
}

.memory-toast[data-status='success'] {
  border-color: color-mix(in srgb, var(--color-success) 24%, var(--color-line));
}

.memory-toast[data-status='info'] {
  border-color: color-mix(in srgb, var(--color-accent) 18%, var(--color-line));
}

.memory-toast[data-status='error'] {
  border-color: color-mix(in srgb, var(--color-error) 28%, var(--color-line));
}

.memory-toast__title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
  line-height: 1.35;
}

.memory-toast__message {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: var(--text-meta);
  line-height: 1.45;
}

.memory-toast-enter-active,
.memory-toast-leave-active,
.memory-toast-move {
  transition: all 0.2s ease;
}

.memory-toast-enter-from,
.memory-toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
