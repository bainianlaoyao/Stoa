---
date: 2026-06-08
topic: terminal-settings-ux-refresh-context
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Terminal Settings UX Refresh — Bounded Context

### Why This Was Gathered

Supports implementing the Terminal settings UX refresh (Plan Task 3 + Task 4): collapsible sections, search-query prop, and a new `TerminalSettings.test.ts`. This report gives an implementation agent everything needed without re-reading the codebase.

### Summary

`TerminalSettings.vue` is a flat, 4-card settings panel (Typography, Cursor, Scrolling & Display, Behavior) using `GlassFormField` selects and one text input. It reads via `store.resolvedTerminalSettings()` and writes via `store.updateSetting('terminal', ...)`. The design spec calls for Typography to stay always-visible while the other 3 sections become collapsible. A `searchQuery` prop from `SettingsSurface` should force-expand matched sections. The existing 4 test files in `settings/` show a consistent convention: `happy-dom`, Pinia + `createRendererApiMock()`, `data-settings-field` selectors, and `attachTo: document.body`.

---

### Key Findings

#### 1. Current TerminalSettings.vue Structure

- **Single file component**, `<script setup lang="ts">`, Composition API (`src/renderer/components/settings/TerminalSettings.vue:1-399`).
- Uses `useI18n()` and `useSettingsStore()` (`:6-7`).
- **No props** — pure store-driven (`:1-7`).
- **4 settings cards** in a flat `div.settings-section` (`:130-297`):
  1. **Typography** — `section[aria-label="Typography"]` (`:132-181`), always visible
     - Fields: fontSize, fontWeight, fontWeightBold, lineHeight, letterSpacing (all selects)
  2. **Cursor** — `section[aria-label="Cursor"]` (`:184-217`)
     - Fields: cursorBlink, cursorStyle, cursorInactiveStyle (all selects)
  3. **Scrolling and display** — `section[aria-label="Scrolling and display"]` (`:220-253`)
     - Fields: scrollback, minimumContrastRatio, gpuAcceleration (all selects)
  4. **Behavior** — `section[aria-label="Behavior"]` (`:256-296`)
     - Fields: copyOnSelection, rightClickBehavior, altClickMovesCursor (selects) + wordSeparators (text input)

#### 2. data-settings-field Attributes (MUST Preserve)

All 14 `data-settings-field` values in the current component (`:146-294`):

| Field | data-settings-field | Type | Handler |
|-------|---------------------|------|---------|
| Font size | `terminalFontSize` | select → number | `handleNumberChange` |
| Font weight | `terminalFontWeight` | select → string | `handleStringChange` |
| Bold font weight | `terminalFontWeightBold` | select → string | `handleStringChange` |
| Line height | `terminalLineHeight` | select → number | `handleNumberChange` |
| Letter spacing | `terminalLetterSpacing` | select → number | `handleNumberChange` |
| Cursor blink | `terminalCursorBlink` | select → boolean | `handleBooleanChange` |
| Cursor style | `terminalCursorStyle` | select → string | `handleStringChange` |
| Inactive cursor style | `terminalCursorInactiveStyle` | select → string | `handleStringChange` |
| Scrollback | `terminalScrollback` | select → number | `handleNumberChange` |
| Min contrast | `terminalMinimumContrastRatio` | select → number | `handleNumberChange` |
| GPU accel | `terminalGpuAcceleration` | select → string | `handleStringChange` |
| Copy on selection | `terminalCopyOnSelection` | select → boolean | `handleBooleanChange` |
| Right click | `terminalRightClickBehavior` | select → string | `handleStringChange` |
| Alt+click | `terminalAltClickMovesCursor` | select → boolean | `handleBooleanChange` |
| Word separators | `terminalWordSeparators` | text → string | `handleStringChange` |

These are used by existing topology/contract tests and Playwright journeys. Removing or renaming them will break Tier 3+ tests.

#### 3. Store Interaction Pattern

- **Read**: `store.resolvedTerminalSettings()` returns a fully-normalized `TerminalSettings` object (`src/renderer/stores/settings.ts:95-97`).
- **Write**: `store.updateSetting('terminal', { ...store.terminal, [key]: value })` (`src/renderer/components/settings/TerminalSettings.vue:101-103`). The store merges the partial into its `terminal` ref and calls `window.stoa.setSetting` (`src/renderer/stores/settings.ts:64-69`).
- **Normalization** happens on read via `normalizeTerminalSettings()` (`src/shared/terminal-settings.ts:109-133`), which clamps numerics and fills defaults.
- **Three handler helpers** convert string select values to the right types (`:105-115`):
  - `handleNumberChange(key, value)` → `Number(value)`
  - `handleBooleanChange(key, value)` → `value === 'true'`
  - `handleStringChange(key, value)` → `value` as-is

