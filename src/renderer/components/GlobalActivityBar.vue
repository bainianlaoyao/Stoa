<script setup lang="ts">
export type AppSurface = 'command' | 'queue' | 'tree' | 'settings'

defineProps<{
  activeSurface: AppSurface
  pendingCount: number
}>()

const emit = defineEmits<{
  select: [surface: AppSurface]
}>()

const items: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'command', label: '⌘', title: 'Command panel' },
  { id: 'queue', label: '≣', title: 'Inbox and task queue' },
  { id: 'tree', label: '⊞', title: 'Context file tree' },
  { id: 'settings', label: '⚙', title: 'Settings' }
]
</script>

<template>
  <nav class="activity-bar" aria-label="Global activity bar">
    <div class="activity-bar__brand">V</div>
    <div class="activity-bar__cluster">
      <button
        v-for="item in items"
        :key="item.id"
        class="activity-bar__item"
        :class="{ 'activity-bar__item--active': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.id === 'queue' && pendingCount > 0" class="activity-bar__dot" />
      </button>
    </div>
  </nav>
</template>
