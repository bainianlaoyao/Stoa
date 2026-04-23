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

const fontFamilyOptions = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' }
]

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

function handleFontFamilyChange(value: string): void {
  void store.updateSetting('terminalFontFamily', value)
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
          <button class="btn-ghost settings-item__browse" type="button" @click="handleBrowse">Browse</button>
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
          label="Font Family"
          type="select"
          :model-value="store.terminalFontFamily"
          :options="fontFamilyOptions"
          data-settings-field="terminalFontFamily"
          @update:model-value="handleFontFamilyChange"
        />
        <GlassFormField
          label="Font Size"
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

.settings-card__badge--mono {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
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