#### 4. GlassFormField Primitive

- Props: `label`, `modelValue` (string), `type` ('text' | 'select'), `options`, `placeholder` (`src/renderer/components/primitives/GlassFormField.vue:4-10`).
- For `type !== 'select'`: renders `<input data-testid="form-input">` (`:21-26`).
- For `type === 'select'`: renders `<GlassListbox>` (`:28-33`), which uses HeadlessUI `Listbox` with `data-testid="glass-listbox-button"` (`src/renderer/components/primitives/GlassListbox.vue:31-32`).
- In tests, select interactions follow: find `glass-listbox-button` → click → find `li.glass-listbox__option` → click (see `GeneralSettings.test.ts:148-159`).

#### 5. Test Conventions (from 4 existing settings test files)

All 4 test files share this pattern:

1. **Environment**: `// @vitest-environment happy-dom` (first line of every file).
2. **Imports**: `vitest`, `@vue/test-utils` mount, `pinia`, `vue-i18n` (when i18n text assertions needed), component, `RendererApi`, `createRendererApiMock` from `@shared/test-fixtures`.
3. **Mock setup**:
   - `window.stoa = createRendererApiMock()` or `createStoaMock(overrides)` that extends it.
   - `setActivePinia(createPinia())` in `beforeEach`.
   - `document.body.innerHTML = ''` in `afterEach`.
4. **Mount pattern**:
   ```ts
   const wrapper = mount(TerminalSettings, {
     global: { plugins: [createPinia(), createTestI18n()] },
     attachTo: document.body
   })
   ```
   Some tests (GeneralSettings, AdvancedSettings) create a custom i18n instance scoped to the component's messages; others (AboutSettings) rely on the global English defaults.
5. **Selectors**: `wrapper.find('[data-settings-field="..."]')` for field existence; `wrapper.find('[data-testid="glass-listbox-button"]')` for select interaction; CSS class selectors for structural elements.
6. **Select interaction pattern** (from `GeneralSettings.test.ts:148-159`):
   ```ts
   const button = field.find('[data-testid="glass-listbox-button"]')
   await button.trigger('click')
   await nextTick()
   const options = field.findAll('li.glass-listbox__option')
   const target = options.find((li) => li.text().includes('18px'))
   await target!.trigger('click')
   await nextTick()
   ```
7. **Store spy pattern**:
   ```ts
   const setSettingMock = vi.fn().mockResolvedValue(undefined)
   setupVibecodingMock({ setSetting: setSettingMock })
   // ... after interaction ...
   expect(setSettingMock).toHaveBeenCalledWith('terminal', { fontSize: 18 })
   ```

#### 6. Design Spec Requirements for TerminalSettings

From `docs/superpowers/specs/2026-06-08-settings-ui-refresh-design.md:62-68`:

- Typography stays **always visible**.
- Cursor, Scrolling & Display, and Behavior become **collapsible sections**.
- A **search hit on a collapsed section forces it open** while the query is active.
- Accepts `searchQuery` as a **prop** from SettingsSurface (`:83-84`).
- Manages local **expanded section state** (`:84`).
- Filters visible cards by **section keywords** (`:85`).

#### 7. SettingsSurface → Tab Data Flow

- `SettingsSurface.vue` renders `TerminalSettings` inside a HeadlessUI `TabPanel` (`:74-79`).
- Currently **no props** are passed to `TerminalSettings`.
- The design spec says SettingsSurface will own `activeTab` and `searchQuery` and pass `searchQuery` down as a prop to each tab component (`:99-104`).
- The `SettingsSurface.test.ts` (untracked, in working tree) already tests search: `data-settings-search` input, filtering tabs by query, and auto-switching panels.

#### 8. i18n Keys for Terminal Settings

English keys at `src/renderer/i18n/en.ts:87-128`, Chinese at `src/renderer/i18n/zh-CN.ts:87-128`.

Structure:
```
terminalSettings.eyebrow / title / description
terminalSettings.typography.title / description / badge / fontSize / fontWeight / fontWeightBold / lineHeight / letterSpacing
terminalSettings.cursor.title / description / badge / cursorBlink / cursorStyle / cursorInactiveStyle
terminalSettings.display.title / description / badge / scrollback / minimumContrastRatio / gpuAcceleration
terminalSettings.behavior.title / description / badge / copyOnSelection / rightClickBehavior / altClickMovesCursor / wordSeparators
```

