<script setup lang="ts">
import { TabList, Tab } from '@headlessui/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

export type SettingsTab = 'general' | 'terminal' | 'providers' | 'about'

defineProps<{
  activeTab: SettingsTab
}>()

const emit = defineEmits<{
  select: [tab: SettingsTab]
}>()

const tabs: Array<{ id: SettingsTab; label: string; summary: string; iconPaths: string[] }> = [
  {
    id: 'general',
    label: t('settings.tabs.general.label'),
    summary: t('settings.tabs.general.summary'),
    iconPaths: [
      'M12 8.25a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5Z',
      'M19.5 12a7.48 7.48 0 0 0-.11-1.28l1.56-1.22l-1.5-2.6l-1.93.53a7.59 7.59 0 0 0-2.2-1.28L15 4h-3l-.32 2.15a7.59 7.59 0 0 0-2.2 1.28l-1.93-.53l-1.5 2.6l1.56 1.22a7.76 7.76 0 0 0 0 2.56L6.05 14.5l1.5 2.6l1.93-.53c.66.54 1.4.97 2.2 1.28L12 20h3l.32-2.15c.8-.31 1.54-.74 2.2-1.28l1.93.53l1.5-2.6l-1.56-1.22c.07-.42.11-.84.11-1.28Z'
    ]
  },
  {
    id: 'terminal',
    label: t('settings.tabs.terminal.label'),
    summary: t('settings.tabs.terminal.summary'),
    iconPaths: [
      'M6.75 7.5l3 2.25-3 2.25m4.5 0h3',
      'M3.75 5.25h16.5v13.5H3.75z'
    ]
  },
  {
    id: 'providers',
    label: t('settings.tabs.providers.label'),
    summary: t('settings.tabs.providers.summary'),
    iconPaths: [
      'M8.25 7.5h7.5',
      'M8.25 12h7.5',
      'M8.25 16.5h4.5',
      'M5.25 5.25h13.5v13.5H5.25z'
    ]
  },
  {
    id: 'about',
    label: t('settings.tabs.about.label'),
    summary: t('settings.tabs.about.summary'),
    iconPaths: [
      'M12 16.5v-4.5',
      'M12 8.25h.008v.008H12V8.25Z',
      'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z'
    ]
  }
]

function onTabClick(tabId: SettingsTab) {
  emit('select', tabId)
}
</script>

<template>
  <TabList class="settings-tab-bar">
    <Tab
      v-for="tab in tabs"
      :key="tab.id"
      as="template"
    >
      <button
        class="settings-tab-bar__item"
        :class="{ 'settings-tab-bar__item--active': tab.id === activeTab }"
        :data-settings-tab="tab.id"
        type="button"
        @click="onTabClick(tab.id)"
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
    </Tab>
  </TabList>
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
  transition: border-color 0.2s ease, 
              background-color 0.2s ease,
              box-shadow 0.2s ease,
              color 0.2s ease;
}

.settings-tab-bar__item:hover,
.settings-tab-bar__item:focus-visible {
  background: var(--color-black-soft);
  color: var(--color-text-strong);
  outline: none;
}

.settings-tab-bar__item:active {
  transform: scale(0.985);
}

.settings-tab-bar__item--active {
  background: var(--color-black-soft);
  border-color: transparent;
  color: var(--color-text-strong);
  box-shadow: none;
}

.settings-tab-bar__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--color-black-faint);
  transition: all 0.2s ease;
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
