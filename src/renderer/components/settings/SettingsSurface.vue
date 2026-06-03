<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { TabGroup, TabPanels, TabPanel } from '@headlessui/vue'
import SettingsTabBar from './SettingsTabBar.vue'
import type { SettingsTab } from './SettingsTabBar.vue'
import GeneralSettings from './GeneralSettings.vue'
import TerminalSettings from './TerminalSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import AboutSettings from './AboutSettings.vue'

const { t } = useI18n()

const tabMeta = computed<Array<{ id: SettingsTab; label: string; summary: string }>>(() => [
  { id: 'general', label: t('settings.tabs.general.label'), summary: t('settings.tabs.general.summary') },
  { id: 'terminal', label: t('settings.tabs.terminal.label'), summary: t('settings.tabs.terminal.summary') },
  { id: 'providers', label: t('settings.tabs.providers.label'), summary: t('settings.tabs.providers.summary') },
  { id: 'advanced', label: t('settings.tabs.advanced.label'), summary: t('settings.tabs.advanced.summary') },
  { id: 'about', label: t('settings.tabs.about.label'), summary: t('settings.tabs.about.summary') }
])

const activeTab = ref<SettingsTab>('general')

const tabComponents: Record<SettingsTab, Component> = {
  general: GeneralSettings,
  terminal: TerminalSettings,
  providers: ProvidersSettings,
  advanced: AdvancedSettings,
  about: AboutSettings
}

const activeTabMeta = computed(() => tabMeta.value.find((tab) => tab.id === activeTab.value) ?? tabMeta.value[0])

function onTabSelect(tab: SettingsTab) {
  activeTab.value = tab
}
</script>

<template>
  <section class="settings-surface" data-surface="settings" aria-label="Settings surface">
    <div class="settings-surface__shell">
      <TabGroup>
        <!-- Sidebar Navigation (Glass) -->
        <aside class="settings-surface__nav-panel" aria-label="Settings sections">
          <!-- Sidebar Header Title -->
          <div class="settings-surface__sidebar-header">
            <p class="eyebrow mb-1">{{ t('settings.eyebrow') }}</p>
            <h2 class="settings-surface__title">{{ t('settings.title') }}</h2>
            <p class="settings-surface__lede text-xs mt-1.5 text-muted leading-relaxed">
              {{ t('settings.lede') }}
            </p>
          </div>

          <!-- Section Label -->
          <div class="settings-surface__nav-copy mt-2">
            <span class="settings-surface__nav-label">{{ t('settings.navLabel') }}</span>
          </div>

          <!-- Tabs -->
          <SettingsTabBar :active-tab="activeTab" @select="onTabSelect" />

          <!-- Dynamic Active Status Panel (At sidebar bottom) -->
          <div class="settings-surface__hero-meta mt-auto">
            <span class="settings-surface__hero-label">{{ t('settings.heroLabel') }}</span>
            <strong class="settings-surface__hero-value">{{ activeTabMeta.label }}</strong>
            <span class="settings-surface__hero-summary">{{ activeTabMeta.summary }}</span>
          </div>
        </aside>

        <!-- Right Content Panel (Solid) -->
        <div class="settings-surface__content-panel">
          <TabPanels class="h-full">
            <TabPanel class="h-full focus:outline-none">
              <GeneralSettings />
            </TabPanel>
            <TabPanel class="h-full focus:outline-none">
              <TerminalSettings />
            </TabPanel>
            <TabPanel class="h-full focus:outline-none">
              <ProvidersSettings />
            </TabPanel>
            <TabPanel class="h-full focus:outline-none">
              <AdvancedSettings />
            </TabPanel>
            <TabPanel class="h-full focus:outline-none">
              <AboutSettings />
            </TabPanel>
          </TabPanels>
        </div>
      </TabGroup>
    </div>
  </section>
</template>

<style scoped>
.settings-surface {
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
}

.settings-surface__shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  grid-template-rows: 1fr;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  background: var(--mica);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.settings-surface__nav-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  height: 100%;
  min-height: 0;
  background: var(--mica-alt);
  border-right: 1px solid var(--color-line);
  user-select: none;
}

.settings-surface__sidebar-header {
  display: flex;
  flex-direction: column;
}

.settings-surface__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.settings-surface__nav-copy {
  display: grid;
  gap: 4px;
}

.settings-surface__nav-label {
  color: var(--color-subtle);
  font-size: var(--text-caption);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-surface__content-panel {
  overflow-y: auto;
  height: 100%;
  min-height: 0;
  background: var(--color-surface-solid);
  padding: 28px 32px;
  scrollbar-width: thin;
}

.settings-surface__content-panel::-webkit-scrollbar {
  width: 6px;
}

.settings-surface__content-panel::-webkit-scrollbar-thumb {
  background: var(--color-line-strong);
  border-radius: var(--radius-sm);
}

.settings-surface__hero-meta {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 16px;
  border: 1px solid var(--color-line);
  border-radius: 2px;
  background: var(--color-surface-solid);
  box-shadow: var(--shadow-soft);
}

.settings-surface__hero-label {
  color: var(--color-subtle);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-surface__hero-value {
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.settings-surface__hero-summary {
  color: var(--color-muted);
  font-size: var(--text-meta);
  line-height: 1.4;
}

@media (max-width: 900px) {
  .settings-surface__shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .settings-surface__nav-panel {
    border-right: none;
    border-bottom: 1px solid var(--color-line);
    height: auto;
  }

  .settings-surface__hero-meta {
    display: none;
  }
}
</style>
