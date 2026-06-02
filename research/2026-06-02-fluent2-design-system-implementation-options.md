---
date: 2026-06-02
topic: Fluent 2 design system implementation options for Vue 3 + TypeScript
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Fluent 2 Design System Implementation Options for Vue 3 + TypeScript

### Why This Was Gathered

A Fluent 2 design-system refactor is planned for the Stoa Electron app (Vue 3.5 + TypeScript + Tailwind CSS 4). This report provides authoritative data on the Fluent 2 package ecosystem, token system, Vue 3 integration paths, accessibility, and trade-offs needed to choose an implementation strategy.

### Summary

Microsoft's Fluent 2 ecosystem has **no official Vue-specific package**. The only Vue-compatible path is `@fluentui/web-components` v2.6.1 — a Web Components library built on `@microsoft/fast-element` v1 that renders through **open Shadow DOM**. It ships 35+ components, 200+ design tokens as CSS custom properties, and full light/dark/high-contrast themes. Vue 3 consumes these as standard custom elements with zero wrapping. The alternative approach is a **token-only adoption** — using `@fluentui/tokens` for CSS variables while keeping existing component primitives (`@headlessui/vue` or custom). No community Vue Fluent UI wrapper exists on npm.

### Key Findings

#### 1. Package Landscape (Verified June 2026)

| Package | Version | Framework | Vue 3 Compatible? | Unpacked Size |
|---------|---------|-----------|-------------------|---------------|
| `@fluentui/react-components` | 9.74.1 | React only | **No** | 1.9 MB |
| `@fluentui/web-components` | 2.6.1 | Web Components | **Yes** | 4.8 MB (449 files) |
| `@fluentui/tokens` | 1.0.0-alpha.23 | Framework-agnostic | **Yes** | Minimal |
| `@microsoft/fast-element` | 2.10.4 | Web Components foundation | N/A (dependency) | 2.5 MB |
| `@microsoft/fast-foundation` | 2.49.6 | Web Components primitives | N/A (dependency) | — |
| `@fluentui/vue-components` | — | **Does not exist** | N/A | N/A |
| `@fluentui/vue` | — | **Does not exist** | N/A | N/A |

**Source**: npm registry API queries for each package name, June 2026.

#### 2. `@fluentui/web-components` Component Inventory

The library exports 35+ Web Components, registered with the `fluent-` tag prefix. All use **open Shadow DOM** (`shadowRootMode: 'open'`).

| Category | Components |
|----------|-----------|
| **Layout** | Accordion, Drawer, Divider, Tree, TreeItem |
| **Buttons** | Button, AnchorButton, CompoundButton, MenuButton, ToggleButton |
| **Input** | Checkbox, Radio/RadioGroup, Slider, Switch, TextInput, TextArea, Dropdown, Listbox |
| **Navigation** | Tab/Tablist, Link |
| **Feedback** | Dialog (+ DialogBody), MessageBar, ProgressBar, Spinner, Tooltip, Badge, CounterBadge |
| **Data Display** | Avatar, Card (implicit), Field, Image, Label, Text |
| **Menu** | Menu, MenuItem, MenuList |
| **Other** | RatingDisplay, Search (not confirmed), Select (not in exports) |

Key architectural observations:
- **Dialog** uses the native `<dialog>` element (`HTMLDialogElement`) — not a custom overlay
- **Button** extends `FASTElement` and uses `ElementInternals` for form association (form-associated custom elements per HTML spec)
- All components support **slots** (`start`, `end`, default slot) for composition
- Components have `appearance`, `size`, `shape` attributes for variant control

**Source**: `packages/web-components/src/index.ts` on `microsoft/fluentui` master branch.

#### 3. Shadow DOM Architecture — Critical for Testing

```typescript
// From fluent-design-system.ts
export const FluentDesignSystem = Object.freeze({
  prefix: 'fluent',
  shadowRootMode: 'open',  // ← Open Shadow DOM
  registry: globalThis.customElements,
});
```

