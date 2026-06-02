# Official Fluent 2 Token-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the renderer's visual system to standard Fluent 2 without replacing Vue primitives in the first pass.

**Architecture:** Keep the existing Vue 3 + Tailwind CSS 4 renderer structure and stable `data-testid` topology. Replace the global design authority and token layer first, then adjust only style contracts and local CSS needed to remove old glassmorphism assumptions. Fluent Web Components are excluded from this phase.

**Tech Stack:** Vue 3, TypeScript, Tailwind CSS 4 `@theme`, Vitest, Playwright.

---

## File Structure

- Modify `docs/engineering/design-language.md`: official Fluent 2 rules, Mica/Acrylic/Smoke guidance, token-only constraints.
- Modify `src/renderer/styles/tailwind.css`: Fluent 2 token values and utilities.
- Modify or create style-contract tests under `src/renderer/**`: tests must fail before token/doc implementation and pass after.
- Avoid edits under `research/upstreams/evolver`.

## Task 1: Visual Authority Contract

- [ ] Add or update a style contract test that reads `docs/engineering/design-language.md` and asserts it names Fluent 2 as the visual authority, includes Mica, Acrylic, Smoke, design tokens, and does not keep "Modern Minimalist Glassmorphism" as the project direction.
- [ ] Run the focused test and verify it fails for the current document.
- [ ] Rewrite `docs/engineering/design-language.md` to official Fluent 2 wording.
- [ ] Re-run the focused test and verify it passes.

## Task 2: Token Layer Contract

- [ ] Add or update a style contract test that reads `src/renderer/styles/tailwind.css` and asserts Fluent material tokens exist: `--mica`, `--mica-alt`, `--acrylic`, `--smoke`, `--control-fill`, `--control-fill-hover`, `--stroke-control`, `--shadow-flyout-val`, and motion tokens.
- [ ] Run the focused test and verify it fails before the token rewrite.
- [ ] Rewrite `tailwind.css` token values to standard Fluent 2 semantics. Keep project role aliases only as renderer design tokens, not as compatibility comments.
- [ ] Re-run the focused test and verify it passes.

## Task 3: Local Surface Cleanup

- [ ] Audit component style blocks for old glass-heavy assumptions such as large arbitrary `backdrop-blur` usage on durable surfaces.
- [ ] Update only the local CSS/classes required to align durable surfaces with Mica-like background and transient surfaces with Acrylic.
- [ ] Preserve current component boundaries and `data-testid` attributes.
- [ ] Run focused component tests for touched components.

## Task 4: Repository Verification

- [ ] Run `npm run test:generate`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npx vitest run`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run test:behavior-coverage`.
- [ ] Report any failures with exact command and failure summary.

