<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUpdateStore } from '@renderer/stores/update'
import stoaLogo from '@renderer/assets/icons/gemini-svg.svg'
import { resolveVisibleSettingsSections } from './settings-search'

const props = withDefaults(defineProps<{
  searchQuery?: string
}>(), {
  searchQuery: ''
})

const { t } = useI18n()
const updateStore = useUpdateStore()

type AboutSectionId = 'overview' | 'updates' | 'links'

const currentVersion = computed(() => updateStore.state.currentVersion)
const latestVersion = computed(() => updateStore.state.downloadedVersion ?? updateStore.state.availableVersion)
const updateMessage = computed(() => updateStore.state.message ?? t('about.updates.noActivity'))
const lastCheckedText = computed(() => {
  return updateStore.state.lastCheckedAt
    ? new Date(updateStore.state.lastCheckedAt).toLocaleString()
    : t('about.updates.neverChecked')
})
const updateStatusLabel = computed(() => {
  switch (updateStore.state.phase) {
    case 'available':
      return t('about.updates.statusAvailable')
    case 'downloaded':
      return t('about.updates.statusDownloaded')
    case 'checking':
      return t('about.updates.statusChecking')
    case 'downloading':
      return t('about.updates.statusDownloading')
    case 'up-to-date':
      return t('about.updates.statusUpToDate')
    case 'disabled':
      return t('about.updates.statusDisabled')
    case 'error':
      return t('about.updates.statusError')
    default:
      return t('about.updates.statusIdle')
  }
})
const updateStatusTone = computed(() => {
  switch (updateStore.state.phase) {
    case 'available':
    case 'downloaded':
      return 'settings-card__badge--accent'
    case 'error':
      return 'settings-card__badge--warning'
    case 'up-to-date':
      return 'settings-card__badge--success'
    default:
      return ''
  }
})
const isChecking = computed(() => updateStore.state.phase === 'checking')
const isDownloading = computed(() => updateStore.state.phase === 'downloading')
const isBusy = computed(() => isChecking.value || isDownloading.value)
const actionLabel = computed(() => {
  switch (updateStore.state.phase) {
    case 'checking':
      return t('about.updates.checking')
    case 'available':
      return t('about.updates.downloadNow')
    case 'downloading':
      return t('about.updates.downloading')
    case 'downloaded':
      return t('about.updates.installNow')
    default:
      return t('about.updates.checkForUpdates')
  }
})
const actionDataAttr = computed(() => {
  switch (updateStore.state.phase) {
    case 'available':
    case 'downloading':
      return 'download-update'
    case 'downloaded':
      return 'install-update'
    default:
      return 'check-updates'
  }
})

const visibleSections = computed(() =>
  resolveVisibleSettingsSections<AboutSectionId>(props.searchQuery, {
    overview: [
      t('about.eyebrow'),
      t('about.title'),
      t('about.description'),
      t('about.summary'),
      t('about.stack'),
      'about',
      'stoa',
      'version',
      'electron',
      'vue',
      'node-pty'
    ],
    updates: [
      t('about.eyebrow'),
      t('about.updates.title'),
      t('about.updates.description'),
      updateStatusLabel.value,
      updateMessage.value,
      'about',
      'update',
      'updates',
      'release',
      'download',
      'install',
      'version',
      'check'
    ],
    links: [
      t('about.eyebrow'),
      t('about.links.title'),
      t('about.links.description'),
      t('about.links.github'),
      t('about.links.documentation'),
      t('about.links.reportIssue'),
      'about',
      'github',
      'documentation',
      'docs',
      'issue',
      'report'
    ]
  })
)

const showOverview = computed(() => visibleSections.value.has('overview'))
const showUpdates = computed(() => visibleSections.value.has('updates'))
const showLinks = computed(() => visibleSections.value.has('links'))
const hasSidebar = computed(() => showUpdates.value || showLinks.value)

async function handleAction(): Promise<void> {
  switch (updateStore.state.phase) {
    case 'available':
      await updateStore.downloadUpdate()
      break
    case 'downloaded':
      await updateStore.quitAndInstallUpdate()
      break
    default:
      await updateStore.checkForUpdates()
  }
}
</script>

