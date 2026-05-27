<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'
import GlassPathField from '../primitives/GlassPathField.vue'
import { SUPPORTED_LOCALES } from '@renderer/i18n'

const { t } = useI18n()
const store = useSettingsStore()

const detectedShell = ref<string | null>(null)
const detectedVscode = ref<string | null>(null)
const detecting = ref(true)
const detectingVscode = ref(false)

const workspaceIdeOptions = [
  { value: 'vscode', label: 'VS Code' }
]

const fontFamilyOptions = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' }
]

const fontFamilyCJKOptions = [
  { value: '', label: 'System default' },
  { value: 'Noto Sans Mono CJK SC', label: 'Noto Sans Mono CJK SC' },
  { value: 'Sarasa Mono SC', label: 'Sarasa Mono SC' },
  { value: 'Source Han Mono SC', label: 'Source Han Mono SC' },
  { value: 'Microsoft YaHei', label: 'Microsoft YaHei' }
]

const fontSizeOptions = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 12),
  label: `${i + 12}px`
}))

const languageOptions = SUPPORTED_LOCALES.map((loc) => ({
  value: loc,
  label: t(`language.${loc}`)
}))

onMounted(async () => {
  const [shell, vscode] = await Promise.all([
    store.detectAndSetShell(),
    store.detectAndSetVscode()
  ])
  detectedShell.value = shell
  detectedVscode.value = vscode
  detecting.value = false
})

async function handleBrowse(): Promise<void> {
  const path = await store.pickFile({ title: t('general.shellSection.title') })
  if (path) {
    await store.updateSetting('shellPath', path)
    detectedShell.value = null
  }
}

async function handleWorkspaceIdeBrowse(): Promise<void> {
  const path = await store.pickFile({ title: t('general.workspaceIdeSection.selectExecutable') })
  if (path) {
    await store.updateSetting('workspaceIde', {
      id: store.workspaceIde.id,
      executablePath: path
    })
  }
}

async function handleVscodeAutoDetect(): Promise<void> {
  detectingVscode.value = true
  const detected = await store.detectAndSetVscode(true)
  detectedVscode.value = detected
  detectingVscode.value = false
}

function handleWorkspaceIdeChange(value: string): void {
  if (value === 'vscode') {
    void store.updateSetting('workspaceIde', {
      id: value,
      executablePath: store.workspaceIde.executablePath
    })
  }
}

function handleFontFamilyChange(value: string): void {
  void store.updateSetting('terminal', { ...store.terminal, fontFamily: value })
  applyFontToDocument()
}

function handleFontFamilyCJKChange(value: string): void {
  void store.updateSetting('terminal', { ...store.terminal, fontFamilyCJK: value })
  applyFontToDocument()
}

function handleFontSizeChange(value: string): void {
  void store.updateSetting('terminal', { ...store.terminal, fontSize: Number(value) })
}

function applyFontToDocument(): void {
  const resolved = store.resolvedTerminalSettings()
  const mono = resolved.fontFamily || getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
  const cjk = resolved.fontFamilyCJK
  const stack = cjk ? `${mono}, ${cjk}, monospace` : `${mono}, monospace`
  document.documentElement.style.setProperty('--font-mono', stack)
  if (cjk) {
    document.documentElement.style.setProperty('--font-ui', `'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', Inter, '${cjk}', sans-serif`)
  }
}

async function handleLanguageChange(value: string): Promise<void> {
  await store.applyLocale(value)
  await store.updateSetting('locale', value)
}
</script>

