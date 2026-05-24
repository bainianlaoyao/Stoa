# X Promotion Asset Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the promo asset pipeline from a handful of screenshots into a richer asset system that captures real Stoa workflows, writes structured asset metadata, and produces ready-to-post promo packs.

**Architecture:** Keep the current local file-backed promo pipeline and expand `build-assets` into two layers. First, an Electron capture layer produces more grounded screenshot scenes plus optional motion candidates. Then a pack-builder layer derives carousel, highlight, trust-proof, and social-preview assets from those scenes while emitting structured manifest metadata that downstream week-planning and daily orchestration can consume without extra rules.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, Playwright Electron helpers, Sharp, existing promo CLI and fact-pack pipeline

---

### Task 1: Expand promo asset metadata types

**Files:**
- Modify: `src/core/promo/types.ts`
- Modify: `src/core/promo/fact-pack.test.ts`
- Modify: `src/core/promo/asset-factory.test.ts`

- [ ] **Step 1: Write failing tests that expect structured promo asset metadata**

Add assertions to the existing asset and fact-pack tests so they require `category`, `scene`, `kind`, `tags`, `alt`, `source`, and `derivesFrom` on assets returned by `buildPromoAssets()` and `buildFactPack()`.

- [ ] **Step 2: Run the focused tests to verify they fail for missing metadata**

Run: `npx vitest run src/core/promo/asset-factory.test.ts src/core/promo/fact-pack.test.ts`

Expected: FAIL because current `PromoAsset` objects only expose `fileName`, `relativePath`, `absolutePath`, and `note`.

- [ ] **Step 3: Extend the promo asset types minimally**

Update `src/core/promo/types.ts` so `PromoAsset` includes:

```ts
export type PromoAssetKind = 'screenshot' | 'gif' | 'video' | 'social-preview' | 'fact-card'
export type PromoAssetCategory = 'overview' | 'workflow' | 'closeup' | 'meta' | 'trust' | 'pack'
export type PromoAssetSource = 'readme-sync' | 'electron-capture' | 'fact-card-generator' | 'derived-pack'

export interface PromoAsset {
  fileName: string
  relativePath: string
  absolutePath: string
  note: string | null
  alt: string | null
  category: PromoAssetCategory
  scene: string
  kind: PromoAssetKind
  tags: string[]
  source: PromoAssetSource
  derivesFrom: string[]
}
```

- [ ] **Step 4: Re-run the focused tests**

Run: `npx vitest run src/core/promo/asset-factory.test.ts src/core/promo/fact-pack.test.ts`

Expected: Still FAIL, now in implementation sites that have not populated the new fields.

### Task 2: Upgrade asset-factory tests to require richer assets and derived packs

**Files:**
- Modify: `src/core/promo/asset-factory.test.ts`

- [ ] **Step 1: Add failing tests for capture categories, sidecar metadata, and derived packs**

Extend `src/core/promo/asset-factory.test.ts` with:

```ts
test('writes metadata-rich sidecars and derived pack assets', async () => {
  // arrange a readme screenshot + captured live screenshots
  // assert the manifest contains overview/workflow/pack categories
  // assert at least one derived carousel image and one social-preview image exist
  // assert their `source` is `derived-pack` and `derivesFrom` is non-empty
})
```

Also assert the stored manifest contains generated assets under paths like:

