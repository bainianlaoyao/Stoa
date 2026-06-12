---
date: 2026-06-07
topic: settings-ui-test-and-behavior-assets
status: completed
mode: context-gathering
sources: 25
---

## Context Report: Settings UI — Tests & Behavior Assets

### Why This Was Gathered
Unblocks any Settings UI implementation or refactoring work by mapping the full test surface: component tests, store tests, e2e, Playwright journeys, topology declarations, behavior specs, and generated assets that must not be hand-edited.

### Summary
The Settings UI is covered by 4 component-level unit test files, 1 Pinia store test, 2 e2e test files (one Vitest, one Playwright), a dedicated stoa-ctl topology + behavior + journey testing layer, and a generated Playwright spec. The entry point is `GlobalActivityBar` → `AppShell` → `SettingsSurface` (tab shell) which delegates to 5 tab components: General, Terminal, Providers, Advanced, About. There is **no dedicated topology declaration** for the Settings surface itself (only for stoa-ctl which lives inside Advanced), and `SettingsSurface.vue` / `SettingsTabBar.vue` / `TerminalSettings.vue` have **no component tests**.

### Key Findings

#### 1. Component Unit Tests (Tier 1)

| File | Lines | What it tests |
|------|-------|---------------|
| `src/renderer/components/settings/AboutSettings.test.ts` | 222 | Renders brand, version, stack, links, update status phases (idle→available→downloading→downloaded), check/download/install button actions via `data-settings-action` attributes |
| `src/renderer/components/settings/GeneralSettings.test.ts` | 185 | Shell path input, workspace IDE selector, font family/size selectors, Browse button → pickFile → setSetting flow, "Detecting..." hint |
| `src/renderer/components/settings/AdvancedSettings.test.ts` | 142 | stoa-ctl toggle row (`data-testid="settings-stoactl-toggle"`), aria-checked states, confirm dialog on enable, no-confirm on disable, i18n-driven labels |
| `src/renderer/components/settings/ProvidersSettings.test.ts` | 198 | Provider entries (opencode/codex/claude-code), evolver inference provider selector, title generation API fields, Browse buttons, claude dangerously-skip-permissions toggle, design-token compliance source scan |
| `src/renderer/stores/settings.test.ts` | 131 | Hydration from `getSettings()`, evolver inference provider normalization, title generation CRUD, `updateSetting` → `setSetting` IPC bridge |

**Missing component tests:**
- `SettingsSurface.vue` — no test file (tab switching, sidebar nav, responsive grid)
- `SettingsTabBar.vue` — no test file (tab rendering, active state, `data-settings-tab` attributes)
- `TerminalSettings.vue` — no test file

#### 2. Integration / E2E Tests

| File | Type | What it tests |
|------|------|---------------|
| `tests/e2e/settings-stoactl-toggle.test.ts` | Vitest e2e (real fs) | Shim creation/removal, env population/stripping, gate toggle + `enabledChanged` event, POSIX rc cleanup |
| `tests/e2e-playwright/settings-modal-ui.test.ts` | Playwright (real Electron) | 5 tab buttons rendered, default General panel, tab switching to Providers/Terminal/About, Claude permissions switch visibility, modal (BaseModal) open/close/escape/aria |

#### 3. App-Level Tests with Settings Interaction

| File | Settings coverage |
|------|-------------------|
| `src/renderer/components/AppShell.test.ts` (530 lines) | Activity bar → Settings button click, `data-surface="settings"` visibility, command surface hidden when settings active, sidebar unmounts on settings surface |
| `src/renderer/components/GlobalActivityBar.test.ts` (93 lines) | `data-activity-item="settings"` rendering, active state, click → emit select, bottom cluster ordering |

#### 4. Topology Declarations (data-testid contracts)

**Existing topology for settings:**

| File | Surface | testIds |
|------|---------|---------|
| `testing/topology/stoactl-topology.ts` | `stoactl-lifecycle` | `settingsStoactlToggle: '[data-testid="settings-stoactl-toggle"]'`, `settingsAdvancedTab: '[data-settings-tab="advanced"]'` |

**Other topologies touching settings:**

| File | Surface | Relevant IDs |
|------|---------|--------------|
| `testing/topology/activity-bar.topology.ts` | `activity-bar` | `root`, `clusterTop`, `clusterBottom` — settings entry point is `data-activity-item="settings"` |
| `testing/topology/modal.topology.ts` | `modal` | `root`, `overlay`, `panel`, `title`, `close`, `body` — used in Playwright settings-modal-ui tests |
| `testing/topology/provider.topology.ts` | `provider-selection` | `floatingCard`, `floatingCardItem`, `radialMenu`, `radialMenuItem` |

**No dedicated settings-surface topology.** The `data-surface="settings"` and `data-settings-tab` attributes are used directly in Playwright tests without a formal topology declaration.

#### 5. Behavior Assets

`testing/behavior/stoactl-lifecycle.ts` declares 5 behaviors:

| ID | Actor | Risk | Coverage |
|----|-------|------|----------|
| `stoactl.disabledAtStartup` | system | medium | high |
| `stoactl.enableThenRestart` | user | medium | high |
| `stoactl.disableCleanup` | user | medium | high |
| `stoactl.http503WhenDisabled` | system | low | standard |
| `stoactl.envStrippedWhenDisabled` | system | low | standard |

