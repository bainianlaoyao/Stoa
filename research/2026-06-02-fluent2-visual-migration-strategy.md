---
date: 2026-06-02
topic: Fluent 2 visual system migration strategy
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Fluent 2 Frontend Visual System Migration

### Why This Was Gathered
Evaluate a safe migration and testing strategy for replacing the current glassmorphism visual system with Fluent 2, as a clean breaking change (no compatibility shims), while ensuring the mandatory 4-tier test pipeline continues to pass.

### Summary
The current Stoa frontend uses a custom Tailwind CSS v4 design-token system (572 CSS variable references across 28 `.vue` files) layered on `@headlessui/vue` for interactive primitives (5 consumer files). The test pipeline has strong structural separation: topology contracts use stable `data-testid` attributes (91 instances across 23 files) rather than CSS class selectors, and behavior specs are fully declarative. This means a Fluent 2 token-layer replacement can be done without touching behavior/topology/contract test layers, but the 2 style-contract tests and all scoped CSS blocks in `.vue` files will need a clean rewrite. The existing `feature/fluent-design` worktree (branched from `2821bb9`) contains only backend-side changes, not visual work — it is not a starting point for this migration.

### Key Findings

#### 1. Current Visual System Architecture

The visual system has three layers:

| Layer | Technology | Scope |
|-------|-----------|-------|
| Design tokens | CSS custom properties in `@theme {}` block | `src/renderer/styles/tailwind.css:3–93` |
| Tailwind utilities | `@utility` definitions mapped to tokens | `src/renderer/styles/tailwind.css:237–340` |
| Component styles | Scoped `<style>` blocks + Tailwind utility classes in templates | 28 `.vue` files |

The design language document (`docs/engineering/design-language.md`) defines the authoritative visual direction: **Modern Minimalist Glassmorphism + Clean UI**. A Fluent 2 migration would replace this document's content, not layer alongside it.

#### 2. Token Coupling Is Deep but Centralized

- **35+ CSS custom properties** defined in `tailwind.css` (light + dark themes)
- **572 `var(--` references** across 28 `.vue` files
- All references go through the token layer — no hardcoded hex colors in production components (confirmed by design-language rule and style-contract tests)
- 18 `backdrop-filter` usages across 8 files (glassmorphism-specific)

**Implication**: Replacing the token definitions in `tailwind.css` and the `@utility` blocks is the single highest-leverage change point. Most `.vue` files will need their scoped CSS rewritten, but they already reference tokens rather than raw values.

#### 3. Interactive Primitives Depend on `@headlessui/vue`

5 files import from `@headlessui/vue`:

| File | Components Used | Lines |
|------|----------------|-------|
| `primitives/BaseModal.vue` | `Dialog, DialogPanel, DialogTitle, TransitionRoot, TransitionChild` | `src/renderer/components/primitives/BaseModal.vue:2-8` |
| `primitives/GlassListbox.vue` | `Listbox, ListboxButton, ListboxOptions, ListboxOption` | `src/renderer/components/primitives/GlassListbox.vue:3-8` |
| `settings/SettingsTabBar.vue` | `TabList, Tab` | `src/renderer/components/settings/SettingsTabBar.vue:2` |
| `settings/SettingsSurface.vue` | `TabGroup, TabPanels, TabPanel` | `src/renderer/components/settings/SettingsSurface.vue:4` |
| `settings/ProvidersSettings.vue` | `Switch` | `src/renderer/components/settings/ProvidersSettings.vue:4` |

**Implication**: Replacing `@headlessui/vue` with `@fluentui/web-components` (the only Fluent UI library compatible with Vue 3) requires rewriting these 5 component files. The primitive layer (`BaseModal`, `GlassListbox`, `GlassFormField`, `GlassPathField`) is the natural replacement boundary.

#### 4. Test Pipeline Survival Analysis

##### Tier 1 — Unit/Component Tests (26 test files)

| Category | Count | Breaks? | Reason |
|----------|-------|---------|--------|
| Logic/behavior tests | ~20 files | **No** | Use `data-testid`, props, events — no CSS coupling |
| Style-contract tests | 2 files | **Yes** | Assert source code patterns (`TitleBar.styles.test.ts`, `BaseModal.styles.test.ts`) |
| Component mount tests | ~4 files | **Possible** | Stub child components; may break if slot/DOM structure changes |