<template>
  <div role="tabpanel" id="settings-panel-about" class="settings-panel" :aria-label="t('about.eyebrow')">
    <header class="settings-panel__header settings-panel__header--about">
      <div>
        <p class="eyebrow">{{ t('about.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('about.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('about.description') }}
      </p>
    </header>

    <div class="settings-section settings-section--about">
      <section
        v-if="showOverview"
        class="settings-card settings-card--hero settings-about"
        :class="{ 'settings-about--full-span': !hasSidebar }"
        :aria-label="t('about.title')"
      >
        <div class="settings-about__brand">
          <div class="settings-about__logo-container">
            <img :src="stoaLogo" alt="" class="settings-about__logo" aria-hidden="true">
          </div>
          <div class="settings-about__identity">
            <h2 class="settings-about__name">Stoa</h2>
            <span class="settings-about__version">v{{ currentVersion }}</span>
          </div>
        </div>
        <p class="settings-about__summary">{{ t('about.summary') }}</p>
        <span class="settings-about__stack">{{ t('about.stack') }}</span>
      </section>

      <div v-if="hasSidebar" class="settings-about__sidebar">
        <section v-if="showUpdates" class="settings-card settings-about__status-card" :aria-label="t('about.updates.title')">
          <div class="settings-card__header">
            <div>
              <h4 class="settings-card__title">{{ t('about.updates.title') }}</h4>
              <p class="settings-card__description">{{ t('about.updates.description') }}</p>
            </div>
            <span class="settings-card__badge" :class="updateStatusTone">{{ updateStatusLabel }}</span>
          </div>

          <div class="settings-about__status-grid">
            <div class="settings-about__status-row">
              <span class="settings-about__status-label">{{ t('about.updates.currentVersion') }}: </span>
              <strong class="settings-about__status-value">{{ currentVersion }}</strong>
            </div>
            <div v-if="latestVersion" class="settings-about__status-row">
              <span class="settings-about__status-label">{{ t('about.updates.latestVersion') }}: </span>
              <strong class="settings-about__status-value">{{ latestVersion }}</strong>
            </div>
            <div class="settings-about__status-row settings-about__status-row--stacked">
              <span class="settings-about__status-label">{{ t('about.updates.status') }}: </span>
              <p class="settings-about__status-message">{{ updateMessage }}</p>
            </div>
            <div class="settings-about__status-row">
              <span class="settings-about__status-label">{{ t('about.updates.lastChecked') }}: </span>
              <span class="settings-about__status-meta">{{ lastCheckedText }}</span>
            </div>
          </div>

          <div class="settings-about__actions">
            <button
              type="button"
              class="btn-primary"
              :data-settings-action="actionDataAttr"
              :disabled="isBusy"
              @click="void handleAction()"
            >
              {{ actionLabel }}
            </button>
          </div>
        </section>

        <section v-if="showLinks" class="settings-card" :aria-label="t('about.links.title')">
          <div class="settings-card__header">
            <div>
              <h4 class="settings-card__title">{{ t('about.links.title') }}</h4>
              <p class="settings-card__description">{{ t('about.links.description') }}</p>
            </div>
            <span class="settings-card__badge">{{ t('about.links.badge') }}</span>
          </div>

          <div class="settings-about__links">
            <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">{{ t('about.links.github') }}</a>
            <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">{{ t('about.links.documentation') }}</a>
            <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">{{ t('about.links.reportIssue') }}</a>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  display: grid;
  gap: 24px;
  align-content: start;
}

.settings-panel__header {
  border-bottom: 1px solid var(--stroke-divider);
}

.settings-panel__header--about {
  padding-bottom: 8px;
}

.settings-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.settings-panel__description {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
  max-width: 640px;
  font-size: var(--text-body-sm);
}

.settings-section {
  display: grid;
  gap: 20px;
}

.settings-section--about {
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
}

.settings-card {
  transition:
    border-color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard),
    background-color var(--duration-rest) var(--curve-standard);
}

.settings-card:hover {
  border-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
}

.settings-card--hero {
  align-content: start;
}

.settings-about--full-span {
  grid-column: 1 / -1;
}

.settings-card__header {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: start;
}

.settings-card__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.settings-card__description {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.4;
  margin-top: 4px;
  font-size: var(--text-meta);
}

.settings-card__badge {
  background: var(--control-fill);
  border: 1px solid var(--stroke-control);
}

.settings-card__badge--accent {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.settings-card__badge--success {
  background: color-mix(in srgb, var(--color-success) 8%, transparent);
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 12%, transparent);
}

.settings-card__badge--warning {
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
  color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 12%, transparent);
}

.settings-about {
  min-height: 100%;
}

.settings-about__brand {
  display: flex;
  gap: 16px;
  align-items: center;
}

.settings-about__logo-container {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--color-surface-solid);
  border: 1px solid var(--stroke-divider);
  box-shadow: var(--shadow-soft);
  flex-shrink: 0;
}

.settings-about__logo {
  height: 32px;
  width: auto;
}

.settings-about__identity {
  display: grid;
  gap: 2px;
}

.settings-about__name {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.settings-about__version {
  color: var(--color-muted);
  font-size: var(--text-meta);
  font-family: var(--font-mono);
}

.settings-about__summary {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
  font-size: var(--text-body-sm);
}

.settings-about__stack {
  color: var(--color-muted);
  font-size: var(--text-meta);
  display: inline-flex;
  width: fit-content;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--control-fill);
  border: 1px solid var(--stroke-control);
  font-weight: 500;
}

.settings-about__sidebar {
  display: grid;
  gap: 20px;
}

.settings-about__status-card {
  display: grid;
  gap: 16px;
}

.settings-about__status-grid {
  display: grid;
  gap: 12px;
}

.settings-about__status-row {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.settings-about__status-row--stacked {
  display: grid;
  gap: 4px;
}

.settings-about__status-label {
  color: var(--color-subtle);
  font-size: var(--text-caption);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-about__status-value {
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-meta);
  font-weight: 500;
}

.settings-about__status-message {
  margin: 0;
  color: var(--color-text);
  line-height: 1.4;
  font-size: var(--text-body-sm);
}

.settings-about__status-meta {
  color: var(--color-muted);
  font-size: var(--text-meta);
  text-align: right;
}

.settings-about__actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 4px;
}

.settings-about__links {
  display: grid;
  gap: 8px;
}

.settings-about__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--control-fill);
  color: var(--color-text-strong);
  text-decoration: none;
  border: 1px solid var(--color-line);
  font-size: var(--text-body-sm);
  font-weight: 500;
  transition:
    border-color var(--duration-rest) var(--curve-standard),
    background-color var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard);
}

.settings-about__link:hover,
.settings-about__link:focus-visible {
  background: var(--control-fill-hover);
  border-color: var(--stroke-divider);
  outline: none;
}

.settings-about__link::after {
  content: '\2197';
  color: var(--color-subtle);
  font-size: var(--text-meta);
  transition: transform 0.2s ease;
}

.settings-about__link:hover::after {
  transform: translate(1px, -1px);
  color: var(--color-accent);
}

@media (max-width: 980px) {
  .settings-section--about {
    grid-template-columns: 1fr;
  }
}
</style>
