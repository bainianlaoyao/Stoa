<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'

const store = useSettingsStore()

const detectedShell = ref<string | null>(null)
const detecting = ref(true)

const fontSizeOptions = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 12),
  label: `${i + 12}px`
}))

onMounted(async () => {
  detectedShell.value = await store.detectAndSetShell()
  detecting.value = false
})

async function handleBrowse(): Promise<void> {
  const path = await store.pickFile({ title: 'Select shell executable' })
  if (path) {
    await store.updateSetting('shellPath', path)
    detectedShell.value = null
  }
}

function handleShellChange(event: Event): void {
  void store.updateSetting('shellPath', (event.target as HTMLInputElement).value)
}

function handleFontSizeChange(value: string): void {
  void store.updateSetting('terminalFontSize', Number(value))
}
</script>

<template>
  <div role="tabpanel" id="settings-panel-general" class="settings-panel" aria-label="General settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">General</p>
        <h3 class="settings-panel__title">Shell and terminal defaults</h3>
      </div>
      <p class="settings-panel__description">
        Configure the default shell path and the monospace scale used by terminal surfaces.
      </p>
    </header>

    <div class="settings-section">
      <section class="settings-card" aria-label="Shell executable">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">Shell executable</h4>
            <p class="settings-card__description">Use the detected shell when available, or point Stoa at a custom binary.</p>
          </div>
          <span class="settings-card__badge settings-card__badge--mono">Path</span>
        </div>

        <div class="settings-field" data-settings-field="shellPath">
          <label class="form-field settings-field__main">
            <span class="form-field__label">Shell path</span>
            <input
              class="form-field__input settings-item__path-input settings-item__path-input--mono"
              type="text"
              :value="store.shellPath"
              placeholder="Auto-detected"
              @change="handleShellChange"
            />
          </label>
          <button class="button-ghost settings-item__browse" type="button" @click="handleBrowse">Browse</button>
        </div>

        <p v-if="detecting" class="settings-item__hint">Detecting...</p>
        <p v-else-if="detectedShell && !store.shellPath" class="settings-item__hint settings-item__hint--success">
          Auto-detected: {{ detectedShell }}
        </p>
        <p v-else-if="store.shellPath && store.shellPath !== detectedShell" class="settings-item__hint">Custom path</p>
        <p v-else-if="detectedShell" class="settings-item__hint settings-item__hint--success">Auto-detected</p>
      </section>

      <section class="settings-card" aria-label="Terminal font size">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">Terminal typography</h4>
            <p class="settings-card__description">Keep command output legible while preserving the tighter console density.</p>
          </div>
          <span class="settings-card__badge">Mono UI</span>
        </div>

        <GlassFormField
          label="Terminal Font Size"
          type="select"
          :model-value="String(store.terminalFontSize)"
          :options="fontSizeOptions"
          data-settings-field="terminalFontSize"
          @update:model-value="handleFontSizeChange"
        />
      </section>
    </div>
  </div>
</template>
