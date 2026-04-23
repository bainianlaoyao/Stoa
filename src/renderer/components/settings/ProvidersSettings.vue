<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { listProviderDescriptors } from '@shared/provider-descriptors'
import { useSettingsStore } from '@renderer/stores/settings'

const { t } = useI18n()
const store = useSettingsStore()

const providerList = listProviderDescriptors()
  .filter(provider => provider.providerId !== 'local-shell')
  .map(provider => ({ id: provider.providerId, label: provider.displayName }))

const detectedPaths = reactive<Record<string, string | null>>({})
const detecting = ref(true)

onMounted(async () => {
  detecting.value = true
  for (const provider of providerList) {
    detectedPaths[provider.id] = await store.detectAndSetProvider(provider.id)
  }
  detecting.value = false
})

async function browseProvider(providerId: string): Promise<void> {
  const path = await store.pickFile({ title: t('providers.selectExecutable', { provider: providerId }) })
  if (path) {
    const updated = { ...store.providers, [providerId]: path }
    await store.updateSetting('providers', updated)
    detectedPaths[providerId] = null
  }
}

function getStatus(providerId: string): 'detected' | 'custom' | 'missing' {
  const configured = store.providers[providerId]
  const detected = detectedPaths[providerId]
  if (configured && configured === detected) return 'detected'
  if (configured) return 'custom'
  if (detected) return 'detected'
  return 'missing'
}

function isClaudeCodeProvider(providerId: string): boolean {
  return providerId === 'claude-code'
}

function handleClaudeDangerouslySkipPermissionsChange(event: Event): void {
  void store.updateSetting(
    'claudeDangerouslySkipPermissions',
    (event.target as HTMLInputElement).checked
  )
}
</script>

<template>
  <div role="tabpanel" id="settings-panel-providers" class="settings-panel" aria-label="Provider settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">{{ t('providers.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('providers.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('providers.description') }}
      </p>
    </header>

    <div class="settings-section">
      <section
        v-for="provider in providerList"
        :key="provider.id"
        class="settings-card"
        :aria-label="`${provider.label} provider`"
      >
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ provider.label }}</h4>
            <p class="settings-card__description">{{ t('providers.cardDescription') }}</p>
          </div>
          <span class="settings-card__badge" :class="`settings-card__badge--${getStatus(provider.id)}`">
            {{ getStatus(provider.id) }}
          </span>
        </div>

        <div class="settings-field" :data-settings-field="`provider-${provider.id}`">
          <label class="form-field settings-field__main">
            <span class="form-field__label">{{ t('providers.executablePath') }}</span>
            <input
              class="form-field__input settings-item__path-input settings-item__path-input--mono"
              type="text"
              :value="store.providers[provider.id] ?? ''"
              :placeholder="getStatus(provider.id) === 'missing' ? t('providers.placeholderMissing') : t('providers.autoDetected')"
              @change="store.updateSetting('providers', { ...store.providers, [provider.id]: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <button class="btn-ghost settings-item__browse" type="button" @click="browseProvider(provider.id)">{{ t('providers.browse') }}</button>
        </div>

        <p v-if="detecting" class="settings-item__hint">{{ t('providers.detecting') }}</p>
        <p v-else-if="getStatus(provider.id) === 'detected'" class="settings-item__hint settings-item__hint--success">{{ t('providers.autoDetected') }}</p>
        <p v-else-if="getStatus(provider.id) === 'custom'" class="settings-item__hint">{{ t('providers.customPath') }}</p>
        <p v-else class="settings-item__hint settings-item__hint--warning">{{ t('providers.notFound') }}</p>

        <div
          v-if="isClaudeCodeProvider(provider.id)"
          class="settings-toggle"
          data-settings-field="provider-claude-code-dangerously-skip-permissions"
        >
          <label class="settings-toggle__label">
            <span class="settings-toggle__copy">
              <span class="settings-toggle__title">Skip Claude permission prompts</span>
              <span class="settings-toggle__description">
                Append <code>--dangerously-skip-permissions</code> when starting or resuming Claude sessions.
              </span>
            </span>
            <span class="settings-toggle__control">
              <input
                class="settings-toggle__input"
                type="checkbox"
                :checked="store.claudeDangerouslySkipPermissions"
                @change="handleClaudeDangerouslySkipPermissionsChange"
              />
              <span class="settings-toggle__track" aria-hidden="true">
                <span class="settings-toggle__thumb" />
              </span>
            </span>
          </label>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-panel__header {
  display: grid;
  gap: 8px;
}

.settings-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-title);
  font-weight: 600;
}

.settings-panel__description {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
  max-width: 640px;
  font-size: var(--text-body);
}

.settings-section {
  display: grid;
  gap: 14px;
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
  font-size: var(--text-title-sm);
  font-weight: 600;
}

.settings-card__description {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
  margin-top: 4px;
  font-size: var(--text-body-sm);
}

.settings-card__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--color-black-faint);
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.settings-card__badge--detected {
  background: var(--shadow-success-ring);
  color: var(--color-success);
}

.settings-card__badge--custom {
  background: var(--color-black-soft);
  color: var(--color-accent);
}

.settings-card__badge--missing {
  background: var(--color-black-faint);
  color: var(--color-attention);
}

.settings-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.settings-field__main {
  min-width: 0;
}

.settings-item__path-input--mono {
  font-family: var(--font-mono);
}

.settings-item__browse {
  min-height: 38px;
}

.settings-item__hint {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}

.settings-item__hint--success {
  color: var(--color-success);
}

.settings-item__hint--warning {
  color: var(--color-attention);
}

.settings-toggle {
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--color-black-faint);
  border: 1px solid var(--color-black-soft);
}

.settings-toggle__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}

.settings-toggle__copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.settings-toggle__title {
  color: var(--color-text-strong);
  font-size: var(--text-body);
  font-weight: 600;
}

.settings-toggle__description {
  color: var(--color-muted);
  font-size: var(--text-body-sm);
  line-height: 1.5;
}

.settings-toggle__description code {
  font-family: var(--font-mono);
}

.settings-toggle__control {
  position: relative;
  flex: 0 0 auto;
}

.settings-toggle__input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.settings-toggle__track {
  display: inline-flex;
  width: 52px;
  height: 30px;
  padding: 3px;
  border-radius: 999px;
  background: var(--color-black-soft);
  box-shadow: inset 0 0 0 1px var(--color-black-soft);
  transition: background 160ms ease;
}

.settings-toggle__thumb {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-text-strong);
  transform: translateX(0);
  transition: transform 160ms ease;
}

.settings-toggle__input:checked + .settings-toggle__track {
  background: var(--color-accent);
}

.settings-toggle__input:checked + .settings-toggle__track .settings-toggle__thumb {
  transform: translateX(22px);
}

.settings-toggle__input:focus-visible + .settings-toggle__track {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

@media (max-width: 980px) {
  .settings-field {
    grid-template-columns: 1fr;
  }

  .settings-toggle__label {
    align-items: start;
  }
}
</style>
