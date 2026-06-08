<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'
import { matchesSettingsQuery, normalizeSettingsQuery } from './settings-search'

const props = withDefaults(defineProps<{
  searchQuery?: string
}>(), {
  searchQuery: ''
})

const { t } = useI18n()
const store = useSettingsStore()

type TerminalSectionId = 'typography' | 'cursor' | 'display' | 'behavior'
type DenseTerminalSectionId = Exclude<TerminalSectionId, 'typography'>

const expandedSections = reactive<Record<DenseTerminalSectionId, boolean>>({
  cursor: false,
  display: false,
  behavior: false
})

const normalizedSearchQuery = computed(() => normalizeSettingsQuery(props.searchQuery))
const hasSearchQuery = computed(() => normalizedSearchQuery.value.length > 0)

const sectionTerms: Record<TerminalSectionId, string[]> = {
  typography: ['terminal', 'typography', 'font', 'weight', 'line height', 'letter spacing', 'text'],
  cursor: ['terminal', 'cursor', 'blink', 'inactive cursor', 'block', 'underline', 'bar'],
  display: ['terminal', 'display', 'scrollback', 'contrast', 'gpu', 'scrolling'],
  behavior: ['terminal', 'behavior', 'copy on selection', 'right click', 'alt click', 'word separators', 'input']
}

const fontSizeOptions = Array.from({ length: 27 }, (_, i) => ({
  value: String(i + 6),
  label: `${i + 6}px`
}))

const fontWeightOptions = [
  { value: 'normal', label: 'Normal' },
  { value: 'bold', label: 'Bold' }
]

const lineHeightOptions = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 2.0].map((value) => ({
  value: String(value),
  label: String(value)
}))

const letterSpacingOptions = Array.from({ length: 15 }, (_, i) => {
  const value = -2 + i * 0.5
  return { value: String(value), label: `${value}px` }
})

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

const scrollbackOptions = [100, 500, 1000, 5000, 10000, 50000].map((value) => ({
  value: String(value),
  label: value.toLocaleString()
}))

const gpuAccelerationOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

const minimumContrastRatioOptions = [1, 2, 3, 4.5, 6, 10].map((value) => ({
  value: String(value),
  label: String(value)
}))

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

function isSectionVisible(sectionId: TerminalSectionId): boolean {
  return matchesSettingsQuery(normalizedSearchQuery.value, sectionTerms[sectionId])
}

function isSectionExpanded(sectionId: DenseTerminalSectionId): boolean {
  if (hasSearchQuery.value && isSectionVisible(sectionId)) {
    return true
  }

  return expandedSections[sectionId]
}

function toggleSection(sectionId: DenseTerminalSectionId): void {
  if (hasSearchQuery.value && isSectionVisible(sectionId)) {
    return
  }

  expandedSections[sectionId] = !expandedSections[sectionId]
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
      <section v-if="isSectionVisible('typography')" class="settings-card" aria-label="Typography">
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

      <section v-if="isSectionVisible('cursor')" class="settings-card settings-card--collapsible" aria-label="Cursor">
        <button
          class="settings-card__expander"
          type="button"
          data-settings-section-toggle="cursor"
          :aria-expanded="isSectionExpanded('cursor')"
          @click="toggleSection('cursor')"
        >
          <div class="settings-card__header">
            <div>
              <h4 class="settings-card__title">{{ t('terminalSettings.cursor.title') }}</h4>
              <p class="settings-card__description">{{ t('terminalSettings.cursor.description') }}</p>
            </div>
            <span class="settings-card__meta">
              <span class="settings-card__badge">{{ t('terminalSettings.cursor.badge') }}</span>
              <span class="settings-card__chevron" :class="{ 'settings-card__chevron--expanded': isSectionExpanded('cursor') }" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" focusable="false">
                  <path d="M4 6l4 4l4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" />
                </svg>
              </span>
            </span>
          </div>
        </button>

        <div v-if="isSectionExpanded('cursor')" class="settings-card__content">
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
        </div>
      </section>

      <section v-if="isSectionVisible('display')" class="settings-card settings-card--collapsible" aria-label="Scrolling and display">
        <button
          class="settings-card__expander"
          type="button"
          data-settings-section-toggle="display"
          :aria-expanded="isSectionExpanded('display')"
          @click="toggleSection('display')"
        >
          <div class="settings-card__header">
            <div>
              <h4 class="settings-card__title">{{ t('terminalSettings.display.title') }}</h4>
              <p class="settings-card__description">{{ t('terminalSettings.display.description') }}</p>
            </div>
            <span class="settings-card__meta">
              <span class="settings-card__badge">{{ t('terminalSettings.display.badge') }}</span>
              <span class="settings-card__chevron" :class="{ 'settings-card__chevron--expanded': isSectionExpanded('display') }" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" focusable="false">
                  <path d="M4 6l4 4l4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" />
                </svg>
              </span>
            </span>
          </div>
        </button>

        <div v-if="isSectionExpanded('display')" class="settings-card__content">
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
        </div>
      </section>

      <section v-if="isSectionVisible('behavior')" class="settings-card settings-card--collapsible" aria-label="Behavior">
        <button
          class="settings-card__expander"
          type="button"
          data-settings-section-toggle="behavior"
          :aria-expanded="isSectionExpanded('behavior')"
          @click="toggleSection('behavior')"
        >
          <div class="settings-card__header">
            <div>
              <h4 class="settings-card__title">{{ t('terminalSettings.behavior.title') }}</h4>
              <p class="settings-card__description">{{ t('terminalSettings.behavior.description') }}</p>
            </div>
            <span class="settings-card__meta">
              <span class="settings-card__badge">{{ t('terminalSettings.behavior.badge') }}</span>
              <span class="settings-card__chevron" :class="{ 'settings-card__chevron--expanded': isSectionExpanded('behavior') }" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" focusable="false">
                  <path d="M4 6l4 4l4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" />
                </svg>
              </span>
            </span>
          </div>
        </button>

        <div v-if="isSectionExpanded('behavior')" class="settings-card__content">
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
  border-bottom: 1px solid var(--stroke-divider);
}

.settings-card {
  transition:
    border-color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard),
    background-color var(--duration-rest) var(--curve-standard);
}

.settings-card:hover {
  border-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
}

.settings-card__badge {
  background: var(--control-fill);
  border: 1px solid var(--stroke-control);
}

.settings-card--collapsible {
  gap: 12px;
}

.settings-card__expander {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-card__expander:focus-visible {
  outline: none;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-focus-ring);
}

.settings-card__meta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.settings-card__chevron {
  display: inline-flex;
  color: var(--color-subtle);
  transition:
    transform var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard);
}

.settings-card__chevron svg {
  width: 16px;
  height: 16px;
}

.settings-card__chevron--expanded {
  transform: rotate(180deg);
  color: var(--color-accent);
}

.settings-card__content {
  display: grid;
  gap: 16px;
}

@media (max-width: 980px) {
  .settings-card__header {
    align-items: start;
  }
}
</style>