- `generated/live/overview/...`
- `generated/live/workflow/...`
- `generated/packs/carousel/...`
- `generated/packs/social-preview/...`

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/core/promo/asset-factory.test.ts`

Expected: FAIL because the current asset factory only seeds README images and two flat live screenshots.

### Task 3: Implement metadata sidecars and manifest parsing helpers

**Files:**
- Modify: `src/core/promo/asset-factory.ts`
- Modify: `src/core/promo/fact-pack.ts`

- [ ] **Step 1: Implement sidecar metadata helpers in the asset factory**

Add small helpers to `src/core/promo/asset-factory.ts` to read and write structured sidecar files. Use a compact JSON sidecar format to avoid fragile markdown parsing:

```ts
interface PromoAssetSidecar {
  note: string
  alt: string
  category: PromoAssetCategory
  scene: string
  kind: PromoAssetKind
  tags: string[]
  source: PromoAssetSource
  derivesFrom?: string[]
}
```

Store each sidecar in the sibling `.md` file using:

```md
{"note":"...","alt":"...","category":"overview","scene":"app-shell-overview","kind":"screenshot","tags":["shell","workspace"],"source":"electron-capture","derivesFrom":[]}
```

with a trailing newline.

- [ ] **Step 2: Implement parsing fallback in fact-pack**

Teach `src/core/promo/fact-pack.ts` to parse the sidecar JSON when present and populate the richer `PromoAsset` fields. If parsing fails, keep the old behavior by treating the whole sidecar as `note` and defaulting:

```ts
alt: null
category: 'overview'
scene: basename(entry.relativePath, extension)
kind: infer from extension
tags: []
source: entry.relativePath.startsWith('generated/') ? 'electron-capture' : 'readme-sync'
derivesFrom: []
```

- [ ] **Step 3: Re-run asset and fact-pack tests**

Run: `npx vitest run src/core/promo/asset-factory.test.ts src/core/promo/fact-pack.test.ts`

Expected: Some tests still FAIL until the asset factory writes the new structure.

### Task 4: Expand the Electron capture matrix

**Files:**
- Modify: `src/core/promo/asset-factory.ts`
- Modify: `tests/e2e-playwright/helpers/ui-actions.ts` (only if a helper is clearly needed for reliable capture flows)

- [ ] **Step 1: Add a failing asset-factory test for multiple capture scenes**

Extend the asset factory test to expect captured scenes named:

- `app-shell-overview`
- `workspace-multi-session`
- `provider-floating-card`
- `provider-radial-menu`
- `session-context-menu-restart`
- `archive-restore`
- `meta-session-overview`

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/core/promo/asset-factory.test.ts`

Expected: FAIL because current capture only writes `app-shell-overview` and `settings-surface`.

- [ ] **Step 3: Implement a capture scene registry**

In `src/core/promo/asset-factory.ts`, replace the hardcoded two-screenshot capture with a small scene list plus capture helpers. Capture these scenes using the existing Electron launch flow and stable selectors:

```ts
await capturePageScreenshot(page, generatedAssetsDir, {
  relativePath: 'generated/live/overview/app-shell-overview.png',
  note: 'Shows the app shell and workspace hierarchy before any project-specific setup.',
  alt: 'Stoa app shell with the workspace hierarchy and command surface visible.',
  category: 'overview',
  scene: 'app-shell-overview',
  kind: 'screenshot',
  tags: ['shell', 'workspace', 'overview'],
  source: 'electron-capture'
})
```

Create demo content before scene capture by:

- creating two projects through the renderer bridge or E2E helpers
- creating multiple sessions through the existing quick-add flow
- opening the floating provider card
- opening the radial menu
- opening the session context menu
- switching to archive surface when needed
- switching to meta-session surface for meta captures

If some scenes are flaky, catch per-scene failure and continue.

- [ ] **Step 4: Re-run the focused test**

Run: `npx vitest run src/core/promo/asset-factory.test.ts`

Expected: Capture-scene assertions pass or move forward to pack-generation failures.

### Task 5: Generate trust cards and distribution packs

**Files:**
- Modify: `src/core/promo/asset-factory.ts`
- Modify: `src/core/promo/asset-factory.test.ts`

- [ ] **Step 1: Add failing tests for trust cards and derived packs**

Extend `src/core/promo/asset-factory.test.ts` with assertions for:

- one `generated/trust/apache-open-source-card.png`
- one `generated/trust/release-velocity-card.png`
- one `generated/packs/carousel/workflow-core-1.png`
- one `generated/packs/social-preview/stoa-social-preview.png`

and ensure those assets carry:

