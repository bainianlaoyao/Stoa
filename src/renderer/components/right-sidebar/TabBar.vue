<script setup lang="ts">
import type { SidebarTab } from '@shared/sidebar-types'

defineProps<{
  activeTab: SidebarTab
}>()

const emit = defineEmits<{
  select: [tab: SidebarTab]
}>()

const tabs: Array<{ id: SidebarTab; label: string; paths: string[] }> = [
  {
    id: 'explorer',
    label: 'Explorer',
    paths: ['M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h3.2l1.6 1.6h6.2a1.75 1.75 0 0 1 1.75 1.75v7.65a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 4.75 16.5V7.25Z'],
  },
  {
    id: 'search',
    label: 'Search',
    paths: ['m16.5 16.5 4 4', 'M5.75 11.75a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z'],
  },
  {
    id: 'git',
    label: 'Git',
    paths: ['M6 3v12', 'M18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M15 12a3 3 0 0 0-2.83-2.83L8.83 4.17', 'M8.83 19.83l3.34-5'],
  },
]
</script>

<template>
  <div
    class="flex items-center gap-0.5 px-2 py-1 border-b"
    style="border-color: var(--color-line);"
    data-testid="sidebar-tab-bar"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="flex items-center gap-1.5 px-2.5 py-1.5 transition-all duration-200 cursor-pointer"
      style="border-radius: var(--radius-sm); color: var(--color-muted);"
      :style="activeTab === tab.id ? {
        color: 'var(--color-accent)',
        background: 'var(--color-active-fill)',
      } : {}"
      @mouseenter="($event.currentTarget as HTMLElement).style.color = 'var(--color-text-strong)'; ($event.currentTarget as HTMLElement).style.background = activeTab !== tab.id ? 'var(--color-black-soft)' : 'var(--color-active-fill)'"
      @mouseleave="($event.currentTarget as HTMLElement).style.color = activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-muted)'; ($event.currentTarget as HTMLElement).style.background = activeTab === tab.id ? 'var(--color-active-fill)' : ''"
      :data-testid="`sidebar-tab-${tab.id}`"
      :aria-current="activeTab === tab.id ? 'true' : undefined"
      @click="emit('select', tab.id)"
    >
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path v-for="d in tab.paths" :key="d" :d="d" />
      </svg>
      <span class="font-medium" style="font-size: var(--text-caption);">{{ tab.label }}</span>
    </button>
  </div>
</template>