Key evidence — `AppShell.test.ts` (`src/renderer/components/AppShell.test.ts`):
- Uses `data-testid="right-sidebar"`, `data-activity-item`, `aria-label` selectors
- Checks CSS class `right-sidebar-closed` (line 422) — **this will break** if Fluent 2 uses different class names

##### Tier 2 — E2E Integration Tests (`tests/e2e/`)

These tests use real file system, real Pinia stores, but mock Electron IPC. They do **not** mount Vue components — they test backend logic. **Will not break.**

##### Tier 3 — Generated Contract/Journey Assets

| File Type | Breaks? | Reason |
|-----------|---------|--------|
| `testing/topology/*.ts` | **No** | Only declares `data-testid` strings |
| `testing/behavior/*.ts` | **No** | Purely declarative specs with no DOM coupling |
| `testing/contracts/testing-contracts.ts` | **No** | Type definitions and validation functions |
| `tests/generated/playwright/*.spec.ts` | **No** | Uses `data-testid` and role-based selectors |

Evidence: `session-restore.generated.spec.ts` uses `getByTestId('surface.archive')`, `getByRole('button')`, `getByTestId('archive.session.restore')` — all survive a visual system swap.

##### Tier 4 — Config Guard Tests

Static analysis of source strings. **Will not break** unless `sandbox: false`, IPC channel constants, or preload API surface changes (which a visual migration should not touch).

#### 5. Prior Fluent Exploration Exists but Is Not Useful

The `feature/fluent-design` worktree (at `.worktrees/fluent-design/`) branched from `2821bb9` but contains only backend-side changes (session-control-server tests, session-supervisor tests, IPC bridge simplification). Its diff shows 0 visual/frontend changes. **Do not use as a base.**

#### 6. Fluent 2 for Vue — Package Landscape

Microsoft's Fluent UI ecosystem:

| Package | Framework | Vue Compatible? |
|---------|-----------|-----------------|
| `@fluentui/react-components` | React only | No |
| `@fluentui/web-components` | Web Components (framework-agnostic) | **Yes** — works with Vue 3 |
| `@fluentui/react-icons` | React only | No (use SVG icons directly) |

The viable path is `@fluentui/web-components` (Fluent UI Web Components v2), which provides `<fluent-button>`, `<fluent-dialog>`, `<fluent-tabs>`, etc. as custom elements that Vue 3 can consume natively.

Alternatively, a **token-only migration** is possible: keep Tailwind CSS v4 and `@headlessui/vue`, but replace the token values and utility definitions to match Fluent 2's design system (colors, radii, shadows, typography). This is the lower-risk path and preserves all primitive component code.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 572 CSS var references across 28 files | grep count | `src/renderer/components/**/*.vue` |
| 5 files import @headlessui/vue | grep count | 5 files in `src/renderer/components/` |
| 91 data-testid attributes across 23 files | grep count | `src/renderer/components/**/*.vue` |
| 35+ design tokens in @theme block | file read | `src/renderer/styles/tailwind.css:3-93` |
| 18 backdrop-filter usages | grep count | 8 `.vue` files |
| Style-contract tests check source patterns | file read | `src/renderer/components/TitleBar.styles.test.ts:9-13` |
| Style-contract tests check source patterns | file read | `src/renderer/components/primitives/BaseModal.styles.test.ts:9-13` |
| Topology specs use only data-testid strings | file read | `testing/topology/command.topology.ts:1-20` |
| Behavior specs are purely declarative | file read | `testing/behavior/session.behavior.ts:1-234` |
| Generated Playwright uses data-testid + roles | file read | `tests/generated/playwright/session-restore.generated.spec.ts:1-50` |
| AppShell test checks CSS class `right-sidebar-closed` | file read | `src/renderer/components/AppShell.test.ts:422` |
| Design language doc is the visual authority | file read | `docs/engineering/design-language.md:1-159` |
| fluent-design worktree has 0 visual changes | git diff stat | `git diff main..feature/fluent-design --stat` |
| Tailwind v4 with @tailwindcss/vite plugin | file read | `package.json:61`, `electron.vite.config.ts:57` |
| Vitest uses happy-dom, excludes worktrees | file read | `vitest.config.ts:19-33` |
| `@fluentui/web-components` is the Vue-compatible Fluent 2 package | domain knowledge | npm registry |

### Migration Strategy Recommendations

#### Option A: Token-Only Swap (Lower Risk, Recommended First)

Replace `tailwind.css` `@theme {}` token values with Fluent 2 equivalents. Keep Tailwind, keep `@headlessui/vue`, keep all component structure.

