# X Promotion Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal local X promotion pipeline that can generate grounded post candidates, collect relevant X discussions, auto-publish selected main posts, and require explicit confirmation before sending replies.

**Architecture:** Keep the pipeline prompt-first and file-backed. A small Node/TypeScript core builds a fact pack from repo docs and local promo assets, calls one local LLM CLI for structured orchestration output, and uses the local kimi-webbridge daemon as the only browser execution layer for X posting and replying.

**Tech Stack:** TypeScript, Node.js filesystem/process APIs, Vitest, local Claude CLI structured output, local kimi-webbridge HTTP daemon

---

### File Structure

**Create:**
- `automation/promo/assets/.gitkeep`
- `automation/promo/config/search-queries.json`
- `automation/promo/config/settings.json`
- `automation/promo/config/voice.md`
- `automation/promo/out/.gitkeep`
- `automation/promo/state/.gitkeep`
- `src/core/promo/types.ts`
- `src/core/promo/promo-paths.ts`
- `src/core/promo/promo-paths.test.ts`
- `src/core/promo/fact-pack.ts`
- `src/core/promo/fact-pack.test.ts`
- `src/core/promo/history-store.ts`
- `src/core/promo/history-store.test.ts`
- `src/core/promo/claude-cli.ts`
- `src/core/promo/claude-cli.test.ts`
- `src/core/promo/webbridge-client.ts`
- `src/core/promo/webbridge-client.test.ts`
- `src/core/promo/x-engagement.ts`
- `src/core/promo/x-engagement.test.ts`
- `src/core/promo/daily-orchestrator.ts`
- `src/core/promo/daily-orchestrator.test.ts`
- `tools/promo/index.ts`
- `tools/promo/index.test.ts`

**Modify:**
- `package.json`

### Task 1: Scaffold promo directories, defaults, and path helpers

**Files:**
- Create: `automation/promo/assets/.gitkeep`
- Create: `automation/promo/config/search-queries.json`
- Create: `automation/promo/config/settings.json`
- Create: `automation/promo/config/voice.md`
- Create: `automation/promo/out/.gitkeep`
- Create: `automation/promo/state/.gitkeep`
- Create: `src/core/promo/types.ts`
- Create: `src/core/promo/promo-paths.ts`
- Create: `src/core/promo/promo-paths.test.ts`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run `npx vitest run src/core/promo/promo-paths.test.ts` and verify failure**
- [ ] **Step 3: Implement promo directory resolution, default config paths, and path creation helpers**
- [ ] **Step 4: Run `npx vitest run src/core/promo/promo-paths.test.ts` and verify pass**

### Task 2: Build fact-pack generation with repo sources and promo assets

**Files:**
- Create: `src/core/promo/fact-pack.ts`
- Create: `src/core/promo/fact-pack.test.ts`
- Modify: `src/core/promo/types.ts`

- [ ] **Step 1: Write failing tests for reading repo fact sources, asset sidecars, and output shape**
- [ ] **Step 2: Run `npx vitest run src/core/promo/fact-pack.test.ts` and verify failure**
- [ ] **Step 3: Implement fact-pack generation**
- [ ] **Step 4: Run `npx vitest run src/core/promo/fact-pack.test.ts` and verify pass**

### Task 3: Add history state and duplicate-memory helpers

**Files:**
- Create: `src/core/promo/history-store.ts`
- Create: `src/core/promo/history-store.test.ts`
- Modify: `src/core/promo/types.ts`

- [ ] **Step 1: Write failing tests for loading empty history, appending post records, and summarizing duplicate memory**
- [ ] **Step 2: Run `npx vitest run src/core/promo/history-store.test.ts` and verify failure**
- [ ] **Step 3: Implement file-backed history store**
- [ ] **Step 4: Run `npx vitest run src/core/promo/history-store.test.ts` and verify pass**

### Task 4: Add the local Claude structured-output adapter

**Files:**
- Create: `src/core/promo/claude-cli.ts`
- Create: `src/core/promo/claude-cli.test.ts`

- [ ] **Step 1: Write failing tests for structured prompt invocation, JSON parsing, and command failure surfacing**
- [ ] **Step 2: Run `npx vitest run src/core/promo/claude-cli.test.ts` and verify failure**
- [ ] **Step 3: Implement the Claude CLI adapter with `-p` and `--json-schema`**
- [ ] **Step 4: Run `npx vitest run src/core/promo/claude-cli.test.ts` and verify pass**

### Task 5: Add the webbridge HTTP client and X browser actions

**Files:**
- Create: `src/core/promo/webbridge-client.ts`
- Create: `src/core/promo/webbridge-client.test.ts`
- Create: `src/core/promo/x-engagement.ts`
- Create: `src/core/promo/x-engagement.test.ts`

- [ ] **Step 1: Write failing tests for webbridge commands, X search result extraction, post publishing dry-run, and reply sending dry-run**
- [ ] **Step 2: Run `npx vitest run src/core/promo/webbridge-client.test.ts src/core/promo/x-engagement.test.ts` and verify failure**
- [ ] **Step 3: Implement the webbridge client and X engagement actions**
- [ ] **Step 4: Run `npx vitest run src/core/promo/webbridge-client.test.ts src/core/promo/x-engagement.test.ts` and verify pass**

### Task 6: Implement the prompt-first daily orchestrator

**Files:**
- Create: `src/core/promo/daily-orchestrator.ts`
- Create: `src/core/promo/daily-orchestrator.test.ts`
- Modify: `src/core/promo/types.ts`

- [ ] **Step 1: Write failing tests for orchestrator output, fallback behavior when X search fails, and Markdown artifact rendering**
- [ ] **Step 2: Run `npx vitest run src/core/promo/daily-orchestrator.test.ts` and verify failure**
- [ ] **Step 3: Implement orchestration, schema validation, and output artifact rendering**
- [ ] **Step 4: Run `npx vitest run src/core/promo/daily-orchestrator.test.ts` and verify pass**

### Task 7: Add the promo CLI entry points

**Files:**
- Create: `tools/promo/index.ts`
- Create: `tools/promo/index.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for `smoke`, `run-daily`, `publish-posts`, and `send-reply` command behavior**
- [ ] **Step 2: Run `npx vitest run tools/promo/index.test.ts` and verify failure**
- [ ] **Step 3: Implement the CLI commands and add package scripts**
- [ ] **Step 4: Run `npx vitest run tools/promo/index.test.ts` and verify pass**

### Task 8: Verify the new pipeline end to end

**Files:**
- Test: `src/core/promo/*.test.ts`
- Test: `tools/promo/index.test.ts`

- [ ] **Step 1: Run targeted promo tests**
  Run: `npx vitest run src/core/promo/promo-paths.test.ts src/core/promo/fact-pack.test.ts src/core/promo/history-store.test.ts src/core/promo/claude-cli.test.ts src/core/promo/webbridge-client.test.ts src/core/promo/x-engagement.test.ts src/core/promo/daily-orchestrator.test.ts tools/promo/index.test.ts`
- [ ] **Step 2: Run `npm run test:generate`**
- [ ] **Step 3: Run `npm run typecheck`**
- [ ] **Step 4: Run `npx vitest run`**
- [ ] **Step 5: Run `npm run test:e2e`**
- [ ] **Step 6: Run `npm run test:behavior-coverage`**

