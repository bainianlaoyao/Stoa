---
date: 2026-06-07
topic: Settings UI implementation map
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Settings UI Implementation

### Why This Was Gathered
Map the current Settings UI architecture to support future changes (adding/removing tabs, refactoring layout, extending fields) without breaking tests, tokens, or i18n contracts.

### Summary
The Settings UI is a two-panel surface (`SettingsSurface.vue`) with a glassmorphic left sidebar for tab navigation and a solid right content panel. It hosts five tabs — General, Terminal, Providers, Advanced, and About — each rendered as an independent `<TabPanel>`. All tabs share a common card-based layout pattern (`settings-card` CSS class), use shared primitives (`GlassFormField`, `GlassPathField`, `GlassListbox`), and read/write state via a single Pinia store (`useSettingsStore`). Every tab has component-level tests. The surface is conditionally mounted in `AppShell.vue` when `activeSurface === 'settings'`.

### Key Findings

#### 1. Component Tree
```
AppShell.vue (activeSurface === 'settings')
  └── SettingsSurface.vue          ← shell: grid 280px | 1fr, TabGroup
        ├── SettingsTabBar.vue      ← sidebar tab list with icons + summaries
        ├── GeneralSettings.vue     ← shell, IDE, typography, theme, language
        ├── TerminalSettings.vue    ← cursor, scroll, display, behavior options
        ├── ProvidersSettings.vue   ← provider paths, evolver, title-gen API
        ├── AdvancedSettings.vue    ← stoa-ctl toggle (only card)
        └── AboutSettings.vue       ← brand hero, update status, links
```

#### 2. Shared Primitives
- `GlassFormField.vue` — select / text input wrapper with label, listbox-based dropdown
- `GlassPathField.vue` — text input + Browse button for file paths
- `GlassListbox.vue` — headless listbox used by GlassFormField for selects

#### 3. State Management
Single Pinia store at `src/renderer/stores/settings.ts`:
- **Refs**: `shellPath`, `terminal`, `providers`, `titleGeneration`, `workspaceIde`, `evolverInferenceProvider`, `evolverExecutionMode`, `claudeDangerouslySkipPermissions`, `stoaCtlEnabled`, `locale`, `theme`, `loaded`
- **Key methods**: `loadSettings()`, `updateSetting(key, value)`, `resolvedTerminalSettings()`, `detectAndSetShell()`, `detectAndSetProvider()`, `detectAndSetVscode()`, `pickFile()`, `applyLocale()`, `applyTheme()`
- **Persistence**: All writes go through `window.stoa.setSetting(key, value)` (IPC to main process)

#### 4. i18n Keys
All settings strings are in `src/renderer/i18n/en.ts` under these top-level keys:
- `settings.*` — surface chrome, tab meta, stoa-ctl toggle
- `general.*` — General tab (shell, IDE, typography, theme, language)
- `terminalSettings.*` — Terminal tab (typography, cursor, display, behavior)
- `providers.*` — Providers tab (evolver, title-generation, per-provider)
- `about.*` — About tab (brand, updates, links)

Mirror translations in `src/renderer/i18n/zh-CN.ts`.

#### 5. Data-testid / Data-attr Topology

| Attr | Component | Selector | Purpose |
|------|-----------|----------|---------|
| `data-surface="settings"` | SettingsSurface | `[data-surface="settings"]` | Surface root |
| `data-surface="advanced-settings"` | AdvancedSettings | `[data-surface="advanced-settings"]` | Advanced tab root |
| `data-settings-tab` | SettingsTabBar | `[data-settings-tab="{id}"]` | Tab button (general/terminal/providers/advanced/about) |
| `data-settings-card="stoactl-toggle"` | AdvancedSettings | `[data-settings-card="stoactl-toggle"]` | Stoa-ctl card |
| `data-testid="settings-stoactl-toggle-row"` | AdvancedSettings | `[data-testid="settings-stoactl-toggle-row"]` | Toggle row |
| `data-testid="settings-stoactl-toggle"` | AdvancedSettings | `[data-testid="settings-stoactl-toggle"]` | Toggle switch |
| `data-settings-field` | All tabs | `[data-settings-field="{name}"]` | ~30 field anchors |
| `data-settings-action` | AboutSettings | `[data-settings-action="{action}"]` | check/download/install-update |

The formal topology contract is at `testing/topology/stoactl-topology.ts` (currently only covers advanced/stoa-ctl).

#### 6. Test Coverage

| Test File | Covers |
|-----------|--------|
| `src/renderer/stores/settings.test.ts` | Store hydration, evolver/title-gen persistence, type guards |
| `src/renderer/components/settings/GeneralSettings.test.ts` | Field rendering, Browse click, font/IDE select changes |
| `src/renderer/components/settings/ProvidersSettings.test.ts` | Provider fields, evolver selector, title-gen toggle/API fields, browse, claude toggle |
| `src/renderer/components/settings/AdvancedSettings.test.ts` | Stoa-ctl toggle (off→on confirm, on→off skip-confirm, cancel) |
| `src/renderer/components/settings/AboutSettings.test.ts` | Brand rendering, version, update status lifecycle (check→download→install) |

All tests use `happy-dom`, Pinia, `createRendererApiMock()`, and `@vue/test-utils mount()`.