<template>
  <div role="tabpanel" id="settings-panel-general" class="settings-panel" aria-label="General settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">{{ t('general.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('general.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('general.description') }}
      </p>
    </header>

    <div class="settings-section">
      <section class="settings-card" aria-label="Shell executable">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.shellSection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.shellSection.description') }}</p>
          </div>
          <span class="settings-card__badge settings-card__badge--mono">{{ t('general.shellSection.badge') }}</span>
        </div>

        <GlassPathField
          data-settings-field="shellPath"
          :label="t('general.shellSection.label')"
          :model-value="store.shellPath"
          :placeholder="t('general.shellSection.placeholder')"
          mono
          :browse-label="t('general.shellSection.browse')"
          @update:model-value="store.updateSetting('shellPath', $event)"
          @browse="handleBrowse"
        />

        <p v-if="detecting" class="settings-item__hint">{{ t('general.shellSection.detecting') }}</p>
        <p v-else-if="detectedShell && !store.shellPath" class="settings-item__hint settings-item__hint--success">
          {{ t('general.shellSection.autoDetectedWith', { path: detectedShell }) }}
        </p>
        <p v-else-if="store.shellPath && store.shellPath !== detectedShell" class="settings-item__hint">{{ t('general.shellSection.customPath') }}</p>
        <p v-else-if="detectedShell" class="settings-item__hint settings-item__hint--success">{{ t('general.shellSection.autoDetected') }}</p>
      </section>

      <section class="settings-card" aria-label="Workspace quick access">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.workspaceIdeSection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.workspaceIdeSection.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('general.workspaceIdeSection.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('general.workspaceIdeSection.ideLabel')"
          type="select"
          :model-value="store.workspaceIde.id"
          :options="workspaceIdeOptions"
          data-settings-field="workspaceIdeId"
          @update:model-value="handleWorkspaceIdeChange"
        />

        <GlassPathField
          data-settings-field="workspaceIdeExecutablePath"
          :label="t('general.workspaceIdeSection.pathLabel')"
          :model-value="store.workspaceIde.executablePath"
          :placeholder="t('general.workspaceIdeSection.pathPlaceholder')"
          mono
          :browse-label="t('general.workspaceIdeSection.browse')"
          @update:model-value="store.updateSetting('workspaceIde', { id: store.workspaceIde.id, executablePath: $event })"
          @browse="handleWorkspaceIdeBrowse"
        />

        <p v-if="detecting" class="settings-item__hint">{{ t('general.workspaceIdeSection.detecting') }}</p>
        <p v-else-if="detectedVscode && !store.workspaceIde.executablePath" class="settings-item__hint settings-item__hint--success">
          {{ t('general.workspaceIdeSection.autoDetectedWith', { path: detectedVscode }) }}
        </p>
        <p v-else-if="store.workspaceIde.executablePath && store.workspaceIde.executablePath !== detectedVscode" class="settings-item__hint">{{ t('general.workspaceIdeSection.customPath') }}</p>
        <p v-else-if="detectedVscode" class="settings-item__hint settings-item__hint--success">{{ t('general.workspaceIdeSection.autoDetected') }}</p>
        <div v-if="!detecting" class="settings-item__detect-row">
          <button class="btn-ghost btn-ghost--sm" type="button" :disabled="detectingVscode" @click="handleVscodeAutoDetect">
            {{ detectingVscode ? t('general.workspaceIdeSection.detecting') : t('general.workspaceIdeSection.autoDetect') }}
          </button>
        </div>
      </section>

      <section class="settings-card" aria-label="Typography">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.typographySection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.typographySection.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('general.typographySection.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('general.typographySection.fontFamily')"
          type="select"
          :model-value="store.resolvedTerminalSettings().fontFamily"
          :options="fontFamilyOptions"
          data-settings-field="terminalFontFamily"
          @update:model-value="handleFontFamilyChange"
        />
        <GlassFormField
          :label="t('general.typographySection.fontFamilyCJK')"
          type="select"
          :model-value="store.resolvedTerminalSettings().fontFamilyCJK"
          :options="fontFamilyCJKOptions"
          data-settings-field="terminalFontFamilyCJK"
          @update:model-value="handleFontFamilyCJKChange"
        />
        <GlassFormField
          :label="t('general.typographySection.fontSize')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().fontSize)"
          :options="fontSizeOptions"
          data-settings-field="terminalFontSize"
          @update:model-value="handleFontSizeChange"
        />
      </section>

      <section class="settings-card" aria-label="Display language">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.languageSection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.languageSection.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('general.languageSection.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('general.languageSection.title')"
          type="select"
          :model-value="store.locale"
          :options="languageOptions"
          data-settings-field="locale"
          @update:model-value="handleLanguageChange"
        />
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

.settings-card__badge--mono {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
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

.settings-item__detect-row {
  margin-top: 2px;
}

.btn-ghost--sm {
  font-size: var(--text-caption);
  padding: 4px 10px;
  min-height: unset;
}

@media (max-width: 980px) {
  .settings-field {
    grid-template-columns: 1fr;
  }
}
</style>
