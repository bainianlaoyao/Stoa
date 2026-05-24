# X Promotion Full Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing local X promotion autopilot into a manual one-shot full pipeline that auto-builds assets, writes a 7-day plan, and then generates/publishes today’s content.

**Architecture:** Keep the existing prompt-first file-backed design. Add one asset-factory module that produces grounded promo assets from existing repo screenshots plus stable Electron journeys, one week-planner module that generates a 7-day content plan through the same structured LLM adapter, and one `run-full` CLI path that composes assets, planning, daily generation, and optional publish.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, Playwright Electron helpers, local Claude CLI structured output, existing promo CLI

---

### Task 1: Extend promo paths and types for generated assets and week plans

**Files:**
- Modify: `src/core/promo/types.ts`
- Modify: `src/core/promo/promo-paths.ts`
- Modify: `src/core/promo/promo-paths.test.ts`

- [ ] Add generated asset and week-plan path coverage in tests first.
- [ ] Run: `npx vitest run src/core/promo/promo-paths.test.ts`
- [ ] Extend `PromoPaths` and scaffold defaults.
- [ ] Re-run: `npx vitest run src/core/promo/promo-paths.test.ts`

### Task 2: Teach fact-pack to read nested generated assets

**Files:**
- Modify: `src/core/promo/types.ts`
- Modify: `src/core/promo/fact-pack.ts`
- Modify: `src/core/promo/fact-pack.test.ts`

- [ ] Add a failing test for nested generated assets and sidecar notes.
- [ ] Run: `npx vitest run src/core/promo/fact-pack.test.ts`
- [ ] Implement recursive asset discovery and richer asset metadata.
- [ ] Re-run: `npx vitest run src/core/promo/fact-pack.test.ts`

### Task 3: Add the asset factory

**Files:**
- Create: `src/core/promo/asset-factory.ts`
- Create: `src/core/promo/asset-factory.test.ts`

- [ ] Add failing tests for seeding existing screenshots, writing sidecars, and producing `asset-manifest.json`.
- [ ] Run: `npx vitest run src/core/promo/asset-factory.test.ts`
- [ ] Implement seeded asset sync plus injectable live-capture support.
- [ ] Re-run: `npx vitest run src/core/promo/asset-factory.test.ts`

### Task 4: Add the week planner

**Files:**
- Create: `src/core/promo/week-planner.ts`
- Create: `src/core/promo/week-planner.test.ts`

- [ ] Add failing tests for week-plan JSON / Markdown generation and 7-day date windows.
- [ ] Run: `npx vitest run src/core/promo/week-planner.test.ts`
- [ ] Implement planning flow using the existing structured-output adapter.
- [ ] Re-run: `npx vitest run src/core/promo/week-planner.test.ts`

### Task 5: Inject week-plan context into the daily orchestrator

**Files:**
- Modify: `src/core/promo/daily-orchestrator.ts`
- Modify: `src/core/promo/daily-orchestrator.test.ts`

- [ ] Add a failing test proving `run-daily` consumes the current day’s week-plan context when available.
- [ ] Run: `npx vitest run src/core/promo/daily-orchestrator.test.ts`
- [ ] Implement week-plan loading and prompt enrichment with graceful fallback.
- [ ] Re-run: `npx vitest run src/core/promo/daily-orchestrator.test.ts`

### Task 6: Extend the promo CLI with `build-assets`, `plan-week`, and `run-full`

**Files:**
- Modify: `tools/promo/index.ts`
- Modify: `tools/promo/index.test.ts`

- [ ] Add failing tests for the new commands and `run-full` sequencing.
- [ ] Run: `npx vitest run tools/promo/index.test.ts`
- [ ] Implement the new commands and default orchestration flow.
- [ ] Re-run: `npx vitest run tools/promo/index.test.ts`

### Task 7: Verify the full promo pipeline

**Files:**
- Test: `src/core/promo/*.test.ts`
- Test: `tools/promo/index.test.ts`

- [ ] Run targeted promo tests.
- [ ] Run `npm run test:generate`
- [ ] Run `npm run typecheck`
- [ ] Run `npx vitest run`
- [ ] Run `npm run test:e2e`
- [ ] Run `npm run test:behavior-coverage`
