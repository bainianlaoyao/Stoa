# Global Design Language

This document defines the project-wide visual design language for `ultra_simple_panel`.

All future UI work, preview work, and frontend implementation work must follow this document unless the user explicitly overrides it.

## Design Direction

The project uses **Modern Minimalist Glassmorphism** combined with **Clean UI**.

This design language is influenced by recent macOS, visionOS, and modern premium SaaS consoles. Its core principle is:

> Use light, depth, transparency, and layering to separate regions instead of relying on heavy borders or noisy visual treatment.

This is the default and authoritative visual direction for the repository.

## Non-Negotiable Rules

### 1. Use Design Tokens Only

Do not hardcode colors, shadows, or radii in component styles when a shared token should be used.

All visual primitives must be drawn from global CSS variables / design tokens.

#### Background system
- Use `var(--canvas)` for the base page background.
- Use `var(--surface)` for elevated / floating translucent panels.
- Use `var(--surface-solid)` for internal cards, controls, and solid inner modules.

#### Text system
- Use `var(--text-strong)` for headings, key labels, and important values.
- Use `var(--text)` for normal reading content.
- Use `var(--muted)` or `var(--subtle)` for secondary metadata, timestamps, hints, and low-priority text.

#### Accent system
- Use `var(--accent)` only when guiding the user toward action or focus.
- Typical use cases: active state, selected state, primary action, focused navigation item.

### 2. Build Hierarchy Through Z-Axis, Not Heavy Framing

Avoid traditional thick borders and visually heavy compartmentalization.

Hierarchy should come from:
- transparency
- blur
- subtle shadow
- restrained contrast shifts

#### Top-level panel treatment
- Use `backdrop-filter: blur(40px)` for top-level glass surfaces when appropriate.
- Pair this with semi-transparent white backgrounds such as `rgba(255, 255, 255, 0.75)` or tokenized equivalents.
- Use the premium shared shadow token such as `var(--shadow-premium)` for the main viewport or other primary elevated surfaces.

#### Inner module treatment
- Inner cards, list rows, or local controls should usually avoid strong shadows.
- Prefer light solid or semi-solid surfaces and extremely subtle borders.
- Default border style should be `border: 1px solid var(--line)`.

#### Border rule
- If a border is necessary, prefer very low-contrast transparent black/white tones.
- Borders should visually blend into the surrounding surface rather than visibly cutting it apart.

### 3. Micro-Interactions Must Be Restrained and Smooth

Interactive feedback should feel subtle, modern, and immediate.

#### Hover states
- Prefer changing transparency, surface brightness, or background opacity.
- Good examples:
  - `background: rgba(0, 0, 0, 0.04)`
  - slightly brighter surface values

#### Active / selected states
- Use color changes with restraint.
- Optional supporting cues:
  - a very light shadow such as `box-shadow: 0 1px 2px rgba(0,0,0,0.02)`
  - higher-contrast border treatment
  - restrained accent tinting

#### Motion
- All interactive state changes should default to:

```css
transition: all 0.2s ease;
```

- Avoid exaggerated motion, spring-heavy behavior, or decorative animation unless explicitly requested.

### 4. Typography Must Preserve Tooling Discipline

Professional console quality depends on correct font separation.

#### UI font: `--font-ui`
Use for:
- navigation
- buttons
- panel titles
- labels
- ordinary UI structure

Use weight and spacing, not oversized type, to create hierarchy.

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
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text-strong);
}
```

## Implementation Expectations

All future contributors must:
- reuse shared tokens instead of inventing local visual constants
- preserve the glass / clean / premium layering system
- avoid introducing noisy visual styles that conflict with this language
- keep UI states smooth, restrained, and low-friction
- maintain strict separation between UI typography and mono typography

## Scope

This document applies to:
- production renderer UI
- preview HTML files
- new frontend modules
- refactors of existing UI surfaces
- interaction styling for panels, controls, lists, and navigation

If a future task requires a different visual language, that change must be explicitly requested by the user.