#### 7. CSS / Design Token Usage

All settings components use scoped `<style>` with BEM-like naming. Key shared CSS patterns:

- **`.settings-panel`** — grid container, shared by General/Terminal/Providers/About
- **`.settings-card`** — card container (`var(--color-surface-solid)`, `var(--color-line-strong)`, `var(--shadow-card)`)
- **`.settings-card__header/title/description/badge`** — card header structure
- **`.settings-toggle`** — toggle row pattern (padding, border, background)
- **`.settings-toggle__switch / .settings-toggle__thumb`** — switch UI
- **`.settings-item__hint`** — status hints (success/warning variants)

Design tokens consumed: `--color-text-strong`, `--color-muted`, `--color-subtle`, `--color-line`, `--color-line-strong`, `--color-surface-solid`, `--color-black-soft`, `--color-black-faint`, `--color-active-fill`, `--color-accent`, `--color-success`, `--color-attention`, `--color-warning`, `--font-ui`, `--font-mono`, `--text-body-sm`, `--text-meta`, `--text-caption`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--shadow-card`, `--shadow-soft`, `--shadow-focus-ring`, `--mica`, `--mica-alt`.

**Design-language constraint**: `docs/engineering/design-language.md` mandates Fluent 2 tokens, Mica for durable surfaces, Acrylic only for transient overlays, no hardcoded visual primitives.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Two-panel grid layout 280px\|1fr | SettingsSurface.vue | `:104-115` |
| TabList with icon + summary | SettingsTabBar.vue | `:17-66` |
| 5 tabs wired to TabPanels | SettingsSurface.vue | `:15-31,73-89` |
| Single Pinia settings store | settings.ts | `:13-199` |
| IPC persistence via window.stoa | settings.ts | `:64-93` |
| GlassFormField/GlassPathField primitives | GeneralSettings.vue | `:5-6` |
| ~30 data-settings-field anchors | All settings .vue files | grep results |
| data-testid on stoa-ctl toggle | AdvancedSettings.vue | `:41,56` |
| data-settings-action on update buttons | AboutSettings.vue | `:154` |
| Topology contract for stoa-ctl | stoactl-topology.ts | `:3-9` |
| 4 component test files | settings/*.test.ts | all 4 files |
| Store test with mock | settings.test.ts | `:1-131` |
| Fluent 2 design token mandate | design-language.md | `:1-80` |
| Surface conditionally mounted | AppShell.vue | `:74` |
| en.ts i18n keys for settings | en.ts | `:1-120+` |

### Risks / Unknowns

- **[!] Duplicated scoped CSS**: `.settings-panel`, `.settings-card`, `.settings-card__header/title/description/badge` are copy-pasted across General, Terminal, Providers, and About components. Any style change must be applied to 4+ files. Risk of drift.
- **[!] HeadlessUI TabGroup mismatch**: `SettingsSurface.vue` uses `@headlessui/vue` `TabGroup/TabPanels/TabPanel` but manages `activeTab` state manually instead of letting HeadlessUI manage it. The `TabList` in `SettingsTabBar.vue` uses `@click` rather than HeadlessUI's selection mechanism. This works but is fragile — if HeadlessUI internal behavior changes, the tabs may desync.
- **[!] Inconsistent border-bottom syntax**: General/Terminal/Providers/About use `border-b: 1px solid var(--color-line)` (Tailwind shorthand) while Advanced uses `border-bottom: 1px solid var(--color-line)` (standard CSS). Both work but indicate mixed authorship.
- **[?] TerminalSettings has no test file**: No `TerminalSettings.test.ts` exists despite being one of the 5 tabs. All fields are untested at the component level.
- **[?] SettingsSurface has no test file**: The container component and tab switching logic have no dedicated test coverage.
- **[?] Topology contract is narrow**: `stoactl-topology.ts` only covers the Advanced tab's stoa-ctl toggle. The other ~30 `data-settings-field` anchors have no formal topology entries.
- **[!] SettingsSurface.vue hardcodes TabPanel content order**: Each `<TabPanel>` renders a specific component (General, Terminal, etc.) in a fixed order matching `tabMeta`. The HeadlessUI `TabGroup` selects panels by index. If tab order in `tabMeta` is reordered without matching `<TabPanel>` order, content and tab labels will desync.

### Recommended Safe Edit Surface

**Safe to edit (low risk):**
- Individual tab content components (General/Terminal/Providers/Advanced/About `.vue`) — each is self-contained
- i18n strings in `en.ts` / `zh-CN.ts` under their respective keys
- `GlassFormField` / `GlassPathField` primitives (have their own tests)
- Store logic in `settings.ts` (has dedicated test)

**Edit with caution:**
- Adding/removing a tab — must update: `tabMeta` array, `SettingsTab` type, `tabComponents` map, `TabPanel` order in SettingsSurface, i18n tabs, and SettingsTabBar tabs array
- `data-settings-field` names — tests reference them by string selector
- `.settings-card` CSS — duplicated in 4+ files, changes must be replicated

**Do not touch without plan:**
- HeadlessUI TabGroup wiring in SettingsSurface (manual tab state)
- `AppShell.vue` surface switching logic
- `testing/topology/stoactl-topology.ts` (contract file)
