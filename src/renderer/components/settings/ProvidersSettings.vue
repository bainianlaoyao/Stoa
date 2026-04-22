<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'

const store = useSettingsStore()

const providerList = [
  { id: 'opencode', label: 'OpenCode' }
]

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
  <div role="tabpanel" id="settings-panel-providers" class="settings-surface__content" aria-label="Provider settings">
    <div class="settings-section">
      <div
        v-for="(provider, index) in providerList"
        :key="provider.id"
        class="settings-item"
        :class="{ 'settings-item--bordered': index < providerList.length - 1 }"
      >
        <p class="eyebrow">{{ provider.label }}</p>
        <div class="settings-item__row">
          <input
            class="form-field__input settings-item__path-input"
            type="text"
            :value="store.providers[provider.id] ?? ''"
            :placeholder="getStatus(provider.id) === 'missing' ? 'not found' : 'Auto-detected'"
            :data-settings-field="`provider-${provider.id}`"
            @change="store.updateSetting('providers', { ...store.providers, [provider.id]: ($event.target as HTMLInputElement).value })"
          />
          <button class="button-ghost settings-item__browse" type="button" @click="browseProvider(provider.id)">Browse</button>
        </div>
        <p v-if="detecting" class="settings-item__hint">Detecting...</p>
        <p v-else-if="getStatus(provider.id) === 'detected'" class="settings-item__hint settings-item__hint--success">Auto-detected ✓</p>
        <p v-else-if="getStatus(provider.id) === 'custom'" class="settings-item__hint">Custom path</p>
        <p v-else class="settings-item__hint settings-item__hint--warning">Not found — click Browse to locate</p>
      </div>
    </div>
  </div>
</template>