No new i18n keys are needed for collapsible sections (the existing title/description/badge keys are reused). If an "Expand/Collapse" accessible label is needed, a new key may be added.

#### 9. CSS Pattern

All scoped CSS follows a consistent pattern (`:301-398`):
- `.settings-panel` → grid container with `gap: 24px`
- `.settings-panel__header` → grid with bottom border
- `.settings-card` → grid card with `padding: 24px`, `border-radius: var(--radius-lg)`, `background: var(--color-surface-solid)`, `border: 1px solid var(--color-line-strong)`
- `.settings-card__header` → flex row with title + badge
- `.settings-card__badge` → uppercase tiny label
- All cards have hover effect (`border-color: rgba(0, 85, 255, 0.15)` — the spec wants this tokenized)

Collapsible sections will need a new CSS pattern for the toggle chevron and collapsed content area.

#### 10. No Existing Collapsible or Search-Query Patterns in Settings

- **Collapsible sections**: None of the 5 settings components currently implement collapsibility. AdvancedSettings has a toggle switch, but not a collapsible section. The collapsible pattern must be invented or follow a Fluent `SettingsExpander`-like approach.
- **searchQuery prop**: No settings component currently accepts a `searchQuery` prop. The design spec introduces this as a new pattern.
- **SettingsSurface search**: The untracked `SettingsSurface.test.ts` file expects a `data-settings-search` input, but `SettingsSurface.vue` does not yet have search. This is in-progress work from Task 1-2 of the plan.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| TerminalSettings has 4 flat cards, no props, no collapsibles | `TerminalSettings.vue` | `:1-399` |
| 14 data-settings-field attributes must be preserved | `TerminalSettings.vue` | `:146-294` |
| Store reads via resolvedTerminalSettings(), writes via updateSetting('terminal', ...) | `TerminalSettings.vue` / `settings.ts` | `:101-103` / `:64-97` |
| GlassFormField uses GlassListbox for selects with data-testid="glass-listbox-button" | `GlassFormField.vue` / `GlassListbox.vue` | `:28-33` / `:31-32` |
| Test convention: happy-dom, Pinia, createRendererApiMock, data-settings-field selectors | All 4 settings test files | `:1-14` (each) |
| Select interaction: click glass-listbox-button → find li.glass-listbox__option → click | `GeneralSettings.test.ts` | `:148-159` |
| Store spy: setupVibecodingMock({ setSetting: vi.fn() }) then assert calls | `AdvancedSettings.test.ts` / `ProvidersSettings.test.ts` | `:87-101` / `:112-136` |
| Design spec: Typography always visible, other 3 collapsible, searchQuery prop | `settings-ui-refresh-design.md` | `:62-68, 83-85` |
| SettingsSurface does not yet pass props to tab components | `SettingsSurface.vue` | `:74-79` |
| i18n keys: 4 sections under terminalSettings.* | `en.ts` / `zh-CN.ts` | `:87-128` / `:87-128` |
| TerminalSettings type: 18 fields, normalized with clamping | `terminal-settings.ts` | `:21-45, 109-133` |
| createRendererApiMock provides full mock with getSettings returning empty terminal | `test-fixtures.ts` | `:107-122` |
| SettingsSurface.test.ts expects data-settings-search but SettingsSurface.vue doesn't have it yet | `SettingsSurface.test.ts` | `:24-51` |
| No existing collapsible section pattern in any settings component | All settings .vue files | N/A |

### Risks / Unknowns

- **[!] SettingsSurface.test.ts is ahead of SettingsSurface.vue** — the search test exists but the feature isn't implemented. TerminalSettings.test.ts should assume `searchQuery` prop will exist when Task 2 is done, but the test must work even if Tasks 1-2 aren't complete (test TerminalSettings in isolation).
- **[!] No shared collapsible primitive exists** — the collapsible section pattern must be built inline in TerminalSettings.vue. If other tabs later need collapsibles, consider extracting to a shared component later, but for now inline is fine.
- **[?] Section keyword list for search filtering** — the design spec says "curated per-tab keywords" but doesn't define them. The implementation agent should derive them from i18n labels + field names and document them in the component.
- **[?] Accessibility** — collapsible sections need `aria-expanded`, a keyboard-toggleable header, and proper focus management. No existing pattern to copy from within this repo.
