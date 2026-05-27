<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Switch } from '@headlessui/vue'
import { listProviderDescriptors } from '@shared/provider-descriptors'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'
import GlassPathField from '../primitives/GlassPathField.vue'

const { t } = useI18n()
const store = useSettingsStore()
const evolverInferenceProviderOptions = [
  { value: 'claude-code', label: 'Claude Code' }
]

const fetchedModels = ref<string[]>([])
const isCustomModel = ref(false)
const fetchingModels = ref(false)
const fetchModelsError = ref<string | null>(null)
const fetchModelsSuccess = ref(false)

const modelOptions = computed(() => {
  const options = [
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini' }
  ]
  for (const m of fetchedModels.value) {
    if (!options.some(opt => opt.value === m)) {
      options.push({ value: m, label: m })
    }
  }
  options.push({ value: 'custom', label: t('providers.titleGeneration.optionCustom') })
  return options
})

const modelSelectValue = computed(() => {
  if (isCustomModel.value) {
    return 'custom'
  }
  const current = store.titleGeneration.model
  const match = modelOptions.value.find(opt => opt.value === current && opt.value !== 'custom')
  if (match) {
    return match.value
  }
  return 'custom'
})

function handleModelSelectChange(value: string): void {
  if (value === 'custom') {
    isCustomModel.value = true
    if (store.titleGeneration.model === 'gpt-5.4-mini' || store.titleGeneration.model === 'gpt-5-mini') {
      handleTitleGenerationPatch({ model: '' })
    }
  } else {
    isCustomModel.value = false
    handleTitleGenerationPatch({ model: value })
  }
}

function handleCustomModelNameChange(value: string): void {
  handleTitleGenerationPatch({ model: value })
}

async function handleFetchModels(): Promise<void> {
  const baseUrl = store.titleGeneration.baseUrl
  const apiKey = store.titleGeneration.apiKey
  if (!baseUrl || !apiKey.trim()) {
    fetchModelsError.value = t('providers.titleGeneration.missingCredentials')
    fetchModelsSuccess.value = false
    return
  }

  fetchingModels.value = true
  fetchModelsError.value = null
  fetchModelsSuccess.value = false

  try {
    const models = await window.stoa.titleGenerationFetchModels(baseUrl, apiKey)
    fetchedModels.value = models
    fetchModelsSuccess.value = true
    
    if (models.length > 0 && !store.titleGeneration.model) {
      isCustomModel.value = false
      handleTitleGenerationPatch({ model: models[0] })
    }
  } catch (err: any) {
    fetchModelsError.value = err.message || String(err)
  } finally {
    fetchingModels.value = false
  }
}

const providerList = listProviderDescriptors()
  .filter(provider => provider.providerId !== 'local-shell')
  .map(provider => ({ id: provider.providerId, label: provider.displayName }))

const detectedPaths = reactive<Record<string, string | null>>({})
const detecting = ref(true)

