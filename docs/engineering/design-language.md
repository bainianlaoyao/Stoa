# Global Design Language

This document defines the project-wide visual design language for `stoa`.

All future UI work, preview work, and frontend implementation work must follow this document unless the user explicitly overrides it.

## Design Direction

The project uses **standard Fluent 2** as its visual authority.

The renderer should feel like a restrained Windows productivity application: neutral, legible, token-driven, and predictable under repeated use. Fluent 2 rules are the source of truth for color, typography, stroke, corner radius, elevation, material, and motion decisions.

This pass is token-first. Keep the current Vue component structure and stable `data-testid` topology. Do not introduce Fluent Web Components unless a later task explicitly asks for that proof of concept.

## Non-Negotiable Rules

### 1. Use Design Tokens Only

Do not hardcode colors, shadows, radii, stroke widths, material fills, or motion timings in component styles when a shared token should be used.

All visual primitives must be drawn from global CSS variables / design tokens.

#### Material system
- Use `var(--mica)` for durable app surfaces and primary working regions.
- Use `var(--mica-alt)` for alternate durable regions that need subtle separation.
- Use `var(--surface-solid)` for dense content, terminal-adjacent UI, form fields, cards, and controls where readability matters more than material depth.
- Use `var(--acrylic)` only for transient overlays, menus, dialogs, popovers, context menus, and flyouts.
- Use `var(--smoke)` only to dim blocked content underneath modal UI.

#### Text system
- Use `var(--text-strong)` for headings, key labels, and important values.
- Use `var(--text)` for normal reading content.
- Use `var(--muted)` or `var(--subtle)` for secondary metadata, timestamps, hints, and low-priority text.

#### Control system
- Use `var(--control-fill)` for resting controls.
- Use `var(--control-fill-hover)` for hover states.
- Use `var(--control-fill-active)` for pressed states.
- Use `var(--stroke-control)` for control boundaries and `var(--stroke-divider)` for layout separators.
- Use `var(--accent)` and `var(--active-fill)` only for selected state, primary action, focus, or navigational orientation.

### 2. Use Fluent 2 Materials Deliberately

Durable application surfaces should be Mica-like and mostly opaque. They provide calm app structure and should not rely on heavy blur.

Acrylic is reserved for transient, light-dismiss surfaces. Use it for:
- dialogs
- context menus
- flyouts
- popovers
- temporary selection surfaces

Smoke is reserved for modal blocking states. It dims the area beneath a dialog or blocking surface and should not be used as a generic page background.

Terminal and dense text surfaces remain solid for readability.

### 3. Build Hierarchy Through Tokens, Not Decoration

Hierarchy should come from:
- material role
- spacing
- type weight
- stroke tokens
- restrained Fluent elevation
- selected and focus states

Use `var(--shadow-card)` for low local elevation and `var(--shadow-flyout)` for transient elevated surfaces. Avoid decorative gradients, oversized blur, heavy framing, or local visual recipes that bypass tokens.

Default border style should be `border: 1px solid var(--stroke-control)` for controls and `border: 1px solid var(--stroke-divider)` for structural dividers.

### 4. Micro-Interactions Must Be Restrained and Smooth

Interactive feedback should feel immediate and quiet.

Use shared motion tokens:
- `var(--duration-rest)` for ordinary hover and state changes
- `var(--duration-emphasized)` for overlays and surface transitions
- `var(--curve-standard)` for ordinary changes
- `var(--curve-decelerate)` for entering surfaces

Avoid exaggerated movement, decorative animation, and scale effects that shift layout.

### 5. Typography Must Preserve Tooling Discipline

Professional console quality depends on correct font separation.

#### UI font: `--font-ui`
Use for:
- navigation
- buttons
- panel titles
- labels
- ordinary UI structure

Use weight, line height, and spacing rather than oversized type to create hierarchy.

#### Mono font: `--font-mono`
Must be used for:
- terminal logs
- file paths
- session IDs
- timestamps when exactness matters
- code snippets
- command-like identifiers

This is required both for alignment and for the correct tooling / infrastructure character.

## Engineering Guidance

When creating new modules, panels, list rows, cards, controls, or previews:

### Bad

```css
.new-module {
  background-color: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 5px;
  color: #222;
}
```

### Good

```css
.new-module {
  background: var(--surface-solid);
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-sm);
  color: var(--text-strong);
}
```

## Implementation Expectations

All future contributors must:
- reuse shared Fluent 2 tokens instead of inventing local visual constants
- keep durable app surfaces Mica-like
- reserve Acrylic for transient overlays and flyouts
- reserve Smoke for modal blocking overlays
- keep dense text and terminal surfaces solid
- maintain strict separation between UI typography and mono typography
- preserve renderer topology and `data-testid` attributes during visual-only work

## Scope

This document applies to:
- production renderer UI
- preview HTML files
- new frontend modules
- refactors of existing UI surfaces
- interaction styling for panels, controls, lists, navigation, overlays, and flyouts

If a future task requires a different visual language, that change must be explicitly requested by the user.
