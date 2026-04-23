<script setup lang="ts">
export type AppSurface = 'command' | 'archive' | 'settings'

defineProps<{
  activeSurface: AppSurface
}>()

const emit = defineEmits<{
  select: [surface: AppSurface]
}>()

const topItems: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'command', label: '⌘', title: 'Command panel' }
]

const bottomItems: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'archive', label: 'Ar', title: 'Archive' },
  { id: 'settings', label: '⚙', title: 'Settings' }
]
</script>

<template>
  <nav class="activity-bar" aria-label="Global activity">
    <div class="activity-bar__brand">V</div>
    <div class="activity-bar__cluster activity-bar__cluster--top">
      <button
        v-for="item in topItems"
        :key="item.id"
        class="activity-bar__item"
        :class="{ 'activity-bar__item--active': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        :aria-current="item.id === activeSurface ? 'true' : undefined"
        :aria-label="item.title"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <span>{{ item.label }}</span>
      </button>
    </div>
    <div class="activity-bar__cluster activity-bar__cluster--bottom">
      <button
        v-for="item in bottomItems"
        :key="item.id"
        class="activity-bar__item"
        :class="{ 'activity-bar__item--active': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        :aria-current="item.id === activeSurface ? 'true' : undefined"
        :aria-label="item.title"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <span>{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>
