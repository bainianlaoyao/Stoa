# Frontend Design Consistency Remediation Plan

This document turns the current frontend design audit into an execution-oriented cleanup plan.

It is subordinate to [design-language.md](./design-language.md). If this document conflicts with the design language, the design language wins.

## Goal

Bring the renderer UI back under one coherent design system:

- one token vocabulary
- one glass layering model
- one interaction timing baseline
- one consistent rule for when a component may visually stand out

## Current Design Summary

The repository currently reads as:

`lightweight premium developer console with macOS / visionOS influenced glass workspace shells`

That overall direction is valid and close to the intended project design language.

The current problem is not the macro direction. The problem is local drift:

- token systems are mixed
- some components invent their own glass treatment
- some interaction timings do not follow the shared baseline
- some edge components still hardcode colors and state styling

## Primary Remediation Themes

### 1. Re-establish token authority

The renderer must use one canonical token system.

Current issue:

- `src/renderer/styles/tailwind.css` defines `--color-*`
- some components still use `--surface`, `--line`, `--muted`, `--text-strong`, `--accent`

Required outcome:

- a single canonical token vocabulary is used everywhere
- components do not rely on parallel alias systems
- future visual work can be reviewed mechanically instead of by taste

### 2. Rebalance glassmorphism toward restraint

The project design language is `Modern Minimalist Glassmorphism + Clean UI`, not decorative liquid glass.

Current issue:

- some floating provider surfaces use stronger gradients, highlights, and local shadow recipes than the rest of the app

Required outcome:

- top-level surfaces may use premium glass treatment
- local controls and micro-panels must use quieter surfaces and lighter contrast
- floating controls should feel integrated into the shell, not like standalone showcase widgets

### 3. Normalize interaction timing

The default motion contract from the design language is:

```css
transition: all 0.2s ease;
```

Required outcome:

- hover, focus, and active timings feel consistent across the renderer
- exceptions are rare and justified by behavior, not local preference

### 4. Remove edge-case hardcoding

Current issue:

- a small number of components still use direct hex colors, direct rgba values, and one-off status styling

Required outcome:

- visual meaning comes from tokens
- state styling is reviewable and reusable

## Priority Order

### P0. Token unification

Files and areas:

- `src/renderer/styles/tailwind.css`
- `src/renderer/components/archive/ArchiveSurface.vue`
- any renderer component still using bare `--surface` / `--line` style variables

Why first:

- all later cleanup depends on having one token source of truth

Done when:

- renderer components no longer mix token dialects
- token usage can be searched and audited reliably

### P1. Provider surface visual reset

Files and areas:

- `src/renderer/components/command/ProviderRadialMenu.vue`
- `src/renderer/components/command/ProviderFloatingCard.vue`

Why second:

- these are the strongest local deviations from the intended restrained glass style

Done when:

- floating provider surfaces use shared border, surface, blur, and shadow rules
- they no longer appear more visually expensive than the primary shell

### P2. Workspace hierarchy panel cleanup

Files and areas:

- `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

Why third:

- this panel is structurally correct but visually inconsistent in hover states, status color usage, and local controls

Done when:

- hover states use shared surface logic
- status dots and inline actions follow shared state tokens
- hardcoded hover backgrounds and local shadow recipes are removed

### P3. Interaction timing pass

Files and areas:

- `src/renderer/components/TitleBar.vue`
- `src/renderer/components/primitives/GlassListbox.vue`
- `src/renderer/components/primitives/GlassPathField.vue`
- `src/renderer/components/settings/ProvidersSettings.vue`
- any other renderer component using `75ms`, `100ms`, `150ms`, `160ms`

Why fourth:

- this is lower risk once the visual token system is stable

Done when:

- shared motion timings are used consistently
- exceptions are documented inline with a clear behavior reason

### P4. Edge component polish

Files and areas:

- `src/renderer/components/TitleBar.vue`
- `src/renderer/components/command/TerminalMetaBar.vue`

Why fifth:

- these are visible inconsistencies but not the core source of design drift

Done when:

- direct color literals are removed or explicitly justified

## Component Guidance

### Components already close to target

These components mostly follow the intended design language and should be treated as reference quality for future cleanup:

- `src/renderer/components/AppShell.vue`
- `src/renderer/components/GlobalActivityBar.vue`
- `src/renderer/components/settings/SettingsSurface.vue`
- `src/renderer/components/settings/GeneralSettings.vue`
- `src/renderer/components/primitives/GlassPathField.vue`
- `src/renderer/components/primitives/GlassListbox.vue`

### Components needing strongest correction

- `src/renderer/components/command/ProviderRadialMenu.vue`
- `src/renderer/components/command/ProviderFloatingCard.vue`
- `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- `src/renderer/components/archive/ArchiveSurface.vue`
- `src/renderer/components/TitleBar.vue`
- `src/renderer/components/command/TerminalMetaBar.vue`

## Review Rules For Future UI Work

Any new renderer UI should be rejected if it does any of the following without explicit justification:

- introduces a new color literal where a shared token already exists
- defines a new local glass recipe instead of using the shared surface model
- uses stronger gradients or shadows than the main viewport shell
- introduces a new motion timing baseline
- mixes UI text styling and mono styling without semantic reason

## Deliverables

This remediation effort is supported by two companion documents:

- [frontend-visual-debt-inventory.md](./frontend-visual-debt-inventory.md)
- [frontend-token-unification-spec.md](./frontend-token-unification-spec.md)

## Success Criteria

This effort is complete when:

- token usage is singular and consistent
- floating controls no longer visually outshout the main shell
- panel and row states feel like one system
- motion timings are coherent
- future frontend review can enforce these rules with simple code inspection
