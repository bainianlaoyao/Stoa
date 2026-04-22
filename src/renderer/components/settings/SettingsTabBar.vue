<script setup lang="ts">
export type SettingsTab = 'general' | 'providers' | 'about'

defineProps<{
  activeTab: SettingsTab
}>()

const emit = defineEmits<{
  select: [tab: SettingsTab]
}>()

const tabs: Array<{ id: SettingsTab; label: string; summary: string; iconPaths: string[] }> = [
  {
    id: 'general',
    label: 'General',
    summary: 'Shell defaults and terminal typography.',
    iconPaths: [
      'M12 8.25a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5Z',
      'M19.5 12a7.48 7.48 0 0 0-.11-1.28l1.56-1.22l-1.5-2.6l-1.93.53a7.59 7.59 0 0 0-2.2-1.28L15 4h-3l-.32 2.15a7.59 7.59 0 0 0-2.2 1.28l-1.93-.53l-1.5 2.6l1.56 1.22a7.76 7.76 0 0 0 0 2.56L6.05 14.5l1.5 2.6l1.93-.53c.66.54 1.4.97 2.2 1.28L12 20h3l.32-2.15c.8-.31 1.54-.74 2.2-1.28l1.93.53l1.5-2.6l-1.56-1.22c.07-.42.11-.84.11-1.28Z'
    ]
  },
  {
    id: 'providers',
    label: 'Providers',
    summary: 'Executable paths for local provider runtimes.',
    iconPaths: [
      'M8.25 7.5h7.5',
      'M8.25 12h7.5',
      'M8.25 16.5h4.5',
      'M5.25 5.25h13.5v13.5H5.25z'
    ]
  },
  {
    id: 'about',
    label: 'About',
    summary: 'Version, stack, and project links.',
    iconPaths: [
      'M12 16.5v-4.5',
      'M12 8.25h.008v.008H12V8.25Z',
      'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z'
    ]
  }
]
</script>

<template>
  <nav class="settings-tab-bar" role="tablist" aria-label="Settings navigation">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="settings-tab-bar__item"
      :class="{ 'settings-tab-bar__item--active': tab.id === activeTab }"
      :aria-selected="tab.id === activeTab"
      :aria-controls="`settings-panel-${tab.id}`"
      :data-settings-tab="tab.id"
      role="tab"
      type="button"
      @click="emit('select', tab.id)"
    >
      <span class="settings-tab-bar__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" focusable="false">
          <path
            v-for="path in tab.iconPaths"
            :key="path"
            :d="path"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
          />
        </svg>
      </span>
      <span class="settings-tab-bar__copy">
        <span class="settings-tab-bar__label">{{ tab.label }}</span>
        <span class="settings-tab-bar__summary">{{ tab.summary }}</span>
      </span>
    </button>
  </nav>
</template>
