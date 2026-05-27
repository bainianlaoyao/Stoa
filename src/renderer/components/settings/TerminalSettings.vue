<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'

const { t } = useI18n()
const store = useSettingsStore()

// ---------------------------------------------------------------------------
// Typography options
// ---------------------------------------------------------------------------

const fontSizeOptions = Array.from({ length: 27 }, (_, i) => ({
  value: String(i + 6),
  label: `${i + 6}px`
}))

const fontWeightOptions = [
  { value: 'normal', label: 'Normal' },
  { value: 'bold', label: 'Bold' }
]

const lineHeightOptions = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 2.0].map((v) => ({
  value: String(v),
  label: String(v)
}))

const letterSpacingOptions = Array.from({ length: 15 }, (_, i) => {
  const val = -2 + i * 0.5
  return { value: String(val), label: `${val}px` }
})

// ---------------------------------------------------------------------------
// Cursor options
// ---------------------------------------------------------------------------

const cursorBlinkOptions = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' }
]

const cursorStyleOptions = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' }
]

const cursorInactiveStyleOptions = [
  { value: 'outline', label: 'Outline' },
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
  { value: 'none', label: 'None' }
]

// ---------------------------------------------------------------------------
// Scrolling & display options
// ---------------------------------------------------------------------------

const scrollbackOptions = [100, 500, 1000, 5000, 10000, 50000].map((v) => ({
  value: String(v),
  label: v.toLocaleString()
}))

const gpuAccelerationOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

const minimumContrastRatioOptions = [1, 2, 3, 4.5, 6, 10].map((v) => ({
  value: String(v),
  label: String(v)
}))

// ---------------------------------------------------------------------------
// Behavior options
// ---------------------------------------------------------------------------

const copyOnSelectionOptions = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' }
]

const rightClickBehaviorOptions = [
  { value: 'default', label: 'Default' },
  { value: 'paste', label: 'Paste' },
  { value: 'selectWord', label: 'Select word' },
  { value: 'nothing', label: 'Nothing' }
]

const altClickMovesCursorOptions = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' }
]

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------

function updateTerminal(key: string, value: unknown): void {
  void store.updateSetting('terminal', { ...store.terminal, [key]: value })
}

function handleNumberChange(key: string, value: string): void {
  updateTerminal(key, Number(value))
}

function handleBooleanChange(key: string, value: string): void {
  updateTerminal(key, value === 'true')
}

function handleStringChange(key: string, value: string): void {
  updateTerminal(key, value)
}
</script>

<template>
  <div role="tabpanel" id="settings-panel-terminal" class="settings-panel" aria-label="Terminal settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">{{ t('terminalSettings.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('terminalSettings.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('terminalSettings.description') }}
      </p>
    </header>

    <div class="settings-section">
      <!-- Card 1: Typography -->
      <section class="settings-card" aria-label="Typography">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('terminalSettings.typography.title') }}</h4>
            <p class="settings-card__description">{{ t('terminalSettings.typography.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('terminalSettings.typography.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('terminalSettings.typography.fontSize')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().fontSize)"
          :options="fontSizeOptions"
          data-settings-field="terminalFontSize"
          @update:model-value="handleNumberChange('fontSize', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.typography.fontWeight')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().fontWeight)"
          :options="fontWeightOptions"
          data-settings-field="terminalFontWeight"
          @update:model-value="handleStringChange('fontWeight', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.typography.fontWeightBold')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().fontWeightBold)"
          :options="fontWeightOptions"
          data-settings-field="terminalFontWeightBold"
          @update:model-value="handleStringChange('fontWeightBold', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.typography.lineHeight')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().lineHeight)"
          :options="lineHeightOptions"
          data-settings-field="terminalLineHeight"
          @update:model-value="handleNumberChange('lineHeight', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.typography.letterSpacing')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().letterSpacing)"
          :options="letterSpacingOptions"
          data-settings-field="terminalLetterSpacing"
          @update:model-value="handleNumberChange('letterSpacing', $event)"
        />
      </section>

      <!-- Card 2: Cursor -->
      <section class="settings-card" aria-label="Cursor">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('terminalSettings.cursor.title') }}</h4>
            <p class="settings-card__description">{{ t('terminalSettings.cursor.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('terminalSettings.cursor.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('terminalSettings.cursor.cursorBlink')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().cursorBlink)"
          :options="cursorBlinkOptions"
          data-settings-field="terminalCursorBlink"
          @update:model-value="handleBooleanChange('cursorBlink', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.cursor.cursorStyle')"
          type="select"
          :model-value="store.resolvedTerminalSettings().cursorStyle"
          :options="cursorStyleOptions"
          data-settings-field="terminalCursorStyle"
          @update:model-value="handleStringChange('cursorStyle', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.cursor.cursorInactiveStyle')"
          type="select"
          :model-value="store.resolvedTerminalSettings().cursorInactiveStyle"
          :options="cursorInactiveStyleOptions"
          data-settings-field="terminalCursorInactiveStyle"
          @update:model-value="handleStringChange('cursorInactiveStyle', $event)"
        />
      </section>

      <!-- Card 3: Scrolling & Display -->
      <section class="settings-card" aria-label="Scrolling and display">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('terminalSettings.display.title') }}</h4>
            <p class="settings-card__description">{{ t('terminalSettings.display.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('terminalSettings.display.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('terminalSettings.display.scrollback')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().scrollback)"
          :options="scrollbackOptions"
          data-settings-field="terminalScrollback"
          @update:model-value="handleNumberChange('scrollback', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.display.minimumContrastRatio')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().minimumContrastRatio)"
          :options="minimumContrastRatioOptions"
          data-settings-field="terminalMinimumContrastRatio"
          @update:model-value="handleNumberChange('minimumContrastRatio', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.display.gpuAcceleration')"
          type="select"
          :model-value="store.resolvedTerminalSettings().gpuAcceleration"
          :options="gpuAccelerationOptions"
          data-settings-field="terminalGpuAcceleration"
          @update:model-value="handleStringChange('gpuAcceleration', $event)"
        />
      </section>

      <!-- Card 4: Behavior -->
      <section class="settings-card" aria-label="Behavior">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('terminalSettings.behavior.title') }}</h4>
            <p class="settings-card__description">{{ t('terminalSettings.behavior.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('terminalSettings.behavior.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('terminalSettings.behavior.copyOnSelection')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().copyOnSelection)"
          :options="copyOnSelectionOptions"
          data-settings-field="terminalCopyOnSelection"
          @update:model-value="handleBooleanChange('copyOnSelection', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.behavior.rightClickBehavior')"
          type="select"
          :model-value="store.resolvedTerminalSettings().rightClickBehavior"
          :options="rightClickBehaviorOptions"
          data-settings-field="terminalRightClickBehavior"
          @update:model-value="handleStringChange('rightClickBehavior', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.behavior.altClickMovesCursor')"
          type="select"
          :model-value="String(store.resolvedTerminalSettings().altClickMovesCursor)"
          :options="altClickMovesCursorOptions"
          data-settings-field="terminalAltClickMovesCursor"
          @update:model-value="handleBooleanChange('altClickMovesCursor', $event)"
        />
        <GlassFormField
          :label="t('terminalSettings.behavior.wordSeparators')"
          type="text"
          :model-value="store.resolvedTerminalSettings().wordSeparators"
          data-settings-field="terminalWordSeparators"
          @update:model-value="handleStringChange('wordSeparators', $event)"
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

@media (max-width: 980px) {
  .settings-field {
    grid-template-columns: 1fr;
  }
}
</style>