- `category: 'trust'` or `category: 'pack'`
- `kind: 'fact-card'` or `kind: 'social-preview'`
- `source: 'fact-card-generator'` or `source: 'derived-pack'`

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/core/promo/asset-factory.test.ts`

Expected: FAIL because no generated cards or packs exist yet.

- [ ] **Step 3: Implement derived asset generation using Sharp**

In `src/core/promo/asset-factory.ts`, add two minimal image generators:

1. `buildTrustCards(...)`
   - render SVG strings with repo facts like `Apache-2.0`, `Open source`, `Non-commercial`, and release note count
   - rasterize them with `sharp(Buffer.from(svg)).png().toFile(...)`

2. `buildDistributionPacks(...)`
   - choose a small set of assets by scene/category
   - create a simple side-by-side or framed OG image using SVG + embedded labels
   - copy selected atomic images into `packs/carousel/` as a ready-to-post 4-image set

Keep visuals intentionally simple and deterministic. This task is not a design system project.

- [ ] **Step 4: Re-run the focused test**

Run: `npx vitest run src/core/promo/asset-factory.test.ts`

Expected: PASS for trust and pack assertions.

### Task 6: Ensure fact-pack and planners consume upgraded assets

**Files:**
- Modify: `src/core/promo/fact-pack.ts`
- Modify: `src/core/promo/week-planner.test.ts`
- Modify: `src/core/promo/daily-orchestrator.test.ts`

- [ ] **Step 1: Add failing tests that verify upgraded assets flow into planning/orchestration**

Update planner/orchestrator tests so the generated input includes structured assets with category and tags. Assert that:

- `buildFactPack()` returns pack and trust assets alongside screenshots
- week planner still serializes these assets without shape regressions
- daily orchestrator still works when `assetFileNames` point at derived pack assets

- [ ] **Step 2: Run the focused tests to verify they fail where shape assumptions are stale**

Run: `npx vitest run src/core/promo/fact-pack.test.ts src/core/promo/week-planner.test.ts src/core/promo/daily-orchestrator.test.ts`

Expected: FAIL only if any test fixtures or implementation still assume the old asset shape.

- [ ] **Step 3: Make the minimal compatibility updates inside promo modules**

Adjust any prompt-building or markdown rendering code that relies on raw asset shape so it cleanly serializes the richer `PromoAsset` records. Do not add compatibility migrations; update the current contract directly.

- [ ] **Step 4: Re-run the focused tests**

Run: `npx vitest run src/core/promo/fact-pack.test.ts src/core/promo/week-planner.test.ts src/core/promo/daily-orchestrator.test.ts`

Expected: PASS.

### Task 7: Document the new implementation behavior in the current plan/spec artifacts

**Files:**
- Modify: `docs/superpowers/specs/2026-05-18-x-promotion-asset-upgrade-design.md` (only if implementation materially differs)
- Modify: `docs/superpowers/plans/2026-05-18-x-promotion-asset-upgrade.md` (mark completed intent if needed)

- [ ] **Step 1: Re-read the spec against the implemented file structure**

Check that implemented paths, scene names, and asset kinds match the spec.

- [ ] **Step 2: If implementation diverged, patch the spec to match reality**

Only update the design doc when the code proved a better, simpler structure than the original text.

- [ ] **Step 3: No-op if the spec is already accurate**

Do not churn docs for cosmetic reasons.

### Task 8: Run the full repo verification gate

**Files:**
- Test: `src/core/promo/*.test.ts`
- Test: `tools/promo/index.test.ts`
- Test: repository-wide gates

- [ ] **Step 1: Run the targeted promo tests**

Run: `npx vitest run src/core/promo/asset-factory.test.ts src/core/promo/fact-pack.test.ts src/core/promo/week-planner.test.ts src/core/promo/daily-orchestrator.test.ts tools/promo/index.test.ts`

Expected: PASS.

- [ ] **Step 2: Regenerate deterministic generated tests**

Run: `npm run test:generate`

Expected: exit 0.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 4: Run the full Vitest suite**

Run: `npx vitest run`

Expected: exit 0.

- [ ] **Step 5: Run Electron Playwright journeys**

Run: `npm run test:e2e`

Expected: exit 0.

- [ ] **Step 6: Run behavior coverage**

Run: `npm run test:behavior-coverage`

Expected: exit 0.

- [ ] **Step 7: Smoke the promo pipeline with real commands**

Run:

```bash
npm run promo -- build-assets
npm run promo -- plan-week
npm run promo -- run-full
```

Expected: all commands exit 0 and write updated promo artifacts under `automation/promo/out/`.

Plan complete and saved to `docs/superpowers/plans/2026-05-18-x-promotion-asset-upgrade.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints
