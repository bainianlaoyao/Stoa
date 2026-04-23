<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { listProviderDescriptors } from '@shared/provider-descriptors'
import { useSettingsStore } from '@renderer/stores/settings'

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
  const path = await store.pickFile({ title: `Select ${providerId} executable` })
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
</script>

<template>
  <div role="tabpanel" id="settings-panel-providers" class="settings-panel" aria-label="Provider settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">Providers</p>
        <h3 class="settings-panel__title">Provider runtime paths</h3>
      </div>
      <p class="settings-panel__description">
        Keep executable discovery predictable so provider-backed sessions can start without extra repair work.
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
            <p class="settings-card__description">Set an explicit executable path or let Stoa use the local detected runtime.</p>
          </div>
          <span class="settings-card__badge" :class="`settings-card__badge--${getStatus(provider.id)}`">
            {{ getStatus(provider.id) }}
          </span>
        </div>

        <div class="settings-field" :data-settings-field="`provider-${provider.id}`">
          <label class="form-field settings-field__main">
            <span class="form-field__label">Executable path</span>
            <input
              class="form-field__input settings-item__path-input settings-item__path-input--mono"
              type="text"
              :value="store.providers[provider.id] ?? ''"
              :placeholder="getStatus(provider.id) === 'missing' ? 'not found' : 'Auto-detected'"
              @change="store.updateSetting('providers', { ...store.providers, [provider.id]: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <button class="btn-ghost settings-item__browse" type="button" @click="browseProvider(provider.id)">Browse</button>
        </div>

        <p v-if="detecting" class="settings-item__hint">Detecting...</p>
        <p v-else-if="getStatus(provider.id) === 'detected'" class="settings-item__hint settings-item__hint--success">Auto-detected</p>
        <p v-else-if="getStatus(provider.id) === 'custom'" class="settings-item__hint">Custom path</p>
        <p v-else class="settings-item__hint settings-item__hint--warning">Not found — click Browse to locate</p>
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

@media (max-width: 980px) {
  .settings-field {
    grid-template-columns: 1fr;
  }
}
</style>
