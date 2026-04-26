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

const fontSizeOptions = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 12),
  label: `${i + 12}px`
}))

const fontFamilyOptions = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' }
]

const workspaceIdeOptions = [
  { value: 'vscode', label: 'VS Code' }
]

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

function handleFontSizeChange(value: string): void {
  void store.updateSetting('terminalFontSize', Number(value))
}

function handleFontFamilyChange(value: string): void {
  void store.updateSetting('terminalFontFamily', value)
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

      <section class="settings-card" aria-label="Terminal font size">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.typographySection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.typographySection.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('general.typographySection.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('general.typographySection.title')"
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

.settings-item__detect-row {
  margin-top: 4px;
}

.btn-ghost--sm {
  font-size: 11px;
  padding: 3px 8px;
  min-height: unset;
}

@media (max-width: 980px) {
  .settings-field {
    grid-template-columns: 1fr;
  }
}
</style>