No behavior assets exist for the broader Settings UI (tab switching, field persistence, validation).

#### 6. Journey Assets

`testing/journeys/stoactl-lifecycle.journey.ts` declares 2 journeys:
- `stoactl.disableCleanup` (variants: cold-boot, runtime-toggle)
- `stoactl.envStrippedWhenDisabled` (variants: shell, opencode)

#### 7. Generated Playwright Assets (DO NOT HAND-EDIT)

| File | Generator |
|------|-----------|
| `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | `generateStoactlLifecyclePlaywrightSkeleton()` in `testing/generators/generate-playwright.ts:256` |

Other generated specs (not settings-specific):
- `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts`
- `tests/generated/playwright/session-restore.generated.spec.ts`
- `tests/generated/playwright/workspace-quick-access.generated.spec.ts`

All are emitted by `npm run test:generate` → `testing/generators/write-generated-playwright.ts`.

#### 8. Data-testid / data-attribute Surface Map

| Attribute | Component | Used in tests |
|-----------|-----------|---------------|
| `data-surface="settings"` | `SettingsSurface.vue:41` | Playwright `settings-modal-ui.test.ts`, `stoactl-lifecycle.generated.spec.ts` |
| `data-settings-tab="{id}"` | `SettingsTabBar.vue:83` | Playwright `settings-modal-ui.test.ts`, generated spec |
| `data-testid="settings-stoactl-toggle"` | `AdvancedSettings.vue` | `stoactl-topology.ts`, `AdvancedSettings.test.ts`, generated spec |
| `data-testid="settings-stoactl-toggle-row"` | `AdvancedSettings.vue` | `AdvancedSettings.test.ts` |
| `data-settings-field="{field}"` | General/Providers/Advanced | All component tests |
| `data-settings-action="{action}"` | `AboutSettings.vue:154` | `AboutSettings.test.ts` |
| `data-surface="advanced-settings"` | `AdvancedSettings.vue` | `AdvancedSettings.test.ts` |
| `data-activity-item="settings"` | `GlobalActivityBar.vue` | `GlobalActivityBar.test.ts`, `AppShell.test.ts`, Playwright |

#### 9. Quality Gate Commands

```bash
npm run test:generate           # Regenerate deterministic Playwright specs
npx vitest run                  # Unit + component + e2e (Vitest)
npm run test:e2e                # Real Electron Playwright (includes generated)
npm run test:behavior-coverage  # Behavior coverage budget validation
npm run test:all                # All of the above in sequence
npm run typecheck               # vue-tsc + tsc
```

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 4 settings component test files | Glob + Read | `src/renderer/components/settings/*.test.ts` |
| SettingsSurface has no test file | Glob + Read | No `SettingsSurface.test.ts` or `SettingsTabBar.test.ts` found |
| Settings store tested with hydration + updateSetting | Read | `src/renderer/stores/settings.test.ts` |
| stoa-ctl topology declares 2 testIds | Read | `testing/topology/stoactl-topology.ts:3-9` |
| 5 stoa-ctl behaviors declared | Read | `testing/behavior/stoactl-lifecycle.ts` |
| 2 stoa-ctl journeys declared | Read | `testing/journeys/stoactl-lifecycle.journey.ts` |
| Generated stoactl spec uses real Electron | Read | `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` |
| Playwright settings-modal-ui covers 5 tabs + modal | Read | `tests/e2e-playwright/settings-modal-ui.test.ts` |
| AppShell stubs SettingsSurface but tests nav | Read | `src/renderer/components/AppShell.test.ts:92-106` |
| GlobalActivityBar covers settings item | Read | `src/renderer/components/GlobalActivityBar.test.ts` |
| e2e stoactl toggle covers shim/env/gate | Read | `tests/e2e/settings-stoactl-toggle.test.ts` |
| SettingsSurface renders 5 tabs via SettingsTabBar | Read | `src/renderer/components/settings/SettingsSurface.vue` |
| SettingsTabBar emits select with tab id | Read | `src/renderer/components/settings/SettingsTabBar.vue:68-70` |
| Quality gate scripts in package.json | Read | `package.json:10-37` |

### Risks / Unknowns

- **[!] No `SettingsSurface.test.ts`**: The tab-switching container and its `data-surface="settings"` + `data-settings-tab` attributes have no unit test coverage. Only Playwright covers this.
- **[!] No `SettingsTabBar.test.ts`**: Tab rendering, active-state class application, and click-to-emit are untested at unit level.
- **[!] No `TerminalSettings.test.ts`**: Terminal settings have zero component test coverage.
- **[!] No settings-surface topology**: The `data-surface="settings"` and `data-settings-tab` attributes are consumed in Playwright without a formal `testing/topology/settings.topology.ts` declaration.
- **[!] No settings behavior assets beyond stoa-ctl**: Tab navigation, field persistence, validation, and general settings CRUD have no behavior/journey declarations.
- **[?] `TerminalSettings.vue` content**: Not read during this research; content and test coverage gap is uncharacterized.
