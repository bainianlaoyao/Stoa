<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { resolveVisibleSettingsSections } from './settings-search'

const props = withDefaults(defineProps<{
  searchQuery?: string
}>(), {
  searchQuery: ''
})

const { t } = useI18n()
const store = useSettingsStore()

type AdvancedSectionId = 'stoactl'

const visibleSections = computed(() =>
  resolveVisibleSettingsSections<AdvancedSectionId>(props.searchQuery, {
    stoactl: [
      t('settings.tabs.advanced.label'),
      t('settings.stoactlToggle.title'),
      t('settings.stoactlToggle.description'),
      'advanced',
      'cli',
      'stoa ctl',
      'stoa-ctl',
      'experimental'
    ]
  })
)

function isSectionVisible(sectionId: AdvancedSectionId): boolean {
  return visibleSections.value.has(sectionId)
}

async function onStoaCtlToggle(): Promise<void> {
  const next = !store.stoaCtlEnabled
  if (next) {
    const confirmed = window.confirm(t('settings.stoactlToggle.warningOnEnable'))
    if (!confirmed) return
  }
  await store.updateSetting('stoaCtlEnabled', next)
}
</script>

<template>
  <section class="advanced-settings" data-surface="advanced-settings" aria-label="Advanced settings">
    <header class="advanced-settings__header">
      <p class="eyebrow">{{ t('settings.tabs.advanced.label') }}</p>
      <h2 class="advanced-settings__title">{{ t('settings.tabs.advanced.label') }}</h2>
      <p class="advanced-settings__description">
        {{ t('settings.tabs.advanced.summary') }}
      </p>
    </header>

    <div class="settings-section">
      <section v-if="isSectionVisible('stoactl')" class="settings-card" data-settings-card="stoactl-toggle">
        <div class="settings-card__header">
          <div>
            <h3 class="settings-card__title">{{ t('settings.stoactlToggle.title') }}</h3>
            <p class="settings-card__description">
              {{ t('settings.stoactlToggle.description') }}
            </p>
          </div>
        </div>

        <div
          class="settings-toggle"
          data-testid="settings-stoactl-toggle-row"
          data-settings-field="stoactl-enabled"
        >
          <div class="settings-toggle__label">
            <span class="settings-toggle__copy">
              <span class="settings-toggle__title">
                {{ store.stoaCtlEnabled
                  ? t('settings.stoactlToggle.enabledLabel')
                  : t('settings.stoactlToggle.disabledLabel') }}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              :aria-checked="store.stoaCtlEnabled"
              data-testid="settings-stoactl-toggle"
              :aria-label="t('settings.stoactlToggle.title')"
              :class="['settings-toggle__switch', { 'settings-toggle__switch--active': store.stoaCtlEnabled }]"
              @click="onStoaCtlToggle"
            >
              <span class="settings-toggle__thumb" />
            </button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.advanced-settings {
  display: grid;
  gap: 24px;
  align-content: start;
}

.advanced-settings__header {
  display: grid;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-line);
}

.advanced-settings__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.advanced-settings__description {
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

.settings-card {
  display: grid;
  gap: 16px;
  padding: 24px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line-strong);
  box-shadow: var(--shadow-card);
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
  margin: 4px 0 0 0;
  color: var(--color-muted);
  line-height: 1.4;
  font-size: var(--text-meta);
}

.settings-toggle {
  background: var(--control-fill);
  border: 1px solid var(--stroke-control);
}

.settings-toggle__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-toggle__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.settings-toggle__title {
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.settings-toggle__switch {
  background: var(--control-fill);
  box-shadow: inset 0 0 0 1px var(--stroke-control);
}

.settings-toggle__switch:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.settings-toggle__switch--active {
  background: var(--color-accent);
  box-shadow: none;
}

.settings-toggle__thumb {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-surface-solid);
  border: 1px solid var(--stroke-control);
  box-shadow: var(--shadow-soft);
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.settings-toggle__switch--active .settings-toggle__thumb {
  transform: translateX(22px);
}

@media (max-width: 980px) {
  .settings-toggle__label {
    align-items: start;
  }
}
</style>