**Implications for Vue Test Utils + Playwright**:
- Shadow DOM is **open** (not closed), meaning `element.shadowRoot` is accessible
- Vue Test Utils `wrapper.find()` **cannot pierce Shadow DOM by default** — you need `element.shadowRoot.querySelector()`
- Playwright supports Shadow DOM piercing via `locator('>>internal=...')` or by querying shadow roots explicitly
- **`data-testid` on inner elements** will NOT be findable via `getByTestId()` unless Playwright's Shadow DOM support is configured
- This is the **single biggest testing risk** for the existing 4-tier test pipeline

**Source**: `packages/web-components/src/fluent-design-system.ts` on `microsoft/fluentui` master.

#### 4. Design Token System — Comprehensive CSS Custom Properties

The `@fluentui/tokens` package provides the full Fluent 2 design token system. All tokens resolve to CSS custom properties (`var(--tokenName)`).

##### Token Categories

| Category | Example Tokens | Count (approx.) |
|----------|---------------|-----------------|
| **Foreground colors** | `colorNeutralForeground1`, `colorBrandForeground1` | 60+ |
| **Background colors** | `colorNeutralBackground1`–`8`, `colorSubtleBackground*` | 40+ |
| **Stroke/border colors** | `colorNeutralStroke1`–`4`, `colorBrandStroke1`–`2` | 25+ |
| **Shadow colors** | `colorNeutralShadowAmbient`, `colorNeutralShadowKey` | 8 |
| **Status colors** | `colorStatusSuccess*`, `colorStatusWarning*`, `colorStatusDanger*` | 30+ |
| **Border radius** | `borderRadiusNone/Small/Medium/Large/XLarge/Circular` | 6 |
| **Font sizes** | `fontSizeBase100`–`600`, `fontSizeHero700`–`1000` | 10 |
| **Line heights** | `lineHeightBase100`–`600`, `lineHeightHero700`–`1000` | 10 |
| **Font weights** | `fontWeightRegular/Medium/Semibold/Bold` | 4 |
| **Font families** | `fontFamilyBase`, `fontFamilyMonospace`, `fontFamilyNumeric` | 3 |
| **Spacing** | `spacingHorizontalXXS`–`XXXL`, `spacingVerticalXXS`–`XXXL` | 26 |
| **Motion duration** | `durationUltraFast`–`durationUltraSlow` | 7 |
| **Motion curves** | `curveAccelerateMax/Mid/Min`, `curveDecelerateMax/Mid/Min`, `curveEasyEase` | 8 |
| **Stroke widths** | `strokeWidthThin/Thick/Thicker/Thickest` | 4 |

##### Typography Presets

The web-components package includes ready-made typography CSS directives:

| Preset | Font Size | Weight | Use Case |
|--------|-----------|--------|----------|
| `typographyCaption2` | Base100 | Regular | Smallest text |
| `typographyCaption1` | Base200 | Regular | Captions |
| `typographyBody1` | Base300 | Regular | Body text (default) |
| `typographyBody2` | Base400 | Regular | Larger body |
| `typographySubtitle2` | Base400 | Semibold | Subtitles |
| `typographySubtitle1` | Base500 | Semibold | Section headers |
| `typographyTitle3` | Base600 | Semibold | Small titles |
| `typographyTitle2` | Hero700 | Semibold | Medium titles |
| `typographyTitle1` | Hero800 | Semibold | Large titles |
| `typographyLargeTitle` | Hero900 | Semibold | Page titles |
| `typographyDisplay` | Hero1000 | Semibold | Display headings |

##### Theme System

```typescript
// Built-in themes
import { webLightTheme, webDarkTheme } from '@fluentui/tokens';
import { teamsLightTheme, teamsDarkTheme, teamsHighContrastTheme } from '@fluentui/tokens';

// Custom theme creation
import { createLightTheme, createDarkTheme } from '@fluentui/tokens';
const myBrandTheme = createLightTheme('#0078d4'); // Pass brand color
```

Applying a theme:

```typescript
import { setTheme } from '@fluentui/web-components';
import { webLightTheme } from '@fluentui/tokens';
setTheme(webLightTheme); // Sets CSS custom properties on document
```

