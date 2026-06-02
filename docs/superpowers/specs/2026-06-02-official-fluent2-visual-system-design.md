# Official Fluent 2 Visual System Design

## Goal

Rework the renderer visual language to standard Fluent 2, using official Windows-style material guidance rather than a Stoa-specific glass-heavy variant.

## Direction

The project should use Fluent 2 as the visual authority. Durable application surfaces use a Mica-like neutral foundation. Acrylic treatment is reserved for transient overlays, menus, dialogs, and flyouts where transparency is officially appropriate. Terminal and dense text surfaces remain solid for readability.

This first implementation is token-first. It does not replace Vue primitives with `@fluentui/web-components`, because Shadow DOM would change test and topology behavior. Fluent Web Components remain a later proof-of-concept for primitives only.

## Scope

- Replace `docs/engineering/design-language.md` with official Fluent 2 rules.
- Rewrite `src/renderer/styles/tailwind.css` tokens toward Fluent 2 color, radius, shadow, typography, motion, Mica, Acrylic, and Smoke semantics.
- Preserve current Vue component structure and stable `data-testid` topology.
- Update style-contract tests so they assert official Fluent 2 conventions rather than the old glassmorphism language.
- Avoid compatibility migrations, broad component rewrites, and vendored upstream edits.

## Testing

The first tests should be source-contract tests for the visual authority document and token layer. Existing component tests should remain behavior-focused. Generated Playwright behavior assets should remain structurally unchanged unless a failing contract proves otherwise.

