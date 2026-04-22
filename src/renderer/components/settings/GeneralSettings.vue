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
  <div role="tabpanel" id="settings-panel-general" class="settings-surface__content" aria-label="General settings">
    <div class="settings-section">
      <div class="settings-item settings-item--bordered">
        <p class="eyebrow">Shell Path</p>
        <div class="settings-item__row">
          <input
            class="form-field__input settings-item__path-input"
            type="text"
            :value="store.shellPath"
            placeholder="Auto-detected"
            data-settings-field="shellPath"
            @change="handleShellChange"
          />
          <button class="button-ghost settings-item__browse" type="button" @click="handleBrowse">Browse</button>
        </div>
        <p v-if="detecting" class="settings-item__hint">Detecting...</p>
        <p v-else-if="detectedShell && !store.shellPath" class="settings-item__hint settings-item__hint--success">
          Auto-detected: {{ detectedShell }} ✓
        </p>
        <p v-else-if="store.shellPath && store.shellPath !== detectedShell" class="settings-item__hint">Custom path</p>
        <p v-else-if="detectedShell" class="settings-item__hint settings-item__hint--success">Auto-detected ✓</p>
      </div>

      <div class="settings-item">
        <GlassFormField
          label="Terminal Font Size"
          type="select"
          :model-value="String(store.terminalFontSize)"
          :options="fontSizeOptions"
          data-settings-field="terminalFontSize"
          @update:model-value="handleFontSizeChange"
        />
      </div>
    </div>
  </div>
</template>
