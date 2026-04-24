# Brand Icon Asset Pipeline Design

## Overview

Make the two source brand images under `src/renderer/assets/icons/` actually usable by the project.

The repository currently has:

- `Stoa-flat.png`
- `Stoa-glass.png`

These are design sources, not a usable asset pipeline. The project needs two distinct output chains:

1. **Application icon assets** for Electron packaging on Windows
2. **Renderer brand assets** that Vue can import directly

The chosen direction is:

- `glass` is the primary application mark
- `flat` is the small-size and vector-first UI mark
- Renderer delivery is a minimal set: `symbol` + `horizontal wordmark`

## Goals

- Turn the existing design-source PNGs into project-consumable assets
- Give Electron Builder an explicit Windows icon source
- Give the renderer stable SVG brand assets that can be imported directly
- Keep the asset model small and explicit instead of introducing a heavy branding system

## Non-Goals

- No compatibility layer or migration helpers
- No full multi-platform icon suite in this task
- No favicon, splash screen, or additional brand lockups beyond the approved minimum set
- No generalized asset build pipeline unless it is strictly required for the approved outputs

## Design

### Asset Split

The implementation will separate **design sources** from **consumable assets**.

#### Design sources

Keep the current files in `src/renderer/assets/icons/` as source references:

- `src/renderer/assets/icons/Stoa-flat.png`
- `src/renderer/assets/icons/Stoa-glass.png`

These remain the visual references and should not become the primary import targets for renderer code.

#### Consumable renderer assets

Create a small SVG-based brand asset set:

- `src/renderer/assets/brand/stoa-symbol.svg`
- `src/renderer/assets/brand/stoa-wordmark-horizontal.svg`

These are the canonical renderer-facing assets.

#### Consumable application assets

Create Windows packaging assets under:

- `build/icons/icon.png`
- `build/icons/icon-256.png`
- `build/icons/icon.ico`

These are the canonical packaging-facing assets.

## Visual Rules

### Style Allocation

- Use `glass` as the master visual for application icon output
- Use `flat` as the base for reusable SVG renderer assets
- Use `flat` for constrained or small-size usage because it preserves clarity better than the glass treatment

### Renderer Brand Set

The minimal renderer set includes:

1. **Symbol**
   - Temple mark only
   - No text
   - Must work at small UI sizes

2. **Horizontal wordmark**
   - Symbol on the left
   - `Stoa` wordmark on the right
   - Exported as a single SVG asset

### Wordmark Rendering

The wordmark SVG should contain fixed vector outlines, not runtime text nodes that depend on local fonts. This keeps the brand mark stable across environments and matches the goal of having directly usable project assets.

## Integration

### Electron Builder

Update `electron-builder.yml` to explicitly set the Windows icon:

- `win.icon: build/icons/icon.ico`

This makes packaging deterministic instead of relying on defaults or missing configuration.

### Renderer Usage

Renderer code should import from `src/renderer/assets/brand/` when it needs the product brand.

Approved usage rule:

- Use SVG brand assets for renderer surfaces
- Use app-icon bitmap assets for packaging and window/application icon use
- Do not directly consume the raw source PNGs from new renderer code

### Proof of Use

Implementation must wire the new renderer brand assets into an existing low-risk surface so they are proven in live UI. The preferred integration point is `src/renderer/components/TitleBar.vue`, replacing the current placeholder square `S` mark with the new brand symbol asset while preserving the existing layout and design-language constraints.

The goal is to prove the assets are real application inputs, not dead files in the repo.

## Generation Strategy

### Renderer SVG Assets

Reconstruct clean SVG assets from the approved brand forms rather than treating the source PNGs as final UI assets.

Requirements:

- The symbol SVG must be crisp, simple, and suitable for import by Vite
- The horizontal wordmark SVG must be self-contained
- Output should not rely on embedded raster images

### Application Icon Assets

Generate the application icon from the `glass` mark as a square icon composition suitable for Windows app/icon contexts.

Requirements:

- A high-resolution PNG source must exist
- A Windows `.ico` file must be generated from that source
- At least one explicit intermediate PNG size should be kept in-repo for traceability and reuse

If the repository already has a practical local tool path for image conversion, use it. Do not introduce a heavy new runtime dependency unless there is no other reliable option.

## File Ownership

- `src/renderer/assets/icons/` stays as source artwork storage
- `src/renderer/assets/brand/` becomes the renderer brand asset namespace
- `build/icons/` becomes the packaging icon namespace

This keeps the boundary clear:

- source artwork is not treated as runtime-ready
- runtime assets are stable and intentionally named

## Validation

The implementation is not complete until the repository quality gates pass.

Required verification:

1. `npm run test:generate`
2. `npm run typecheck`
3. `npx vitest run`
4. `npm run test:e2e`
5. `npm run test:behavior-coverage`

Additional practical verification:

- `npm run build`
- Confirm the new renderer SVG assets resolve through the Vite asset pipeline
- Confirm Electron Builder sees `build/icons/icon.ico`

## Out of Scope for This Spec

- macOS `.icns`
- Linux icon packaging variants
- Theme-switched brand variants
- A larger icon component library
- Brand documentation beyond this implementation spec
