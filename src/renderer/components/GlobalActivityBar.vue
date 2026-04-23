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
  <nav class="grid grid-rows-[auto_auto_1fr_auto] py-5 pb-4 bg-transparent" aria-label="Global activity">
    <div class="w-6 h-6 mx-auto mb-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft">V</div>
    <div class="grid gap-3">
      <button
        v-for="item in topItems"
        :key="item.id"
        class="relative w-9 h-9 mx-auto border-0 rounded-[10px] bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none"
        :class="{ 'text-text-strong bg-surface-solid shadow-soft': item.id === activeSurface }"
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
    <div class="grid gap-3 self-end">
      <button
        v-for="item in bottomItems"
        :key="item.id"
        class="relative w-9 h-9 mx-auto border-0 rounded-[10px] bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none"
        :class="{ 'text-text-strong bg-surface-solid shadow-soft': item.id === activeSurface }"
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