- **Files changed**: ~1 (`tailwind.css` token values) + `docs/engineering/design-language.md`
- **Tests broken**: 2 style-contract tests + `AppShell.test.ts` (1 class assertion)
- **Effort**: Small
- **Breaking surface**: Visual appearance only; no DOM, no API, no behavior

This does **not** adopt Fluent 2 components — it adopts the Fluent 2 visual language (colors, radii, shadows, motion) within the existing architecture.

#### Option B: Full Fluent 2 Web Components (Higher Risk)

Replace `@headlessui/vue` with `@fluentui/web-components`. Rewrite primitives layer (`BaseModal`, `GlassListbox`, `GlassFormField`, `GlassPathField`). Restyle all components.

- **Files changed**: ~5 primitive rewrites + ~28 component restyles + `tailwind.css` + `package.json`
- **Tests broken**: 2 style-contract tests, ~3-5 component tests with CSS class assertions, all primitive tests
- **Effort**: Large
- **Breaking surface**: DOM structure, component API, CSS classes, dependency graph
- **Risk**: Fluent Web Components use Shadow DOM by default; Vue Test Utils cannot pierce Shadow DOM without `attachTo` workarounds

#### Recommended Migration Order (for either option)

1. **Update `docs/engineering/design-language.md`** — Redefine the visual authority document
2. **Replace token layer** in `tailwind.css` — Fluent 2 colors, radii, shadows, typography tokens
3. **Run `npm run test:generate`** — Verify generated assets are deterministic (should be unchanged)
4. **Fix 2 style-contract tests** — Update source-pattern assertions to match new conventions
5. **Fix CSS class assertions** — `AppShell.test.ts` line 422 (`right-sidebar-closed`), scan for others
6. **Run `npx vitest run`** — Full unit/component pass
7. **Run `npm run test:e2e`** — Playwright journeys (should pass without changes)
8. **Run `npm run test:behavior-coverage`** — Coverage budgets (should pass without changes)
9. **If Option B**: After steps 1-8 pass, introduce `@fluentui/web-components`, rewrite primitives, fix primitive tests, re-run full pipeline

### Risks / Unknowns

- **[!] Shadow DOM**: If using `@fluentui/web-components` (Option B), Shadow DOM will block Vue Test Utils queries. Tests would need `element.shadowRoot.querySelector()` or custom mount logic. This is a significant test-infrastructure cost.
- **[!] `backdrop-filter: blur()`**: Fluent 2's Acrylic material uses `backdrop-filter` differently. The 18 current usages may produce visual regressions on certain GPU/driver combinations inside Electron.
- **[!] `@fluentui/web-components` bundle size**: Adding the full web components library to an Electron app increases renderer bundle size. Tree-shaking effectiveness is unknown.
- **[?] `@headlessui/vue` v2 vs Fluent primitives**: Headless UI provides unstyled primitives; Fluent Web Components provide fully styled ones. Mixing both in one codebase creates visual inconsistency. A clean break means replacing all 5 consumer files.
- **[?] `data-testid` preservation**: If Fluent Web Components wrap content in Shadow DOM, `data-testid` attributes on inner elements become invisible to Playwright's `getByTestId`. This would break the entire generated Playwright test suite. **Verify Shadow DOM handling before committing to Option B.**
- **[?] Tailwind v4 + Fluent Web Components coexistence**: If Fluent components bring their own styles, there may be specificity conflicts with Tailwind utilities. Needs a proof-of-concept.

### Files Catalogued (for migration scoping)

**Token/Style Layer (highest priority)**:
- `src/renderer/styles/tailwind.css` — 340 lines, all tokens + utilities
- `docs/engineering/design-language.md` — 159 lines, visual authority

**Primitives (Option B rewrite targets)**:
- `src/renderer/components/primitives/BaseModal.vue` — 65 lines
- `src/renderer/components/primitives/GlassListbox.vue` — 184 lines
- `src/renderer/components/primitives/GlassFormField.vue` — 35 lines
- `src/renderer/components/primitives/GlassPathField.vue` — uses tokens

**Style-contract Tests (must fix)**:
- `src/renderer/components/TitleBar.styles.test.ts` — 23 lines
- `src/renderer/components/primitives/BaseModal.styles.test.ts` — 15 lines

**Tests with CSS class assertions (must audit)**:
- `src/renderer/components/AppShell.test.ts` — line 422 `right-sidebar-closed`
