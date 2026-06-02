<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface SessionContextMenuItem {
  id: string
  label: string
  description?: string
  danger?: boolean
  disabled?: boolean
}

const MENU_OFFSET = 8
const MENU_WIDTH = 220

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  items: SessionContextMenuItem[]
  ariaLabel?: string
}>()

const emit = defineEmits<{
  select: [itemId: string]
  close: []
}>()

const rootRef = ref<HTMLElement | null>(null)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

const menuStyle = computed(() => {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : MENU_WIDTH * 2
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : MENU_WIDTH * 2
  const estimatedHeight = 12 + props.items.length * 44
  const left = clamp(props.position.x + MENU_OFFSET, MENU_OFFSET, Math.max(MENU_OFFSET, viewportWidth - MENU_WIDTH - MENU_OFFSET))
  const top = clamp(props.position.y + MENU_OFFSET, MENU_OFFSET, Math.max(MENU_OFFSET, viewportHeight - estimatedHeight - MENU_OFFSET))

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`
  }
})

function handleDocumentMouseDown(event: MouseEvent): void {
  if (!props.visible) {
    return
  }

  const target = event.target
  if (!(target instanceof Node)) {
    return
  }

  if (rootRef.value?.contains(target)) {
    return
  }

  emit('close')
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.visible) {
    emit('close')
  }
}

function selectItem(item: SessionContextMenuItem): void {
  if (item.disabled) {
    return
  }

  emit('select', item.id)
  emit('close')
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown)
  document.addEventListener('keydown', handleEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <Teleport v-if="visible" to="body">
    <div
      ref="rootRef"
      class="session-context-menu"
      data-testid="session-context-menu"
      role="menu"
      :aria-label="ariaLabel ?? 'Session actions'"
      :style="menuStyle"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="session-context-menu__item"
        :class="{ 'session-context-menu__item--danger': item.danger }"
        :disabled="item.disabled"
        :data-testid="`session-context-menu.item.${item.id}`"
        role="menuitem"
        @click="selectItem(item)"
      >
        <span class="session-context-menu__label">{{ item.label }}</span>
        <span v-if="item.description" class="session-context-menu__description">{{ item.description }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.session-context-menu {
  position: fixed;
  z-index: 260;
  min-width: 220px;
  padding: 6px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--acrylic);
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  box-shadow: var(--shadow-flyout);
  display: grid;
  gap: 4px;
}

.session-context-menu__item {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-strong);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-ui);
}

.session-context-menu__item:hover:not(:disabled),
.session-context-menu__item:focus-visible:not(:disabled) {
  background: var(--color-black-soft);
  outline: none;
}

.session-context-menu__item:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.session-context-menu__item--danger:not(:disabled) {
  color: var(--color-error);
}

.session-context-menu__label {
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.session-context-menu__description {
  color: var(--color-muted);
  font-size: var(--text-caption);
}
</style>
