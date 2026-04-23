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

<style scoped>
.settings-surface {
  display: grid;
  gap: 18px;
  min-height: 100%;
  padding: 22px;
  align-content: start;
}

.settings-surface__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 16px;
  align-items: end;
  padding: 20px 22px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.settings-surface__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.settings-surface__lede {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.settings-surface__hero-meta {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 16px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-solid);
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
  font-size: 14px;
  font-weight: 600;
}

.settings-surface__hero-summary {
  color: var(--color-muted);
  font-size: 12px;
}

.settings-surface__shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.settings-surface__nav-panel {
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 18px;
  min-height: 0;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.settings-surface__nav-label {
  color: var(--color-subtle);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-surface__nav-text {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.settings-surface__content-panel {
  overflow: auto;
  min-height: 0;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

@media (max-width: 980px) {
  .settings-surface__hero,
  .settings-surface__shell {
    grid-template-columns: 1fr;
  }

  .settings-surface {
    padding: 16px;
  }
}
</style>