The `themeToTokensObject` utility converts any Theme object to `Record<keyof Theme, string>` where each value is `var(--tokenName)` — useful for programmatic token access.

**Source**: `packages/tokens/src/index.ts`, `packages/tokens/src/tokens.ts`, `packages/tokens/src/types.ts`, `packages/tokens/src/themeToTokensObject.ts`, `packages/web-components/src/styles/partials/typography.partials.ts`, `packages/web-components/src/theme/index.ts` on `microsoft/fluentui` master.

#### 5. Vue 3 Integration — Required Configuration

Since `@fluentui/web-components` are standard Web Components, Vue 3 needs one configuration change:

```typescript
// vite.config.ts or main.ts
app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('fluent-');
```

For Vite specifically, configure in `vite.config.ts`:

```typescript
// With @vitejs/plugin-vue
vue({
  template: {
    compilerOptions: {
      isCustomElement: (tag) => tag.startsWith('fluent-'),
    },
  },
}),
```

Component registration (two options):

```typescript
// Option A: Side-effect import (registers all components)
import '@fluentui/web-components';

// Option B: Individual component registration
import { ButtonDefinition, FluentDesignSystem } from '@fluentui/web-components';
ButtonDefinition.define(FlluentDesignSystem.registry); // registers <fluent-button>
```

Template usage in Vue SFC:

```vue
<template>
  <fluent-button appearance="primary" @click="handleClick">
    Click me
  </fluent-button>

  <fluent-dialog :open="showDialog" @toggle="onToggle">
    <fluent-dialog-body>
      <p>Dialog content</p>
    </fluent-dialog-body>
  </fluent-dialog>
</template>
```

**Two-way binding**: Fluent Web Components emit standard DOM events. Vue's `v-model` does NOT work natively with web component properties. You must use `:value` + `@change` or `@input` manually.

**Source**: Fluent UI Web Components README, `packages/web-components/README.md` on `microsoft/fluentui` master.

#### 6. Accessibility

Fluent 2 Web Components have built-in accessibility:

- **Dialog**: Uses native `<dialog>` element with `aria-describedby`, `aria-labelledby`, `aria-label`, `role="alertdialog"` support, focus trapping via modal dialog spec
- **Button**: Uses `ElementInternals` for form association, supports `autofocus`, `disabled`, `disabled-focusable` states, proper ARIA disabled state
- **Checkbox/Radio/Switch**: Support `aria-label`, proper checked state announcements
- **Tree/TreeItem**: Proper `role="tree"` / `role="treeitem"` with expanded/selected state
- **Tabs**: `role="tablist"` / `role="tab"` with proper keyboard navigation
- **Menu**: `role="menu"` / `role="menuitem"` with keyboard support
- All components support **high contrast theme** (`teamsHighContrastTheme`)

The Fluent 2 design system is aligned with Microsoft's accessibility standards (WCAG 2.1 AA compliance target).

**Source**: `packages/web-components/src/dialog/dialog.ts`, `packages/web-components/src/button/button.base.ts` — ARIA attributes, roles, and `ElementInternals` usage inspected in source.

#### 7. FAST Ecosystem Status

Key facts:
- **`@microsoft/fast-element`** v2.10.4 is the current FAST Element library (actively maintained)
- **`@microsoft/fast-foundation`** v2.49.6 provides base component patterns
- `@fluentui/web-components` v2.6.1 depends on `@microsoft/fast-element` **^1.13.0** (NOT v2) and `@microsoft/fast-foundation` ^2.49.6
- The FAST monorepo (`microsoft/fast`) still exists but `@fluentui/web-components` source lives in the `microsoft/fluentui` monorepo
- FAST's README confirms: "The source for `@fluentui/web-components` is hosted in the Fluent UI monorepo"
- FAST is NOT deprecated — it continues as the foundation layer for Fluent Web Components

**Source**: npm registry version data, `microsoft/fast` README.md.

#### 8. Community Vue Wrappers — None Exist

