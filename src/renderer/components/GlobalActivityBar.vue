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
  <nav class="activity-bar" data-testid="activity-bar" aria-label="Global activity">
    <div data-testid="activity-cluster-top" class="activity-cluster">
      <button
        v-for="item in topItems"
        :key="item.id"
        class="activity-item"
        :class="{ 'activity-item--active': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        :aria-current="item.id === activeSurface ? 'true' : undefined"
        :aria-label="item.title"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <span class="activity-item__indicator" aria-hidden="true" />
        <svg
          data-activity-icon
          :data-icon-kind="item.iconKind"
          class="activity-item__icon"
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
    <div data-testid="activity-cluster-bottom" class="activity-cluster activity-cluster--bottom">
      <button
        v-for="item in bottomItems"
        :key="item.id"
        class="activity-item"
        :class="{ 'activity-item--active': item.id === activeSurface }"
        :data-activity-item="item.id"
        :data-active="String(item.id === activeSurface)"
        :aria-current="item.id === activeSurface ? 'true' : undefined"
        :aria-label="item.title"
        type="button"
        :title="item.title"
        @click="emit('select', item.id)"
      >
        <span class="activity-item__indicator" aria-hidden="true" />
        <svg
          data-activity-icon
          :data-icon-kind="item.iconKind"
          class="activity-item__icon"
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

<style scoped>
.activity-bar {
  display: flex;
  width: 56px;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  padding: 16px 8px 18px;
  background: var(--mica-alt);
  border-right: 1px solid var(--stroke-divider);
}

.activity-cluster {
  display: grid;
  gap: 8px;
}

.activity-cluster--bottom {
  margin-top: auto;
  padding-bottom: 2px;
}

.activity-item {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition:
    background-color var(--duration-rest) var(--curve-standard),
    border-color var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard);
}

.activity-item:hover {
  background: var(--control-fill-hover);
  color: var(--text-strong);
}

.activity-item:active {
  background: var(--control-fill-active);
}

.activity-item:focus-visible {
  background: var(--control-fill-hover);
  color: var(--text-strong);
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.activity-item--active {
  background: var(--active-fill);
  border-color: var(--stroke-control);
  color: var(--text-strong);
}

.activity-item__indicator {
  position: absolute;
  left: -5px;
  top: 50%;
  width: 3px;
  height: 20px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  opacity: 0;
  transform: translateY(-50%);
  transition:
    opacity var(--duration-rest) var(--curve-standard),
    height var(--duration-rest) var(--curve-standard);
}

.activity-item--active .activity-item__indicator {
  opacity: 1;
}

.activity-item__icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}
</style>
