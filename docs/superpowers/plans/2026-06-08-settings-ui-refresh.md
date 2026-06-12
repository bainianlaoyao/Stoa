# Settings UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the current settings UI with token-first Fluent 2 styling, lightweight search, and collapsible terminal sections while preserving settings behavior contracts.

**Architecture:** Keep the existing settings surface and tabs, but move shell state into Vue-owned `activeTab` and `searchQuery`. Use a shared search helper plus per-tab section metadata to filter cards without flattening the entire settings experience. Normalize shared visual primitives through tokens and shared utility classes rather than introducing a new UI framework.

**Tech Stack:** Vue 3 SFCs, Pinia, vue-i18n, Vitest, Playwright, Tailwind v4 utilities, Electron renderer.

---

### Task 1: Write failing shell/search tests

**Files:**
- Create: `src/renderer/components/settings/SettingsSurface.test.ts`
- Modify: `src/renderer/components/settings/SettingsTabBar.vue`
- Test: `src/renderer/components/settings/SettingsSurface.test.ts`

- [ ] Add tests for rendering the search field and filtering tabs by query.
- [ ] Run `npx vitest run src/renderer/components/settings/SettingsSurface.test.ts`.
- [ ] Confirm failure before changing production code.

### Task 2: Implement shell search and single-owner tab rendering

**Files:**
- Create: `src/renderer/components/settings/settings-search.ts`
- Modify: `src/renderer/components/settings/SettingsSurface.vue`
- Modify: `src/renderer/components/settings/SettingsTabBar.vue`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh-CN.ts`
- Test: `src/renderer/components/settings/SettingsSurface.test.ts`

- [ ] Add shared query normalization and keyword matching helpers.
- [ ] Refactor the shell to own `activeTab` and `searchQuery` directly.
- [ ] Add the search field and filtered tab metadata.
- [ ] Re-run `npx vitest run src/renderer/components/settings/SettingsSurface.test.ts` until green.

### Task 3: Write failing terminal interaction tests

**Files:**
- Create: `src/renderer/components/settings/TerminalSettings.test.ts`
- Modify: `src/renderer/components/settings/TerminalSettings.vue`
- Test: `src/renderer/components/settings/TerminalSettings.test.ts`

- [ ] Add tests for collapsed sections, forced expansion on search, and filtered card visibility.
- [ ] Run `npx vitest run src/renderer/components/settings/TerminalSettings.test.ts`.
- [ ] Confirm failure before changing `TerminalSettings.vue`.

### Task 4: Implement terminal expanders and section filtering

**Files:**
- Modify: `src/renderer/components/settings/TerminalSettings.vue`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh-CN.ts`
- Test: `src/renderer/components/settings/TerminalSettings.test.ts`

- [ ] Add section-level metadata and local expanded-state handling.
- [ ] Keep Typography always visible.
- [ ] Convert Cursor, Display, and Behavior into collapsible cards.
- [ ] Re-run `npx vitest run src/renderer/components/settings/TerminalSettings.test.ts` until green.

### Task 5: Apply shared token cleanup across settings cards

**Files:**
- Modify: `src/renderer/styles/tailwind.css`
- Modify: `src/renderer/components/settings/GeneralSettings.vue`
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`
- Modify: `src/renderer/components/settings/AdvancedSettings.vue`
- Modify: `src/renderer/components/settings/AboutSettings.vue`

- [ ] Promote repeated settings card and toggle primitives into shared utility styles or shared token-backed selectors.
- [ ] Remove raw `rgba(...)` surfaces and hover colors where equivalent tokens exist.
- [ ] Preserve existing `AboutSettings` update-action behavior.

### Task 6: Add regression coverage and run quality gates

**Files:**
- Modify: `tests/e2e-playwright/settings-modal-ui.test.ts`
- Modify: any affected unit tests

- [ ] Update or add tests for search and terminal disclosure behavior.
- [ ] Run `npm run test:generate`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npx vitest run`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run test:behavior-coverage`.
