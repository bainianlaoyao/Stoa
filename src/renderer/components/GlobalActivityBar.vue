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
  iconKind: string
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
    iconKind: 'terminal-command',
    iconPaths: [
      'M5.75 5.75h12.5A1.75 1.75 0 0 1 20 7.5v9A1.75 1.75 0 0 1 18.25 18.25H5.75A1.75 1.75 0 0 1 4 16.5v-9A1.75 1.75 0 0 1 5.75 5.75Z',
      'm8 10 2.25 2.25L7.75 14.5',
      'M12.75 14.5h3.75'
    ]
  }
]

const bottomItems: ActivityItem[] = [
  {
    id: 'archive',
    title: t('activityBar.archive'),
    iconKind: 'archive-box',
    iconPaths: [
      'M5.75 5.75h12.5A1.25 1.25 0 0 1 19.5 7v2.25H4.5V7a1.25 1.25 0 0 1 1.25-1.25Z',
      'M5.25 9.25h13.5v8A1.75 1.75 0 0 1 17 19H7a1.75 1.75 0 0 1-1.75-1.75v-8Z',
      'M9.25 12h5.5'
    ]
  },
  {
    id: 'settings',
    title: t('activityBar.settings'),
    iconKind: 'settings-sliders',
    iconPaths: [
      'M5 7.25h5.25',
      'M13.75 7.25H19',
      'M10.25 5.75v3',
      'M5 12h9.25',
      'M17.75 12H19',
      'M14.25 10.5v3',
      'M5 16.75h2.25',
      'M10.75 16.75H19',
      'M7.25 15.25v3'
    ]
  }
]
</script>

<template>
  <nav class="flex min-h-full flex-col items-center py-5 pb-4 bg-transparent" data-testid="activity-bar" aria-label="Global activity">
    <div data-testid="activity-cluster-top" class="grid gap-3">
      <button
        v-for="item in topItems"
        :key="item.id"
        class="relative inline-flex h-10 w-10 items-center justify-center border-0 rounded-xl bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none"
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
          :data-icon-kind="item.iconKind"
          class="h-[28px] w-[28px] shrink-0"
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
        class="relative inline-flex h-10 w-10 items-center justify-center border-0 rounded-xl bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none"
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
          :data-icon-kind="item.iconKind"
          class="h-[28px] w-[28px] shrink-0"
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
