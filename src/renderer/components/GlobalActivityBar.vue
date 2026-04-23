<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export type AppSurface = 'command' | 'archive' | 'settings'

const { t } = useI18n()

interface ActivityIconCircle {
  cx: number
  cy: number
  r: number
}

interface ActivityItem {
  id: AppSurface
  title: string
  iconPaths: string[]
  iconCircles?: ActivityIconCircle[]
}

defineProps<{
  activeSurface: AppSurface
}>()

const emit = defineEmits<{
  select: [surface: AppSurface]
}>()

const topItems: ActivityItem[] = [
  {
    id: 'command',
    title: t('activityBar.command'),
    iconPaths: [
      'M5.75 6.25h12.5A1.75 1.75 0 0 1 20 8v7.5a1.75 1.75 0 0 1-1.75 1.75H5.75A1.75 1.75 0 0 1 4 15.5V8a1.75 1.75 0 0 1 1.75-1.75Z',
      'm8.5 10 2 2-2 2',
      'M13.25 14H16',
      'M9 17.25h6'
    ]
  }
]

const bottomItems: ActivityItem[] = [
  {
    id: 'archive',
    title: t('activityBar.archive'),
    iconPaths: [
      'M5.75 7.25h12.5A1.75 1.75 0 0 1 20 9v1.5a1.75 1.75 0 0 1-1.75 1.75H5.75A1.75 1.75 0 0 1 4 10.5V9a1.75 1.75 0 0 1 1.75-1.75Z',
      'M5 12.25h14v3.25A1.75 1.75 0 0 1 17.25 17.25H6.75A1.75 1.75 0 0 1 5 15.5v-3.25Z',
      'M9.25 10.75h5.5'
    ]
  },
  {
    id: 'settings',
    title: t('activityBar.settings'),
    iconPaths: [
      'M12 3.75v1.5',
      'M12 18.75v1.5',
      'm6.166 6.166 1.06 1.06',
      'm16.774 16.774 1.06 1.06',
      'M3.75 12h1.5',
      'M18.75 12h1.5',
      'm6.166 17.834 1.06-1.06',
      'm16.774 7.226 1.06-1.06',
      'M8.25 6.5h7.5L17 8.75v6.5l-1.25 2.25h-7.5L7 15.25v-6.5L8.25 6.5Z'
    ],
    iconCircles: [{ cx: 12, cy: 12, r: 2.25 }]
  }
]
</script>

<template>
  <nav class="flex min-h-full flex-col items-center py-5 pb-4 bg-transparent" data-testid="activity-bar" aria-label="Global activity">
    <div data-testid="activity-brand" class="w-6 h-6 mx-auto mb-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft">S</div>
    <div data-testid="activity-cluster-top" class="grid gap-3">
      <button
        v-for="item in topItems"
        :key="item.id"
        class="relative inline-flex h-9 w-9 items-center justify-center border-0 rounded-[10px] bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none"
        :class="{ 'text-text-strong bg-surface-solid shadow-soft': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        :aria-current="item.id === activeSurface ? 'true' : undefined"
        :aria-label="item.title"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <svg
          data-activity-icon
          class="h-[18px] w-[18px] shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path v-for="path in item.iconPaths" :key="path" :d="path" />
          <circle
            v-for="circle in item.iconCircles ?? []"
            :key="`${circle.cx}-${circle.cy}-${circle.r}`"
            :cx="circle.cx"
            :cy="circle.cy"
            :r="circle.r"
          />
        </svg>
        <span class="sr-only">{{ item.title }}</span>
      </button>
    </div>
    <div data-testid="activity-cluster-bottom" class="mt-auto grid gap-3">
      <button
        v-for="item in bottomItems"
        :key="item.id"
        class="relative inline-flex h-9 w-9 items-center justify-center border-0 rounded-[10px] bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none"
        :class="{ 'text-text-strong bg-surface-solid shadow-soft': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        :aria-current="item.id === activeSurface ? 'true' : undefined"
        :aria-label="item.title"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <svg
          data-activity-icon
          class="h-[18px] w-[18px] shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path v-for="path in item.iconPaths" :key="path" :d="path" />
          <circle
            v-for="circle in item.iconCircles ?? []"
            :key="`${circle.cx}-${circle.cy}-${circle.r}`"
            :cx="circle.cx"
            :cy="circle.cy"
            :r="circle.r"
          />
        </svg>
        <span class="sr-only">{{ item.title }}</span>
      </button>
    </div>
  </nav>
</template>
