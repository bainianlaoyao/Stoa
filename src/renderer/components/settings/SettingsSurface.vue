<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsTabBar from './SettingsTabBar.vue'
import type { SettingsTab, SettingsTabItem } from './SettingsTabBar.vue'
import GeneralSettings from './GeneralSettings.vue'
import TerminalSettings from './TerminalSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import AboutSettings from './AboutSettings.vue'
import { matchesSettingsQuery, normalizeSettingsQuery } from './settings-search'

const { t } = useI18n()

interface SettingsTabMeta extends SettingsTabItem {
  searchTerms: string[]
}

const tabMeta = computed<SettingsTabMeta[]>(() => [
  {
    id: 'general',
    label: t('settings.tabs.general.label'),
    summary: t('settings.tabs.general.summary'),
    searchTerms: ['general', 'shell', 'font', 'language', 'theme', 'ide']
  },
  {
    id: 'terminal',
    label: t('settings.tabs.terminal.label'),
    summary: t('settings.tabs.terminal.summary'),
    searchTerms: ['terminal', 'cursor', 'scrollback', 'gpu', 'contrast', 'input', 'behavior', 'typography']
  },
  {
    id: 'providers',
    label: t('settings.tabs.providers.label'),
    summary: t('settings.tabs.providers.summary'),
    searchTerms: ['provider', 'providers', 'claude', 'codex', 'opencode', 'title', 'model', 'api key']
  },
  {
    id: 'advanced',
    label: t('settings.tabs.advanced.label'),
    summary: t('settings.tabs.advanced.summary'),
    searchTerms: ['advanced', 'cli', 'stoa-ctl', 'experimental']
  },
  {
    id: 'about',
    label: t('settings.tabs.about.label'),
    summary: t('settings.tabs.about.summary'),
    searchTerms: ['about', 'version', 'updates', 'release', 'documentation', 'github']
  }
])

const activeTab = ref<SettingsTab>('general')
const searchQuery = ref('')

const tabComponents: Record<SettingsTab, Component> = {
  general: GeneralSettings,
  terminal: TerminalSettings,
  providers: ProvidersSettings,
  advanced: AdvancedSettings,
  about: AboutSettings
}

const filteredTabMeta = computed(() => {
  const query = normalizeSettingsQuery(searchQuery.value)
  if (!query) {
    return tabMeta.value
  }

  return tabMeta.value.filter((tab) => matchesSettingsQuery(query, [tab.label, tab.summary, ...tab.searchTerms]))
})

const activeTabMeta = computed(() => filteredTabMeta.value.find((tab) => tab.id === activeTab.value) ?? filteredTabMeta.value[0] ?? null)
const activeTabComponent = computed(() => (activeTabMeta.value ? tabComponents[activeTabMeta.value.id] : null))

function onTabSelect(tab: SettingsTab) {
  activeTab.value = tab
}

watch(filteredTabMeta, (tabs) => {
  if (tabs.length === 0) {
    return
  }

  if (!tabs.some((tab) => tab.id === activeTab.value)) {
    activeTab.value = tabs[0].id
  }
}, { immediate: true })
</script>

<template>
  <section class="settings-surface" data-surface="settings" aria-label="Settings surface">
    <div class="settings-surface__shell">
      <aside class="settings-surface__nav-panel" aria-label="Settings sections">
        <div class="settings-surface__sidebar-header">
          <p class="eyebrow mb-1">{{ t('settings.eyebrow') }}</p>
          <h2 class="settings-surface__title">{{ t('settings.title') }}</h2>
          <p class="settings-surface__lede text-xs mt-1.5 text-muted leading-relaxed">
            {{ t('settings.lede') }}
          </p>
        </div>

        <label class="settings-surface__search" :aria-label="t('settings.searchLabel')">
          <span class="settings-surface__search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" focusable="false">
              <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
              <circle cx="11" cy="11" r="6.25" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </span>
          <input
            v-model="searchQuery"
            class="settings-surface__search-input"
            data-settings-search
            type="search"
            :placeholder="t('settings.searchPlaceholder')"
          >
        </label>

        <div class="settings-surface__nav-copy mt-2">
          <span class="settings-surface__nav-label">{{ t('settings.navLabel') }}</span>
        </div>

        <SettingsTabBar :tabs="filteredTabMeta" :active-tab="activeTab" @select="onTabSelect" />

        <div class="settings-surface__hero-meta mt-auto">
          <template v-if="activeTabMeta">
            <span class="settings-surface__hero-label">{{ t('settings.heroLabel') }}</span>
            <strong class="settings-surface__hero-value">{{ activeTabMeta.label }}</strong>
            <span class="settings-surface__hero-summary">{{ activeTabMeta.summary }}</span>
          </template>
          <template v-else>
            <span class="settings-surface__hero-label">{{ t('settings.heroLabel') }}</span>
            <strong class="settings-surface__hero-value">{{ t('settings.noResultsTitle') }}</strong>
            <span class="settings-surface__hero-summary">{{ t('settings.noResultsDescription') }}</span>
          </template>
        </div>
      </aside>

      <div class="settings-surface__content-panel">
        <component
          :is="activeTabComponent"
          v-if="activeTabComponent"
          :search-query="searchQuery"
        />
        <section v-else class="settings-surface__empty-state" aria-label="No matching settings">
          <p class="eyebrow">{{ t('settings.searchLabel') }}</p>
          <h3 class="settings-surface__empty-title">{{ t('settings.noResultsTitle') }}</h3>
          <p class="settings-surface__empty-description">{{ t('settings.noResultsDescription') }}</p>
        </section>
      </div>
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
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-md);
  background: var(--color-mica);
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
  background: var(--color-mica-alt);
  border-right: 1px solid var(--stroke-divider);
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
}

.settings-surface__search {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-md);
  background: var(--control-fill);
  transition:
    border-color var(--duration-rest) var(--curve-standard),
    background-color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard);
}

.settings-surface__search:focus-within {
  border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
  background: var(--control-fill-hover);
  box-shadow: var(--shadow-focus-ring);
}

.settings-surface__search-icon {
  display: inline-flex;
  color: var(--color-subtle);
}

.settings-surface__search-icon svg {
  width: 16px;
  height: 16px;
}

.settings-surface__search-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  outline: none;
}

.settings-surface__search-input::placeholder {
  color: var(--color-subtle);
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
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-md);
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

.settings-surface__empty-state {
  display: grid;
  gap: 8px;
  align-content: start;
  max-width: 420px;
}

.settings-surface__empty-title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-title);
  font-weight: 700;
}

.settings-surface__empty-description {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-body-sm);
  line-height: 1.5;
}

@media (max-width: 900px) {
  .settings-surface__shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .settings-surface__nav-panel {
    border-right: none;
    border-bottom: 1px solid var(--stroke-divider);
    height: auto;
  }

  .settings-surface__hero-meta {
    display: none;
  }
}
</style>
