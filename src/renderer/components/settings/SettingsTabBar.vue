<script setup lang="ts">
export type SettingsTab = 'general' | 'terminal' | 'providers' | 'advanced' | 'about'

export interface SettingsTabItem {
  id: SettingsTab
  label: string
  summary: string
}

const props = defineProps<{
  activeTab: SettingsTab
  tabs: SettingsTabItem[]
}>()

const emit = defineEmits<{
  select: [tab: SettingsTab]
}>()

const iconPathsByTab: Record<SettingsTab, string[]> = {
  general: [
    'M12 8.25a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5Z',
    'M19.5 12a7.48 7.48 0 0 0-.11-1.28l1.56-1.22l-1.5-2.6l-1.93.53a7.59 7.59 0 0 0-2.2-1.28L15 4h-3l-.32 2.15a7.59 7.59 0 0 0-2.2 1.28l-1.93-.53l-1.5 2.6l1.56 1.22a7.76 7.76 0 0 0 0 2.56L6.05 14.5l1.5 2.6l1.93-.53c.66.54 1.4.97 2.2 1.28L12 20h3l.32-2.15c.8-.31 1.54-.74 2.2-1.28l1.93.53l1.5-2.6l-1.56-1.22c.07-.42.11-.84.11-1.28Z'
  ],
  terminal: [
    'M6.75 7.5l3 2.25-3 2.25m4.5 0h3',
    'M3.75 5.25h16.5v13.5H3.75z'
  ],
  providers: [
    'M8.25 7.5h7.5',
    'M8.25 12h7.5',
    'M8.25 16.5h4.5',
    'M5.25 5.25h13.5v13.5H5.25z'
  ],
  advanced: [
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z',
    'M15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0Z'
  ],
  about: [
    'M12 16.5v-4.5',
    'M12 8.25h.008v.008H12V8.25Z',
    'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z'
  ]
}

function onTabClick(tabId: SettingsTab) {
  emit('select', tabId)
}
</script>

<template>
  <div class="settings-tab-bar" role="tablist" aria-label="Settings tabs">
    <button
      v-for="tab in props.tabs"
      :key="tab.id"
      class="settings-tab-bar__item"
      :class="{ 'settings-tab-bar__item--active': tab.id === activeTab }"
      :data-settings-tab="tab.id"
      :aria-selected="tab.id === activeTab"
      :tabindex="tab.id === activeTab ? 0 : -1"
      role="tab"
      type="button"
      @click="onTabClick(tab.id)"
    >
      <span class="settings-tab-bar__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" focusable="false">
          <path
            v-for="path in iconPathsByTab[tab.id]"
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
  </div>
</template>

<style scoped>
.settings-tab-bar {
  display: grid;
  gap: 4px;
}

.settings-tab-bar__item {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 10px 12px 10px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-muted);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-rest) var(--curve-standard),
    background-color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard);
}

.settings-tab-bar__item:hover,
.settings-tab-bar__item:focus-visible {
  background: var(--control-fill-hover);
  color: var(--color-text-strong);
  outline: none;
}

.settings-tab-bar__item--active {
  background: var(--color-active-fill);
  border-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
  color: var(--color-text-strong);
  box-shadow: var(--shadow-soft);
}

.settings-tab-bar__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--control-fill);
  transition:
    background-color var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard);
}

.settings-tab-bar__item--active .settings-tab-bar__icon {
  background: var(--color-active-fill);
  color: var(--color-accent);
}

.settings-tab-bar__icon svg {
  width: 16px;
  height: 16px;
}

.settings-tab-bar__copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.settings-tab-bar__label {
  color: currentColor;
  font-size: var(--text-body-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.settings-tab-bar__summary {
  margin: 0;
  color: var(--color-subtle);
  line-height: 1.3;
  font-size: 11px;
  font-weight: 400;
}

.settings-tab-bar__item--active .settings-tab-bar__summary {
  color: var(--color-muted);
}
</style>
