# Frontend Token Unification Spec

This document defines how the renderer should converge on one token naming system.

It does not introduce compatibility layers. This repository is in prototype mode and breaking cleanup is preferred over transitional token aliasing.

## Problem

The current renderer uses mixed token vocabularies.

Canonical theme tokens are defined in:

- `src/renderer/styles/tailwind.css`

But some components still reference another naming family:

- `--surface`
- `--surface-solid`
- `--text-strong`
- `--text`
- `--muted`
- `--subtle`
- `--line`
- `--accent`

This prevents the design language from acting as a strict engineering constraint.

## Decision

Adopt one canonical renderer token system based on the existing `--color-*`, `--shadow-*`, `--radius-*`, and typography tokens in `src/renderer/styles/tailwind.css`.

Do not preserve the alternate short-form variable family.

## Canonical Token Families

### Color tokens

Use:

- `--color-canvas`
- `--color-surface`
- `--color-surface-solid`
- `--color-surface-soft`
- `--color-line`
- `--color-line-strong`
- `--color-text-strong`
- `--color-text`
- `--color-muted`
- `--color-subtle`
- `--color-accent`
- `--color-success`
- `--color-warning`
- `--color-attention`
- `--color-confirm`
- `--color-error`

### Shadow tokens

Use:

- `--shadow-glass`
- `--shadow-soft`
- `--shadow-card`
- `--shadow-premium`

Constraint:

- shadow tokens are for shadows
- do not reuse them as fills, borders, status backgrounds, or semantic surfaces

### Radius tokens

Use:

- `--radius-lg`
- `--radius-md`
- `--radius-sm`

### Typography tokens

Use:

- `--font-ui`
- `--font-mono`
- `--text-caption`
- `--text-meta`
- `--text-body-sm`
- `--text-body`
- `--text-title-sm`
- `--text-title`

## Mapping From Deprecated Names

The following old names should be removed and replaced:

| Deprecated | Replace with |
|---|---|
| `--canvas` | `--color-canvas` |
| `--surface` | `--color-surface` |
| `--surface-solid` | `--color-surface-solid` |
| `--text-strong` | `--color-text-strong` |
| `--text` | `--color-text` |
| `--muted` | `--color-muted` |
| `--subtle` | `--color-subtle` |
| `--line` | `--color-line` |
| `--line-strong` | `--color-line-strong` |
| `--accent` | `--color-accent` |

## Token Usage Rules

### 1. No parallel aliases

Do not define both:

- `--color-surface`
- `--surface`

Choose the canonical name only.

### 2. No semantic drift

Do not use a token outside its semantic role.

Examples:

- do not use shadow tokens as background fills
- do not use accent tokens for passive decoration
- do not use muted tokens for primary copy

### 3. No local re-invention of primitives

Component-local literals should be rare.

Allowed cases:

- mathematically derived values for placement or geometry
- truly unique browser or OS affordances
- xterm-specific visual values if they are later promoted into explicit terminal tokens

Disallowed cases:

- local replacement for surface color
- local replacement for border color
- local replacement for standard control hover states

### 4. Terminal subtheme remains tokenized

The terminal is allowed to stay visually darker than the surrounding app shell, but that darkness must still be represented through explicit tokens, not repeated rgba literals.

## Follow-up Token Additions

The existing token set is close, but a few explicit additions would reduce future misuse.

Recommended additions:

- `--color-success-surface`
- `--color-warning-surface`
- `--color-error-surface`
- `--motion-fast`
- `--motion-default`
- `--motion-slow`
- `--color-terminal-muted`
- `--color-terminal-subtle`
- `--color-terminal-chip`

These should be added only if used in multiple places. Do not pre-expand the token system without real usage.

## Migration Procedure

1. Remove deprecated short-form token usage from renderer components.
2. Replace local literals with canonical tokens where an equivalent exists.
3. Where no equivalent exists and the value is repeated, promote it into a new canonical token.
4. Re-run design review on the affected component to ensure the token replacement did not preserve a bad visual decision.

## Enforcement

Recommended review checks:

- reject new uses of bare `--surface`, `--line`, `--muted`, `--text-strong`, `--accent`
- reject shadow tokens used as backgrounds or semantic fills
- reject new direct hex or rgba values for common surfaces and states

## Scope

This spec applies to:

- renderer Vue components
- renderer CSS and Tailwind utility definitions
- preview surfaces that claim to represent production UI direction

It does not require temporary compatibility aliases.