Search results:
- `fluent-vue` on npm → **Project Fluent i18n plugin** for Vue.js (NOT a Fluent UI component library)
- `@fluentui/vue` → **Does not exist** on npm
- `@fluentui/vue-components` → **Does not exist** on npm
- No official or community-maintained Vue wrapper for Fluent UI 2 exists

**Source**: npm registry API queries for each package name.

#### 9. `@fluentui/tokens` — Token-Only Adoption Path

The `@fluentui/tokens` package (v1.0.0-alpha.23) can be used independently of `@fluentui/web-components`:

```typescript
import { webLightTheme, webDarkTheme, createLightTheme, createDarkTheme } from '@fluentui/tokens';
```

The tokens package:
- Exports theme objects containing all resolved token values (hex colors, pixel values, etc.)
- Exports CSS variable references via `tokens` object (`Record<keyof Theme, string>`)
- Supports custom brand color themes via `createLightTheme(brandColor)` and `createDarkTheme(brandColor)`
- Can be consumed in Tailwind CSS via `@theme {}` block or CSS custom properties

This enables a **token-only migration**: replace Tailwind token values with Fluent 2 token values without adopting web components.

**Source**: `packages/tokens/src/index.ts`, `packages/tokens/src/tokens.ts`, `packages/tokens/src/themeToTokensObject.ts`.

#### 10. Implementation Strategy Comparison

| Strategy | Packages Added | Components Rewritten | Test Impact | Bundle Impact | Risk |
|----------|---------------|---------------------|-------------|---------------|------|
| **A: Token-only** | `@fluentui/tokens` | 0 | 2–3 style tests | ~minimal | Low |
| **B: Full Web Components** | `@fluentui/web-components`, `@fluentui/tokens` | 5 primitives + 28 restyles | 2 style + 3–5 component + all primitive tests + Shadow DOM穿透 | +4.8 MB | High |
| **C: Hybrid** (tokens + selective WC) | `@fluentui/tokens` + selective `@fluentui/web-components` | Selective (e.g., Dialog, Tabs only) | Moderate | Variable | Medium |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `@fluentui/web-components` v2.6.1 latest stable | npm registry | `https://registry.npmjs.org/@fluentui/web-components/latest` |
| Depends on `@microsoft/fast-element` ^1.13.0 | npm registry | Package metadata dependencies |
| Depends on `@microsoft/fast-foundation` ^2.49.6 | npm registry | Package metadata dependencies |
| Unpacked size: 4.8 MB, 449 files | npm registry | Package dist metadata |
| Shadow DOM mode: open | GitHub source | `packages/web-components/src/fluent-design-system.ts` |
| Dialog uses native `<dialog>` element | GitHub source | `packages/web-components/src/dialog/dialog.ts` |
| Button uses `ElementInternals` + form association | GitHub source | `packages/web-components/src/button/button.base.ts` |
| 35+ component exports | GitHub source | `packages/web-components/src/index.ts` |
| Token system: 200+ CSS custom properties | GitHub source | `packages/tokens/src/tokens.ts`, `packages/tokens/src/types.ts` |
| Built-in themes: webLight, webDark, teamsLight, teamsDark, teamsHighContrast | GitHub source | `packages/tokens/src/themes/index.ts` |
| Typography presets: 15 CSS directives | GitHub source | `packages/web-components/src/styles/partials/typography.partials.ts` |
| `setTheme()` API for applying themes | GitHub README | `packages/web-components/README.md` |
| `@fluentui/tokens` v1.0.0-alpha.23 | npm registry | `https://registry.npmjs.org/@fluentui/tokens/latest` |
| `@fluentui/react-components` v9.74.1 | npm registry | `https://registry.npmjs.org/@fluentui/react-components/latest` |
| No `@fluentui/vue-components` package | npm registry | Query returned undefined |
| No `@fluentui/vue` package | npm registry | Query returned undefined |
| `fluent-vue` is i18n, not UI components | npm registry | Description: "Internationalization plugin for Vue.js" |
| FAST still maintained, web components migrated to Fluent UI monorepo | GitHub README | `microsoft/fast` main branch |
| `@microsoft/fast-element` v2.10.4 current | npm registry | `https://registry.npmjs.org/@microsoft/fast-element/latest` |
| Web components use `@microsoft/fast-element` v1 (not v2) | npm registry | `@fluentui/web-components` peer deps |
| `themeToTokensObject` utility for programmatic token access | GitHub source | `packages/tokens/src/themeToTokensObject.ts` |
| Component registration via `FluentDesignSystem.registry` | GitHub source | `packages/web-components/src/fluent-design-system.ts` |