onMounted(async () => {
  const current = store.titleGeneration.model
  const defaultValues = ['gpt-5.4-mini', 'gpt-5-mini']
  if (current && !defaultValues.includes(current)) {
    isCustomModel.value = true
  }

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

function handleClaudeDangerouslySkipPermissionsChange(value: boolean): void {
  void store.updateSetting('claudeDangerouslySkipPermissions', value)
}

function handleEvolverInferenceProviderChange(value: string): void {
  if (value === 'claude-code') {
    void store.updateSetting('evolverInferenceProvider', value)
  }
}

function handleTitleGenerationPatch(
  patch: Partial<typeof store.titleGeneration>
): void {
  void store.updateSetting('titleGeneration', {
    ...store.titleGeneration,
    ...patch
  })
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
      <section class="settings-card" :aria-label="t('providers.evolverInference.ariaLabel')">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('providers.evolverInference.title') }}</h4>
            <p class="settings-card__description">
              {{ t('providers.evolverInference.description') }}
            </p>
          </div>
          <span class="settings-card__badge">{{ t('providers.evolverInference.badge') }}</span>
        </div>

        <div class="settings-inline-field" data-settings-field="evolver-inference-provider">
          <GlassFormField
            :label="t('providers.evolverInference.label')"
            type="select"
            :model-value="store.evolverInferenceProvider"
            :options="evolverInferenceProviderOptions"
            @update:model-value="handleEvolverInferenceProviderChange"
          />
        </div>

        <p class="settings-item__hint">
          {{ t('providers.evolverInference.hint') }}
        </p>
      </section>

      <section class="settings-card" :aria-label="t('providers.titleGeneration.ariaLabel')">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('providers.titleGeneration.title') }}</h4>
            <p class="settings-card__description">
              {{ t('providers.titleGeneration.description') }}
            </p>
          </div>
          <span class="settings-card__badge">{{ t('providers.titleGeneration.badge') }}</span>
        </div>

        <div
          class="settings-toggle"
          data-settings-field="title-generation-enabled"
        >
          <div class="settings-toggle__label">
            <span class="settings-toggle__copy">
              <span class="settings-toggle__title">{{ t('providers.titleGeneration.enabled') }}</span>
              <span class="settings-toggle__description">{{ t('providers.titleGeneration.enabledHint') }}</span>
            </span>
            <Switch
              :model-value="store.titleGeneration.enabled"
              class="settings-toggle__switch"
              :class="{ 'settings-toggle__switch--active': store.titleGeneration.enabled }"
              @update:model-value="handleTitleGenerationPatch({ enabled: $event })"
            >
              <span class="settings-toggle__thumb" />
            </Switch>
          </div>
        </div>

        <div class="flex gap-2 items-end">
          <div class="grow min-w-0 settings-inline-field" data-settings-field="title-generation-model">
            <GlassFormField
              :label="t('providers.titleGeneration.modelLabel')"
              type="select"
              :model-value="modelSelectValue"
              :options="modelOptions"
              @update:model-value="handleModelSelectChange"
            />
          </div>
          <button
            class="btn-ghost mb-0.5 min-h-[38px] flex items-center justify-center gap-1.5 shrink-0"
            type="button"
            :disabled="fetchingModels"
            @click="handleFetchModels"
          >
            <svg v-if="fetchingModels" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>{{ fetchingModels ? t('providers.titleGeneration.fetchingModels') : t('providers.titleGeneration.fetchModels') }}</span>
          </button>
        </div>

        <p v-if="fetchModelsError" class="settings-item__hint settings-item__hint--warning">
          {{ fetchModelsError }}
        </p>
        <p v-else-if="fetchModelsSuccess" class="settings-item__hint settings-item__hint--success">
          {{ t('providers.titleGeneration.fetchModelsSuccess') }}
        </p>

        <div v-if="isCustomModel" class="settings-inline-field" data-settings-field="title-generation-custom-model">
          <GlassFormField
            :label="t('providers.titleGeneration.customModelLabel')"
            :model-value="store.titleGeneration.model"
            :placeholder="t('providers.titleGeneration.customModelPlaceholder')"
            @update:model-value="handleCustomModelNameChange"
          />
        </div>

        <div class="settings-inline-field" data-settings-field="title-generation-base-url">
          <GlassFormField
            :label="t('providers.titleGeneration.baseUrlLabel')"
            :model-value="store.titleGeneration.baseUrl"
            :placeholder="t('providers.titleGeneration.baseUrlPlaceholder')"
            @update:model-value="handleTitleGenerationPatch({ baseUrl: $event })"
          />
        </div>

        <div class="settings-inline-field" data-settings-field="title-generation-api-key">
          <GlassFormField
            :label="t('providers.titleGeneration.apiKeyLabel')"
            :model-value="store.titleGeneration.apiKey"
            :placeholder="t('providers.titleGeneration.apiKeyPlaceholder')"
            @update:model-value="handleTitleGenerationPatch({ apiKey: $event })"
          />
        </div>

        <p class="settings-item__hint">
          {{ t('providers.titleGeneration.hint') }}
        </p>
      </section>

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

        <GlassPathField
          :data-settings-field="`provider-${provider.id}`"
          :label="t('providers.executablePath')"
          :model-value="store.providers[provider.id] ?? ''"
          :placeholder="getStatus(provider.id) === 'missing' ? t('providers.placeholderMissing') : t('providers.autoDetected')"
          mono
          :browse-label="t('providers.browse')"
          @update:model-value="store.updateSetting('providers', { ...store.providers, [provider.id]: $event })"
          @browse="browseProvider(provider.id)"
        />

        <p v-if="detecting" class="settings-item__hint">{{ t('providers.detecting') }}</p>
        <p v-else-if="getStatus(provider.id) === 'detected'" class="settings-item__hint settings-item__hint--success">{{ t('providers.autoDetected') }}</p>
        <p v-else-if="getStatus(provider.id) === 'custom'" class="settings-item__hint">{{ t('providers.customPath') }}</p>
        <p v-else class="settings-item__hint settings-item__hint--warning">{{ t('providers.notFound') }}</p>

        <div
          v-if="isClaudeCodeProvider(provider.id)"
          class="settings-toggle"
          data-settings-field="provider-claude-code-dangerously-skip-permissions"
        >
          <div class="settings-toggle__label">
            <span class="settings-toggle__copy">
              <span class="settings-toggle__title">{{ t('providers.claude.skipPermissions') }}</span>
              <span class="settings-toggle__description" v-html="t('providers.claude.skipPermissionsDescription')" />
            </span>
            <Switch
              :model-value="store.claudeDangerouslySkipPermissions"
              class="settings-toggle__switch"
              :class="{ 'settings-toggle__switch--active': store.claudeDangerouslySkipPermissions }"
              @update:model-value="handleClaudeDangerouslySkipPermissionsChange"
            >
              <span class="settings-toggle__thumb" />
            </Switch>
          </div>
        </div>
      </section>
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
  display: grid;
  gap: 6px;
  padding-bottom: 8px;
  border-b: 1px solid var(--color-line);
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

