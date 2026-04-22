<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import SettingsTabBar from './SettingsTabBar.vue'
import type { SettingsTab } from './SettingsTabBar.vue'
import GeneralSettings from './GeneralSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AboutSettings from './AboutSettings.vue'

const tabMeta: Array<{ id: SettingsTab; label: string; summary: string }> = [
  { id: 'general', label: 'General', summary: 'Shell path and terminal font size.' },
  { id: 'providers', label: 'Providers', summary: 'Local provider executable paths.' },
  { id: 'about', label: 'About', summary: 'Version, stack, and project links.' }
]

const activeTab = ref<SettingsTab>('general')

const tabComponents: Record<SettingsTab, Component> = {
  general: GeneralSettings,
  providers: ProvidersSettings,
  about: AboutSettings
}

const activeTabMeta = computed(() => tabMeta.find((tab) => tab.id === activeTab.value) ?? tabMeta[0])
</script>

<template>
  <section class="settings-surface" data-surface="settings" aria-label="Settings surface">
    <header class="settings-surface__hero">
      <div class="settings-surface__hero-copy">
        <p class="eyebrow">Workspace settings</p>
        <h2 class="settings-surface__title">Settings</h2>
        <p class="settings-surface__lede">
          Manage shell, provider, and application details for the current workspace.
        </p>
      </div>
      <div class="settings-surface__hero-meta">
        <span class="settings-surface__hero-label">Current section</span>
        <strong class="settings-surface__hero-value">{{ activeTabMeta.label }}</strong>
        <span class="settings-surface__hero-summary">{{ activeTabMeta.summary }}</span>
      </div>
    </header>

    <div class="settings-surface__shell">
      <aside class="settings-surface__nav-panel" aria-label="Settings sections">
        <div class="settings-surface__nav-copy">
          <span class="settings-surface__nav-label">Sections</span>
          <p class="settings-surface__nav-text">Core preferences and reference information.</p>
        </div>
        <SettingsTabBar :active-tab="activeTab" @select="activeTab = $event" />
      </aside>

      <div class="settings-surface__content-panel">
        <component :is="tabComponents[activeTab]" />
      </div>
    </div>
  </section>
</template>