### Risks / Unknowns

- **[!] Shadow DOM + Testing**: Open Shadow DOM still blocks `@vue/test-utils` `wrapper.find()`. Tests need `element.shadowRoot.querySelector()` or custom mount helpers. Playwright supports Shadow DOM piercing but `getByTestId` may need configuration. This is the **highest-risk unknown** — a proof-of-concept is strongly recommended before committing to Strategy B.
- **[!] Shadow DOM + data-testid**: If Fluent components wrap content in Shadow DOM, `data-testid` attributes on inner elements become invisible to Playwright's `getByTestId()`. The existing 91 `data-testid` instances and all generated Playwright journeys depend on this mechanism. **Verify before committing.**
- **[!] `v-model` incompatibility**: Vue's `v-model` directive does NOT work with web component properties. Every input component requires manual `:value` + `@change` binding. This adds boilerplate and reduces type safety.
- **[!] `@fluentui/tokens` is alpha**: The tokens package is v1.0.0-alpha.23. While the token values are stable (shared with React components), the API surface may change.
- **[!] FAST Element version lag**: `@fluentui/web-components` depends on `@microsoft/fast-element` ^1.13.0 while the latest is v2.10.4. This suggests the web components may be behind the FAST foundation curve.
- **[!] Bundle size**: 4.8 MB unpacked for web components is significant. Tree-shaking effectiveness for Electron builds is unverified. Individual component imports (`@fluentui/web-components/button.js`) should help but actual savings are unmeasured.
- **[?] Tailwind 4 coexistence**: Fluent Web Components bring their own styles via Shadow DOM (encapsulated). But if Fluent tokens are applied globally as CSS custom properties, specificity conflicts with Tailwind utilities may arise. Needs PoC.
- **[?] `backdrop-filter` / Acrylic**: Fluent 2 "Acrylic" material uses `backdrop-filter` with noise texture layers. The current glassmorphism uses `backdrop-filter: blur()` without texture. Visual alignment needs design direction.
- **[?] Electron compatibility**: Web Components with Shadow DOM + native `<dialog>` should work in Electron (Chromium-based), but Edge cases around focus trapping in Electron's multi-process architecture are unverified.
- **[?] Missing components**: No `fluent-select`, `fluent-popover`, `fluent-calendar`, `fluent-date-picker`, or `fluent-data-grid` in the web-components export list. If Stoa needs any of these, custom implementations or alternative libraries are required.

### Files Catalogued

**Official package sources inspected**:
- `packages/web-components/src/index.ts` — Component export catalog
- `packages/web-components/src/fluent-design-system.ts` — Shadow DOM mode, registry
- `packages/web-components/src/button/button.ts` — Button component API
- `packages/web-components/src/button/button.base.ts` — FASTElement base, ElementInternals
- `packages/web-components/src/dialog/dialog.ts` — Native dialog, ARIA, accessibility
- `packages/web-components/src/styles/partials/typography.partials.ts` — Typography presets
- `packages/web-components/src/theme/design-tokens.ts` — CSS custom property exports
- `packages/web-components/src/theme/index.ts` — Token + theme re-exports
- `packages/web-components/README.md` — Setup, usage, theming guide
- `packages/tokens/src/index.ts` — Token + theme exports
- `packages/tokens/src/tokens.ts` — Token-to-CSS-variable mapping (200+ entries)
- `packages/tokens/src/types.ts` — Full token type definitions
- `packages/tokens/src/themes/index.ts` — Theme catalog
- `packages/tokens/src/themeToTokensObject.ts` — Theme→tokens utility