.settings-card {
  display: grid;
  gap: 16px;
  padding: 24px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line-strong);
  box-shadow: var(--shadow-card);
  transition: all 0.2s ease;
}

.settings-card:hover {
  border-color: rgba(0, 85, 255, 0.15);
  box-shadow: var(--shadow-soft);
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.01);
  color: var(--color-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.settings-card__badge--detected {
  background: color-mix(in srgb, var(--color-success) 8%, transparent);
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 12%, transparent);
}

.settings-card__badge--custom {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.settings-card__badge--missing {
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
  color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 12%, transparent);
}

.settings-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.settings-field__main {
  min-width: 0;
}

.settings-inline-field {
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
  color: var(--color-subtle);
  font-size: var(--text-meta);
  font-weight: 400;
}

.settings-item__hint--success {
  color: var(--color-success);
  font-weight: 500;
}

.settings-item__hint--warning {
  color: var(--color-attention);
  font-weight: 500;
}

.settings-toggle {
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.008);
  border: 1px solid var(--color-line);
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

.settings-toggle__description {
  color: var(--color-muted);
  font-size: var(--text-meta);
  line-height: 1.4;
}

.settings-toggle__description code {
  font-family: var(--font-mono);
}

:deep(.settings-toggle__switch) {
  display: inline-flex;
  width: 48px;
  height: 26px;
  padding: 2px;
  border-radius: 999px;
  background: var(--color-black-soft);
  box-shadow: inset 0 0 0 1px var(--color-line);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  flex: 0 0 auto;
}

:deep(.settings-toggle__switch:hover) {
  background: var(--color-black-soft);
}

:deep(.settings-toggle__switch--active) {
  background: var(--color-accent);
  box-shadow: none;
}

:deep(.settings-toggle__switch:focus-visible) {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.settings-toggle__thumb {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line);
  box-shadow: var(--shadow-soft);
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
}

:deep(.settings-toggle__switch--active) .settings-toggle__thumb {
  transform: translateX(22px);
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
