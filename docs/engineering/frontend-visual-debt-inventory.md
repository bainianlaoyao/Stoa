# Frontend Visual Debt Inventory

This document records concrete frontend design debt by file.

It is intentionally operational. Each entry identifies:

- what is visually wrong
- why it conflicts with the project design language
- what direction the fix should take

## Severity Scale

- `High`: strong visible drift from the design language or token system
- `Medium`: localized inconsistency that weakens coherence
- `Low`: edge-case polish issue

## High Severity

### `src/renderer/components/command/ProviderRadialMenu.vue`

Issue:

- local floating menu track and buttons define their own gradients, borders, highlights, blur amounts, and shadow stack
- the component reads closer to decorative liquid glass than restrained system glass

Why it conflicts:

- project design language prefers subtle layering and shared visual primitives
- this component visually overperforms relative to the main shell

Fix direction:

- remove local gradient-driven glass recipes
- replace with shared surface, line, radius, and shadow tokens
- keep the radial interaction pattern if desired, but visually quiet it down

### `src/renderer/components/command/ProviderFloatingCard.vue`

Issue:

- local floating card uses custom gradient glass and local shadow formulas

Why it conflicts:

- floating micro-surfaces should not exceed the visual weight of the primary viewport container

Fix direction:

- use a tokenized floating panel treatment
- preserve separation through blur and low-contrast border, not bespoke glass art direction

### `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

Issue:

- mixes token-driven values with hardcoded hover backgrounds and status colors
- local row states and icon button states feel assembled rather than systematized

Examples:

- hardcoded hover background on the `New Project` action
- direct rgba hover background on route items
- hardcoded neutral status dot color
- local success ring value instead of a shared status treatment

Why it conflicts:

- this panel is a core shell component and should be one of the cleanest expressions of the design system

Fix direction:

- move all row, button, and state styling to shared surface logic
- define a consistent status color policy
- ensure active and hover states use the same hierarchy model as the rest of the shell

### `src/renderer/components/archive/ArchiveSurface.vue`

Issue:

- uses a parallel token dialect: `--surface`, `--line`, `--muted`, `--text-strong`, `--accent`

Why it conflicts:

- the renderer theme currently uses `--color-*` naming in `src/renderer/styles/tailwind.css`
- this makes the component visually dependent on aliasing rather than the canonical theme contract

Fix direction:

- migrate the component onto the canonical token vocabulary selected in the token unification spec

## Medium Severity

### `src/renderer/components/TitleBar.vue`

Issue:

- close button hover state hardcodes `#e81123`
- title bar action timings differ from the design baseline

Why it conflicts:

- edge chrome still belongs to the same visual system
- direct literals weaken token authority

Fix direction:

- introduce an explicit destructive window-control token only if necessary
- otherwise harmonize with shared hover behavior

### `src/renderer/components/command/TerminalMetaBar.vue`

Issue:

- direct text color literal `#64748b`

Why it conflicts:

- metadata styling should come from muted or subtle token roles

Fix direction:

- map to canonical metadata text tokens

### `src/renderer/components/primitives/GlassListbox.vue`

Issue:

- motion timings use `100ms`, `75ms`, `150ms`

Why it conflicts:

- shared interaction rhythm should default to `0.2s ease`

Fix direction:

- align transition timings unless there is a strong usability reason not to

### `src/renderer/components/primitives/GlassPathField.vue`

Issue:

- focus transition timing uses `0.15s`

Why it conflicts:

- small inconsistency, but this primitive is reused and therefore multiplies visual drift

Fix direction:

- align with shared timing tokens or baseline motion rule

### `src/renderer/components/settings/ProvidersSettings.vue`

Issue:

- uses `--shadow-success-ring` as a background-like value for badge state
- switch timing uses `160ms`

Why it conflicts:

- shadow tokens should not be repurposed as semantic fill colors
- component behavior timings diverge from the baseline

Fix direction:

- introduce explicit semantic success-surface or success-tint tokens
- align motion timing with the global motion rule

## Low Severity

### `src/renderer/components/TerminalViewport.vue`

Issue:

- terminal surface still contains several direct rgba values for dark-surface metadata, labels, and chips

Why it conflicts:

- the terminal is allowed to have a darker sub-theme, but it should still be tokenized

Fix direction:

- keep the terminal dark mode treatment
- migrate repeated dark-surface colors into explicit terminal tokens

### `src/renderer/components/settings/AboutSettings.vue`

Issue:

- mostly coherent, but the brand tile is still a local treatment rather than a defined brand or app-mark token

Why it conflicts:

- not a major inconsistency, but repeated future use could create divergence

Fix direction:

- define whether the app monogram is a brand primitive or just a local one-off

## Reference Components

These components are currently the best examples of the intended system behavior:

- `src/renderer/components/AppShell.vue`
- `src/renderer/components/GlobalActivityBar.vue`
- `src/renderer/components/settings/SettingsSurface.vue`
- `src/renderer/components/settings/GeneralSettings.vue`
- `src/renderer/components/primitives/GlassPathField.vue`
- `src/renderer/components/primitives/GlassListbox.vue`

These should be used as style references more often than the more decorative provider surfaces.

## Cleanup Strategy

Recommended cleanup order:

1. token dialect cleanup
2. provider surface simplification
3. workspace hierarchy panel normalization
4. motion timing normalization
5. terminal and title bar polish
