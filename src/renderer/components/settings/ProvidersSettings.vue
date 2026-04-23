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
